/** Pure wallet helpers — no database, easy to test. (No store credit: payments are Stripe only.) */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Public shape of a saved Stripe card (never the full number — Stripe keeps that). */
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/** "visa" → "Visa", "amex" → "American Express" */
export function cardBrandName(brand: string): string {
  const names: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    diners: 'Diners Club',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  };
  return names[brand] ?? (brand ? brand[0].toUpperCase() + brand.slice(1) : 'Card');
}
