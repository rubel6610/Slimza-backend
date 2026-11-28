-- CreateIndex
CREATE INDEX `Product_price_idx` ON `Product`(`price`);

-- CreateIndex
CREATE FULLTEXT INDEX `Product_name_idx` ON `Product`(`name`);

-- CreateIndex
CREATE FULLTEXT INDEX `Product_description_idx` ON `Product`(`description`);

-- CreateIndex
CREATE FULLTEXT INDEX `Product_name_description_idx` ON `Product`(`name`, `description`);

