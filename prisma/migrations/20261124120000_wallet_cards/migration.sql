-- Saved cards for test / demo mode (Stripe off): brand, last 4 and expiry only.
-- CreateTable
CREATE TABLE `WalletCard` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(40) NOT NULL,
    `last4` VARCHAR(4) NOT NULL,
    `expMonth` INTEGER NOT NULL,
    `expYear` INTEGER NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WalletCard_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WalletCard` ADD CONSTRAINT `WalletCard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

