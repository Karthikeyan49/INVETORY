-- Quotation Builder (Operations module) — pick-and-play quotations with
-- priced line items, each carrying a JSON list of spec components.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS quotations (
  quotation_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_no     VARCHAR(40) NOT NULL,
  customer_name    VARCHAR(190) NOT NULL,
  customer_address VARCHAR(400) NULL,
  particular       VARCHAR(255) NULL,
  customer_gstin           VARCHAR(20)  NULL,
  customer_contact         VARCHAR(190) NULL,
  customer_contact_phone   VARCHAR(40)  NULL,
  reference_no             VARCHAR(60)  NULL,
  prepared_by_name         VARCHAR(190) NULL,
  prepared_by_designation  VARCHAR(120) NULL,
  prepared_by_phone        VARCHAR(40)  NULL,
  system_title             VARCHAR(255) NULL,
  quotation_date   DATE NULL,
  subtotal         DECIMAL(14,2) NOT NULL DEFAULT 0,
  gst_rate         DECIMAL(5,2)  NOT NULL DEFAULT 18,
  gst_amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
  grand_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
  advance_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  advance_date     DATE NULL,
  terms            TEXT NULL,
  notes            TEXT NULL,
  status           ENUM('Draft','Sent','Accepted','Rejected') NOT NULL DEFAULT 'Draft',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NULL,
  PRIMARY KEY (quotation_id),
  KEY idx_quot_no (quotation_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quotation_items (
  item_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id BIGINT UNSIGNED NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  name         VARCHAR(255) NOT NULL,
  make         VARCHAR(120) NULL,
  qty          DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit         VARCHAR(40) NULL,
  specifications VARCHAR(500) NULL,
  gst_rate     DECIMAL(5,2) NOT NULL DEFAULT 18,
  rate         DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
  components   JSON NULL,
  PRIMARY KEY (item_id),
  KEY idx_qi_quot (quotation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
