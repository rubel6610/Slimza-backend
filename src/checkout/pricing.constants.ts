/**
 * Pricing rules for products without purchase options (size multipliers + supply-plan discounts).
 * Products themselves come only from the database (Dashboard → Products).
 */
export const SIZE_TABLES: Record<
  'powder' | 'resin' | 'pack',
  { label: string; multiplier: number }[]
> = {
  powder: [
    { label: '50 g', multiplier: 1 },
    { label: '100 g', multiplier: 1.8 },
    { label: '250 g', multiplier: 4 },
    { label: '500 g', multiplier: 7.5 },
  ],
  resin: [
    { label: '15 g', multiplier: 1 },
    { label: '30 g', multiplier: 1.8 },
    { label: '50 g', multiplier: 2.8 },
  ],
  pack: [
    { label: '14 sticks', multiplier: 1 },
    { label: '30 sticks', multiplier: 1.9 },
  ],
};

export const SUPPLY_PLAN_DISCOUNTS: Record<number, { discount: number; label: string }> = {
  1: { discount: 0, label: '1 Month Supply' },
  2: { discount: 0.1, label: '2 Month Supply' },
  3: { discount: 0.15, label: '3 Month Supply' },
};

export const round2 = (num: number): number =>
  Math.round((num + Number.EPSILON) * 100) / 100;
