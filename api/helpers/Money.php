<?php
declare(strict_types=1);

/**
 * Money — small, sanctioned helpers for currency arithmetic in PHP.
 *
 * Context: every money column in the schema is DECIMAL(x,2), so values are
 * stored exactly and the database rounds on write; balance comparisons already
 * use an epsilon tolerance. The residual risk from PHP float math is therefore
 * sub-cent drift within a single in-memory calculation. These helpers make that
 * explicit: round every computed amount to 2 dp before storing/returning, and
 * compare amounts with a tolerance instead of `==`.
 *
 * For a future hardening pass, prefer routing new financial math through here;
 * a full migration to integer paise / bcmath should be done with a financial
 * regression suite (see MONEY_PRECISION.md), not piecemeal.
 */
final class Money
{
    /** Comparisons within this many currency units are treated as equal (half a paisa). */
    public const EPSILON = 0.005;

    /** Round to 2 decimal places (paise), half-up. */
    public static function round(float|int|string $amount): float
    {
        return round((float) $amount, 2);
    }

    /** Sum a list of amounts, rounding the result to 2 dp. */
    public static function sum(array $amounts): float
    {
        return self::round(array_sum(array_map('floatval', $amounts)));
    }

    /** unit price × quantity, rounded to 2 dp. */
    public static function lineTotal(float|int|string $unitPrice, float|int|string $quantity): float
    {
        return self::round((float) $unitPrice * (float) $quantity);
    }

    /** True when two amounts are equal within EPSILON. */
    public static function equals(float $a, float $b): bool
    {
        return abs($a - $b) < self::EPSILON;
    }

    /** True when $a is greater than $b beyond the epsilon tolerance. */
    public static function greaterThan(float $a, float $b): bool
    {
        return ($a - $b) > self::EPSILON;
    }

    /** True when the amount is a valid, non-negative money value. */
    public static function isNonNegative(float|int|string $amount): bool
    {
        return is_numeric($amount) && (float) $amount >= 0;
    }
}
