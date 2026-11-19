-- Archive lifecycle (soft delete). See src/common/archive/archive.ts and docs/ARCHIVE.md.
-- archivedAt = NULL  -> live record
-- archivedAt = date  -> archived (hidden from storefront, restorable, deletable)

-- AlterTable
ALTER TABLE `NewsletterLead` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Order` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Coupon` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `NewsletterLead_archivedAt_idx` ON `NewsletterLead`(`archivedAt`);

-- CreateIndex
CREATE INDEX `Order_archivedAt_idx` ON `Order`(`archivedAt`);

-- CreateIndex
CREATE INDEX `Product_archivedAt_idx` ON `Product`(`archivedAt`);

-- CreateIndex
CREATE INDEX `Coupon_archivedAt_idx` ON `Coupon`(`archivedAt`);
