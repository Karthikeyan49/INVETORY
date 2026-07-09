-- ============================================================
-- Migration 012: connect modules end-to-end
--   • Machine purchase  -> Expense  (handled in PHP, no schema change)
--   • Invoice created    -> Sales Order (orders row linked via invoices.order_id)
--   • Order/Invoice paid -> Revenue   (already wired via Payment::refreshInvoice)
--
--   To let an invoice-originated sale live in the orders table without a
--   catalog user/product, allow orders.user_id to be NULL and carry the
--   free-text customer name + a source tag directly on the order.
-- Idempotent: information_schema guards.
-- ============================================================

SET @t := 'orders';

-- Make user_id nullable (direct/invoice sales have no portal user account).
-- The FK on user_id stays valid: FK constraints ignore NULL values.
SET @nullable := (SELECT IS_NULLABLE FROM information_schema.columns
                  WHERE table_schema=DATABASE() AND table_name=@t AND column_name='user_id');
SET @s := IF(@nullable='NO', 'ALTER TABLE orders MODIFY COLUMN user_id INT(11) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Free-text customer name for orders without a linked user.
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name=@t AND column_name='customer_name');
SET @s := IF(@c=0, 'ALTER TABLE orders ADD COLUMN customer_name VARCHAR(150) NULL AFTER user_id', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Where the order originated: portal | invoice | machine (default legacy = portal).
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema=DATABASE() AND table_name=@t AND column_name='source');
SET @s := IF(@c=0, 'ALTER TABLE orders ADD COLUMN source VARCHAR(30) NULL DEFAULT NULL AFTER notes', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ============================================================
-- DONE — restart PHP (opcache) after running this migration
-- ============================================================
