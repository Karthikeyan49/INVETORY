-- 033_wiring_fixes.sql
-- Cross-module interconnection fixes (system wiring audit):
--   #4  machines.previous_status — restore a machine's real status after a
--       maintenance issue is resolved (instead of hardcoding 'in_stock').
--   #7  machines.purchase_id / purchases.machine_id — a real FK between a
--       machine and the vendor purchase it was booked from, so buy-price edits
--       can sync and the link survives note edits.
--   #9  followups.mobile — carry the prospect's phone from a DCR line into the
--       seeded lead (the number was silently dropped before).
--   #5/#6 invoices.customer_id — link an invoice to the real customer id so the
--       Customer History tab stops matching by name (which leaks between two
--       customers who share a name).
-- Idempotent: applied on production via the PHP information_schema guard, so the
-- ADD COLUMNs below are the source-of-truth record of the schema change.

ALTER TABLE machines  ADD COLUMN previous_status VARCHAR(20) NULL AFTER status;
ALTER TABLE machines  ADD COLUMN purchase_id     INT NULL      AFTER notes;
ALTER TABLE purchases ADD COLUMN machine_id      INT NULL      AFTER vendor_name;
ALTER TABLE followups ADD COLUMN mobile          VARCHAR(30) NULL AFTER customer_name;
ALTER TABLE invoices  ADD COLUMN customer_id     INT NULL      AFTER order_id;

CREATE INDEX idx_machines_purchase   ON machines(purchase_id);
CREATE INDEX idx_purchases_machine   ON purchases(machine_id);
CREATE INDEX idx_invoices_customer   ON invoices(customer_id);
