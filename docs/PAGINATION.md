# Pagination, search & sort: learn it step by step

The reusable toolkit lives in **`src/common/pagination/pagination.ts`**.
The worked example is **`GET /users/paged`** (`UsersService.findPage`).
Tests that show every rule: `src/common/pagination/pagination.spec.ts`.

---

## Part 1: how the backend works (read this first)

### The contract (same for every list)

```
GET /users/paged?page=2&limit=20&q=rubel&sort=name:asc&status=ACTIVE
```

```jsonc
{
  "items": [ /* only this page */ ],
  "meta": { "page": 2, "limit": 20, "total": 137, "totalPages": 7,
            "hasNextPage": true, "hasPreviousPage": true }
}
```

| Param | Meaning | Default | Rules |
| --- | --- | --- | --- |
| `page` | which page, starting at 1 | 1 | whole number ≥ 1 |
| `limit` | rows per page | 20 | 1–100 |
| `q` | free-text search | "" | ≤ 200 chars |
| `sort` | `field:asc` or `field:desc` | per endpoint | field must be whitelisted |
| filters | endpoint-specific (`status`, `role`…) | none | validated with zod |

### The four building blocks

1. **`listQuerySchema({ sortable, defaultSort })`** reads and validates the URL. Bad input
   gives a 400 before your code runs. `.extend({...})` adds your own filters.
2. **`searchWhere(q, fields)`**: `q` becomes "any of these fields contains q". It returns
   `{}` when empty, so you can always spread it.
3. **`toOrderBy(sort)`**: `"name:asc"` becomes `[{ name: 'asc' }, { id: 'asc' }]`. The `id`
   tiebreaker keeps the order stable, so rows never jump between pages.
4. **`paginate(query, { count, findMany })`** runs the count and the page query in
   parallel with the **same `where`**, then builds `meta`.

### Read the example

Open `UsersService.findPage` and follow the three numbered comments. Then try it.
These are real requests (use an admin token):

```
/users/paged?page=1&limit=2
/users/paged?page=2&limit=2&sort=name:asc
/users/paged?q=yopmail&role=CUSTOMER
/users/paged?sort=passwordHash:asc   → 400 (not whitelisted, on purpose)
/users/paged?limit=500               → 400 (max 100)
```

**Why a new route?** The dashboard still uses the old `GET /users` (a plain array).
Adding `/users/paged` next to it means nothing breaks while you build the new
frontend. When the frontend is switched over, delete the old route. This is a
normal way to change an API safely.

---

## Part 2: your turn, the frontend (Users page)

Work in `Slimza/`. Do one step at a time and check it in the browser before moving on.

### Step 1: types and the API call

In `store/features/user/userApi.ts`:

- Add a generic type you'll reuse everywhere:
  ```ts
  export interface PageMeta { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean }
  export interface Paginated<T> { items: T[]; meta: PageMeta }
  ```
  (Later, move it to a shared file such as `store/api/pagination.ts`.)
- Add `getUsersPage: builder.query<Paginated<User>, UsersPageParams>` calling
  `/users/paged` with `params`.
- ✅ Check: log the result in `AllUsersTable` and compare it with the requests above.

### Step 2: keep the list state in one place

You need `page`, `limit`, `q`, `sort`, `status`, `archived`.

- Start with `useState`. (Stretch goal later: keep them in the URL with
  `useSearchParams`, so refresh and back/forward keep the view.)
- **Rule to remember:** when a filter, the search or the sort changes, set `page` back to 1.
  Otherwise you can end up on "page 5 of 1".

### Step 3: search without spamming the API

Typing "rubel" shouldn't send 5 requests.

- Hint: `useDeferredValue(search)`, or a small `useDebounce(value, 300)` hook.
- ✅ Check in the Network tab: one request after you stop typing.

### Step 4: render the page and the controls

- Rows come from `data.items`, not from filtering in the browser any more. Remove the
  old `.filter(...)` code for search and status.
- Text: `Showing {from}–{to} of {total}`, where
  `from = (page - 1) * limit + 1` and `to = Math.min(page * limit, total)`.
- Previous/Next buttons: disable them with `meta.hasPreviousPage` / `meta.hasNextPage`.
- Optional: a "rows per page" select (10 / 20 / 50).

### Step 5: loading states that feel good

RTK Query gives you two flags:
- `isLoading` is the first load, with no data yet. Show a skeleton.
- `isFetching` is any reload (next page, new search). Keep the old rows and dim them
  (`opacity-60`), so the table doesn't flash empty.

### Step 6: sorting

- Make column headers clickable: `name` becomes `name:asc`, then `name:desc`, then back.
- Only use fields the backend allows (`createdAt`, `name`, `email`, `loyaltyPoints`),
  or you'll get the 400 from Part 1.

### Step 7: after an action, refresh

Suspend, activate, archive and similar actions already invalidate the `"User"` tag. Make sure
`getUsersPage` has `providesTags: ["User"]`, so the current page reloads by itself.

### Step 8: clean up

Once the Users page uses `/users/paged`, remove the old `GET /users` route and the
`findAll` method (backend), and the old `getAllUsers` call (frontend). The sidebar badge
uses it too: switch it to `getUsersPage({ limit: 1 })` and read `meta.total`.

---

## Part 3: your turn, more endpoints (backend practice)

Same recipe each time: **schema → where → paginate → controller route**. Copy
`findPage` from users and adapt it. Suggested order, easiest first:

| Endpoint | Search fields | Filters | Sortable | Notes |
| --- | --- | --- | --- | --- |
| Coupons | `code` | `archived`, active/expired | `createdAt`, `code`, `discountPercent` | small and simple |
| Newsletter leads | `email` | `archived`, `status` | `subscribedAt`, `email` | |
| Franchise applications | `fullName`, `email`, `businessName` | `archived`, `status`, `interest`, `channel` | `createdAt` | |
| Orders (admin) | `orderNumber`, `customerEmail`, `customerName` | `archived`, `status`, `paymentStatus`, date range | `createdAt`, `total` | already has page/limit; move it onto the toolkit |
| Products | `name`, `description` | `category`, `publishStatus`, `archived`, price range | `createdAt`, `price`, `name` | the shop page needs it too |

Things to watch:
- **Use the same `where` for count and findMany**, or `total` won't match the pages.
- **Date ranges:** `createdAt: { gte: from, lte: to }`. Validate with `z.coerce.date()`.
- **Dashboard stats must not use a paginated list.** Totals such as revenue should come
  from `prisma.order.aggregate({ _sum: { total: true } })`, not from adding up page 1.
- Write one spec per endpoint, like `pagination.spec.ts`.

When you've done one, ask for a review and I'll go through it with you.
