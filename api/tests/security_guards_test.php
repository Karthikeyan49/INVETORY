<?php
declare(strict_types=1);

/**
 * Framework-free security regression tests.
 *
 * Locks in the fix/security-hardening invariants so they can't silently
 * regress: (1) route-guard authorization map, (2) rate-limiter wiring,
 * (3) Money helper behaviour. Run with:  php api/tests/security_guards_test.php
 * Exits non-zero if any assertion fails.
 */

$root = dirname(__DIR__);
$failures = [];
$passes = 0;

function check(string $name, bool $cond, array &$failures, int &$passes): void
{
    if ($cond) {
        $passes++;
    } else {
        $failures[] = $name;
        fwrite(STDERR, "FAIL: {$name}\n");
    }
}

$index = file_get_contents($root . '/index.php');

/**
 * Assert the route with the given (method, path) literal is registered with the
 * expected guard argument. Matches the router registration line.
 */
function guardFor(string $index, string $method, string $path): ?string
{
    // e.g. $router->post('/machines/{id}/convert/invoice', [..], 'admin:owner,accountant');
    $quotedPath = preg_quote($path, '#');
    $re = '#\$router->' . $method . "\\(\\s*'" . $quotedPath . "'\\s*,.*?(?:,\\s*(true|'[^']*'))?\\);#";
    if (preg_match($re, $index, $m)) {
        return $m[1] ?? 'NONE';
    }
    return null;
}

// ── 1. Route-guard authorization map ─────────────────────────────────────────
$expect = [
    // Back-office tier must be staff-only (not auth=true)
    ['get',  '/machines',                              "'admin'"],
    ['post', '/machines',                              "'admin'"],
    ['post', '/machines/{id}/convert/invoice',         "'admin:owner,accountant'"],
    ['get',  '/stampings',                             "'admin'"],
    ['post', '/spares',                                "'admin'"],
    ['post', '/inventory-items',                       "'admin'"],
    ['get',  '/machine-issues',                        "'admin'"],
    ['post', '/purchases',                             "'admin:owner,accountant'"],
    ['get',  '/deliveries',                            "'admin'"],
    ['get',  '/followups',                             "'admin'"],
    // PII + aggregate metrics
    ['get',  '/users/email/{email}',                   "'admin'"],
    ['get',  '/statistics/revenue',                    "'admin'"],
    // Orders financial mutations
    ['get',  '/orders',                                "'admin'"],
    ['put',  '/orders/{id}/payment-status',            "'admin:owner,accountant'"],
    // Admin financial / privilege routes
    ['put',  '/admin/users/{id}',                      "'admin:owner'"],
    ['put',  '/admin/settings',                        "'admin:owner'"],
    ['post', '/admin/payroll/process',                 "'admin:owner,accountant,hr'"],
    ['post', '/admin/invoices',                        "'admin:owner,accountant'"],
    ['delete','/admin/expenses/{id}',                  "'admin:owner,accountant'"],
    // Chat must require auth
    ['post', '/chat',                                  "'admin'"],
    ['get',  '/chat/debug',                            "'admin:owner'"],
];
foreach ($expect as [$method, $path, $want]) {
    $got = guardFor($index, $method, $path);
    check("guard {$method} {$path} == {$want} (got " . var_export($got, true) . ")", $got === $want, $failures, $passes);
}

// Negative: customer self-service order create/show stay auth=true (correct).
check("POST /orders stays auth=true (customer places own order)",
    guardFor($index, 'post', '/orders') === 'true', $failures, $passes);

// ── 2. Rate limiter wired in ─────────────────────────────────────────────────
check('RateLimitMiddleware required in index.php',
    str_contains($index, "/middleware/RateLimitMiddleware.php'"), $failures, $passes);
check('login limiter invoked', str_contains($index, 'RateLimitMiddleware::loginLimit()'), $failures, $passes);
check('otp limiter invoked',   str_contains($index, 'RateLimitMiddleware::otpLimit()'), $failures, $passes);
check('general limiter invoked', str_contains($index, 'RateLimitMiddleware::handle()'), $failures, $passes);

// ── 3. Money helper ──────────────────────────────────────────────────────────
require_once $root . '/helpers/Money.php';
check('Money::round(1.239) == 1.24', Money::round(1.239) === 1.24, $failures, $passes);
check('Money::lineTotal(10.33, 3) == 30.99', Money::lineTotal(10.33, 3) === 30.99, $failures, $passes);
check('Money::sum([0.1,0.2]) == 0.3', Money::sum([0.1, 0.2]) === 0.3, $failures, $passes);
check('Money::equals(0.1+0.2, 0.3) is true', Money::equals(0.1 + 0.2, 0.3) === true, $failures, $passes);
check('Money::greaterThan(1.0, 1.0) is false', Money::greaterThan(1.0, 1.0) === false, $failures, $passes);
check('Money::greaterThan(1.01, 1.0) is true', Money::greaterThan(1.01, 1.0) === true, $failures, $passes);
check('Money::isNonNegative(-1) is false', Money::isNonNegative(-1) === false, $failures, $passes);

// ── Summary ──────────────────────────────────────────────────────────────────
$total = $passes + count($failures);
echo "\n{$passes}/{$total} checks passed.\n";
if ($failures) {
    echo count($failures) . " FAILED.\n";
    exit(1);
}
echo "All security-guard invariants hold.\n";
exit(0);
