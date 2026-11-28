-- One renewal order per Stripe invoice.
-- AlterTable
ALTER TABLE `Order` ADD COLUMN `stripeInvoiceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Order_stripeInvoiceId_key` ON `Order`(`stripeInvoiceId`);

