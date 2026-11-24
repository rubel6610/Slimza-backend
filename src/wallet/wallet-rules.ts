/** Pure wallet (store credit) rules — no database, easy to test. All amounts are GBP. */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Largest single admin adjustment (guards against typos like 10000 instead of 10.00). */
export const MAX_ADJUSTMENT = 5000;

/**
 * Store credit an order uses: as much as the customer has, up to what they owe.
 * Credit can pay for products, delivery, anything — it's money.
 */
export function planWalletUse(balance: number, payable: number, wanted: boolean): number {
  if (!wanted) return 0;
  return round2(Math.max(0, Math.min(round2(balance), round2(payable))));
}

/** Unique ledger keys: one order payment / return per order, ever. */
export const walletKeys = {
  orderPayment: (orderId: string) => `order-payment:${orderId}`,
  orderReturn: (orderId: string) => `order-return:${orderId}`,
};

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
