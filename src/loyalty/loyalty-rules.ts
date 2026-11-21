/**
 * Loyalty maths — pure functions, no database. The storefront mirrors these in
 * Slimza: app/(CommonLayout)/lib/loyalty.ts for live previews; the server is authoritative.
 */
import type { LoyaltyConfig, LoyaltyTier } from './loyalty-config.js';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Tiers sorted low → high. */
export const sortedTiers = (config: LoyaltyConfig) => [...config.tiers].sort((a, b) => a.minLifetime - b.minLifetime);

export function tierFor(config: LoyaltyConfig, lifetime: number): { tier: LoyaltyTier; next: LoyaltyTier | null } {
  const tiers = sortedTiers(config);
  let index = 0;
  tiers.forEach((t, i) => {
    if (lifetime >= t.minLifetime) index = i;
  });
  return { tier: tiers[index], next: tiers[index + 1] ?? null };
}

/** Points for spending `spend` £ on products, with the customer's tier multiplier. Whole points, rounded down. */
export function pointsForSpend(config: LoyaltyConfig, spend: number, lifetime = 0): number {
  if (!config.enabled || spend <= 0) return 0;
  const { tier } = tierFor(config, lifetime);
  return Math.floor(Math.floor(spend) * config.earn.pointsPerPound * tier.multiplier);
}

/** £ value of a number of points (rounded down to the penny). */
export const pointsToPounds = (config: LoyaltyConfig, points: number) =>
  Math.floor((points / config.redeem.pointsPerPound) * 100) / 100;

export interface RedemptionResult {
  /** Points actually used (never charges more points than the £ they buy). */
  points: number;
  /** £ taken off */
  discount: number;
  /** Why the request was reduced or refused, for messages (null = used as asked). */
  limitedBy: null | 'balance' | 'minimum' | 'order' | 'disabled';
}

/**
 * Works out how many of `requested` points can be used on an order whose products
 * (after coupons and bundle rewards, excluding delivery) cost `eligibleAmount`.
 */
export function planRedemption(
  config: LoyaltyConfig,
  requested: number,
  balance: number,
  eligibleAmount: number,
): RedemptionResult {
  const want = Math.max(0, Math.floor(requested));
  if (want === 0) return { points: 0, discount: 0, limitedBy: null };
  if (!config.enabled) return { points: 0, discount: 0, limitedBy: 'disabled' };

  const maxDiscount = round2((Math.max(0, eligibleAmount) * config.redeem.maxPercentOfOrder) / 100);
  const maxPointsForOrder = Math.floor(maxDiscount * config.redeem.pointsPerPound);
  let points = Math.min(want, balance, maxPointsForOrder);
  const limitedBy: RedemptionResult['limitedBy'] =
    points < want ? (points === balance && balance < maxPointsForOrder ? 'balance' : 'order') : null;

  if (points < config.redeem.minPoints || points <= 0) {
    return { points: 0, discount: 0, limitedBy: points <= 0 ? limitedBy ?? 'order' : 'minimum' };
  }
  const discount = pointsToPounds(config, points);
  // Only charge the points the discount is actually worth (no lost fractions of a penny).
  points = Math.ceil(discount * config.redeem.pointsPerPound - 1e-9);
  return { points, discount, limitedBy };
}

/** Is today (UTC) in the month of a "YYYY-MM-DD" birthday? */
export function isBirthdayMonth(birthday: string, now = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday?.trim() ?? '');
  return Boolean(m && Number(m[2]) === now.getUTCMonth() + 1);
}
