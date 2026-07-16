<?php
declare(strict_types=1);

class Validator
{
    private array $errors = [];

    /**
     * Rules: required|string|email|phone|numeric|integer|min:N|max:N|in:a,b,c|array|url|regex:PATTERN
     */
    public static function make(array $data, array $rules): self
    {
        $instance = new self();
        foreach ($rules as $field => $ruleString) {
            $value    = $data[$field] ?? null;
            $ruleList = explode('|', $ruleString);
            $required = in_array('required', $ruleList, true);

            if (!$required && ($value === null || $value === '')) {
                continue;
            }

            foreach ($ruleList as $rule) {
                $instance->applyRule($field, $value, $rule);
            }
        }
        return $instance;
    }

    private function applyRule(string $field, mixed $value, string $rule): void
    {
        $param = null;
        if (str_contains($rule, ':')) {
            [$rule, $param] = explode(':', $rule, 2);
        }

        switch ($rule) {
            case 'required':
                if ($value === null || $value === '') {
                    $this->errors[$field][] = "$field is required";
                }
                break;

            case 'string':
                if (!is_string($value)) {
                    $this->errors[$field][] = "$field must be a string";
                }
                break;

            case 'email':
                if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
                    $this->errors[$field][] = "$field must be a valid email address";
                }
                break;

            case 'phone':
                // Indian phone: 10 digits, optionally prefixed with +91 or 0
                $clean = preg_replace('/[\s\-\(\)]+/', '', (string)$value);
                if (!preg_match('/^(\+91|0)?[6-9]\d{9}$/', $clean)) {
                    $this->errors[$field][] = "$field must be a valid 10-digit Indian phone number";
                }
                break;

            case 'numeric':
                if (!is_numeric($value)) {
                    $this->errors[$field][] = "$field must be a number";
                }
                break;

            case 'integer':
                if (!filter_var($value, FILTER_VALIDATE_INT)) {
                    $this->errors[$field][] = "$field must be an integer";
                }
                break;

            case 'min':
                $len = is_string($value) ? mb_strlen($value) : (float)$value;
                if ($len < (float)$param) {
                    $this->errors[$field][] = is_string($value)
                        ? "$field must be at least $param characters"
                        : "$field must be at least $param";
                }
                break;

            case 'max':
                $len = is_string($value) ? mb_strlen($value) : (float)$value;
                if ($len > (float)$param) {
                    $this->errors[$field][] = is_string($value)
                        ? "$field must not exceed $param characters"
                        : "$field must not exceed $param";
                }
                break;

            case 'in':
                $allowed = explode(',', $param ?? '');
                if (!in_array((string)$value, $allowed, true)) {
                    $this->errors[$field][] = "$field must be one of: " . implode(', ', $allowed);
                }
                break;

            case 'array':
                if (!is_array($value)) {
                    $this->errors[$field][] = "$field must be an array";
                }
                break;

            case 'regex':
                if (!preg_match($param, (string)$value)) {
                    $this->errors[$field][] = "$field format is invalid";
                }
                break;

            case 'gst':
                // Indian GSTIN: 15-char format + official modulo-36 check digit.
                if (!self::isValidGstin((string)$value)) {
                    $this->errors[$field][] = "$field must be a valid GSTIN (e.g. 29ABCDE1234F1Z5)";
                }
                break;
        }
    }

    /**
     * Validate an Indian GSTIN: 15-char format AND the official GSTN modulo-36
     * check digit (the 15th char, computed over the first 14). Shared so every
     * GSTIN entry point (vendors, settings, invoices, quotations) is consistent.
     */
    public static function isValidGstin(string $gstin): bool
    {
        $g = strtoupper(trim($gstin));
        if (!preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $g)) {
            return false;
        }
        $code = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $mod = 36;
        $factor = 2;
        $sum = 0;
        for ($i = 13; $i >= 0; $i--) {
            $cp = strpos($code, $g[$i]);
            if ($cp === false) return false;
            $digit = $factor * $cp;
            $factor = $factor === 2 ? 1 : 2;
            $digit = intdiv($digit, $mod) + ($digit % $mod);
            $sum += $digit;
        }
        $check = $code[($mod - ($sum % $mod)) % $mod];
        return $check === $g[14];
    }

    public function fails(): bool  { return !empty($this->errors); }
    public function errors(): array { return $this->errors; }

    public function validate(): void
    {
        if ($this->fails()) {
            Response::validationError($this->errors);
        }
    }
}
