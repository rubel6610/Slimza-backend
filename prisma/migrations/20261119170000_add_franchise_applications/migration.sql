-- Franchise / sales-representative applications from the public /franchise page.
-- CreateTable
CREATE TABLE `FranchiseApplication` (
    `id` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `address` TEXT NOT NULL,
    `businessName` VARCHAR(191) NULL,
    `country` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `interest` ENUM('FRANCHISE', 'SALES_REPRESENTATIVE') NOT NULL,
    `channel` ENUM('ONLINE', 'RETAIL', 'BOTH') NOT NULL,
    `message` TEXT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NEW',
    `adminNote` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FranchiseApplication_status_idx`(`status`),
    INDEX `FranchiseApplication_archivedAt_idx`(`archivedAt`),
    INDEX `FranchiseApplication_createdAt_idx`(`createdAt`),
    INDEX `FranchiseApplication_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

