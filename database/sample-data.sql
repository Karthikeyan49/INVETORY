-- ============================================================================
-- sample-data.sql  —  OPTIONAL demo data for testing the app
-- ============================================================================
-- Import this ONCE, AFTER schema.sql, to get a few products, a component
-- library, and one saved quotation so the Quotation Builder / prompt-builder
-- has something to work with. It is NOT shipped by deploy.sh and is NOT part of
-- the clean structure-only schema — import it only when you want demo data.
--
--   mysql -u <user> -p <db> < database/sample-data.sql
--   (or paste into phpMyAdmin → Import / SQL, with the database selected)
--
-- Re-runnable: it removes its own sample rows first, so importing twice is safe.
-- ============================================================================

-- --- General-purpose fix -----------------------------------------------------
-- The original template shipped a biomass-specific enum on products.product_type
-- (pellets/biomass-stove/biomass-burner). Widen it to a free-form slug so any
-- industry's products (solar, etc.) insert cleanly. Harmless if already widened.
ALTER TABLE `products` MODIFY `product_type` VARCHAR(50) NOT NULL DEFAULT 'general';

-- ---------------------------------------------------------------------------
-- 1) Sample products (solar catalog)  — grouped by `category` in the palette
-- ---------------------------------------------------------------------------
DELETE FROM `products` WHERE `product_name` IN (
  'Solar Panel 625Wp Mono PERC',
  'Solar Panel 550Wp Polycrystalline',
  'Hybrid Inverter 60kW',
  'String Inverter 10kW',
  'DC Cable 6 sq mm',
  'AC Cable 4 sq mm',
  'GI Mounting Structure',
  'Solar Battery 100Ah'
);

-- Ensure the gst_rate column exists (for DBs imported before it was added).
ALTER TABLE `products` ADD COLUMN IF NOT EXISTS `gst_rate` decimal(5,2) NOT NULL DEFAULT 18.00 AFTER `base_price`;

INSERT INTO `products`
  (`product_name`, `product_type`, `description`, `base_price`, `gst_rate`, `unit`, `category`, `tag`, `is_available`, `is_deleted`)
VALUES
  ('Solar Panel 625Wp Mono PERC',        'solar-panels', 'N-type TOPCon mono-perc module, 25yr performance warranty', 11500.00,  5.00, 'Nos', 'Solar Panels', 'Bestseller', 1, 0),
  ('Solar Panel 550Wp Polycrystalline',  'solar-panels', 'Polycrystalline module for budget rooftop systems',          9500.00,  5.00, 'Nos', 'Solar Panels', NULL,        1, 0),
  ('Hybrid Inverter 60kW',               'inverters',    'Three-phase hybrid inverter with battery backup support',    385000.00, 18.00, 'Nos', 'Inverters',   'Backup',    1, 0),
  ('String Inverter 10kW',               'inverters',    'Three-phase grid-tie string inverter',                        82000.00, 18.00, 'Nos', 'Inverters',   NULL,        1, 0),
  ('DC Cable 6 sq mm',                   'cables',       'UV-resistant solar DC cable, per metre',                          95.00, 18.00, 'Mtr', 'Cables',      NULL,        1, 0),
  ('AC Cable 4 sq mm',                   'cables',       'Copper AC cable, per metre',                                       70.00, 18.00, 'Mtr', 'Cables',      NULL,        1, 0),
  ('GI Mounting Structure',              'mounting',     'Hot-dip galvanised rooftop mounting set',                       4500.00, 18.00, 'Set', 'Mounting',    NULL,        1, 0),
  ('Solar Battery 100Ah',                'batteries',    'Tall tubular solar battery, 12V 100Ah',                        18500.00, 28.00, 'Nos', 'Batteries',   NULL,        1, 0);

-- ---------------------------------------------------------------------------
-- 2) Sample component library  — the draggable chips in the builder
-- ---------------------------------------------------------------------------
DELETE FROM `component_library` WHERE `name` IN (
  'Earthing Kit', 'ACDB', 'DCDB', 'Lightning Arrester', 'MC4 Connectors', 'Cable Ties'
);

INSERT INTO `component_library`
  (`name`, `make`, `default_unit`, `default_qty`, `category`)
VALUES
  ('Earthing Kit',       'ABB',     'Nos',  1, 'Protection'),
  ('ACDB',               'Havells', 'Nos',  1, 'Protection'),
  ('DCDB',               'Havells', 'Nos',  1, 'Protection'),
  ('Lightning Arrester', 'ABB',     'Nos',  1, 'Protection'),
  ('MC4 Connectors',     'Staubli', 'Pair', 4, 'Accessories'),
  ('Cable Ties',         NULL,      'Pkt',  2, 'Accessories');

-- ---------------------------------------------------------------------------
-- 3) One saved quotation  (the "70 panels, 1 hybrid inverter, 100m DC cable"
--    example) + its line items, with companion components attached.
-- ---------------------------------------------------------------------------
DELETE qi FROM `quotation_items` qi
  JOIN `quotations` q ON q.`quotation_id` = qi.`quotation_id`
  WHERE q.`quotation_no` = 'VBQ-2026-0001';
DELETE FROM `quotations` WHERE `quotation_no` = 'VBQ-2026-0001';

-- Totals:
--   Panels   70 x 11500 = 805000  @ 5%  GST = 40250
--   Inverter  1 x 385000 = 385000 @ 18% GST = 69300
--   DC Cable 100 x    95 =   9500 @ 18% GST =  1710
--   Subtotal = 1,199,500   GST = 111,260   Grand total = 1,310,760
INSERT INTO `quotations`
  (`quotation_no`, `customer_name`, `customer_address`, `particular`,
   `customer_gstin`, `customer_contact`, `customer_contact_phone`, `reference_no`,
   `prepared_by_name`, `prepared_by_designation`, `prepared_by_phone`, `system_title`,
   `quotation_date`, `subtotal`, `gst_rate`, `gst_amount`, `grand_total`,
   `advance_amount`, `advance_date`, `terms`, `status`)
VALUES
  ('VBQ-2026-0001', 'VELS Grand Square', 'No 1/1, Kancheepuram – 631 502', 'Rooftop Solar Supply & Installation',
   '33AGLPM0183B2ZS', 'Mr. Mohanavel', '9443246060', 'VB_TN-2627',
   'M/S Baskaran', 'Marketing Manager', '9445531605', 'HYBRID WITH 60KW BACKUP',
   '2026-06-05', 1199500.00, 18.00, 111260.00, 1310760.00,
   300000.00, '2026-05-14',
   '1. 75% Advance along with PO\n2. Delivery within 2 days\n3. Transport at actuals\n4. Unloading included',
   'Sent');

SET @qid := LAST_INSERT_ID();

INSERT INTO `quotation_items`
  (`quotation_id`, `sort_order`, `name`, `make`, `qty`, `unit`, `specifications`, `gst_rate`, `rate`, `amount`, `components`)
VALUES
  (@qid, 0, 'Solar Panel 625Wp Mono PERC', 'RAYZON', 70, 'Nos', 'N-type TOPCon mono-perc, 25yr warranty', 5.00, 11500.00, 805000.00,
     JSON_ARRAY(
       JSON_OBJECT('group','Protection',  'name','Earthing Kit',   'make','ABB',     'qty', 1),
       JSON_OBJECT('group','Accessories', 'name','MC4 Connectors', 'make','Staubli', 'qty', 8)
     )),
  (@qid, 1, 'Hybrid Inverter 60kW', 'Deye', 1, 'Nos', 'Three-phase hybrid inverter with 60kW backup', 18.00, 385000.00, 385000.00,
     JSON_ARRAY(
       JSON_OBJECT('group','Protection', 'name','ACDB',               'make','Havells', 'qty', 1),
       JSON_OBJECT('group','Protection', 'name','DCDB',               'make','Havells', 'qty', 1),
       JSON_OBJECT('group','Protection', 'name','Lightning Arrester', 'make','ABB',     'qty', 1)
     )),
  (@qid, 2, 'DC Cable 6 sq mm', NULL, 100, 'Mtr', 'UV-resistant solar DC cable', 18.00, 95.00, 9500.00,
     JSON_ARRAY());

-- Done. Reload the app: Products page shows 8 products, the Quotation Builder
-- palette shows components + products, and Quotations lists VBQ-2026-0001.
