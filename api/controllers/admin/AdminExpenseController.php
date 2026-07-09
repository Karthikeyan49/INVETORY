<?php
declare(strict_types=1);

/**
 * Admin Expense Controller
 *
 * Endpoints
 * ─────────
 *   GET    /admin/expenses                 — list (filterable + paginated)
 *   GET    /admin/expenses/{id}            — fetch a single expense
 *   POST   /admin/expenses                 — create
 *   PUT    /admin/expenses/{id}            — update
 *   DELETE /admin/expenses/{id}            — delete (hard)
 *   GET    /admin/expenses/categories      — distinct category list for dropdowns
 */
class AdminExpenseController
{
    private const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'];

    // ─── GET /admin/expenses ─────────────────────────────────────────────────
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 50)));

        [$whereClause, $params] = self::filters($request);
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM expenses WHERE $whereClause", $params);
        $offset = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT expense_id, expense_code, expense_date, category, vendor, description,
                    amount, payment_mode, bill_url, created_by, created_at, updated_at
             FROM expenses
             WHERE $whereClause
             ORDER BY expense_date DESC, expense_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['amount'] = (float)$r['amount'];
        }

        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / max($limit, 1)),
        ]);
    }

    // ─── GET /admin/expenses/summary ────────────────────────────────────────
    public function summary(Request $request): void
    {
        [$whereClause, $params] = self::filters($request);

        $summary = Database::fetch(
            "SELECT COUNT(*) AS count,
                    COALESCE(SUM(amount), 0) AS total,
                    COALESCE(AVG(amount), 0) AS average
             FROM expenses
             WHERE $whereClause",
            $params
        ) ?: [];

        $categoryCount = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM (SELECT category FROM expenses WHERE $whereClause GROUP BY category) x",
            $params
        );

        $topCategory = Database::fetch(
            "SELECT category AS name, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS value
             FROM expenses
             WHERE $whereClause
             GROUP BY category
             ORDER BY value DESC
             LIMIT 1",
            $params
        );

        Response::success([
            'count' => (int)($summary['count'] ?? 0),
            'total' => (float)($summary['total'] ?? 0),
            'average' => (float)($summary['average'] ?? 0),
            'category_count' => $categoryCount,
            'top_category' => $topCategory ? [
                'name' => (string)$topCategory['name'],
                'count' => (int)$topCategory['count'],
                'value' => (float)$topCategory['value'],
            ] : null,
        ]);
    }

    // ─── GET /admin/expenses/{id} ────────────────────────────────────────────
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }

        $row = Database::fetch('SELECT * FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$row) {
            Response::error('Expense not found', 404);
        }
        $row['amount'] = (float)$row['amount'];
        Response::success($row);
    }

    // ─── GET /admin/expenses/categories ──────────────────────────────────────
    public function categories(Request $request): void
    {
        $rows = Database::fetchAll('SELECT DISTINCT category FROM expenses ORDER BY category ASC');
        Response::success(array_column($rows, 'category'));
    }

    // ─── POST /admin/expenses ────────────────────────────────────────────────
    public function store(Request $request): void
    {
        Validator::make(
            $request->only(['expense_date', 'category', 'vendor', 'amount', 'payment_mode']),
            [
                'expense_date' => 'required|string|max:10',
                'category'     => 'required|string|min:2|max:80',
                'vendor'       => 'required|string|min:2|max:150',
                'amount'       => 'required|numeric',
                'payment_mode' => 'required|string|max:20',
            ]
        )->validate();

        self::validateDate($request->input('expense_date'));
        self::validateAmount($request->input('amount'));
        self::validatePaymentMode((string)$request->input('payment_mode'));

        $count      = Database::count('SELECT COUNT(*) AS cnt FROM expenses');
        $code       = 'EXP-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
        $createdBy  = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        $expenseId = Database::insert(
            'INSERT INTO expenses
                (expense_code, expense_date, category, vendor, description, amount, payment_mode, bill_url, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $code,
                $request->input('expense_date'),
                Request::sanitize((string)$request->input('category')),
                Request::sanitize((string)$request->input('vendor')),
                $request->input('description') ? Request::sanitize((string)$request->input('description')) : null,
                (float)$request->input('amount'),
                (string)$request->input('payment_mode'),
                $request->input('bill_url') ?: null,
                $createdBy,
            ]
        );

        $row = Database::fetch('SELECT * FROM expenses WHERE expense_id = ? LIMIT 1', [$expenseId]);
        $row['amount'] = (float)$row['amount'];
        Response::success($row, 'Expense created successfully', 201);
    }

    // ─── PUT /admin/expenses/{id} ────────────────────────────────────────────
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }

        $existing = Database::fetch('SELECT expense_id FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$existing) {
            Response::error('Expense not found', 404);
        }

        $input = $request->only(['expense_date', 'category', 'vendor', 'description', 'amount', 'payment_mode', 'bill_url']);
        if (empty($input)) {
            Response::error('Provide at least one field to update', 400);
        }

        if (isset($input['expense_date'])) self::validateDate($input['expense_date']);
        if (isset($input['amount']))       self::validateAmount($input['amount']);
        if (isset($input['payment_mode'])) self::validatePaymentMode((string)$input['payment_mode']);
        if (isset($input['category']) && strlen(trim((string)$input['category'])) < 2) {
            Response::error('Category must be at least 2 characters', 422);
        }
        if (isset($input['vendor']) && strlen(trim((string)$input['vendor'])) < 2) {
            Response::error('Vendor must be at least 2 characters', 422);
        }

        $sets   = [];
        $params = [];
        foreach ($input as $col => $val) {
            $sets[]   = "$col = ?";
            $params[] = in_array($col, ['category', 'vendor', 'description'], true) && $val !== null
                ? Request::sanitize((string)$val)
                : $val;
        }
        $sets[] = 'updated_at = NOW()';
        $params[] = $id;

        Database::execute(
            'UPDATE expenses SET ' . implode(', ', $sets) . ' WHERE expense_id = ?',
            $params
        );

        $row = Database::fetch('SELECT * FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        $row['amount'] = (float)$row['amount'];
        Response::success($row, 'Expense updated successfully');
    }

    // ─── DELETE /admin/expenses/{id} ─────────────────────────────────────────
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }

        $existing = Database::fetch('SELECT expense_id FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$existing) {
            Response::error('Expense not found', 404);
        }

        Database::execute('DELETE FROM expenses WHERE expense_id = ?', [$id]);
        Response::success(null, 'Expense deleted successfully');
    }

    // ─── Validation helpers ─────────────────────────────────────────────────
    private static function filters(Request $request): array
    {
        $where  = ['1=1'];
        $params = [];

        if ($cat = $request->query('category')) {
            $where[]  = 'category = ?';
            $params[] = $cat;
        }
        if ($vendor = $request->query('vendor')) {
            $where[]  = 'vendor LIKE ?';
            $params[] = '%' . trim((string)$vendor) . '%';
        }
        if ($mode = $request->query('payment_mode')) {
            self::validatePaymentMode((string)$mode);
            $where[]  = 'payment_mode = ?';
            $params[] = $mode;
        }
        if ($from = $request->query('from')) {
            self::validateDate($from);
            $where[]  = 'expense_date >= ?';
            $params[] = $from;
        }
        if ($to = $request->query('to')) {
            self::validateDate($to);
            $where[]  = 'expense_date <= ?';
            $params[] = $to;
        }
        if ($min = $request->query('min_amount')) {
            if (!is_numeric($min)) {
                Response::error('min_amount must be numeric', 422);
            }
            $where[] = 'amount >= ?';
            $params[] = (float)$min;
        }
        if ($max = $request->query('max_amount')) {
            if (!is_numeric($max)) {
                Response::error('max_amount must be numeric', 422);
            }
            $where[] = 'amount <= ?';
            $params[] = (float)$max;
        }
        if ($search = trim((string)$request->query('search', ''))) {
            $like     = '%' . $search . '%';
            $where[]  = '(vendor LIKE ? OR description LIKE ? OR expense_code LIKE ?)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        return [implode(' AND ', $where), $params];
    }

    private static function validateDate($val): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val) || !strtotime((string)$val)) {
            Response::error('expense_date must be a valid YYYY-MM-DD date', 422);
        }
    }

    private static function validateAmount($val): void
    {
        if (!is_numeric($val) || (float)$val <= 0) {
            Response::error('amount must be a positive number', 422);
        }
        if ((float)$val > 10_000_000) {
            Response::error('amount exceeds maximum allowed (₹1 crore)', 422);
        }
    }

    private static function validatePaymentMode(string $val): void
    {
        if (!in_array($val, self::PAYMENT_MODES, true)) {
            Response::error('payment_mode must be one of: ' . implode(', ', self::PAYMENT_MODES), 422);
        }
    }

    // ─── POST /admin/expenses/extract-bill ───────────────────────────────────
    /**
     * Accepts { image: "data:image/...;base64,..." }
     * Tries Gemini 1.5 Flash first; if quota exceeded (429) falls back to a
     * structured prompt that the frontend will re-try with Tesseract.js.
     * Returns { date, vendor, amount, category, description, fallback: bool }
     */
    public function extractBill(Request $request): void
    {
        $imageData = $request->input('image');
        if (!$imageData) {
            Response::error('image is required', 422);
        }

        // Detect MIME type from data URI
        preg_match('/^data:(image\/[a-z]+);base64,/i', (string)$imageData, $m);
        $mimeType = $m[1] ?? 'image/jpeg';

        $apiKey = GROQ_API_KEY;
        if (!$apiKey) {
            Response::error('Groq API key not configured', 503);
        }

        $prompt = <<<'PROMPT'
You are a bill/receipt parser for an Indian business expense management system.
Extract the following fields from the bill image and return ONLY a valid JSON object with no extra text or markdown:
{
  "date": "YYYY-MM-DD or empty string",
  "vendor": "shop/vendor/company name or empty string",
  "amount": <number: the final GRAND TOTAL or NET PAYABLE, 0 if not found>,
  "category": "one of: Fuel & Transport, Utilities, Office Stationery, Raw Material, Maintenance & Repairs, Salary & Wages, Marketing, Food & Hospitality, Logistics & Freight, Professional Services, Taxes & Compliance, IT & Software, Equipment Purchase, Printing & Packaging, Bank Charges, Miscellaneous",
  "description": "2-3 sentence description of items purchased, vendor type, and purpose. Min 30 chars, max 250 chars"
}
Rules:
- date: prefer printed date on bill, output as YYYY-MM-DD
- vendor: the shop/company name, NOT the customer name
- amount: the largest/final total including GST as a plain number (no symbols)
- category: pick the closest match from the given list
- description: write 2-3 sentences describing what was purchased, what type of shop/vendor it is, and the likely business purpose
PROMPT;

        // Groq uses OpenAI-compatible chat completions format with vision
        $payload = [
            'model'           => 'meta-llama/llama-4-scout-17b-16e-instruct',
            'response_format' => ['type' => 'json_object'],  // Force pure JSON output
            'messages'        => [
                [
                    'role'    => 'system',
                    'content' => 'You are a JSON-only bill parser. Always respond with a single valid JSON object and nothing else. No markdown, no explanation, no extra text.',
                ],
                [
                    'role'    => 'user',
                    'content' => [
                        ['type' => 'text',      'text'      => $prompt],
                        ['type' => 'image_url', 'image_url' => ['url' => (string)$imageData]],
                    ],
                ],
            ],
            'temperature' => 0.1,
            'max_tokens'  => 500,
        ];

        $ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload),
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                "Authorization: Bearer {$apiKey}",
            ],
            CURLOPT_TIMEOUT        => 25,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $resp = json_decode((string)$raw, true);

        if ($httpCode === 429) {
            $errMsg = $resp['error']['message'] ?? 'Quota exceeded';
            Response::success(['fallback' => true, 'reason' => $errMsg], 'Groq quota exceeded — use Tesseract fallback');
        }

        if ($httpCode !== 200 || !$raw) {
            $errMsg = $resp['error']['message'] ?? "HTTP $httpCode";
            Response::error("Groq API error: $errMsg", 502);
        }

        $text = $resp['choices'][0]['message']['content'] ?? null;
        if (!$text) {
            Response::error('Empty response from Groq', 502);
        }

        // 1. Strip markdown fences if any
        $text = trim(preg_replace('/^```(?:json)?\s*|\s*```\s*$/i', '', trim($text)));

        // 2. Try direct parse
        $extracted = json_decode($text, true);

        // 3. If still failing, try extracting the first {...} block from the text
        if (!is_array($extracted)) {
            if (preg_match('/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/s', $text, $jsonMatch)) {
                $extracted = json_decode($jsonMatch[0], true);
            }
        }

        if (!is_array($extracted)) {
            Response::error('Could not parse Groq response as JSON. Raw: ' . substr($text, 0, 200), 502);
        }

        $extracted['fallback'] = false;
        Response::success($extracted, 'Bill extracted successfully');
    }
}
