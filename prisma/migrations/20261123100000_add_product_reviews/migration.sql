-- AlterTable
ALTER TABLE `Product` MODIFY `rating` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `reviewCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `ProductReview` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `authorName` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL DEFAULT '',
    `body` TEXT NOT NULL,
    `status` ENUM('PUBLISHED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED',
    `verifiedPurchase` BOOLEAN NOT NULL DEFAULT false,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `featuredAt` DATETIME(3) NULL,
    `adminReply` TEXT NULL,
    `adminReplyAt` DATETIME(3) NULL,
    `editedByAdmin` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    INDEX `ProductReview_productId_status_archivedAt_idx`(`productId`, `status`, `archivedAt`),
    INDEX `ProductReview_featured_status_idx`(`featured`, `status`),
    INDEX `ProductReview_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `ProductReview_productId_userId_key`(`productId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductReview` ADD CONSTRAINT `ProductReview_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductReview` ADD CONSTRAINT `ProductReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Product ratings now come from real customer reviews. Clear the placeholder
-- "5.0 stars / 12 reviews" every product was created with.
UPDATE `Product` SET `rating` = 0, `reviewCount` = 0;
