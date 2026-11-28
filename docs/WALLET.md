# Wallet (saved cards + payments)

Customer page: **My account → Wallet** (`/account/wallet`). Code: `src/wallet`, checkout in `src/checkout`.

## Money rules (owner decision)
- **No store credit.** Slimza takes payments through Stripe only and never holds a customer balance.
  (Store credit existed briefly; migration `20261125090000_remove_store_credit` removed it — it was empty.)
- **Refunds go back to the card through Stripe**, and the customer is always emailed
  (`MailService.sendRefundEmail`, sent from `CheckoutService.processRefund`).
- **Delivery is never discounted.** Coupons, bundle rewards and loyalty points only reduce the products:
  `total = max(0, products − coupon − bundle reward − points) + delivery`
  (backend `calculatePricing`, frontend `lib/pricing.ts` + `lib/useCheckoutPoints.ts`).

## What the wallet shows
- **Payment cards** — saved cards, default card, add / remove.
- **Payments** — the customer's latest 10 paid orders and the card used (`Order.paymentLabel`, e.g.
  "Visa •••• 4242", read from Stripe when the order is confirmed). Same ownership rule as My orders.

## Saved cards
- **Stripe mode** (keys set): cards are stored by Stripe on a Stripe Customer (`User.stripeCustomerId`,
  created on first use). Slimza only sees brand, last 4 and expiry. Add = SetupIntent + Stripe's card form
  (Link / Apple Pay / Google Pay hidden); default = `invoice_settings.default_payment_method`; remove = detach.
- **Test mode** (no Stripe keys): cards are kept in `WalletCard` — brand, last 4 and expiry only (the
  browser checks the number and CVC and never sends them).
- Checkout: **Saved card / New card** switch; new cards can be saved with "Save this card to my wallet"
  (`setup_future_usage: off_session`). Card ids are always checked to belong to the signed-in customer.

## API
| Who | Method | Path |
|---|---|---|
| Customer | GET | `/wallet` → `{ cardsEnabled, cardsMode, cards, payments }` |
| Customer | POST | `/wallet/cards/setup-intent` → `{ clientSecret }` (Stripe mode) |
| Customer | POST | `/wallet/cards` `{ brand, last4, expMonth, expYear, makeDefault? }` (test mode) |
| Customer | PATCH | `/wallet/cards/:id/default` |
| Customer | DELETE | `/wallet/cards/:id` |
| Checkout | POST | `/checkout/create-payment-intent` + `savedCardId` / `saveCard` |

Migrations: `20261124100000_wallet`, `20261124110000_order_payment_label`, `20261124120000_wallet_cards`,
`20261125090000_remove_store_credit` (run `npm run migrate:deploy` in production).
