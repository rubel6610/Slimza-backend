/**
 * Product tax (Dashboard → Products → Tax). A product's price either includes tax, or tax is added
 * on top: a percent of the price, or a fixed £ per item. Tax is NEVER discounted — coupons, points,
 * bundle discounts and rewards don't reduce it (same rule as delivery).
 */
export type TaxType = 'percent' | 'fixed';

export interface ProductTax {
  taxIncluded?: boolean | null;
  taxType?: string | null;
  taxValue?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tax for `qty` items at `unitPrice` (the full, undiscounted price). 0 when the price includes tax. */
export function taxFor(product: ProductTax, unitPrice: number, qty: number): number {
  if (product.taxIncluded !== false) return 0;
  const value = Math.max(0, Number(product.taxValue) || 0);
  if (!value || qty <= 0) return 0;
  return product.taxType === 'fixed' ? round2(value * qty) : round2((unitPrice * qty * value) / 100);
}

/** "Tax included", "+ 20% tax", "+ £1.50 tax per item" */
export function taxLabel(product: ProductTax): string {
  if (product.taxIncluded !== false || !Number(product.taxValue)) return 'Tax included';
  return product.taxType === 'fixed' ? `+ £${Number(product.taxValue).toFixed(2)} tax per item` : `+ ${Number(product.taxValue)}% tax`;
}
