-- 036_queries_customer_id.sql
-- B2: link customer queries/enquiries to a specific customer so the Customer page
-- can add and list a customer's enquiries. Additive + idempotent (applied on
-- production via the information_schema guard in the migration runner).
ALTER TABLE `queries` ADD COLUMN `customer_id` INT NULL AFTER `user_id`;
CREATE INDEX `idx_queries_customer` ON `queries` (`customer_id`);
