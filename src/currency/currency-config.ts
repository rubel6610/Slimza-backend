/**
 * ============================================================================
 *  DISPLAY CURRENCIES — managed from Dashboard → Currencies
 * ============================================================================
 *
 * Stored as the CMS section `currencies` (GET /cms, PUT /cms/currencies).
 *
 * Every price in the database, and every payment, is in GBP. Customers can pick
 * another currency in the header to SEE prices converted with these rates;
 * checkout still charges the GBP amount (the storefront says so).
 *
 * `rate` = how much 1 GBP is worth in that currency (USD 1.27 → £10 shows as $12.70).
 */
import { z } from 'zod';

export const CURRENCY_CMS_KEY = 'currencies';
export const BASE_CURRENCY = 'GBP';

export const currencyItemSchema = z.object({
  /** ISO 4217 code, e.g. "USD". */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. USD'),
  name: z.string().trim().min(1).max(40),
  symbol: z.string().trim().min(1).max(6),
  /** 1 GBP = `rate` of this currency. */
  rate: z.number().positive('Rate must be above 0').max(100_000),
  /** Digits after the decimal point (2 for most currencies). */
  decimals: z.number().int().min(0).max(3),
  active: z.boolean(),
});

export const currencyConfigSchema = z
  .object({
    /** Currency new visitors see. Must be one of the active currencies. */
    defaultCurrency: z.string().trim().toUpperCase(),
    currencies: z.array(currencyItemSchema).min(1).max(20),
    /** Shown in the dashboard so admins know how fresh the rates are. */
    ratesUpdatedAt: z.string().max(40).nullable(),
  })
  .superRefine((c, ctx) => {
    const codes = new Set<string>();
    c.currencies.forEach((cur, i) => {
      if (codes.has(cur.code))
        ctx.addIssue({
          code: 'custom',
          path: ['currencies', i, 'code'],
          message: `${cur.code} is listed twice`,
        });
      codes.add(cur.code);
    });
    const base = c.currencies.find((cur) => cur.code === BASE_CURRENCY);
    if (!base)
      ctx.addIssue({
        code: 'custom',
        path: ['currencies'],
        message: 'GBP must stay in the list (prices are stored in GBP)',
      });
    else {
      if (base.rate !== 1)
        ctx.addIssue({
          code: 'custom',
          path: ['currencies'],
          message: 'The GBP rate must be 1',
        });
      if (!base.active)
        ctx.addIssue({
          code: 'custom',
          path: ['currencies'],
          message: 'GBP must stay active (checkout charges in GBP)',
        });
    }
    const def = c.currencies.find((cur) => cur.code === c.defaultCurrency);
    if (!def || !def.active)
      ctx.addIssue({
        code: 'custom',
        path: ['defaultCurrency'],
        message: 'The default currency must be one of the active currencies',
      });
  });

export type CurrencyConfig = z.infer<typeof currencyConfigSchema>;
export type CurrencyItem = z.infer<typeof currencyItemSchema>;

/** Starting rates (approximate). Admins should update them from the dashboard. */
export const DEFAULT_CURRENCY_CONFIG: CurrencyConfig = {
  defaultCurrency: BASE_CURRENCY,
  currencies: [
    {
      code: 'GBP',
      name: 'British Pound',
      symbol: '£',
      rate: 1,
      decimals: 2,
      active: true,
    },
    {
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
      rate: 1.27,
      decimals: 2,
      active: true,
    },
    {
      code: 'EUR',
      name: 'Euro',
      symbol: '€',
      rate: 1.17,
      decimals: 2,
      active: true,
    },
    {
      code: 'AED',
      name: 'UAE Dirham',
      symbol: 'AED',
      rate: 4.66,
      decimals: 2,
      active: true,
    },
    {
      code: 'SAR',
      name: 'Saudi Riyal',
      symbol: 'SAR',
      rate: 4.76,
      decimals: 2,
      active: true,
    },
  ],
  ratesUpdatedAt: null,
};

export function parseCurrencyConfigForSave(
  raw: unknown,
): { ok: true; data: CurrencyConfig } | { ok: false; message: string } {
  const parsed = currencyConfigSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue.path.length ? ` (${issue.path.join('.')})` : '';
  return { ok: false, message: `${issue.message}${where}` };
}
