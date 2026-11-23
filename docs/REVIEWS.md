# Product reviews

Customers review products on the product page (`#reviews`, bottom of `/shop/:slug`) or in
**My account → My reviews** (`/account/reviews`), which lists every product from their delivered orders.
Admins moderate them in **Dashboard → Product Reviews**. Code: `src/reviews`.

## Rules
- Signed-in customers only, **one review per product** (posting again edits it). 1–5 stars, optional
  title, 10–2000 characters. Shown as first name + last initial ("Sarah M.").
- **Live straight away** (`status = PUBLISHED`). Admins can hide it (`HIDDEN`), and the customer sees
  that their review is hidden.
- **Only products the customer has received can be reviewed**: a new review needs an order of theirs
  with `paymentStatus = PAID` and `status = DELIVERED` (not archived) containing the product, on its own
  or inside a custom bundle. Anything else gets a 403. Reviews written before this rule can still be
  edited or deleted. Every new review is therefore a **verified purchase**.
- Admins can edit the name, rating and wording. Changing the title or text marks the review
  `editedByAdmin` internally (never shown to anyone), and the customer's next edit clears it. Admins can also post a public reply.
- **Featured** reviews appear in the homepage "What Our Customers Say" section (newest featured
  first), followed by the manual quotes from the CMS section `testimonials`. Only visible reviews can
  be featured; hiding or archiving a review un-features it.
- Archive lifecycle: archive (it disappears from the shop) → restore, or delete permanently. The
  customer can't edit or repost an archived review.
- **`Product.rating` / `Product.reviewCount`** are recalculated from visible reviews after every
  change, so cards, search sorting and the product page always show real numbers. Migration
  `20261123100000_add_product_reviews` reset the old placeholder values (5.0 stars / 12 reviews) to 0.

## API
| Who | Method | Path |
| --- | --- | --- |
| Public | GET | `/reviews/featured?limit=` |
| Public | GET | `/reviews/product/:idOrSlug?page=&limit=&sort=newest\|oldest\|highest\|lowest&rating=` → `{ items, meta, summary }` |
| Customer | GET | `/reviews/mine` (Account → My reviews: delivered products + own reviews, `canReview`) |
| Customer | GET / PUT / DELETE | `/reviews/product/:idOrSlug/mine` (GET includes `canReview`) |
| Admin | GET | `/reviews/admin?q=&status=&rating=&featured=&verified=&replied=&archived=&sort=&page=&limit=` |
| Admin | GET | `/reviews/admin/stats` |
| Admin | PATCH | `/reviews/admin/:id` (`status`, `featured`, `authorName`, `rating`, `title`, `body`, `adminReply`) |
| Admin | PATCH | `/reviews/admin/:id/archive`, `/reviews/admin/:id/unarchive` |
| Admin | DELETE | `/reviews/admin/:id` (archived only) |
