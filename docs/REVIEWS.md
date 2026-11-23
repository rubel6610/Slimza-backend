# Product reviews

Customers review products on the product page (`#reviews`, bottom of `/shop/:slug`).
Admins moderate them in **Dashboard → Product Reviews**. Code: `src/reviews`.

## Rules
- Signed-in customers only, **one review per product** (posting again edits it). 1–5 stars, optional
  title, 10–2000 characters. Shown as first name + last initial ("Sarah M.").
- **Live straight away** (`status = PUBLISHED`). Admins can hide it (`HIDDEN`), and the customer sees
  that their review is hidden.
- **Verified purchase** = the customer had a paid, not-cancelled order containing the product when
  they wrote it.
- Admins can edit the name, rating and wording. Changing the title or text marks the review
  "Edited by Slimza", and the customer's next edit clears that. Admins can also post a public reply.
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
| Customer | GET / PUT / DELETE | `/reviews/product/:idOrSlug/mine` |
| Admin | GET | `/reviews/admin?q=&status=&rating=&featured=&verified=&replied=&archived=&sort=&page=&limit=` |
| Admin | GET | `/reviews/admin/stats` |
| Admin | PATCH | `/reviews/admin/:id` (`status`, `featured`, `authorName`, `rating`, `title`, `body`, `adminReply`) |
| Admin | PATCH | `/reviews/admin/:id/archive`, `/reviews/admin/:id/unarchive` |
| Admin | DELETE | `/reviews/admin/:id` (archived only) |
