# Display currencies

Customers pick a currency (GBP, USD, EUR, AED, SAR by default) in the storefront header.
Every price on the shop is converted for display; **products, orders and payments stay in GBP**.

- Settings: CMS section `currencies` (`GET /cms`, `PUT /cms/currencies`, admin only), validated by
  `src/currency/currency-config.ts`. Managed in **Dashboard → Currencies**.
- `rate` = what £1 is worth in that currency. GBP must stay in the list, active, with rate 1.
- `defaultCurrency` = what new visitors see (must be active). A customer's own choice is kept in
  their browser (`localStorage.slimza_currency`, listed as strictly necessary in the cookie policy).
- Checkout shows the converted total plus "You'll be charged £X in GBP". Order history, receipts and
  the Stripe "Pay" button always show GBP, because that is what was charged.

Rates are not fetched automatically: update them in the dashboard (the page shows when they were last
changed). Charging in other currencies would need Stripe multi-currency pricing on the backend.
