# One-time purchase & Subscribe & Save

Code: `src/products/supply-options.ts`, `src/subscriptions`, checkout in `src/checkout`.

## Purchase options (per product)
Dashboard → Products → **Purchase options**: any number of supply options, each with
name ("120 – 4 Month Supply"), supply length (N weeks / months), price, optional "was" price,
servings (→ "£0.16 / serving"), badge ("Most popular", "Best value") and a **Subscribe & Save %**.
Switch **Offer Subscribe & Save** on per product. Products without options keep the old 1/2/3-month plans.

## Product page
One-time purchase | Subscribe & Save up to X% (biggest option discount) → option cards → price,
"You save", "Delivered every 4 months (every 120 days). Minimum 2 deliveries, then cancel any time."

## Checkout
- The basket can mix one-time and subscription lines; **one payment** covers the first delivery of
  everything (one order). Coupons and loyalty points apply to this first order only.
- Subscription lines need: a signed-in customer, Stripe, and the ticked terms (`acceptSubscriptionTerms`).
  The card is always saved (`setup_future_usage: off_session`).
- After payment, each subscribed line gets a Stripe Subscription (inline price, `trial_end` = one supply
  length from now) and a `Subscription` row (`ordersCount: 1`).

## Renewals
Stripe charges `renewalAmount` = subscription price × qty + delivery + tax (never discounted) every supply
length. `invoice.paid` → `SubscriptionsService.recordRenewal` creates a normal Order
(`subscriptionId`, `subscriptionSequence` 2, 3…, unique `stripeInvoiceId`), emails the customer, adds
loyalty points. `invoice.payment_failed` → status PAST_DUE + email with Stripe's pay link (Stripe retries).
`customer.subscription.deleted` → CANCELLED.

**The Stripe webhook must be set up** (`STRIPE_WEBHOOK_SECRET`, endpoint `POST /Api/checkout/webhook`,
events `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `invoice.paid`,
`invoice.payment_failed`, `customer.subscription.deleted`). Locally: `stripe listen --forward-to
localhost:5173/Api/checkout/webhook` and put the printed `whsec_…` in `.env`. Without it renewals are still
charged by Stripe but no order is created (Dashboard "Renew now" records its own renewal directly).

## Minimum commitment
Dashboard → Order management → Subscriptions → **Minimum deliveries before a customer can cancel**
(default 2; CMS section `subscriptions`). Copied onto each subscription when it starts; customers can
cancel only when `ordersCount >= minOrders`. Admins can cancel any time.

## Pages / API
| Who | Method | Path |
|---|---|---|
| Public | GET | `/subscriptions/settings` |
| Customer | GET | `/subscriptions/mine` (Account → Subscriptions) |
| Customer | POST | `/subscriptions/mine/:id/cancel` |
| Admin | GET | `/subscriptions/admin?status=` (Order management → Subscriptions) |
| Admin | PUT | `/subscriptions/admin/settings` `{ data: { enabled, minOrders } }` |
| Admin | POST | `/subscriptions/admin/:id/cancel` · `/subscriptions/admin/:id/renew-now` |

Migrations: `20261125120000_subscriptions`, `20261125120500_order_stripe_invoice`.
