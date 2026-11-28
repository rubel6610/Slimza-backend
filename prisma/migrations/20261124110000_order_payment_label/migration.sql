-- How an order was paid, for the customer's wallet ("Visa •••• 4242", "Store credit").
ALTER TABLE `Order` ADD COLUMN `paymentLabel` VARCHAR(191) NOT NULL DEFAULT '';
