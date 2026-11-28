import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { LoyaltyEntryStatus, LoyaltyEntryType, OrderStatus, PaymentStatus, UserRole, UserStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEFAULT_LOYALTY_CONFIG, parseLoyaltyConfigForSave, readLoyaltyConfig, type LoyaltyConfig } from './loyalty-config.js';
import { isBirthdayMonth, planRedemption, pointsForSpend, tierFor } from './loyalty-rules.js';
import { LoyaltyService } from './loyalty.service.js';

const cfg = (patch: Partial<LoyaltyConfig> = {}): LoyaltyConfig => ({ ...DEFAULT_LOYALTY_CONFIG, ...patch });

describe('loyalty rules', () => {
  it('earns 1 point per whole £1, with the tier multiplier', () => {
    expect(pointsForSpend(cfg(), 49.99)).toBe(49);
    expect(pointsForSpend(cfg(), 100, 1500)).toBe(125); // Gold ×1.25
    expect(pointsForSpend(cfg({ enabled: false }), 100)).toBe(0);
  });

  it('finds the tier and the next one', () => {
    expect(tierFor(cfg(), 0).tier.name).toBe('Green');
    expect(tierFor(cfg(), 499).next?.name).toBe('Silver');
    expect(tierFor(cfg(), 2000)).toMatchObject({ tier: { name: 'Gold' }, next: null });
  });

  it('plans redemptions: 100 points = £1, limited by balance, minimum and order value', () => {
    expect(planRedemption(cfg(), 250, 1000, 50)).toEqual({ points: 250, discount: 2.5, limitedBy: null });
    expect(planRedemption(cfg(), 800, 300, 50)).toMatchObject({ points: 300, discount: 3, limitedBy: 'balance' });
    expect(planRedemption(cfg(), 9000, 9000, 20)).toMatchObject({ points: 2000, discount: 20, limitedBy: 'order' });
    expect(planRedemption(cfg(), 50, 1000, 50)).toMatchObject({ points: 0, limitedBy: 'minimum' });
    const half = cfg({ redeem: { ...DEFAULT_LOYALTY_CONFIG.redeem, maxPercentOfOrder: 50 } });
    expect(planRedemption(half, 5000, 5000, 30)).toMatchObject({ points: 1500, discount: 15 });
  });

  it('detects the birthday month', () => {
    expect(isBirthdayMonth('1990-11-03', new Date('2026-11-21T00:00:00Z'))).toBe(true);
    expect(isBirthdayMonth('1990-12-03', new Date('2026-11-21T00:00:00Z'))).toBe(false);
    expect(isBirthdayMonth('', new Date())).toBe(false);
  });

  it('validates saves and reads old data safely', () => {
    const bad = parseLoyaltyConfigForSave({ ...DEFAULT_LOYALTY_CONFIG, tiers: [{ id: 'a', name: 'A', minLifetime: 10, multiplier: 1, perk: '' }] });
    expect(bad.ok).toBe(false);
    expect(readLoyaltyConfig({ bonuses: { welcome: 250 } }).bonuses).toEqual({ welcome: 250, birthday: 100 });
  });
});

// ---- Service with an in-memory database -------------------------------------------

interface Row {
  id: string;
  userId: string;
  type: LoyaltyEntryType;
  status: LoyaltyEntryStatus;
  points: number;
  description: string;
  orderId: string | null;
  referenceKey: string;
  createdAt: Date;
}

function makeDb(config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG) {
  const users = new Map<string, { id: string; role: UserRole; isEmailVerified: boolean; birthday: string; status: UserStatus; archivedAt: Date | null; loyaltyPoints: number; loyaltyLifetime: number }>();
  const orders = new Map<string, { id: string; orderNumber: string; status: OrderStatus; paymentStatus: PaymentStatus }>();
  const rows: Row[] = [];
  let n = 0;
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);

  const db = {
    cmsSection: { findUnique: async () => ({ data: config }) },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { loyaltyPoints?: { increment: number }; loyaltyLifetime?: { increment: number } } }) => {
        const u = users.get(where.id)!;
        u.loyaltyPoints += data.loyaltyPoints?.increment ?? 0;
        u.loyaltyLifetime += data.loyaltyLifetime?.increment ?? 0;
        return u;
      },
      updateMany: async ({ where, data }: { where: { id: string; loyaltyPoints?: { gte: number }; loyaltyLifetime?: { gte: number } }; data: { loyaltyPoints?: { decrement: number }; loyaltyLifetime?: { decrement: number } } }) => {
        const u = users.get(where.id);
        if (!u) return { count: 0 };
        if (where.loyaltyPoints && u.loyaltyPoints < where.loyaltyPoints.gte) return { count: 0 };
        if (where.loyaltyLifetime && u.loyaltyLifetime < where.loyaltyLifetime.gte) return { count: 0 };
        u.loyaltyPoints -= data.loyaltyPoints?.decrement ?? 0;
        u.loyaltyLifetime -= data.loyaltyLifetime?.decrement ?? 0;
        return { count: 1 };
      },
    },
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => orders.get(where.id) ?? null,
      findMany: async () => [...orders.values()],
    },
    loyaltyTransaction: {
      create: async ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
        if (rows.some((r) => r.referenceKey === data.referenceKey)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { ...data, id: `t${++n}`, createdAt: new Date(Date.now() + n) };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => ({
        _sum: { points: rows.filter((r) => match(r, where)).reduce((s, r) => s + r.points, 0) },
      }),
    },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const addUser = (id: string, extra: Partial<{ isEmailVerified: boolean; birthday: string; loyaltyPoints: number }> = {}) =>
    users.set(id, { id, role: UserRole.CUSTOMER, isEmailVerified: true, birthday: '', status: UserStatus.ACTIVE, archivedAt: null, loyaltyPoints: 0, loyaltyLifetime: 0, ...extra });
  const service = new LoyaltyService(db as unknown as PrismaService);
  return { service, users, orders, rows, addUser };
}

describe('LoyaltyService', () => {
  it('gives the welcome bonus once, to verified customers only', async () => {
    const { service, users, addUser } = makeDb();
    addUser('u1');
    addUser('u2', { isEmailVerified: false });
    await service.ensureAutoBonuses('u1');
    await service.ensureAutoBonuses('u1');
    await service.ensureAutoBonuses('u2');
    expect(users.get('u1')!.loyaltyPoints).toBe(100);
    expect(users.get('u2')!.loyaltyPoints).toBe(0);
  });

  it('gives the birthday bonus once per year in the birthday month', async () => {
    const { service, users, addUser } = makeDb();
    const month = String(new Date().getUTCMonth() + 1).padStart(2, '0');
    addUser('u1', { isEmailVerified: false, birthday: `1990-${month}-15` });
    await service.ensureAutoBonuses('u1');
    await service.ensureAutoBonuses('u1');
    expect(users.get('u1')!.loyaltyPoints).toBe(100);
  });

  it('lets a social reward be claimed once per platform', async () => {
    const { service, users, addUser } = makeDb();
    addUser('u1', { isEmailVerified: false });
    await expect(service.claimSocial('u1', 'facebook')).resolves.toEqual({ ok: true, points: 50 });
    await expect(service.claimSocial('u1', 'facebook')).rejects.toThrow(/already claimed/);
    await expect(service.claimSocial('u1', 'x')).rejects.toThrow(/not available/); // inactive by default
    expect(users.get('u1')!.loyaltyPoints).toBe(50);
  });

  it('keeps purchase points pending until delivery, and spends redeemed points at once', async () => {
    const { service, users, orders, addUser } = makeDb();
    addUser('u1', { isEmailVerified: false, loyaltyPoints: 500 });
    orders.set('o1', { id: 'o1', orderNumber: 'SLZ-1', status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID });
    await service.recordOrder({ orderId: 'o1', orderNumber: 'SLZ-1', redeemUserId: 'u1', pointsRedeemed: 200, earnUserId: 'u1', pointsEarned: 40, paid: true });
    expect(users.get('u1')).toMatchObject({ loyaltyPoints: 300, loyaltyLifetime: 0 });

    await service.syncOrder('o1'); // still processing
    expect(users.get('u1')!.loyaltyPoints).toBe(300);

    orders.get('o1')!.status = OrderStatus.DELIVERED;
    await service.syncOrder('o1');
    await service.syncOrder('o1'); // idempotent
    expect(users.get('u1')).toMatchObject({ loyaltyPoints: 340, loyaltyLifetime: 40 });
  });

  it('cancelling before delivery cancels the pending points and returns spent points', async () => {
    const { service, users, orders, rows, addUser } = makeDb();
    addUser('u1', { isEmailVerified: false, loyaltyPoints: 500 });
    orders.set('o1', { id: 'o1', orderNumber: 'SLZ-1', status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID });
    await service.recordOrder({ orderId: 'o1', orderNumber: 'SLZ-1', redeemUserId: 'u1', pointsRedeemed: 200, earnUserId: 'u1', pointsEarned: 40, paid: true });
    orders.get('o1')!.status = OrderStatus.CANCELLED;
    await service.syncOrder('o1');
    await service.syncOrder('o1');
    expect(users.get('u1')).toMatchObject({ loyaltyPoints: 500, loyaltyLifetime: 0 });
    expect(rows.find((r) => r.type === LoyaltyEntryType.PURCHASE)!.status).toBe(LoyaltyEntryStatus.CANCELLED);
  });

  it('refunding after delivery takes the earned points back', async () => {
    const { service, users, orders, addUser } = makeDb();
    addUser('u1', { isEmailVerified: false });
    orders.set('o1', { id: 'o1', orderNumber: 'SLZ-1', status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.PAID });
    await service.recordOrder({ orderId: 'o1', orderNumber: 'SLZ-1', redeemUserId: null, pointsRedeemed: 0, earnUserId: 'u1', pointsEarned: 60, paid: true });
    await service.syncOrder('o1');
    expect(users.get('u1')!.loyaltyPoints).toBe(60);

    orders.get('o1')!.paymentStatus = PaymentStatus.REFUNDED;
    orders.get('o1')!.status = OrderStatus.CANCELLED;
    await service.syncOrder('o1');
    expect(users.get('u1')).toMatchObject({ loyaltyPoints: 0, loyaltyLifetime: 0 });
  });

  it('never deducts more points than a customer has', async () => {
    const { service, addUser } = makeDb();
    addUser('u1', { isEmailVerified: false, loyaltyPoints: 30 });
    await expect(service.adminAdjust({ userId: 'u1', points: -50, reason: 'Correction' })).rejects.toThrow(/only has 30/);
    await expect(service.adminAdjust({ userId: 'u1', points: 70, reason: 'Goodwill' })).resolves.toMatchObject({ loyaltyPoints: 100 });
  });
});
