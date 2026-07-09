-- ============================================================================
-- Migration: add `gst_rate` to the products table
-- ============================================================================
-- Run this ONCE on an EXISTING database that was imported before products had a
-- GST column. Fresh installs from schema.sql already include it — you don't need
-- this file in that case.
--
-- What it does:
--   • adds products.gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00 (after base_price)
--   • existing product rows get 18.00 by default (edit per-product afterwards)
--
-- Safe to run more than once (ADD COLUMN IF NOT EXISTS is a no-op if it exists).
--
-- How to import:
--   phpMyAdmin → select your database → SQL / Import tab → paste/upload this file
--   CLI:  mysql -u <user> -p <db> < database/migration_add_product_gst_rate.sql
-- ============================================================================

-- Target database — must already exist. Change this if your DB name differs,
-- or remove the line and select the database in phpMyAdmin before importing.
USE `u952547820_vbsolar`;

ALTER TABLE `products`
  ADD COLUMN IF NOT EXISTS `gst_rate` DECIMAL(5,2) NOT NULL DEFAULT 18.00 AFTER `base_price`;

-- Done. New products created via the Products page now carry their own GST %,
-- which auto-fills the line's tax when the product is added to a quotation/invoice.
