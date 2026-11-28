# Make your own bundle

Everything about bundles is set in **Dashboard → Bundle** (`/dashboard/bundle`) and
stored as the CMS section `bundle` (`CmsSection` row, key `"bundle"`).

| What | Where |
| --- | --- |
| Settings shape, defaults, validation | `src/bundle/bundle-config.ts` |
| Rules + pricing (pure functions) | `src/bundle/bundle-pricing.ts` |
| Checkout re-pricing | `CheckoutService.priceBundles` (`src/checkout/checkout.service.ts`) |
| Storefront mirror of the rules | Slimza: `app/(CommonLayout)/lib/bundle.ts` |
| Builder state (page + homepage card) | Slimza: `app/(CommonLayout)/lib/useBundleBuilder.ts` |
| Dashboard editor | Slimza: `app/(DashboardLayout)/dashboard/_components/bundle/BundleManager.tsx` |

## Flow

1. Admin saves → `PUT /cms/bundle`. `CmsService.updateSection` validates with
   `bundleConfigSchema` (400 with readable messages on bad input).
2. Storefront gets it with every CMS section (`GET /cms`) → `cmsStore.bundle`.
   Products come from `GET /products`, filtered by the rules.
3. The basket stores product ids + quantities (plus a display snapshot).
4. Checkout sends only `{ productId, qty }`. The backend reloads the settings and
   the products, re-checks every rule and re-prices. The browser's numbers are
   never trusted.

## Pricing

```
unit price = product.price            (or originalPrice when "Use product sale prices" is off)
subtotal   = Σ unit price × qty
tier       = active tier with the highest minItems ≤ total qty
percent    = tier.percent
             + extraPercentPerItem × (qty − last tier's minItems)   (only past the last tier)
             capped at maxPercent (0 = no cap, never above 90)
total      = subtotal × (1 − percent / 100)
```

- **Coupons**: when "Allow coupon codes on bundles" is off, the coupon % is applied to
  the non-bundle items only.
- **Spend reward** (optional): `amount` off the order once bundle totals reach `threshold`.

## Rules

`minItems`, `maxItems` (0 = no limit), `oneProductPerCategory` (one dropdown per category
row; default on), `perCategoryLimit` (items allowed from each category counting QTY, 0 = no limit), `maxQtyPerProduct` (0 = no limit), `categories` (empty = all) and
`excludedProductIds`.

## Changing a rule

Change both `src/bundle/bundle-pricing.ts` and the storefront mirror
`lib/bundle.ts`, and add a case to `src/bundle/bundle-pricing.spec.ts` /
`src/checkout/checkout.bundles.spec.ts`.

Discount tiers follow the archive lifecycle (see `docs/ARCHIVE.md`).
