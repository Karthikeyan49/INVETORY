<?php
declare(strict_types=1);

/**
 * Admin Payroll Controller
 * GET  /admin/payroll                         — fetch payroll for a month (?month=YYYY-MM)
 * GET  /admin/payroll/report                  — month totals (employee count, sum net_pay, etc.)
 * GET  /admin/payroll/{id}                    — single payroll slip by payroll_id
 * GET  /admin/payroll/{employee_id}/history   — full payroll history for an employee
 * POST /admin/payroll/calculate               — preview calc WITHOUT persisting
 * POST /admin/payroll/run                     — compute + persist (existing, re-run safe)
 * POST /admin/payroll/process                 — mark month as Processed / Paid
 */
class AdminPayrollController
{
    // ─── GET /admin/payroll ───────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $month = $request->query('month') ?? date('Y-m');
        $rows  = Payroll::forMonth($month);
        Response::success(array_map([Payroll::class, 'format'], $rows));
    }

    // ─── POST /admin/payroll/run ──────────────────────────────────────────────

    public function run(Request $request): void
    {
        $month = trim((string)$request->input('month', ''));
        if (!$month || !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $workingDays = $this->resolveWorkingDays($request, $month);
        $manualOvertimeHours = $this->resolveOvertimeHours($request);
        $leaveCreditDays = $this->resolveLeaveCreditDays();
        $advanceTotals = EmployeeAdvance::totalsForMonth($month);

        // Incentive-type employees are paid via the Incentives module — NEVER a
        // monthly salary slip. Optionally restrict to a single employee (one-click
        // generate for one person) via employee_key / employee_id.
        $employees = $this->payrollEmployees($request);

        foreach ($employees as $emp) {
            $entries = Database::fetchAll(
                "SELECT * FROM attendance
                  WHERE employee_key = ?
                    AND DATE_FORMAT(date, '%Y-%m') = ?",
                [$emp['employee_key'], $month]
            );
            $slip = $this->buildSlip(
                $emp,
                $entries,
                $month,
                $workingDays,
                $manualOvertimeHours,
                $advanceTotals,
                $leaveCreditDays
            );

            Payroll::upsert([
                'employeeKey'     => $emp['employee_key'],
                'month'           => $month,
                'workingDays'     => $slip['workingDays'],
                'presentDays'     => $slip['presentDays'],
                'salaryPerDay'    => $slip['salaryPerDay'],
                'leaves'          => $slip['leaves'],
                'leaveAvailedThisMonth' => $slip['leaveAvailedThisMonth'],
                'leaveCredit'     => $slip['leaveCredit'],
                'leaveSalary'     => $slip['leaveSalary'],
                'travelAllow'     => $slip['travelAllow'],
                'baseSalary'      => $slip['baseSalary'],
                'siteAllowance'   => $slip['siteAllowance'],
                'da'              => $slip['da'],
                'foodAllowance'   => $slip['foodAllowance'],
                'totalSalay'      => $slip['totalSalay'],
                'earnedSalary'    => $slip['earnedSalary'],
                'attendBonus'     => $slip['attendBonus'],
                'salaryAdvancePaid' => $slip['salaryAdvancePaid'],
                'deductedAdvance' => $slip['deductedAdvance'],
                'overtimeRate'    => $slip['overtimeRate'],
                'overtimeHours'   => $slip['overtimeHours'],
                'overtimeSalary'  => $slip['overtimeSalary'],
                'totalSalary'     => $slip['totalSalary'],
                'hra'             => $slip['hra'],
                'allowances'      => $slip['allowances'],
                'pf'              => $slip['pf'],
                'professionalTax' => $slip['professionalTax'],
                'deductions'      => $slip['deductions'],
                'netPay'          => $slip['netPay'],
            ]);
        }

        $result = Payroll::forMonth($month);
        Response::success(array_map([Payroll::class, 'format'], $result), 'Payroll computed');
    }

    // ─── GET /admin/payroll/{id} ─────────────────────────────────────────────

    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $row = Database::fetch(
            'SELECT p.*, e.name AS employee_name, e.designation, e.joined_at
               FROM payroll p
               JOIN employees e ON p.employee_key = e.employee_key
              WHERE p.payroll_id = ? LIMIT 1',
            [$id]
        );
        if (!$row) Response::error('Payroll slip not found', 404);
        Response::success(Payroll::format($row));
    }

    // ─── GET /admin/payroll/{employee_id}/history ────────────────────────────

    public function history(Request $request): void
    {
        $empId = $request->param('id');
        $emp   = Employee::findByKey($empId);
        if (!$emp) Response::error('Employee not found', 404);

        $rows = Database::fetchAll(
            'SELECT p.*, e.name AS employee_name, e.designation, e.joined_at
               FROM payroll p
               JOIN employees e ON p.employee_key = e.employee_key
              WHERE p.employee_key = ?
              ORDER BY p.month DESC',
            [$empId]
        );

        Response::success(array_map([Payroll::class, 'format'], $rows));
    }

    // ─── POST /admin/payroll/calculate ───────────────────────────────────────

    public function calculate(Request $request): void
    {
        $month = trim((string)$request->input('month', ''));
        if (!$month || !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $workingDays = $this->resolveWorkingDays($request, $month);
        $manualOvertimeHours = $this->resolveOvertimeHours($request);
        $leaveCreditDays = $this->resolveLeaveCreditDays();
        $advanceTotals = EmployeeAdvance::totalsForMonth($month);

        $employees = $this->payrollEmployees($request);
        $slips     = [];

        foreach ($employees as $emp) {
            $entries = Database::fetchAll(
                "SELECT * FROM attendance
                  WHERE employee_key = ?
                    AND DATE_FORMAT(date, '%Y-%m') = ?",
                [$emp['employee_key'], $month]
            );
            $slips[] = $this->buildSlip(
                $emp,
                $entries,
                $month,
                $workingDays,
                $manualOvertimeHours,
                $advanceTotals,
                $leaveCreditDays
            );
        }

        Response::success($slips, 'Preview (not saved)');
    }

    // ─── POST /admin/payroll/process ─────────────────────────────────────────

    public function process(Request $request): void
    {
        $month  = trim((string)$request->input('month', ''));
        $status = trim((string)$request->input('status', 'Processed'));

        if (!$month || !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }
        if (!in_array($status, ['Processed', 'Paid'], true)) {
            Response::error('Status must be Processed or Paid', 422);
        }

        $timestampCol = $status === 'Paid' ? 'paid_at' : 'processed_at';

        $affected = Database::execute(
            "UPDATE payroll SET status = ?, $timestampCol = NOW() WHERE month = ?",
            [$status, $month]
        );

        // Finance link (B11): when payroll is marked Paid, post the month's total
        // net pay to the expense ledger → P&L as "Salary & Wages". Idempotent —
        // syncs the existing salary expense for the month instead of duplicating.
        if ($status === 'Paid') {
            $this->syncPayrollExpense($month, (int)($request->user['user_id'] ?? 0) ?: null);
        }

        $result = Payroll::forMonth($month);
        Response::success([
            'month'    => $month,
            'status'   => $status,
            'affected' => (int)$affected,
            'slips'    => array_map([Payroll::class, 'format'], $result),
        ], "Payroll marked $status");
    }

    // ─── GET /admin/payroll/report ───────────────────────────────────────────

    public function report(Request $request): void
    {
        $month = $request->query('month') ?? date('Y-m');
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $summary = Database::fetch(
            "SELECT COUNT(*) AS employees,
                    SUM(earned_salary)    AS total_earned,
                    SUM(overtime_salary)  AS total_overtime,
                    SUM(hra)              AS total_hra,
                    SUM(allowances)       AS total_allowances,
                    SUM(pf)               AS total_pf,
                    SUM(deductions)       AS total_deductions,
                    SUM(net_pay)          AS total_net_pay
             FROM payroll WHERE month = ?",
            [$month]
        );

        $statusBreakdown = Database::fetchAll(
            "SELECT status, COUNT(*) AS count
             FROM payroll WHERE month = ?
             GROUP BY status",
            [$month]
        );

        Response::success([
            'month'   => $month,
            'summary' => [
                'employees'        => (int)($summary['employees']         ?? 0),
                'totalEarned'      => (float)($summary['total_earned']      ?? 0),
                'totalOvertime'    => (float)($summary['total_overtime']    ?? 0),
                'totalHra'         => (float)($summary['total_hra']         ?? 0),
                'totalAllowances'  => (float)($summary['total_allowances']  ?? 0),
                'totalPf'          => (float)($summary['total_pf']          ?? 0),
                'totalDeductions'  => (float)($summary['total_deductions']  ?? 0),
                'totalNetPay'      => (float)($summary['total_net_pay']     ?? 0),
            ],
            'byStatus' => array_map(fn($r) => [
                'status' => $r['status'],
                'count'  => (int)$r['count'],
            ], $statusBreakdown),
        ]);
    }

    // ─── private ─────────────────────────────────────────────────────────────

    private function buildSlip(
        array $emp,
        array $entries,
        string $month,
        int $workingDays,
        array $manualOvertimeHours = [],
        array $advanceTotals = [],
        float $leaveCreditDays = 20.0
    ): array {
        $dayFractions = [];
        $dayLeaves = [];

        foreach ($entries as $entry) {
            $date = (string)($entry['date'] ?? '');
            if (($entry['status'] ?? '') === 'Present') {
                $dayFractions[$date] = ($dayFractions[$date] ?? 0) + 1;
            } elseif (($entry['status'] ?? '') === 'Half-day') {
                $dayFractions[$date] = ($dayFractions[$date] ?? 0) + 0.5;
            } elseif (($entry['status'] ?? '') === 'Leave') {
                $dayLeaves[$date] = true;
            }
        }

        $present = 0.0;
        foreach ($dayFractions as $date => $fraction) {
            if ($date !== '') $present += min(1.0, (float)$fraction);
        }
        $leaves = 0;
        foreach ($dayLeaves as $date => $_) {
            if (!isset($dayFractions[$date]) || $dayFractions[$date] <= 0) $leaves++;
        }

        $baseSalary = round(max(0, (float)($emp['base_salary'] ?? 0)), 2);
        $siteAllowance = round(max(0, (float)($emp['site_allowance'] ?? 0)), 2);
        $da = round(max(0, (float)($emp['da'] ?? 0)), 2);
        $foodAllowance = round(max(0, (float)($emp['food_allowance'] ?? 0)), 2);
        $travelAllow = round(max(0, (float)($emp['travel_allowance'] ?? 0)), 2);
        $monthlySalary = round($baseSalary + $siteAllowance + $da + $foodAllowance + $travelAllow, 2);
        $totalSalay = $monthlySalary;
        $salaryPerDay = $workingDays > 0 ? round($monthlySalary / $workingDays, 2) : 0.0;
        $overtimeHrs = round(max(0, (float)($manualOvertimeHours[$emp['employee_key']] ?? 0)), 2);
        $overtimeRate = $workingDays > 0
            ? round((($baseSalary + $da) / $workingDays / 8) * 1.5, 2)
            : 0.0;

        $presentDays = round($present, 1);
        $leaveAvailed = (int)$leaves;
        // Leave credits: 1 credit is earned per `leaveCreditDays` present days
        // (configurable in Settings → "Leave credit days"). Available credit is
        // what's left after this month's availed leave. Purely additive reporting —
        // does not change earned/net pay here.
        $earnedLeaveCredit = $leaveCreditDays > 0 ? (int)floor($presentDays / $leaveCreditDays) : 0;
        $leaveCredit = max(0, $earnedLeaveCredit - $leaveAvailed);
        $earnedSalary = round($salaryPerDay * $presentDays, 2);
        $overtimeSalary = round($overtimeRate * $overtimeHrs, 2);
        $attendanceBonusAmount = round(max(0, (float)($emp['attendance_bonus_amount'] ?? 0)), 2);
        $attendBonus = $presentDays >= $workingDays ? $attendanceBonusAmount : 0.0;
        $leaveSalary = round($salaryPerDay * $leaveAvailed, 2);

        $hra = 0.0;
        $allowances = 0.0;
        $totalSalary = round($earnedSalary + $attendBonus + $overtimeSalary, 2);

        $pfEnabled = (int)($emp['pf_enabled'] ?? 1) === 1;
        $pfPercent = max(0, (float)($emp['pf_percent'] ?? 12));
        $pf = $pfEnabled ? round($earnedSalary * ($pfPercent / 100), 2) : 0.0;
        $esiEnabled = (int)($emp['esi_enabled'] ?? 0) === 1;
        $esiPercent = max(0, (float)($emp['esi_employee_percent'] ?? 0));
        $esi = $esiEnabled ? round($earnedSalary * ($esiPercent / 100), 2) : 0.0;
        $professionalTax = 0.0;
        $salaryAdvancePaid = round(max(0, (float)($advanceTotals[$emp['employee_key']] ?? 0)), 2);
        $deductedAdvance = $salaryAdvancePaid;
        $deductions = round($pf + $esi + $deductedAdvance, 2);
        $netPay = round(max(0, $totalSalary - $deductions), 2);

        return [
            'employeeId'      => $emp['employee_key'],
            'employeeName'    => $emp['name'],
            'designation'     => (string)($emp['designation'] ?? ''),
            'doj'             => (string)($emp['joined_at'] ?? ''),
            'month'           => $month,
            'workingDays'     => $workingDays,
            'presentDays'     => $presentDays,
            'leaves'          => $leaveAvailed,
            'leaveCredit'     => $leaveCredit,
            'earnedLeaveCredit' => $earnedLeaveCredit,
            'baseSalary'      => $baseSalary,
            'siteAllowance'   => $siteAllowance,
            'da'              => $da,
            'foodAllowance'   => $foodAllowance,
            'totalSalay'      => $totalSalay,
            'salaryPerDay'    => $salaryPerDay,
            'overtimeRate'    => $overtimeRate,
            'overtimeHours'   => $overtimeHrs,
            'overtimeHrs'     => $overtimeHrs,
            'earnedSalary'    => $earnedSalary,
            'overtimeSalary'  => $overtimeSalary,
            'attendBonus'     => $attendBonus,
            'leaveAvailedThisMonth' => $leaveAvailed,
            'leaveSalary'     => $leaveSalary,
            'travelAllow'     => $travelAllow,
            'salaryAdvancePaid' => $salaryAdvancePaid,
            'deductedAdvance' => $deductedAdvance,
            'totalSalary'     => $totalSalary,
            // Keep legacy fields populated for existing reports/integrations.
            'hra'             => $hra,
            'allowances'      => $allowances,
            'pf'              => $pf,
            'professionalTax' => $professionalTax,
            'deductions'      => $deductions,
            'netPay'          => $netPay,
        ];
    }

    /**
     * Working days for the month: prefers the value sent from the admin UI
     * (clamped to 1–31), falls back to calendar count excluding Sundays.
     */
    private function resolveWorkingDays(Request $request, string $month): int
    {
        $override = $request->input('workingDays');
        if ($override !== null && $override !== '') {
            $n = (int)$override;
            if ($n >= 1 && $n <= 31) return $n;
        }

        [$y, $m] = array_map('intval', explode('-', $month));
        $lastDay = (int)date('t', mktime(0, 0, 0, $m, 1, $y));
        $count   = 0;
        for ($d = 1; $d <= $lastDay; $d++) {
            if (date('w', mktime(0, 0, 0, $m, $d, $y)) !== '0') $count++;
        }
        return $count;
    }

    /**
     * Post/sync the month's total payroll net pay to the expense ledger so HR
     * payroll flows into Finance / P&L (B11). A single "Salary & Wages" expense
     * per month, keyed by a stable description marker so re-marking Paid updates
     * (not duplicates) the entry. Best-effort — never blocks the status change.
     */
    private function syncPayrollExpense(string $month, ?int $userId): void
    {
        try {
            $sumRow = Database::fetch("SELECT COALESCE(SUM(net_pay), 0) AS total FROM payroll WHERE month = ?", [$month]);
            $total = round((float)($sumRow['total'] ?? 0), 2);
            $marker = "Payroll salaries for $month";
            $existing = Database::fetch(
                "SELECT expense_id FROM expenses WHERE category = 'Salary & Wages' AND description = ? LIMIT 1",
                [$marker]
            );
            if ($total <= 0) {
                return; // nothing to post
            }
            $payDate = $month . '-01';
            if ($existing) {
                Database::execute(
                    "UPDATE expenses SET amount = ?, expense_date = ? WHERE expense_id = ?",
                    [$total, $payDate, (int)$existing['expense_id']]
                );
                return;
            }
            $count = Database::count('SELECT COUNT(*) AS cnt FROM expenses');
            $code = 'EXP-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
            Database::insert(
                'INSERT INTO expenses
                    (expense_code, expense_date, category, vendor, description, amount, payment_mode, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [$code, $payDate, 'Salary & Wages', 'Payroll', $marker, $total, 'Bank Transfer', $userId]
            );
        } catch (\Throwable $e) {
            // Expense posting is best-effort; payroll status change already succeeded.
        }
    }

    /**
     * Active employees eligible for a monthly payroll slip: excludes incentive-type
     * staff (paid via the Incentives module). If `employee_key`/`employee_id` is
     * provided, restricts to that single employee (still excluding incentive type).
     */
    private function payrollEmployees(Request $request): array
    {
        $key = trim((string)($request->input('employee_key') ?? $request->input('employee_id') ?? ''));
        if ($key !== '') {
            return Database::fetchAll(
                'SELECT * FROM employees WHERE is_active = 1 AND COALESCE(is_incentive, 0) = 0 AND employee_key = ?',
                [$key]
            );
        }
        return Database::fetchAll(
            'SELECT * FROM employees WHERE is_active = 1 AND COALESCE(is_incentive, 0) = 0',
            []
        );
    }

    /** Days of presence that earn 1 leave credit (Settings → "Leave credit days"). Default 20. */
    private function resolveLeaveCreditDays(): float
    {
        $row = Database::fetch("SELECT setting_value FROM settings WHERE setting_key = 'leave_credit_days' LIMIT 1");
        $val = isset($row['setting_value']) ? (float)$row['setting_value'] : 0.0;
        return $val > 0 ? $val : 20.0;
    }

    private function resolveOvertimeHours(Request $request): array
    {
        $raw = $request->input('overtimeHours', []);
        if (!is_array($raw)) return [];

        $hours = [];
        foreach ($raw as $employeeKey => $value) {
            $key = trim((string)$employeeKey);
            if ($key === '') continue;
            $hours[$key] = round(max(0, (float)$value), 2);
        }
        return $hours;
    }
}
