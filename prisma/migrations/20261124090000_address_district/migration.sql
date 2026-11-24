-- Optional district / county on saved addresses (orders keep it inside shippingAddress JSON).
ALTER TABLE `Address` ADD COLUMN `district` VARCHAR(191) NOT NULL DEFAULT '';
