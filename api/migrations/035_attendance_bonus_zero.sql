-- 035_attendance_bonus_zero.sql
-- B5: set the attendance bonus to 0.
-- The full-attendance bonus was previously ₹750 by default. Business decision to
-- remove it: change the column default to 0 and zero out existing employee values.
-- Idempotent: re-running is a no-op (default already 0, rows already 0).
ALTER TABLE `employees`
  MODIFY COLUMN `attendance_bonus_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00;

UPDATE `employees`
  SET `attendance_bonus_amount` = 0.00
  WHERE `attendance_bonus_amount` <> 0.00;
