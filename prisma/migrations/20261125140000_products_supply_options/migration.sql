-- Products are sold through purchase options only (no separate product price).
-- Products without options get the plans the shop showed until now:
--   1 Month = price · 2 Months = price × 2 − 10% · 3 Months = price × 3 − 15%
-- ("was" prices scale the same way). Admins edit / replace them in Dashboard → Products.
UPDATE `Product`
SET `supplyOptions` = JSON_ARRAY(
    JSON_OBJECT('id', 'm1', 'label', '1 Month Supply', 'interval', 'month', 'intervalCount', 1,
      'price', ROUND(`price`, 2),
      'compareAtPrice', IF(`originalPrice` > `price`, ROUND(`originalPrice`, 2), NULL),
      'servings', NULL, 'badge', '', 'subscribeDiscountPercent', 0),
    JSON_OBJECT('id', 'm2', 'label', '2 Month Supply', 'interval', 'month', 'intervalCount', 2,
      'price', ROUND(`price` * 2 * 0.9, 2),
      'compareAtPrice', IF(`originalPrice` > `price`, ROUND(`originalPrice` * 2 * 0.9, 2), ROUND(`price` * 2, 2)),
      'servings', NULL, 'badge', '', 'subscribeDiscountPercent', 0),
    JSON_OBJECT('id', 'm3', 'label', '3 Month Supply', 'interval', 'month', 'intervalCount', 3,
      'price', ROUND(`price` * 3 * 0.85, 2),
      'compareAtPrice', IF(`originalPrice` > `price`, ROUND(`originalPrice` * 3 * 0.85, 2), ROUND(`price` * 3, 2)),
      'servings', NULL, 'badge', '', 'subscribeDiscountPercent', 0)
  )
WHERE `supplyOptions` IS NULL OR JSON_LENGTH(`supplyOptions`) = 0;
