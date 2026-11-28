import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  LoyaltyEntryStatus,
  LoyaltyEntryType,
  OrderStatus,
  PaymentStatus,
  UserRole,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getAccountBlock } from '../users/account-access.js';
import { LOYALTY_CMS_KEY, readLoyaltyConfig, type LoyaltyConfig } from './loyalty-config.js';
import { isBirthdayMonth, planRedemption, pointsForSpend, pointsToPounds, tierFor } from './loyalty-rules.js';

type Tx = Prisma.TransactionClient;

interface NewEntry {
  userId: string;
  type: LoyaltyEntryType;
  status?: LoyaltyEntryStatus;
  points: number;
  description: string;
  orderId?: string | null;
  /** Unique per event. A second entry with the same key is ignored (idempotent). */
  referenceKey: string;
}

/** Entry types whose points count towards the lifetime total (tiers). */
const LIFETIME_TYPES = new Set<LoyaltyEntryType>([
  LoyaltyEntryType.WELCOME,
  LoyaltyEntryType.PURCHASE,
  LoyaltyEntryType.BIRTHDAY,
  LoyaltyEntryType.SOCIAL,
  LoyaltyEntryType.ADMIN,
]);

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Slimza Rewards. The ledger (`LoyaltyTransaction`) is the source of truth; each user's
 * spendable balance (`User.loyaltyPoints`) and lifetime total (`User.loyaltyLifetime`)
 * are updated in the same database transaction as the ledger row.
 *
 * Earning:   welcome (verified account) · purchases (pending until delivered) ·
 *            birthday month (once a year) · following on social (once per platform) · admin
 * Spending:  at checkout (CheckoutService → reserveForOrder), 100 points = £1 by default
 * Reversals: cancelled / refunded orders take back their points and return spent points
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<LoyaltyConfig> {
    const record = await this.prisma.cmsSection.findUnique({ where: { key: LOYALTY_CMS_KEY } });
    return readLoyaltyConfig(record?.data);
  }

  // ---- Ledger primitive ----------------------------------------------------------

  /**
   * Writes one ledger entry and, if it is AVAILABLE, moves the balance. Returns false when
   * an entry with the same referenceKey already exists (nothing changes).
   */
  private async addEntry(tx: Tx, entry: NewEntry): Promise<boolean> {
    const status = entry.status ?? LoyaltyEntryStatus.AVAILABLE;
    try {
      await tx.loyaltyTransaction.create({
        data: {
          userId: entry.userId,
          type: entry.type,
          status,
          points: entry.points,
          description: entry.description.slice(0, 300),
          orderId: entry.orderId ?? null,
          referenceKey: entry.referenceKey,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
    if (status === LoyaltyEntryStatus.AVAILABLE) await this.moveBalance(tx, entry.userId, entry.type, entry.points);
    return true;
  }

  private async moveBalance(tx: Tx, userId: string, type: LoyaltyEntryType, points: number) {
    if (points === 0) return;
    if (points < 0 && type !== LoyaltyEntryType.PURCHASE_REVERSAL) {
      // Spending / admin deductions may never take the balance below zero.
      const res = await tx.user.updateMany({
        where: { id: userId, loyaltyPoints: { gte: -points } },
        data: { loyaltyPoints: { decrement: -points } },
      });
      if (res.count === 0) throw new BadRequestException('Not enough loyalty points.');
      return;
    }
    const lifetimeDelta =
      LIFETIME_TYPES.has(type) && points > 0 ? points : type === LoyaltyEntryType.PURCHASE_REVERSAL ? points : 0;
    await tx.user.update({
      where: { id: userId },
      data: {
        loyaltyPoints: { increment: points },
        ...(lifetimeDelta ? { loyaltyLifetime: { increment: lifetimeDelta } } : {}),
      },
    });
  }

  /** Convenience wrapper: one entry in its own transaction. */
  private grant(entry: NewEntry) {
    return this.prisma.$transaction((tx) => this.addEntry(tx, entry));
  }

  // ---- Automatic bonuses -----------------------------------------------------------

  /**
   * Welcome + birthday bonuses. Safe to call often (idempotent); called when the customer
   * opens their points page and before checkout, so existing customers get them too.
   */
  async ensureAutoBonuses(userId: string, config?: LoyaltyConfig): Promise<void> {
    const cfg = config ?? (await this.getConfig());
    if (!cfg.enabled) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isEmailVerified: true, birthday: true, status: true, archivedAt: true },
    });
    if (!user || user.role !== UserRole.CUSTOMER || getAccountBlock(user)) return;

    if (cfg.bonuses.welcome > 0 && user.isEmailVerified) {
      await this.grant({
        userId,
        type: LoyaltyEntryType.WELCOME,
        points: cfg.bonuses.welcome,
        description: `Welcome to ${cfg.programName}`,
        referenceKey: `welcome:${userId}`,
      });
    }

    const now = new Date();
    if (cfg.bonuses.birthday > 0 && isBirthdayMonth(user.birthday, now)) {
      await this.grant({
        userId,
        type: LoyaltyEntryType.BIRTHDAY,
        points: cfg.bonuses.birthday,
        description: `Happy birthday from ${cfg.programName}!`,
        referenceKey: `birthday:${userId}:${now.getUTCFullYear()}`,
      });
    }
  }

  // ---- Customer --------------------------------------------------------------------

  async getSummary(userId: string) {
    const config = await this.getConfig();
    await this.ensureAutoBonuses(userId, config);

    const [user, entries, pendingAgg] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true, loyaltyLifetime: true, birthday: true } }),
      this.prisma.loyaltyTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, type: true, status: true, points: true, description: true, orderId: true, referenceKey: true, createdAt: true },
      }),
      this.prisma.loyaltyTransaction.aggregate({
        where: { userId, status: LoyaltyEntryStatus.PENDING },
        _sum: { points: true },
      }),
    ]);
    if (!user) throw new NotFoundException('Account not found');

    const orderIds = [...new Set(entries.map((e) => e.orderId).filter((id): id is string => Boolean(id)))];
    const orders = orderIds.length
      ? await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } })
      : [];
    const orderNumbers = new Map(orders.map((o) => [o.id, o.orderNumber]));
    const { tier, next } = tierFor(config, user.loyaltyLifetime);

    return {
      enabled: config.enabled,
      balance: user.loyaltyPoints,
      balanceValue: pointsToPounds(config, user.loyaltyPoints),
      pending: pendingAgg._sum.points ?? 0,
      lifetime: user.loyaltyLifetime,
      tier,
      nextTier: next,
      hasBirthday: /^\d{4}-\d{2}-\d{2}$/.test(user.birthday ?? ''),
      socialClaimed: entries
        .filter((e) => e.type === LoyaltyEntryType.SOCIAL)
        .map((e) => e.referenceKey.split(':')[2])
        .filter(Boolean),
      ledger: entries.map(({ referenceKey: _ref, ...e }) => ({
        ...e,
        orderNumber: e.orderId ? (orderNumbers.get(e.orderId) ?? null) : null,
      })),
    };
  }

  /** "I followed you on Facebook" — once per platform, like most rewards programmes (not verifiable). */
  async claimSocial(userId: string, platformId: string) {
    const config = await this.getConfig();
    if (!config.enabled) throw new BadRequestException(`${config.programName} is paused right now.`);
    const platform = config.social.find((s) => s.id === platformId && s.active);
    if (!platform || platform.points <= 0) throw new NotFoundException('This reward is not available.');
    const added = await this.grant({
      userId,
      type: LoyaltyEntryType.SOCIAL,
      points: platform.points,
      description: platform.label,
      referenceKey: `social:${userId}:${platform.id}`,
    });
    if (!added) throw new ConflictException('You have already claimed this reward.');
    return { ok: true as const, points: platform.points };
  }

  // ---- Checkout --------------------------------------------------------------------

  /** Balance + config for pricing. Also hands out any due automatic bonuses first. */
  async getRedeemContext(userId: string) {
    const config = await this.getConfig();
    await this.ensureAutoBonuses(userId, config);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true, loyaltyLifetime: true } });
    return { config, balance: user?.loyaltyPoints ?? 0, lifetime: user?.loyaltyLifetime ?? 0 };
  }

  planRedemption(config: LoyaltyConfig, requested: number, balance: number, eligibleAmount: number) {
    return planRedemption(config, requested, balance, eligibleAmount);
  }

  /**
   * After an order is saved: spend the redeemed points and book the points it earns.
   * Redeeming never fails the (already paid) order: if the balance dropped in the
   * meantime we log it and keep the order.
   */
  async recordOrder(params: {
    orderId: string;
    orderNumber: string;
    /** Signed-in buyer who chose to use points (only they can spend points). */
    redeemUserId: string | null;
    pointsRedeemed: number;
    /** Account that earns the order's points (buyer, or the account with the order's email). */
    earnUserId: string | null;
    pointsEarned: number;
    paid: boolean;
  }) {
    const config = await this.getConfig();
    if (params.redeemUserId && params.pointsRedeemed > 0) {
      try {
        await this.grant({
          userId: params.redeemUserId,
          type: LoyaltyEntryType.REDEEM,
          points: -params.pointsRedeemed,
          description: `Used on order #${params.orderNumber}`,
          orderId: params.orderId,
          referenceKey: `order:${params.orderId}:redeem`,
        });
      } catch (err) {
        this.logger.error(
          `Could not deduct ${params.pointsRedeemed} points for order #${params.orderNumber}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    if (params.earnUserId && params.pointsEarned > 0 && params.paid) {
      const pending = config.earn.pendingUntilDelivered;
      await this.grant({
        userId: params.earnUserId,
        type: LoyaltyEntryType.PURCHASE,
        status: pending ? LoyaltyEntryStatus.PENDING : LoyaltyEntryStatus.AVAILABLE,
        points: params.pointsEarned,
        description: `Order #${params.orderNumber}`,
        orderId: params.orderId,
        referenceKey: `order:${params.orderId}:earn`,
      });
    }
  }

  /** Points an order would earn for this customer (tier multiplier applied). */
  async pointsForOrder(earnUserId: string | null, spend: number, config?: LoyaltyConfig) {
    if (!earnUserId) return 0;
    const cfg = config ?? (await this.getConfig());
    const user = await this.prisma.user.findUnique({ where: { id: earnUserId }, select: { loyaltyLifetime: true, role: true } });
    if (!user || user.role !== UserRole.CUSTOMER) return 0;
    return pointsForSpend(cfg, spend, user.loyaltyLifetime);
  }

  /**
   * Re-checks an order's points after its status changed. Idempotent; call it after any
   * order status / payment status update.
   *  - delivered          → pending purchase points become spendable
   *  - cancelled/refunded → purchase points cancelled (or taken back), spent points returned
   */
  async syncOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true, paymentStatus: true },
    });
    if (!order) return;
    const entries = await this.prisma.loyaltyTransaction.findMany({ where: { orderId } });
    if (!entries.length) return;

    const cancelled =
      order.status === OrderStatus.CANCELLED ||
      order.paymentStatus === PaymentStatus.REFUNDED ||
      order.paymentStatus === PaymentStatus.FAILED;
    const earn = entries.find((e) => e.type === LoyaltyEntryType.PURCHASE);
    const redeem = entries.find((e) => e.type === LoyaltyEntryType.REDEEM);

    await this.prisma.$transaction(async (tx) => {
      if (cancelled) {
        if (earn?.status === LoyaltyEntryStatus.PENDING) {
          await tx.loyaltyTransaction.updateMany({
            where: { id: earn.id, status: LoyaltyEntryStatus.PENDING },
            data: { status: LoyaltyEntryStatus.CANCELLED },
          });
        } else if (earn?.status === LoyaltyEntryStatus.AVAILABLE) {
          // Take the points back, but never more than the customer still has.
          const user = await tx.user.findUnique({ where: { id: earn.userId }, select: { loyaltyPoints: true } });
          const takeBack = Math.min(earn.points, Math.max(0, user?.loyaltyPoints ?? 0));
          await this.addEntry(tx, {
            userId: earn.userId,
            type: LoyaltyEntryType.PURCHASE_REVERSAL,
            points: -takeBack,
            description: `Order #${order.orderNumber} cancelled or refunded`,
            orderId,
            referenceKey: `order:${orderId}:reverse`,
          });
          // Lifetime loses the full order points even if the balance was partly spent.
          if (takeBack < earn.points) {
            await tx.user.updateMany({
              where: { id: earn.userId, loyaltyLifetime: { gte: earn.points - takeBack } },
              data: { loyaltyLifetime: { decrement: earn.points - takeBack } },
            });
          }
        }
        if (redeem) {
          await this.addEntry(tx, {
            userId: redeem.userId,
            type: LoyaltyEntryType.REDEEM_RETURN,
            points: -redeem.points,
            description: `Points returned: order #${order.orderNumber} cancelled or refunded`,
            orderId,
            referenceKey: `order:${orderId}:return`,
          });
        }
        return;
      }

      if (order.status === OrderStatus.DELIVERED && earn?.status === LoyaltyEntryStatus.PENDING) {
        const res = await tx.loyaltyTransaction.updateMany({
          where: { id: earn.id, status: LoyaltyEntryStatus.PENDING },
          data: { status: LoyaltyEntryStatus.AVAILABLE },
        });
        if (res.count === 1) await this.moveBalance(tx, earn.userId, earn.type, earn.points);
      }
    });
  }

  // ---- Admin -----------------------------------------------------------------------

  async adminStats() {
    const [members, outstanding, earned, redeemed] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER, loyaltyLifetime: { gt: 0 } } }),
      this.prisma.user.aggregate({ where: { role: UserRole.CUSTOMER }, _sum: { loyaltyPoints: true } }),
      this.prisma.loyaltyTransaction.aggregate({
        where: { status: LoyaltyEntryStatus.AVAILABLE, points: { gt: 0 }, type: { in: [...LIFETIME_TYPES] } },
        _sum: { points: true },
      }),
      this.prisma.loyaltyTransaction.aggregate({ where: { type: LoyaltyEntryType.REDEEM }, _sum: { points: true } }),
    ]);
    const config = await this.getConfig();
    const outstandingPoints = outstanding._sum.loyaltyPoints ?? 0;
    return {
      members,
      outstandingPoints,
      outstandingValue: pointsToPounds(config, outstandingPoints),
      earnedPoints: earned._sum.points ?? 0,
      redeemedPoints: Math.abs(redeemed._sum.points ?? 0),
    };
  }

  async adminCustomers(query: { q?: string; page: number; limit: number }) {
    const where: Prisma.UserWhereInput = {
      role: UserRole.CUSTOMER,
      ...(query.q ? { OR: [{ email: { contains: query.q } }, { name: { contains: query.q } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ loyaltyPoints: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: { id: true, name: true, email: true, loyaltyPoints: true, loyaltyLifetime: true, status: true, archivedAt: true, createdAt: true },
      }),
    ]);
    const config = await this.getConfig();
    return {
      items: items.map((u) => ({ ...u, tier: tierFor(config, u.loyaltyLifetime).tier.name })),
      total,
      page: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async adminTransactions(query: { userId?: string; page: number; limit: number }) {
    const where: Prisma.LoyaltyTransactionWhereInput = query.userId ? { userId: query.userId } : {};
    const [total, items] = await Promise.all([
      this.prisma.loyaltyTransaction.count({ where }),
      this.prisma.loyaltyTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { items, total, page: query.page, totalPages: Math.max(1, Math.ceil(total / query.limit)) };
  }

  /** Manual +/- points with a reason. Deductions can't take the balance below zero. */
  async adminAdjust(input: { userId: string; points: number; reason: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, loyaltyPoints: true } });
    if (!user || user.role !== UserRole.CUSTOMER) throw new NotFoundException('Customer not found');
    if (input.points < 0 && user.loyaltyPoints < -input.points) {
      throw new BadRequestException(`This customer only has ${user.loyaltyPoints} points.`);
    }
    await this.grant({
      userId: user.id,
      type: LoyaltyEntryType.ADMIN,
      points: input.points,
      description: input.reason,
      referenceKey: `admin:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    });
    const updated = await this.prisma.user.findUnique({ where: { id: user.id }, select: { loyaltyPoints: true, loyaltyLifetime: true } });
    return { ok: true as const, ...updated };
  }
}
