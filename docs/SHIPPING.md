# Shipping

Set in **Dashboard → Shipping**. Saved as the CMS section `shipping` (`PUT /cms/shipping`, validated by
`parseShippingConfigForSave`). Defaults are the client's price list of 25 Nov 2026 (`DEFAULT_SHIPPING_CONFIG`).

| Where | File |
| --- | --- |
| Rules, defaults, quote | `src/shipping/shipping-config.ts` |
| Country list + aliases | `src/shipping/countries.ts` |
| Checkout pricing | `CheckoutService.calculatePricing` |
| Storefront copy (shows the price before payment) | `Slimza/app/(CommonLayout)/lib/shipping.ts`, `lib/countries.ts` |
| Policy page | `/shipping-policy` (footer → Quick links), built from the same settings |

The storefront copy only displays prices. The server recalculates every order, so keep the two copies in sync when the rules change.

## How a delivery price is worked out

1. **Weight.** Each item uses its purchase option's **Packed weight (g)** (Dashboard → Products → purchase options). An item without one uses **Default packed weight per item** (250g). Bundles use each product's first option. Order weight = sum of weight × quantity.
2. **Address checks.** These are refused at checkout:
   - BFPO and PO Box addresses (each can be switched off).
   - **Excluded destinations.** Countries are matched by name or alias ("Ivory Coast" = Côte d'Ivoire, "Western Samoa" = Samoa). Regions that aren't countries (Crimea, Nevis, Tahiti) are matched in the address lines, city or district.
3. **UK.** The customer sees the active UK methods. The default is *Standard UK Delivery*, Evri UK, 2–4 working days, **free**. There is no weight limit for UK orders.
4. **Everywhere else.** The country's zone is used, or *Rest of the World* if no other zone lists it. The price is the first weight band the order fits in. The method is called `intl-<zoneId>`, e.g. "Tracked International Delivery (Europe)".
5. **Over the limit.** If the order is heavier than the zone's last band, or than **Heaviest international order** (2kg), checkout is refused. The customer sees the "contact us for a shipping quote" message.

Shipping is **never discounted**: coupons, loyalty points and bundle rewards only reduce the products:

```
total = max(0, products − discounts − points) + shipping + tax
```

If the rules change after a customer has paid (webhook / confirm), the order is still recorded (`ignoreRestrictions`).

## Default prices

| Zone | ≤250g | 251–500g | 501g–1kg | 1.01–2kg | Carrier |
| --- | --- | --- | --- | --- | --- |
| UK | Free | Free | Free | Free | Evri UK |
| 1 Europe | £10.95 | £13.95 | £17.95 | £22.95 | Evri International |
| 2 USA & Canada | £14.95 | £18.95 | £24.95 | £32.95 | Evri International |
| 3 Australia & NZ | £14.95 | £18.95 | £24.95 | £32.95 | Evri International |
| 4 Rest of World | £19.95 | £24.95 | £32.95 | £39.95 | Royal Mail International Tracked |

Over 2kg: contact for a quote. Parcelforce Worldwide is noted for heavier or express orders. Use it when you dispatch: it goes in the tracking form, not checkout.

## Checkout (storefront)

- **Country list.** Every supported country; excluded ones are left out.
- **Shipping Method.** Shows the methods for the address with carrier, delivery time and price (for international orders, also the order's packed weight).
- **Blocked orders.** Excluded destinations, over 2kg, BFPO and PO Box show a message, and the customer can't continue to payment.
- **Customs.** International orders show the customs, duties & taxes notice and need a tick: "customs charges are my responsibility". The payment page shows the notice again. It sends the customer back if the tick or the address is missing.

## Dispatch & tracking

On the order page in Dashboard → Orders → **Tracking**, enter the carrier, tracking number and an optional link.

`PATCH /checkout/admin/orders/:id/tracking` `{ carrier, trackingNumber, trackingUrl?, notify? }`:
- saves `trackingCarrier`, `trackingNumber`, `trackingUrl` and `shippedAt`
- moves Placed/Processing orders to **Shipped**
- emails the customer "Your order is on its way" with the tracking details, unless `notify: false`

The customer sees the tracking under **Account → My orders**.

Orders also store `shippingLabel`, the delivery name and carrier the customer chose, e.g. "Tracked International Delivery (Europe) · Evri International".

## Tests

`src/shipping/shipping-config.spec.ts` covers:
- the price list, weight bands and over 2kg
- excluded countries and regions, BFPO and PO Box
- edited settings and validation

`src/checkout/checkout.tax.spec.ts` covers weight taken from purchase options at checkout.
