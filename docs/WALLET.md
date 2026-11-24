# Wallet (store credit + saved cards)

Customer page: **My account → Wallet** (`/account/wallet`). Code: `src/wallet`, checkout in `src/checkout`.

## Store credit
- Money (GBP) the customer can spend at checkout. Kept as a ledger, `WalletTransaction`, one row per
  change (signed `amount`, `balanceAfter`), plus the cached `User.walletBalance`. Only `WalletService`
  changes them, in one transaction with an optimistic lock, so two orders can't spend the same credit
  and the balance never goes below £0.
- `referenceKey` is unique, so an order's payment / return / refund is booked at most once.

| Type | When |
|---|---|
| `ADMIN_CREDIT` / `ADMIN_DEBIT` | Admin adds / removes credit (Dashboard → All Users → user → Store credit). The reason is shown to the customer. Max £5,000 per change. |
| `ORDER_PAYMENT` | Credit spent on an order |
| `ORDER_RETURN` | The order was cancelled or refunded: the store credit it used comes back |

Refunds always go back to the customer's **card through Stripe** (the card part of the order). There is
no "refund to store credit" option. (`REFUND` stays in the enum, unused.)

## Checkout
- Signed-in customers with credit see **Use store credit** in the order summary (`useWallet`).
- Credit pays after coupons, bundle rewards and loyalty points, and can cover delivery too.
  `Order.total` is the full order value; `Order.walletUsed` the credit part; the card pays the rest.
- Credit covers everything → no card: the page shows **Pay £x with store credit**, the order is
  confirmed with `paymentMode: "wallet"`. If the credit changed meanwhile the order is refused (409)
  and nothing is charged.
- Card + credit: the PaymentIntent is for the remainder only. If the credit dropped between paying and
  confirming, the order takes what's left (the card was already charged) and logs it.

## Saved cards (Stripe)
- Cards are stored by Stripe on a Stripe Customer (`User.stripeCustomerId`, created on first use).
  Slimza only ever sees brand, last 4 and expiry.
- Add: SetupIntent + Stripe's Payment Element on the wallet page. Default card: Stripe's
  `invoice_settings.default_payment_method`. Remove: detach.
- Checkout: customers pick a saved card (default pre-selected) or a new one, with
  **Save this card to my wallet** (`setup_future_usage: off_session`). Every card id is checked to belong
  to the signed-in customer.
- **Test mode (no Stripe keys)**: cards are kept in the `WalletCard` table instead — only brand, last 4
  and expiry (the browser checks the number and CVC and never sends them). Customers save them with
  **Save this card to my wallet** on the checkout card form, or **Add card** on the wallet page; at checkout
  they can pick a saved card. `GET /wallet` returns `cardsMode: "stripe" | "test"`.

## API
| Who | Method | Path |
|---|---|---|
| Customer | GET | `/wallet?page=&limit=` → balance, cards, cardsEnabled, history |
| Customer | GET | `/wallet/transactions?page=&limit=` |
| Customer | POST | `/wallet/cards/setup-intent` → `{ clientSecret }` |
| Customer | POST | `/wallet/cards` `{ brand, last4, expMonth, expYear, makeDefault? }` (test mode only) |
| Customer | PATCH | `/wallet/cards/:pm_id/default` |
| Customer | DELETE | `/wallet/cards/:pm_id` |
| Admin | GET | `/wallet/admin/users/:userId` |
| Admin | POST | `/wallet/admin/users/:userId/adjust` `{ amount (+/−), reason }` |
| Checkout | POST | `/checkout/create-payment-intent` + `useWallet`, `savedCardId`, `saveCard` (→ `mode: "wallet"` when credit covers all) |
| Checkout | POST | `/checkout/confirm` + `useWallet`, `paymentMode: "wallet"` |

Migrations: `20261124100000_wallet`, `20261124110000_order_payment_label`, `20261124120000_wallet_cards` (run `npm run migrate:deploy` in production).
