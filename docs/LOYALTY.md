# Loyalty points (Slimza Rewards)

Settings: **Dashboard → Loyalty points** (`/dashboard/loyalty`), stored as the CMS
section `loyalty` and validated by `src/loyalty/loyalty-config.ts` on save.

| What | Where |
| --- | --- |
| Settings shape, defaults, validation | `src/loyalty/loyalty-config.ts` |
| Points maths (pure) | `src/loyalty/loyalty-rules.ts` |
| Ledger, balances, bonuses, order sync | `src/loyalty/loyalty.service.ts` |
| Customer + admin API | `src/loyalty/loyalty.controller.ts` |
| Checkout integration | `CheckoutService.planPoints`, `confirmOrder`, `syncLoyalty` |
| Storefront mirror of the rules | Slimza: `app/(CommonLayout)/lib/loyalty.ts` |

## Data

- `LoyaltyTransaction`: one row per change, `points` signed. `referenceKey` is unique, so
  the same bonus / order is never applied twice (`welcome:<user>`,
  `birthday:<user>:<year>`, `social:<user>:<platform>`, `order:<id>:earn|redeem|reverse|return`).
- `User.loyaltyPoints`: spendable balance = sum of AVAILABLE rows. Updated in the same
  transaction as the row. Deductions use a conditional update, so it never goes below 0.
- `User.loyaltyLifetime`: points ever earned; drives the tier.
- `Order.pointsRedeemed / pointsDiscount / pointsEarned`: snapshot on the order.

## Earning

| Event | When | Default |
| --- | --- | --- |
| Welcome | verified customer, once (granted on `/loyalty/me` or checkout) | 100 |
| Purchase | order paid; PENDING until DELIVERED (setting) | 1 pt / £1 × tier multiplier |
| Birthday | in the birthday month, once per calendar year (`User.birthday` = YYYY-MM-DD) | 100 |
| Social | customer clicks "Follow & earn", once per platform (self-reported) | 50 each |
| Admin | Dashboard → Loyalty → Adjust (reason shown to the customer) | — |

Purchase points are on products after coupons, bundle rewards and points used; delivery
never earns. Guests earn nothing, but an order placed with an account's email is credited
to that account.

## Spending

`pointsToRedeem` on `POST /checkout/create-payment-intent` and `/checkout/confirm`
(signed-in customers only). Default 100 points = £1, from 100 points, up to 100 % of the
products (never delivery). The payment step refuses impossible requests (400); the
confirmation step uses what is possible so a paid order never fails.

## Reversals (`LoyaltyService.syncOrder`)

Called after every order status change, refund and Stripe webhook.

- DELIVERED → pending purchase points become AVAILABLE.
- CANCELLED / REFUNDED / payment FAILED → pending points CANCELLED; already-available
  points taken back (never below 0); points spent on the order returned.

## Endpoints

- `GET /loyalty/me`, `POST /loyalty/me/social/:platform` (customers)
- `GET /loyalty/admin/stats | customers | transactions`, `POST /loyalty/admin/adjust` (admins)
