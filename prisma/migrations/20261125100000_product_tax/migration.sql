-- Tax for products whose price doesn't include it: percent or fixed £ per item. Never discounted.
-- AlterTable
ALTER TABLE `Order` ADD COLUMN `tax` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `taxType` VARCHAR(191) NOT NULL DEFAULT 'percent',
    ADD COLUMN `taxValue` DOUBLE NOT NULL DEFAULT 0;

