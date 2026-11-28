-- AlterTable
ALTER TABLE `Product` DROP COLUMN `variations`,
    MODIFY `image` VARCHAR(191) NOT NULL DEFAULT '';

