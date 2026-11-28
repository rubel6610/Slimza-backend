/**
 * Products that are shown in the shop but can't be bought:
 *  - "Coming Soon": announced, not on sale yet
 *  - "Out of Stock": sold out for now (an admin choice — it wins even over "unlimited stock")
 * Customers see them with a badge and disabled buy buttons; checkout refuses them.
 */
export const STOCK_STATUSES = ['In Stock', 'Low Stock', 'Out of Stock', 'Coming Soon'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** Why this product can't be bought right now (null = it can). */
export function unavailableReason(product: { name: string; stockStatus?: string | null }): string | null {
  if (product.stockStatus === 'Coming Soon') return `"${product.name}" is coming soon and can't be bought yet. Please remove it from your basket.`;
  if (product.stockStatus === 'Out of Stock') return `"${product.name}" is out of stock. Please remove it from your basket.`;
  return null;
}
