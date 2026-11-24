import { describe, expect, it, vi } from 'vitest';
import { cardBrandName, planWalletUse } from './wallet-rules.js';
import { adminAdjustSchema } from './wallet.schemas.js';
import { WalletService } from './wallet.service.js';

describe('wallet rules', () => {
  it('uses as much credit as the customer has, up to what they owe', () => {
    expect(planWalletUse(10, 25.5, true)).toBe(10);
    expect(planWalletUse(40, 25.5, true)).toBe(25.5);
    expect(planWalletUse(40, 25.5, false)).toBe(0);
    expect(planWalletUse(0, 25.5, true)).toBe(0);
  });

  it('names card brands', () => {
    expect(cardBrandName('visa')).toBe('Visa');
    expect(cardBrandName('amex')).toBe('American Express');
    expect(cardBrandName('newbrand')).toBe('Newbrand');
  });

  it('validates admin adjustments', () => {
    expect(adminAdjustSchema.parse({ amount: '12.345', reason: 'Goodwill' }).amount).toBe(12.35);
    expect(adminAdjustSchema.safeParse({ amount: 0, reason: 'Goodwill' }).success).toBe(false);
    expect(adminAdjustSchema.safeParse({ amount: 99999, reason: 'Goodwill' }).success).toBe(false);
    expect(adminAdjustSchema.safeParse({ amount: 5, reason: '' }).success).toBe(false);
  });
});

/** In-memory Prisma double for the ledger: one user, a list of wallet rows. */
function fakePrisma(start = 0) {
  const user = { id: 'u1', role: 'CUSTOMER', walletBalance: start, stripeCustomerId: null as string | null };
  const rows: Array<Record<string, any>> = [];
  const tx = {
    walletTransaction: {
      findUnique: vi.fn(async ({ where }) => rows.find((r) => r.referenceKey === where.referenceKey) ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { id: `w${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      }),
      count: vi.fn(async () => rows.length),
      findMany: vi.fn(async () => [...rows].reverse()),
    },
    user: {
      findUnique: vi.fn(async () => user),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.walletBalance !== user.walletBalance) return { count: 0 };
        user.walletBalance = data.walletBalance;
        return { count: 1 };
      }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma, user, rows };
}

const make = (start = 0) => {
  const f = fakePrisma(start);
  const config = { get: () => '' };
  return { ...f, wallet: new WalletService(f.prisma as never, config as never) };
};

describe('WalletService store credit', () => {
  it('admin credit and debit update the balance and the ledger', async () => {
    const { wallet, user, rows } = make(0);
    await wallet.adminAdjust('u1', 20, 'Goodwill', 'admin1');
    await wallet.adminAdjust('u1', -5, 'Correction', 'admin1');
    expect(user.walletBalance).toBe(15);
    expect(rows.map((r) => [r.type, r.amount, r.balanceAfter])).toEqual([
      ['ADMIN_CREDIT', 20, 20],
      ['ADMIN_DEBIT', -5, 15],
    ]);
  });

  it('never goes below zero', async () => {
    const { wallet, user } = make(3);
    await expect(wallet.adminAdjust('u1', -5, 'Too much', 'admin1')).rejects.toThrow(/only has £3.00/);
    expect(user.walletBalance).toBe(3);
  });

  it('spends credit on an order once, and gives it back once when cancelled', async () => {
    const { wallet, user, rows } = make(30);
    const order = { id: 'o1', orderNumber: 'SLZ-1' };
    expect(await wallet.payForOrder({ userId: 'u1', orderId: 'o1', orderNumber: 'SLZ-1', amount: 12.5, strict: true })).toBe(12.5);
    expect(await wallet.payForOrder({ userId: 'u1', orderId: 'o1', orderNumber: 'SLZ-1', amount: 12.5, strict: true })).toBe(0); // same order again
    expect(user.walletBalance).toBe(17.5);
    expect(await wallet.returnForOrder(order)).toBe(12.5);
    expect(await wallet.returnForOrder(order)).toBe(0);
    expect(user.walletBalance).toBe(30);
    expect(rows.map((r) => r.type)).toEqual(['ORDER_PAYMENT', 'ORDER_RETURN']);
  });

  it('strict payment fails without enough credit; lenient takes what is left', async () => {
    const strict = make(5);
    await expect(strict.wallet.payForOrder({ userId: 'u1', orderId: 'o1', orderNumber: 'SLZ-1', amount: 8, strict: true })).rejects.toThrow(/changed/);
    expect(strict.user.walletBalance).toBe(5);
    const lenient = make(5);
    expect(await lenient.wallet.payForOrder({ userId: 'u1', orderId: 'o1', orderNumber: 'SLZ-1', amount: 8, strict: false })).toBe(5);
    expect(lenient.user.walletBalance).toBe(0);
  });

});

describe('WalletService payments', () => {
  it("lists the customer's paid orders with how they were paid", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'o2', orderNumber: 'SLZ-2', createdAt: new Date(), total: 30, walletUsed: 10, paymentMode: 'stripe', paymentLabel: 'Store credit + Visa •••• 4242', paymentStatus: 'PAID', status: 'PLACED' },
      { id: 'o1', orderNumber: 'SLZ-1', createdAt: new Date(), total: 28.88, walletUsed: 0, paymentMode: 'demo', paymentLabel: '', paymentStatus: 'PAID', status: 'PLACED' },
    ]);
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ email: 'Sam@Example.com' }) }, order: { findMany } };
    const wallet = new WalletService(prisma as never, { get: () => '' } as never);
    const res = await wallet.payments('u1');
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ userId: 'u1' }, { customerEmail: 'sam@example.com' }]);
    expect(res.map((p) => [p.paymentLabel, p.cardPaid])).toEqual([
      ['Store credit + Visa •••• 4242', 20],
      ['Card (test payment)', 28.88],
    ]);
  });
});

describe('WalletService test-mode cards (no Stripe)', () => {
  function setup() {
    const rows: Array<Record<string, any>> = [];
    const walletCard = {
      findMany: vi.fn(async ({ where }) => rows.filter((r) => r.userId === where.userId).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))),
      findFirst: vi.fn(async ({ where }) => rows.find((r) => r.userId === where.userId && (!where.id || r.id === where.id)) ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { id: `00000000-0000-4000-8000-00000000000${rows.length + 1}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }) => {
        rows.filter((r) => r.userId === where.userId).forEach((r) => Object.assign(r, data));
        return { count: 1 };
      }),
      delete: vi.fn(async ({ where }) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)[0]),
    };
    const tx = { walletCard };
    const prisma = { walletCard, $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg as unknown[]))) };
    return { wallet: new WalletService(prisma as never, { get: () => '' } as never), rows };
  }
  const card = { brand: 'Visa' as const, last4: '4242', expMonth: 12, expYear: 2099, makeDefault: false };

  it('saves brand / last 4 / expiry only; the first card is the default', async () => {
    const { wallet, rows } = setup();
    expect(wallet.cardsMode).toBe('test');
    await wallet.addTestCard('u1', card);
    await wallet.addTestCard('u1', card); // same card again: no duplicate
    await wallet.addTestCard('u1', { ...card, brand: 'Mastercard', last4: '5100' });
    expect(rows.map((r) => [r.brand, r.last4, r.isDefault])).toEqual([
      ['Visa', '4242', true],
      ['Mastercard', '5100', false],
    ]);
    expect(Object.keys(rows[0])).not.toContain('number');
    expect((await wallet.listCards('u1'))[0]).toMatchObject({ last4: '4242', isDefault: true });
  });

  it('refuses expired cards; removing the default promotes the next card', async () => {
    const { wallet, rows } = setup();
    await expect(wallet.addTestCard('u1', { ...card, expYear: 2001 })).rejects.toThrow(/expired/);
    await wallet.addTestCard('u1', card);
    await wallet.addTestCard('u1', { ...card, last4: '1111' });
    await wallet.removeCard('u1', rows[0].id);
    expect(rows.map((r) => [r.last4, r.isDefault])).toEqual([['1111', true]]);
  });
});
