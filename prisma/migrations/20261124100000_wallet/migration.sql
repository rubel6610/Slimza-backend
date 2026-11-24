-- Wallet: store credit ledger, Stripe customer for saved cards, credit used per order.
-- AlterTable
ALTER TABLE `Order` ADD COLUMN `walletUsed` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `stripeCustomerId` VARCHAR(191) NULL,
    ADD COLUMN `walletBalance` DOUBLE NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `WalletTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('ADMIN_CREDIT', 'ADMIN_DEBIT', 'REFUND', 'ORDER_PAYMENT', 'ORDER_RETURN') NOT NULL,
    `amount` DOUBLE NOT NULL,
    `balanceAfter` DOUBLE NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `referenceKey` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WalletTransaction_referenceKey_key`(`referenceKey`),
    INDEX `WalletTransaction_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `WalletTransaction_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_stripeCustomerId_key` ON `User`(`stripeCustomerId`);

-- AddForeignKey
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

