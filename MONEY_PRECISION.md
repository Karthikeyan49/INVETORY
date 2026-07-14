# Money Precision — Assessment & Plan

The security review flagged PHP `float` used for currency (~248 cast sites). This
documents the actual risk and the remediation approach.

## Assessment (why the practical risk is low)

- **Storage is exact.** Every money column in the schema is `DECIMAL(x,2)`
  (no `FLOAT`/`DOUBLE`). MySQL rounds to 2 dp on write, so float drift never
  persists — it can only exist transiently inside a single PHP calculation.
- **Comparisons are tolerant.** Balance / overpayment checks already compare with
  an epsilon (`> 0.005`), and payment-status uses `<= EPSILON`. There are **no**
  exact `==` equality comparisons on money, so drift can't flip a guard.
- **Transactions are small.** Line-item counts are low, so accumulated drift stays
  well under half a paisa and is rounded away on store.

Net: this is a code-hygiene / defense-in-depth issue here, not an active
financial-integrity bug.

## What was done now

- Added `api/helpers/Money.php` — the sanctioned helper: `round()`, `sum()`,
  `lineTotal()`, `equals()`, `greaterThan()`, `isNonNegative()`, and an `EPSILON`
  constant. New financial math should go through it.
- Applied explicit 2-dp rounding at order total computation
  (`Order::create` line totals + grand total).

## Recommended follow-up (separate, test-backed effort)

A full migration off raw float should **not** be rushed across 248 sites in a
security branch — a mistake there would create the very financial bugs we're
avoiding. Do it as its own change, in this order:

1. Land a financial regression test suite first (order totals, tax, invoice
   totals, payment/balance math, installments) capturing current outputs.
2. Route all money arithmetic through `Money::` (round every computed amount,
   compare with `Money::equals`/`greaterThan`).
3. Optionally move internal math to integer paise or `bcmath` for exactness,
   converting only at the DECIMAL storage boundary.
4. Verify the regression suite is unchanged at each step.
