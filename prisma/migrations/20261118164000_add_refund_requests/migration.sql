-- CreateTable
CREATE TABLE `RefundRequest` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `customerEmail` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'gbp',
    `reason` TEXT NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED') NOT NULL DEFAULT 'REQUESTED',
    `adminNote` TEXT NULL,
    `stripeRefundId` VARCHAR(191) NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RefundRequest_orderId_key`(`orderId`),
    INDEX `RefundRequest_status_idx`(`status`),
    INDEX `RefundRequest_customerEmail_idx`(`customerEmail`),
    INDEX `RefundRequest_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RefundRequest` ADD CONSTRAINT `RefundRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
