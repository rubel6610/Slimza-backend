-- Shipping label + tracking details on orders.
-- AlterTable
ALTER TABLE `Order` ADD COLUMN `shippedAt` DATETIME(3) NULL,
    ADD COLUMN `shippingLabel` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `trackingCarrier` VARCHAR(191) NULL,
    ADD COLUMN `trackingNumber` VARCHAR(191) NULL,
    ADD COLUMN `trackingUrl` VARCHAR(500) NULL;

