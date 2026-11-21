# Archive lifecycle (no direct deletes)

Nothing in the Slimza admin dashboard can be deleted in one step. Every item an admin can remove goes through the same three states:

```
  LIVE ──archive──▶ ARCHIVED ──delete forever──▶ GONE
       ◀──restore──
```

| State    | `archivedAt`  | Storefront | Admin dashboard                    | Possible actions          |
| -------- | ------------- | ---------- | ---------------------------------- | ------------------------- |
| Live     | `null`        | visible    | normal list                        | edit, **archive**         |
| Archived | ISO timestamp | hidden     | "Archived" tab or Archive panel    | **restore**, **delete forever** |
| Gone     | (row removed) | —          | —                                  | none: it cannot be undone |

The **backend** enforces the rule, not only the UI. A permanent delete of something that is still live returns **`409 Conflict`** with the message *"… is not archived. Archive it first, then delete it permanently from the archive."*

---

## What it covers

| Dashboard screen                     | Stored as                         | Archive / restore / delete-forever endpoints |
| ------------------------------------ | --------------------------------- | -------------------------------------------- |
| Products                             | `Product.archivedAt`              | `PATCH /products/:id/archive` · `PATCH /products/:id/unarchive` · `DELETE /products/:id`<br>Bulk: `POST /products/bulk-archive` · `bulk-unarchive` · `bulk-delete` (body `{ ids }`) |
| Orders                               | `Order.archivedAt`                | `PATCH /checkout/admin/orders/:id/archive` · `…/unarchive` · `DELETE /checkout/admin/orders/:id`<br>Bulk: `POST /checkout/admin/orders/bulk-archive` · `bulk-unarchive` · `bulk-delete` |
| Coupons                              | `Coupon.archivedAt`               | `PATCH /coupons/:id/archive` · `…/unarchive` · `DELETE /coupons/:id` |
| Franchise applications               | `FranchiseApplication.archivedAt` | `PATCH /franchise/applications/:id/archive` · `…/unarchive` · `DELETE /franchise/applications/:id` |
| Users                                | `User.archivedAt`                 | `PATCH /users/:id/archive` · `…/unarchive` · `DELETE /users/:id` (see "User accounts" below) |
| Newsletter leads                     | `NewsletterLead.archivedAt`       | `PATCH /cms/newsletter/leads/:id/archive` · `…/unarchive` · `DELETE /cms/newsletter/leads/:id` |
| CMS → Banner slides                  | item in `banner_slides` JSON      | `PATCH /cms/:key/items/:itemId/archive`<br>`PATCH /cms/:key/items/:itemId/unarchive`<br>`DELETE /cms/:key/items/:itemId` |
| CMS → Header navigation links        | item in `header.navLinks`         | same, with `key = header` |
| CMS → Features                       | item in `features`                | same, with `key = features` |
| CMS → Categories                     | item in `categories`              | same, with `key = categories` |
| CMS → Trusted By partners            | item in `trusted_by.partners`     | same, with `key = trusted_by` |
| CMS → Return policy cards            | item in `return_policy.cards`     | same, with `key = return_policy` |
| Bundle → Discount tiers              | item in `bundle.tiers`            | same, with `key = bundle` |

All of these endpoints are admin-only (`@Roles(UserRole.ADMIN)`). Archive and restore are idempotent: archiving something that is already archived returns it unchanged.

### List endpoints: `?archived=`

| Value               | Returns                              | Used by                                |
| ------------------- | ------------------------------------ | -------------------------------------- |
| `exclude` (default) | live records only                    | the storefront and the normal admin lists |
| `only`              | archived records only                | the dashboard "Archived" tab           |
| `include`           | everything                           | dashboard revenue stats, the products context |

Supported on `GET /products`, `GET /coupons`, `GET /checkout/admin/orders` and `GET /cms/newsletter/leads`. On the public `GET /products`, the value is **ignored for non-admins**: they always get `exclude`.

CMS sections use `GET /cms?includeArchived=true` (and `GET /cms/:key?includeArchived=true`). It is honoured for admins only; everyone else receives sections with archived items stripped out.

---

## Side effects worth knowing

- **Products.** An archived product disappears from the shop and returns `404` on its product page (admins can still open it). Checkout rejects baskets that still contain it: *"… is no longer available."*
- **Coupons.** An archived coupon behaves exactly like a deleted one at checkout (*"Invalid coupon code."*) and never shows in the header promo bar. Creating a new coupon with the code of an archived one is refused with a message telling you to restore it or delete it permanently first.
- **Orders.** Archiving only hides the order from the admin Orders list. The customer still sees it in *My orders*, and the dashboard revenue/overview stats still count it (they query with `archived=include`). A permanent delete also removes its order items and refund request (`onDelete: Cascade`), and the customer no longer sees it.
- **Newsletter leads.** If an archived email subscribes again from the storefront, the lead is restored, because subscribing again is fresh consent.
- **CMS `active` vs `archivedAt`.** These are independent. `active: false` is the on/off switch: the item stays in the editor list but is hidden from the shop. `archivedAt` moves the item to the Archive panel. Restoring keeps the previous `active` value.

---

## User accounts: active, suspended, archived

Users have an account **status** as well as the archive (rules: `src/users/account-access.ts`).

| State     | Set by                              | The user can…                                     |
| --------- | ----------------------------------- | ------------------------------------------------- |
| Active    | default / `PATCH /users/:id/activate` | everything                                     |
| Suspended | `PATCH /users/:id/suspend` `{ reason? }` | browse the shop as a guest, nothing else      |
| Archived  | `PATCH /users/:id/archive`          | browse the shop as a guest, nothing else          |

A suspended or archived account:

- **can't sign in or refresh a session.** It gets 403 with `code: ACCOUNT_SUSPENDED` / `ACCOUNT_ARCHIVED`, and the message includes the admin's reason.
- **can't call any authenticated endpoint, or make any non-GET request while signed in.** `JwtAuthGuard` looks up the status on every request, so a suspension takes effect at once and doesn't wait for the token to expire.
- **can't buy or pay**, even as a "guest" using the account's email. `CheckoutService.assertPurchaserCanBuy` checks this before the PaymentIntent is created and again before the order is saved.
- **is signed out everywhere.** Suspending or archiving revokes all refresh tokens. On the frontend, `store/api/baseApi.ts` signs the user out and shows the reason as soon as any request returns one of those codes.

Other rules:

- Admin accounts and your own account can't be suspended, archived or deleted (403).
- Restoring an archived user keeps their status: a suspended user stays suspended.
- Deleting a user forever removes their addresses and sessions. Their orders are kept, with `userId` set to null.
- Endpoints that must work for a blocked account (sign in / out / up, refresh) are marked `@AllowBlockedAccount()`.
- `GET /users?archived=exclude|only|include&status=ACTIVE|SUSPENDED`

Dashboard: `AllUsersTable.tsx` (Suspend / Activate / Archive buttons, a "Suspended" tab, Users/Archived switch) and `users/SuspendUserDialog.tsx`.

---

## Backend: how it is built

```
src/common/archive/archive.ts   shared rules for DB records
src/cms/cms-archive.ts          the same rules for items inside CMS JSON sections
src/cms/cms-archive.spec.ts     unit tests for both
prisma/migrations/20261119120000_add_archived_at/   adds the columns and indexes
```

### `src/common/archive/archive.ts`

| Export                            | What it does |
| --------------------------------- | ------------ |
| `archiveFilterSchema`             | Zod schema for `?archived=`, defaults to `exclude` |
| `archiveWhere(filter)`            | Prisma `where` fragment: `{ archivedAt: null }`, `{ archivedAt: { not: null } }` or `{}` |
| `resolveArchiveFilter(req, isAdmin)` | Forces `exclude` for non-admins on public endpoints |
| `assertArchivedBeforeDelete(record, label)` | Throws 409 if `record.archivedAt` is null |
| `assertAllArchivedBeforeDelete(records)` | Same check for bulk deletes (all-or-nothing) |
| `bulkIdsSchema`                   | `{ ids: string[] }` body (1–100 ids) |

### `src/cms/cms-archive.ts`

CMS content is one JSON blob per section, so items cannot have a database column. Each item carries `archivedAt` instead, and the rules are applied on every write:

1. **`PUT /cms/:key` can never remove an item.** `mergeCmsSectionUpdate` compares the payload with what is stored. A live item missing from the payload → 409. An archived item missing from the payload is put back, so an out-of-date browser tab cannot lose it by accident.
2. **Permanent removal** only happens through `DELETE /cms/:key/items/:itemId` (`removeArchivedCmsItem`), and only for archived items.
3. **`POST /cms/:key/reset`** restores the default content. Items you added yourself (ids that are not in the defaults) are moved to the archive, not deleted (`resetCmsSectionKeepingCustomItems`).
4. **Public reads** (`GET /cms`, `GET /cms/:key`) strip archived items (`stripArchivedItems`).

Which sections have archivable lists is configured in one place:

```ts
// src/cms/cms-archive.ts
export const CMS_ARCHIVABLE_LISTS = {
  header:        { path: 'navLinks', label: 'Navigation link' },
  banner_slides: { path: null,       label: 'Banner slide' },   // null = the section itself is the array
  features:      { path: null,       label: 'Feature' },
  categories:    { path: null,       label: 'Category' },
  trusted_by:    { path: 'partners', label: 'Partner' },
  return_policy: { path: 'cards',    label: 'Policy card' },
  bundle:        { path: 'tiers',    label: 'Discount tier' },
};
```

Every item in those lists needs a **unique string `id`**. (The default `banner_slides` had two slides with `id: 'slide-2'`. This was fixed in `DEFAULT_CMS_DATA`. If a database already stores duplicate ids from an earlier seed, give them unique ids.)

---

## Frontend: how it is built (Slimza repo)

```
app/(CommonLayout)/lib/archive.ts                       isArchived, isLiveCmsItem, formatArchivedDate
store/features/archive.ts                               ArchiveFilter, BulkArchiveResponse types
store/features/*/…Api.ts                                RTK Query endpoints (archive*, unarchive*, deleteArchived*)
app/(DashboardLayout)/dashboard/_components/archive/
  ArchiveConfirmDialog.tsx   one confirm dialog for archive (amber) / restore (green) / delete forever (red)
  ArchiveButton.tsx          the button that replaced every old trash/"Delete" button
  ArchiveViewToggle.tsx      "Active | Archived" switch for tables (orders, coupons, newsletter)
  ArchivedItemsPanel.tsx     collapsible Archive list under each CMS editor
  useCmsItemArchive.tsx      hook: archive / restore / delete-forever for one CMS section
app/(DashboardLayout)/dashboard/_components/cms/cmsHelpers.ts
  splitArchived(items)       → { live, archived }
  moveLiveItem(items, id, ±1) reorder among live items, skipping archived ones
```

- **Storefront components** must filter CMS lists with `isLiveCmsItem(item)` (live **and** `active !== false`), never with `active` alone. The backend already strips archived items for visitors. The frontend filter also covers an admin who opens the shop in the same browser session, where the cached CMS data includes archived items.
- **Dashboard CMS routes** fetch `GET /cms?includeArchived=true` (see `store/ReduxProvider.tsx`). Storefront routes fetch plain `/cms`.
- The CMS item mutations deliberately **do not invalidate** the `Cms` cache tag. A refetch would overwrite unsaved edits in the editors. `useCmsItemArchive` updates only the affected item in the local store, using the server's response.

---

## Adding a new archivable thing

**A new database model**

1. Add `archivedAt DateTime?` and `@@index([archivedAt])` to the model, then create a migration.
2. In list queries, spread `...archiveWhere(filter)` into `where`, and accept `?archived=` with `archiveFilterSchema`.
3. Add `archive` / `unarchive` service methods that set or clear `archivedAt`.
4. In `remove`, call `assertArchivedBeforeDelete(record, label)` before `prisma.x.delete`.
5. Expose `PATCH :id/archive`, `PATCH :id/unarchive` and `DELETE :id` (admin only).
6. Frontend: add the mutations to the slice's `…Api.ts`, use `ArchiveViewToggle` + `ArchiveConfirmDialog` in the table.

**A new list inside a CMS section**

1. Give every item a unique string `id`.
2. Add the section to `CMS_ARCHIVABLE_LISTS` in `src/cms/cms-archive.ts`.
3. Add `extends Archivable` to the item's interface in `cmsStore.ts`.
4. In the editor: `splitArchived`, `useCmsItemArchive`, `ArchiveButton`, `ArchivedItemsPanel`, and render `{archive.confirmDialog}`.
5. In the storefront component: `items.filter(isLiveCmsItem)`.

---

## Testing

```bash
# backend
npx vitest run src/cms/cms-archive.spec.ts
```

Manual check with curl (admin token in `$T`):

```bash
curl -X DELETE  -H "Authorization: Bearer $T" $API/products/<id>           # live → 409
curl -X PATCH   -H "Authorization: Bearer $T" $API/products/<id>/archive   # → archivedAt set
curl -X DELETE  -H "Authorization: Bearer $T" $API/products/<id>           # → { ok: true }
```
