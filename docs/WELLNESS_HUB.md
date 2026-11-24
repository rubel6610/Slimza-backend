# Wellness Product Hub

The homepage "Wellness Product Hub" shows **groups**, managed in **Dashboard → Wellness Product Hub**.
Code: `src/wellness-hub` (rules in `wellness-hub-config.ts`).

## Groups are not categories
- A group is a hand-picked, ordered list of products. A product can be in any number of groups,
  whatever its shop category.
- Shop categories (tea, matcha, shilajit…) stay in the CMS `categories` section and drive the shop
  filters and "Related products". The hub does not read them.

## Data
CMS section `wellness_hub` (saved with `PUT /cms/wellness_hub`, admin only, validated):

```
{ enabled, title, groups: [{ id, slug, name, description, image, productIds[], active, archivedAt }] }
```
- `slug` is unique, lowercase-with-dashes. The group page is `/wellness-hub/<slug>`.
- Up to 100 products per group. Duplicates are removed on save.
- Groups use the normal CMS archive lifecycle (`groups` list, see `docs/ARCHIVE.md`).

## API
| Who | Method | Path |
|---|---|---|
| Public | GET | `/wellness-hub/:slug` → `{ group, products }` (shown and live only; products in the admin's order, drafts/archived left out; 404 otherwise) |
| Admin | PUT | `/cms/wellness_hub` |

## First run
If `wellness_hub` doesn't exist yet, startup creates it from the current `categories` section: one group
per category (same name, image, order, shown/hidden), holding the published products in that category.
It never runs again once the section exists, so later category changes don't touch the hub.

## Choosing groups from the product form
The dashboard product form (add / edit) has a **Wellness Product Hub** picker.
- `POST /products` and `PATCH /products/:id` accept optional `hubGroupIds: string[]`. The product ends up
  in exactly those groups: added at the end of newly chosen groups, removed from the others, unchanged
  position where it already was. Omitting the field leaves the groups alone (the form only sends it
  when the admin changed the picker).
- Archiving a product keeps it in its groups (group pages just skip it), so restoring brings it back.
- Deleting a product forever removes it from every group.
