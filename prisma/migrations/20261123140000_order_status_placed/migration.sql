-- Order flow: Placed (automatic) → Processing → Shipped → Delivered, or Cancelled.
-- The old PENDING status becomes PLACED.

-- 1. Allow both values while existing rows are converted.
ALTER TABLE `Order` MODIFY `status` ENUM('PENDING', 'PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PLACED';

-- 2. Convert.
UPDATE `Order` SET `status` = 'PLACED' WHERE `status` = 'PENDING';

-- 3. Drop PENDING.
ALTER TABLE `Order` MODIFY `status` ENUM('PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PLACED';
