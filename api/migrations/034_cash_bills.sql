-- 034_cash_bills.sql
-- Sri Vari Cash Bill (F/SVS/34) records — a cash-sale receipt that can be
-- created from a machine and downloaded as a PDF, like delivery challans / invoices.
CREATE TABLE IF NOT EXISTS cash_bills (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  bill_no       VARCHAR(40)   NOT NULL,
  customer_id   INT           NULL,
  customer_name VARCHAR(255)  NULL,
  cell_no       VARCHAR(40)   NULL,
  machine_id    INT           NULL,
  description   TEXT          NULL,
  qty           VARCHAR(40)   NULL,
  amount        DECIMAL(12,2) NULL,
  total         DECIMAL(12,2) NULL,
  bill_date     DATE          NULL,
  notes         TEXT          NULL,
  created_by    INT           NULL,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cash_bills_customer (customer_id),
  INDEX idx_cash_bills_created  (created_at)
);
