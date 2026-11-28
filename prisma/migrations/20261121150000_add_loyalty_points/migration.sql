-- AlterTable
ALTER TABLE `Order` ADD COLUMN `pointsDiscount` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `pointsEarned` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pointsRedeemed` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `loyaltyLifetime` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `loyaltyPoints` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `LoyaltyTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('WELCOME', 'PURCHASE', 'PURCHASE_REVERSAL', 'REDEEM', 'REDEEM_RETURN', 'BIRTHDAY', 'SOCIAL', 'ADMIN') NOT NULL,
    `status` ENUM('PENDING', 'AVAILABLE', 'CANCELLED') NOT NULL DEFAULT 'AVAILABLE',
    `points` INTEGER NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `referenceKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LoyaltyTransaction_referenceKey_key`(`referenceKey`),
    INDEX `LoyaltyTransaction_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LoyaltyTransaction_orderId_idx`(`orderId`),
    INDEX `LoyaltyTransaction_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LoyaltyTransaction` ADD CONSTRAINT `LoyaltyTransaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

