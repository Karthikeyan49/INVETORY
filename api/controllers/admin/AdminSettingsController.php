<?php
declare(strict_types=1);

/**
 * Admin Settings Controller
 * GET /admin/settings — all settings structured by section
 * PUT /admin/settings — update any section (company / contact / notifications)
 */
class AdminSettingsController
{
    private const DOCUMENT_SETTING_KEYS = [
        'pr_prefix', 'pr_padding', 'pr_period_policy',
        'po_prefix', 'po_padding', 'po_period_policy',
        'grn_prefix', 'grn_padding', 'grn_period_policy',
        'quotation_prefix', 'quotation_padding', 'quotation_period_policy',
        'proforma_prefix', 'proforma_padding', 'proforma_period_policy',
        'payment_prefix', 'payment_padding', 'payment_period_policy',
        'adjustment_prefix', 'adjustment_padding', 'adjustment_period_policy',
        'budget_prefix', 'budget_padding', 'budget_period_policy',
        'invoice_prefix', 'invoice_padding', 'invoice_period_policy',
        'order_prefix', 'order_padding', 'order_period_policy',
    ];

    private const ALLOWED_SCALAR = [
        'company_name', 'gstin',
        'company_email', 'company_phone', 'company_address',
        'company_subtitle', 'company_primary_color', 'company_logo',
        'company_bank_name', 'company_bank_account', 'company_bank_ifsc', 'company_bank_branch',
        'contact_email', 'contact_phone', 'contact_address',
        'delivery_fee', 'gst_rate',
        'quotation_terms', 'invoice_terms',
        'notify_order', 'notify_low_stock', 'notify_new_customer',
        'invoice_prefix', 'order_prefix',
        'pr_prefix', 'pr_padding', 'pr_period_policy',
        'po_prefix', 'po_padding', 'po_period_policy',
        'grn_prefix', 'grn_padding', 'grn_period_policy',
        'quotation_prefix', 'quotation_padding', 'quotation_period_policy',
        'proforma_prefix', 'proforma_padding', 'proforma_period_policy',
        'payment_prefix', 'payment_padding', 'payment_period_policy',
        'adjustment_prefix', 'adjustment_padding', 'adjustment_period_policy',
        'budget_prefix', 'budget_padding', 'budget_period_policy',
        'invoice_padding', 'invoice_period_policy',
        'order_padding', 'order_period_policy',
        'attendance_cutoff_time',
        'attendance_checkout_cutoff_time',
        'attendance_working_days',
        'leave_credit_days',
    ];

    // ── GET /admin/settings ───────────────────────────────────────────────────

    public function show(Request $request): void
    {
        $rows = Database::fetchAll('SELECT setting_key, setting_value FROM settings');
        $map  = [];
        foreach ($rows as $r) {
            $map[$r['setting_key']] = $r['setting_value'];
        }

        $data = [
            // Company profile
            'company_name'    => $map['company_name']    ?? 'Inventory Management System',
            'gstin'           => $map['gstin']           ?? '33AUSPB5370L2ZB',
            'company_email'   => $map['company_email']   ?? '',
            'company_phone'   => $map['company_phone']   ?? '9445531605',
            'company_address' => $map['company_address'] ?? 'Tamil Nadu, India',
            'company_subtitle'      => $map['company_subtitle']      ?? 'Inventory & Stamping Management',
            'company_primary_color' => $map['company_primary_color'] ?? '#1f5a3a',
            'company_logo'          => $map['company_logo']          ?? '',
            // Bank details printed on quotations / invoices
            'company_bank_name'    => $map['company_bank_name']    ?? 'KARUR VYSYA BANK',
            'company_bank_account' => $map['company_bank_account'] ?? '1138011000000143',
            'company_bank_ifsc'    => $map['company_bank_ifsc']    ?? 'KVBL0001138',
            'company_bank_branch'  => $map['company_bank_branch']  ?? 'KARUR VYSYA BANK',

            // Contact Us shown in mobile app
            'contact_email'   => $map['contact_email']   ?? $map['company_email']   ?? '',
            'contact_phone'   => $map['contact_phone']   ?? $map['company_phone']   ?? '',
            'contact_address' => $map['contact_address'] ?? $map['company_address'] ?? '',

            // Finance
            'delivery_fee' => (float)($map['delivery_fee'] ?? 150),
            'gst_rate'     => (float)($map['gst_rate']     ?? 18),

            // Terms & Conditions printed on quotations / invoices. Empty by default;
            // the UI falls back to its built-in template when a value isn't set.
            'quotation_terms' => $map['quotation_terms'] ?? '',
            'invoice_terms'   => $map['invoice_terms']   ?? '',

            // Attendance — daily cutoffs (12-hour AM/PM strings)
            'attendance_cutoff_time'          => $map['attendance_cutoff_time']          ?? '10:30 AM',
            'attendance_checkout_cutoff_time' => $map['attendance_checkout_cutoff_time'] ?? '05:00 PM',
            // Working days — CSV of weekday numbers (0=Sun … 6=Sat); auto-absent skips other days
            'attendance_working_days'         => $map['attendance_working_days']         ?? Attendance::DEFAULT_WORKING_DAYS,
            // Payroll — present days that earn 1 leave credit (used by payroll leave-credit calc)
            'leave_credit_days'               => (float)($map['leave_credit_days']        ?? 20),

            // Notifications
            'notifications' => [
                'order_alerts'      => (bool)(int)($map['notify_order']        ?? 1),
                'low_stock'         => (bool)(int)($map['notify_low_stock']    ?? 1),
                'dealer_commission' => (bool)(int)($map['notify_new_customer'] ?? 0),
            ],

            // Phase 2 document numbering
            'document_numbering' => NumberSequence::settingsSummary($map),
        ];

        Response::success($data);
    }

    // ── PUT /admin/settings ───────────────────────────────────────────────────

    public function update(Request $request): void
    {
        $body = $request->only([
            'company_name', 'gstin',
            'company_email', 'company_phone', 'company_address',
            'company_subtitle', 'company_primary_color', 'company_logo',
            'company_bank_name', 'company_bank_account', 'company_bank_ifsc', 'company_bank_branch',
            'contact_email', 'contact_phone', 'contact_address',
            'delivery_fee', 'gst_rate',
            'quotation_terms', 'invoice_terms',
            'notifications',
            'document_numbering',
            'attendance_cutoff_time',
            'attendance_checkout_cutoff_time',
            'attendance_working_days',
            'leave_credit_days',
            'pr_prefix', 'pr_padding', 'pr_period_policy',
            'po_prefix', 'po_padding', 'po_period_policy',
            'grn_prefix', 'grn_padding', 'grn_period_policy',
            'quotation_prefix', 'quotation_padding', 'quotation_period_policy',
            'proforma_prefix', 'proforma_padding', 'proforma_period_policy',
            'payment_prefix', 'payment_padding', 'payment_period_policy',
            'adjustment_prefix', 'adjustment_padding', 'adjustment_period_policy',
            'budget_prefix', 'budget_padding', 'budget_period_policy',
            'invoice_prefix', 'invoice_padding', 'invoice_period_policy',
            'order_prefix', 'order_padding', 'order_period_policy',
        ]);

        if (empty($body)) {
            Response::error('Provide at least one setting to update', 400);
        }

        foreach ($body as $key => $value) {
            // Handle notifications object
            if ($key === 'notifications' && is_array($value)) {
                $map = [
                    'order_alerts'      => 'notify_order',
                    'low_stock'         => 'notify_low_stock',
                    'dealer_commission' => 'notify_new_customer',
                ];
                foreach ($map as $uiKey => $dbKey) {
                    if (isset($value[$uiKey])) {
                        $this->upsert($dbKey, $value[$uiKey] ? '1' : '0');
                    }
                }
                continue;
            }

            if ($key === 'document_numbering' && is_array($value)) {
                $this->updateDocumentNumbering($value);
                continue;
            }

            // Scalar keys — allowed list guard
            if (!in_array($key, self::ALLOWED_SCALAR, true)) continue;

            if (in_array($key, self::DOCUMENT_SETTING_KEYS, true)) {
                $this->upsert($key, $this->normalizeDocumentSetting($key, $value));
                continue;
            }

            // Cutoff times must be valid 12-hour AM/PM strings (e.g. "10:30 AM", "05:00 PM")
            if (in_array($key, ['attendance_cutoff_time', 'attendance_checkout_cutoff_time'], true)) {
                $val = trim((string)$value);
                if (!Attendance::isValidCutoff($val)) {
                    Response::error("$key must be in 12-hour AM/PM format (e.g. \"10:30 AM\")", 422);
                }
                // Normalize: uppercase AM/PM, single space
                $val = preg_replace('/\s+/', ' ', strtoupper($val));
                $this->upsert($key, $val);
                continue;
            }

            // Working days — CSV of weekday numbers (0=Sun … 6=Sat), e.g. "1,2,3,4,5,6"
            if ($key === 'attendance_working_days') {
                // Accept an array of numbers from the UI or a CSV string.
                if (is_array($value)) {
                    $value = implode(',', array_map(static fn($d) => (int)$d, $value));
                }
                $val = trim((string)$value);
                if (!Attendance::isValidWorkingDays($val)) {
                    Response::error("$key must be a comma-separated list of weekday numbers 0–6 (e.g. \"1,2,3,4,5,6\")", 422);
                }
                $this->upsert($key, $val);
                continue;
            }

            // Company GSTIN — validate format + checksum (empty clears it)
            if ($key === 'gstin') {
                $g = strtoupper(trim((string)$value));
                if ($g !== '' && !Validator::isValidGstin($g)) {
                    Response::error('gstin must be a valid GSTIN (15-char format + checksum)', 422);
                }
                $this->upsert($key, $g);
                continue;
            }

            // Leave credit days — a positive number (present days per 1 leave credit)
            if ($key === 'leave_credit_days') {
                $n = (float)$value;
                if ($n <= 0 || $n > 31) {
                    Response::error('leave_credit_days must be a number between 1 and 31', 422);
                }
                // Store trimmed of any trailing .0 so it reads cleanly
                $this->upsert($key, rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.'));
                continue;
            }

            $this->upsert($key, (string)$value);
        }

        $this->show($request);
    }

    private function upsert(string $key, string $value): void
    {
        Database::execute(
            'INSERT INTO settings (setting_key, setting_value)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            [$key, $value]
        );
    }

    private function updateDocumentNumbering(array $payload): void
    {
        $known = NumberSequence::settingsSummary();

        foreach ($payload as $docType => $config) {
            if (!is_array($config)) {
                continue;
            }

            if (is_int($docType)) {
                $docType = (string)($config['doc_type'] ?? $config['docType'] ?? '');
            }

            $docType = strtoupper(trim((string)$docType));
            if (!isset($known[$docType])) {
                continue;
            }

            $keys = $known[$docType];
            if (array_key_exists('prefix', $config)) {
                $this->upsert($keys['prefix_key'], $this->normalizeDocumentSetting($keys['prefix_key'], $config['prefix']));
            }
            if (array_key_exists('padding', $config)) {
                $this->upsert($keys['padding_key'], $this->normalizeDocumentSetting($keys['padding_key'], $config['padding']));
            }
            if (array_key_exists('period_policy', $config) || array_key_exists('periodPolicy', $config)) {
                $policy = $config['period_policy'] ?? $config['periodPolicy'];
                $this->upsert($keys['period_key'], $this->normalizeDocumentSetting($keys['period_key'], $policy));
            }
        }
    }

    private function normalizeDocumentSetting(string $key, mixed $value): string
    {
        if (str_ends_with($key, '_padding')) {
            $padding = (int)$value;
            if ($padding < 2 || $padding > 8) {
                Response::error("$key must be between 2 and 8", 422);
            }
            return (string)$padding;
        }

        if (str_ends_with($key, '_period_policy')) {
            $policy = strtolower(trim((string)$value));
            if (!in_array($policy, NumberSequence::validPeriodPolicies(), true)) {
                Response::error("$key must be one of: " . implode(', ', NumberSequence::validPeriodPolicies()), 422);
            }
            return $policy;
        }

        $prefix = preg_replace('/[^A-Z0-9]/', '', strtoupper(trim((string)$value))) ?: '';
        if ($prefix === '') {
            Response::error("$key must contain at least one letter or number", 422);
        }

        return substr($prefix, 0, 12);
    }
}
