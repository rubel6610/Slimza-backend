# Product search

**Endpoint:** `GET /products/search` (public). **Engine:** `src/products/product-search.ts`.
**Used by:** the `/shop` page (server side) and the navbar's live preview.

```
/products/search?q=detox tea&category=cleanse-reset,daily-energy&brand=&flag=best-selling
                &min=10&max=40&sort=relevance&page=1&limit=12
→ { items, meta: { page, limit, total, totalPages, hasNextPage, hasPreviousPage },
    facets: { categories: {slug: n}, brands: {slug: n}, flags: {slug: {name, count}} },
    sort, terms }
```

## Why it scales

- **Full-text indexes** on `Product.name`, `Product.description` and both together
  (`@@fulltext` in `schema.prisma`; migration `20261121180000_product_fulltext_search`).
  A search reads the index instead of scanning every row like `LIKE '%tea%'` does.
- **Only one page** of products is sent; counts are computed in the database.
- **Published, live products only** (`PUBLIC_PRODUCT_WHERE`). Drafts never leak.

## How text is matched

1. Lower-case; strip MySQL operator characters (`+ - * " ( ) < > ~ @`) and punctuation.
2. Drop stopwords MySQL never indexes (`the`, `for`, `and`…). Otherwise they'd match nothing.
3. Light stemming: `teas → tea`, `berries → berry`, `boxes → box`.
4. **Every** word must appear in name, description, brand or category. Prefix match:
   `tea*` finds "Teatox". Words under 3 letters use `LIKE` on the name.
5. Sort `relevance` (default when searching) ranks by full-text relevance, then featured order.

## Facets

Each facet is counted with every *other* filter applied ("if I also ticked this brand,
how many would I see?"). Flags are product tags; `/products/search?flag=best-selling`
matches any spelling of the tag. The slug → spelling map is cached for 60 s.

## Limits and next steps

- No typo tolerance ("teaa" won't find "tea") and no synonyms. When that matters, put
  Meilisearch / Typesense / Elasticsearch / Algolia behind the same endpoint. Only
  `product-search.ts` and `ProductsService.search` change; the frontend stays the same.
- Category and flag counts run one indexed `COUNT` each (≈ 10–40 queries per search).
  Fine for thousands of products; for very large catalogues, cache them per filter set.
- InnoDB's minimum token size (3) and stopword list are MySQL server settings
  (`innodb_ft_min_token_size`, `innodb_ft_server_stopword_table`).

Tests: `src/products/product-search.spec.ts`.
