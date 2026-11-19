-- User account status (active / suspended) + archive. See src/users/account-access.ts.
-- AlterTable
ALTER TABLE `User` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `suspendedAt` DATETIME(3) NULL,
    ADD COLUMN `suspensionReason` TEXT NULL;

-- CreateIndex
CREATE INDEX `User_status_idx` ON `User`(`status`);

-- CreateIndex
CREATE INDEX `User_archivedAt_idx` ON `User`(`archivedAt`);

