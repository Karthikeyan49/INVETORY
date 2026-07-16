-- 037_backfill_vendors_from_po.sql
-- A3: vendors added via the Purchase Order (and Purchases) free-text vendor field
-- were never written to the Vendors register, so they "couldn't be found".
-- Going forward PoRegister::create/update call Vendor::ensureByName(); this
-- migration backfills the register with distinct historical vendor names from
-- po_register + purchases that aren't already present.
-- Additive + idempotent: re-running inserts nothing (guarded by NOT EXISTS).
INSERT INTO vendors (name, is_active, created_at)
SELECT n.name, 1, NOW()
FROM (
  SELECT DISTINCT TRIM(vendor_name) AS name FROM po_register WHERE TRIM(COALESCE(vendor_name, '')) <> ''
  UNION
  SELECT DISTINCT TRIM(vendor_name) AS name FROM purchases   WHERE TRIM(COALESCE(vendor_name, '')) <> ''
) n
WHERE NOT EXISTS (
  SELECT 1 FROM vendors v WHERE LOWER(TRIM(v.name)) = LOWER(n.name)
);

-- Give any register rows still missing a vendor_code a stable generated one.
UPDATE vendors
   SET vendor_code = CONCAT('VND-', LPAD(vendor_id, 4, '0'))
 WHERE vendor_code IS NULL OR vendor_code = '';
