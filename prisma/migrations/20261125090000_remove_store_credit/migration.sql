-- No store credit: Slimza takes payments through Stripe only (refunds go back to the card).
-- The ledger and balances were empty when this was written.
-- DropForeignKey
ALTER TABLE `WalletTransaction` DROP FOREIGN KEY `WalletTransaction_userId_fkey`;

-- AlterTable
ALTER TABLE `Order` DROP COLUMN `walletUsed`;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `walletBalance`;

-- DropTable
DROP TABLE `WalletTransaction`;

