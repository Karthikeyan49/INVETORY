-- ============================================================
-- Migration 032: rate_limits table (security hardening)
--   Backing store for RateLimitMiddleware. Rows are one-per-request
--   with created_at stored as a UNIX epoch (integer seconds) so the
--   sliding-window checks in RateLimitMiddleware::check() work without
--   timezone math. Probabilistic cleanup in the middleware prunes old
--   rows, so no cron is required on shared hosting.
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
    id         BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
    ip         VARCHAR(45)  NOT NULL,           -- IPv4/IPv6
    bucket     VARCHAR(32)  NOT NULL,           -- general | login | register | otp
    created_at INT(10) UNSIGNED NOT NULL,       -- UNIX epoch seconds
    PRIMARY KEY (id),
    KEY idx_ip_bucket_created (ip, bucket, created_at),
    KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
