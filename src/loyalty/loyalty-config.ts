/**
 * ============================================================================
 *  LOYALTY POINTS ("Slimza Rewards") — settings managed from Dashboard → Loyalty
 * ============================================================================
 *
 * Stored as the CMS section `loyalty`, so the storefront receives it with every other
 * CMS section (`GET /cms`) and the dashboard saves it with `PUT /cms/loyalty`
 * (validated here, 400 on bad input). The server applies these rules; the browser
 * only previews them.
 *
 * How customers earn and spend: see docs/LOYALTY.md.
 */
import { z } from 'zod';

export const LOYALTY_CMS_KEY = 'loyalty';

const text = (max: number) => z.string().trim().max(max);

export const loyaltySocialSchema = z.object({
  /** Stable id used in claims ("facebook"). Never change it once customers have claimed. */
  id: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes'),
  label: text(80).min(1),
  url: z.string().trim().url('Enter a full link, e.g. https://facebook.com/…').max(500),
  points: z.number().int().min(0).max(10_000),
  active: z.boolean(),
});

export const loyaltyTierSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: text(40).min(1),
  /** Lifetime points needed to reach this tier. The first tier should be 0. */
  minLifetime: z.number().int().min(0).max(10_000_000),
  /** Purchase points are multiplied by this (1 = normal, 1.5 = +50%). */
  multiplier: z.number().min(1).max(5),
  perk: text(160),
});

export const loyaltyConfigSchema = z
  .object({
    enabled: z.boolean(),
    programName: text(60).min(1),
    earn: z.object({
      /** Points per £1 spent on products (after discounts, excluding delivery). */
      pointsPerPound: z.number().min(0).max(100),
      /** true = purchase points become spendable only once the order is delivered. */
      pendingUntilDelivered: z.boolean(),
    }),
    redeem: z.object({
      /** How many points make £1 off. */
      pointsPerPound: z.number().int().min(1).max(100_000),
      /** Smallest number of points that can be used at once. */
      minPoints: z.number().int().min(0).max(1_000_000),
      /** Points can pay for at most this % of the products (after other discounts). */
      maxPercentOfOrder: z.number().min(1).max(100),
    }),
    bonuses: z.object({
      /** For a verified account (once). */
      welcome: z.number().int().min(0).max(100_000),
      /** In the customer's birthday month (once a year; needs a birthday on their profile). */
      birthday: z.number().int().min(0).max(100_000),
    }),
    social: z.array(loyaltySocialSchema).max(12),
    tiers: z.array(loyaltyTierSchema).min(1).max(8),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.social.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['social', i, 'id'], message: `Duplicate social id "${s.id}"` });
      ids.add(s.id);
    });
    const mins = c.tiers.map((t) => t.minLifetime);
    if (Math.min(...mins) !== 0) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'One tier must start at 0 points' });
    if (new Set(mins).size !== mins.length) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'Two tiers start at the same points' });
  });

export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;
export type LoyaltyTier = z.infer<typeof loyaltyTierSchema>;

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  programName: 'Slimza Rewards',
  earn: { pointsPerPound: 1, pendingUntilDelivered: true },
  redeem: { pointsPerPound: 100, minPoints: 100, maxPercentOfOrder: 100 },
  bonuses: { welcome: 100, birthday: 100 },
  social: [
    { id: 'facebook', label: 'Like us on Facebook', url: 'https://www.facebook.com/profile.php?id=61572087039415', points: 50, active: true },
    { id: 'instagram', label: 'Follow us on Instagram', url: 'https://www.instagram.com/slimza_uk', points: 50, active: true },
    { id: 'tiktok', label: 'Follow us on TikTok', url: 'https://www.tiktok.com/@slimza_uk', points: 50, active: false },
    { id: 'youtube', label: 'Subscribe on YouTube', url: 'https://www.youtube.com/@slimza.co.uk1', points: 50, active: false },
    { id: 'x', label: 'Follow us on X', url: 'https://x.com/slimza365', points: 50, active: false },
    { id: 'linkedin', label: 'Follow us on LinkedIn', url: 'https://www.linkedin.com/in/slimza-com-70a091386/', points: 50, active: false },
  ],
  tiers: [
    { id: 'green', name: 'Green', minLifetime: 0, multiplier: 1, perk: '1 point for every £1' },
    { id: 'silver', name: 'Silver', minLifetime: 500, multiplier: 1.1, perk: '1.1 points for every £1' },
    { id: 'gold', name: 'Gold', minLifetime: 1500, multiplier: 1.25, perk: '1.25 points for every £1' },
  ],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lenient read: stored data merged over defaults; falls back to defaults if still invalid. */
export function readLoyaltyConfig(raw: unknown): LoyaltyConfig {
  if (!isObject(raw)) return DEFAULT_LOYALTY_CONFIG;
  const d = DEFAULT_LOYALTY_CONFIG;
  const merged = {
    ...d,
    ...raw,
    earn: { ...d.earn, ...(isObject(raw.earn) ? raw.earn : {}) },
    redeem: { ...d.redeem, ...(isObject(raw.redeem) ? raw.redeem : {}) },
    bonuses: { ...d.bonuses, ...(isObject(raw.bonuses) ? raw.bonuses : {}) },
    social: Array.isArray(raw.social) ? raw.social : d.social,
    tiers: Array.isArray(raw.tiers) ? raw.tiers : d.tiers,
  };
  const parsed = loyaltyConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : d;
}

export function parseLoyaltyConfigForSave(raw: unknown): { ok: true; data: LoyaltyConfig } | { ok: false; message: string } {
  const parsed = loyaltyConfigSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues.map((i) => `${i.path.join('.') || 'loyalty'}: ${i.message}`).join('; '),
  };
}
