-- 038_employee_incentive_flag.sql
-- B10: mark incentive-type employees (paid via the Incentives module, per
-- sale/visit/collection) so payroll NEVER generates a monthly salary slip for
-- them. Set at employee creation. Additive + idempotent.
ALTER TABLE `employees` ADD COLUMN `is_incentive` TINYINT(1) NOT NULL DEFAULT 0 AFTER `base_salary`;
