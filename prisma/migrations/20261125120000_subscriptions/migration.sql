-- Subscribe & Save: per-product supply options, subscriptions, renewal orders.
-- AlterTable
ALTER TABLE `Order` ADD COLUMN `subscriptionId` VARCHAR(191) NULL,
    ADD COLUMN `subscriptionSequence` INTEGER NULL;

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `stripeProductId` VARCHAR(191) NULL,
    ADD COLUMN `subscriptionEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `supplyOptions` JSON NULL;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'PAST_DUE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `stripeSubscriptionId` VARCHAR(191) NULL,
    `stripeCustomerId` VARCHAR(191) NULL,
    `productName` VARCHAR(191) NOT NULL,
    `productImage` VARCHAR(191) NOT NULL DEFAULT '',
    `optionId` VARCHAR(191) NOT NULL,
    `optionLabel` VARCHAR(191) NOT NULL,
    `interval` VARCHAR(191) NOT NULL,
    `intervalCount` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unitPrice` DOUBLE NOT NULL,
    `shippingMethod` VARCHAR(191) NOT NULL,
    `shippingFee` DOUBLE NOT NULL,
    `tax` DOUBLE NOT NULL DEFAULT 0,
    `renewalAmount` DOUBLE NOT NULL,
    `shippingAddress` JSON NOT NULL,
    `paymentLabel` VARCHAR(191) NOT NULL DEFAULT '',
    `ordersCount` INTEGER NOT NULL DEFAULT 1,
    `minOrders` INTEGER NOT NULL DEFAULT 2,
    `firstOrderId` VARCHAR(191) NULL,
    `nextRenewalAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_stripeSubscriptionId_key`(`stripeSubscriptionId`),
    INDEX `Subscription_userId_idx`(`userId`),
    INDEX `Subscription_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

