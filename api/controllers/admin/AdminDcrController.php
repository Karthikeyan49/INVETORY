<?php
declare(strict_types=1);

/**
 * AdminDcrController — Daily Call Report (R13 / T11), code F-SVS-01.
 * Create / list / view / approve field-visit reports; approval seeds
 * follow-ups (leads) from prospect lines.
 */
class AdminDcrController
{
    // GET /admin/dcr
    public function index(Request $request): void
    {
        $result = Dcr::all(
            [
                'status'      => $request->query('status'),
                'employee_id' => $request->query('employee_id'),
                'from'        => $request->query('from'),
                'to'          => $request->query('to'),
                'area'        => $request->query('area'),
                'search'      => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 100)
        );
        Response::paginated($result['rows'], [
            'page' => 1, 'limit' => 100, 'total' => $result['total'], 'total_pages' => 1,
        ]);
    }

    // GET /admin/dcr/areas — distinct locations for the location filter
    public function areas(Request $request): void
    {
        Response::success(Dcr::distinctAreas());
    }

    // GET /admin/dcr/{id}
    public function show(Request $request): void
    {
        $dcr = Dcr::find((int)$request->param('id'));
        if (!$dcr) {
            Response::error('DCR not found', 404);
        }
        Response::success($dcr);
    }

    // POST /admin/dcr
    public function store(Request $request): void
    {
        $data = $request->only([
            'employee_id', 'employee_name', 'report_date', 'area',
            'opening_km', 'closing_km', 'total_km', 'notes', 'lines',
        ]);
        if (empty($data['employee_name'])) {
            Response::error('Employee name is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = Dcr::create($data);
        Response::success(Dcr::find($id), 'Daily Call Report created', 201);
    }

    // POST /admin/dcr/extract
    /**
     * Parse an uploaded DCR PDF into a structured { header, lines } payload the
     * front-end can pre-fill into the New-DCR form. Nothing is saved here — the
     * user reviews / edits, then saves through the normal store() endpoint.
     *
     * Mirrors AdminExpenseController::extractBill: extract → Groq (JSON mode) →
     * robust parse → normalised JSON. Text is pulled from the PDF with poppler's
     * pdftotext (layout mode) so the model receives a column-aligned table.
     *
     * Multipart field: "file" (a text-based DCR PDF).
     */
    public function extract(Request $request): void
    {
        // Preferred path: the browser (pdf.js) already extracted the PDF text and
        // posts it as JSON { text }. This is the path that works on shared hosting,
        // where the pdftotext binary / shell_exec are unavailable.
        $clientText = trim((string)$request->input('text', ''));
        if ($clientText !== '') {
            $text = $clientText;
        } else {
            // Fallback: server-side extraction from an uploaded PDF (needs pdftotext).
            $file = $_FILES['file'] ?? null;
            if (!is_array($file)) {
                Response::error('Provide the extracted text (field "text") or upload a PDF (field "file")', 422);
            }
            if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                Response::error('Upload failed (code ' . (string)($file['error'] ?? 'unknown') . ')', 422);
            }

            $tmp = (string)($file['tmp_name'] ?? '');
            if ($tmp === '' || !is_file($tmp)) {
                Response::error('Uploaded file is not available', 422);
            }
            // Defence in depth: on a real request the temp file must be an HTTP upload.
            if (PHP_SAPI !== 'cli' && !is_uploaded_file($tmp)) {
                Response::error('Invalid upload', 422);
            }

            $size = (int)($file['size'] ?? 0);
            if ($size <= 0) {
                Response::error('Uploaded file is empty', 422);
            }
            if ($size > 8 * 1024 * 1024) {
                Response::error('PDF must be 8 MB or less', 422);
            }

            // Accept PDFs only — verify extension AND the %PDF- magic bytes so we never
            // hand an arbitrary file to the extractor.
            $ext = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
            if ($ext !== 'pdf') {
                Response::error('Only PDF files are supported', 422);
            }
            $magic = (string)@file_get_contents($tmp, false, null, 0, 5);
            if (strncmp($magic, '%PDF-', 5) !== 0) {
                Response::error('Uploaded file is not a valid PDF', 422);
            }

            $text = self::pdfToText($tmp);
            if ($text === null) {
                Response::error('PDF text extraction is unavailable on the server. Please update to the latest app version (browser-side extraction) and retry.', 503);
            }
        }
        $text = trim($text);
        if ($text === '') {
            Response::error('No extractable text found in the PDF (a scanned image?). Please enter the report manually.', 422);
        }
        // Keep the prompt bounded regardless of how large the PDF is.
        if (strlen($text) > 60000) {
            $text = substr($text, 0, 60000);
        }

        $apiKey = GROQ_API_KEY;
        if (!$apiKey) {
            Response::error('Groq API key not configured', 503);
        }

        $instructions = <<<'PROMPT'
You are a parser for an Indian field-sales "Daily Call Report" (DCR / form F-SVS-01).
You are given the plain text of a DCR PDF, extracted with a layout-preserving tool.
Return ONLY a single valid JSON object — no markdown, no commentary — in exactly this shape:
{
  "header": {
    "employee_name": "the employee / salesperson name, or \"\"",
    "report_date": "YYYY-MM-DD or \"\"",
    "area": "string or \"\"",
    "opening_km": number,
    "closing_km": number,
    "total_km": number,
    "notes": "string or \"\""
  },
  "lines": [
    {
      "customer": "string",
      "address": "string",
      "mobile": "digits only, or \"\"",
      "model": "string",
      "cust_status": "new or existing",
      "cust_type": "customer or prospect",
      "category": "string",
      "stamping": "string",
      "service": "string",
      "payment": "string",
      "remarks": "string",
      "staff_sign": "string"
    }
  ]
}
Rules:
- Each numbered row (1, 2, 3 …) in the visit table is exactly one object in "lines", in the same order.
- A single cell may wrap across several physical text lines (e.g. a customer name or remark split over 2-3 lines). Rejoin the wrapped fragments into one value per cell.
- Do NOT invent data. If a cell is blank, use "" (empty string). Never copy a value from a neighbouring column.
- mobile: keep digits only (strip spaces / dashes).
- cust_status must be "new" or "existing"; cust_type must be "customer" or "prospect". If unclear use "new" and "customer".
- opening_km / closing_km / total_km must be plain numbers with no units; use 0 when absent.
- Ignore the repeated column-header row and any page footers.
PROMPT;

        $prompt = $instructions . "\n\nDCR PDF TEXT:\n\"\"\"\n" . $text . "\n\"\"\"";

        $payload = [
            'model'           => 'llama-3.3-70b-versatile',
            'response_format' => ['type' => 'json_object'],  // force pure JSON output
            'messages'        => [
                [
                    'role'    => 'system',
                    'content' => 'You are a JSON-only data extraction engine. Always reply with a single valid JSON object and nothing else. No markdown, no explanation.',
                ],
                ['role' => 'user', 'content' => $prompt],
            ],
            'temperature' => 0.1,
            'max_tokens'  => 8000,
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
            CURLOPT_TIMEOUT        => 60,
        ]);
        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $resp = json_decode((string)$raw, true);

        if ($httpCode === 429) {
            $errMsg = $resp['error']['message'] ?? 'Quota exceeded';
            Response::error('Groq quota exceeded — please try again later or enter the report manually. (' . $errMsg . ')', 429);
        }
        if ($httpCode !== 200 || !$raw) {
            $errMsg = $resp['error']['message'] ?? "HTTP $httpCode";
            Response::error("Groq API error: $errMsg", 502);
        }

        $content = $resp['choices'][0]['message']['content'] ?? null;
        if (!$content) {
            Response::error('Empty response from Groq', 502);
        }

        // Robust parse — mirror extractBill: strip fences, direct parse, then
        // fall back to the first {...} block.
        $content   = trim(preg_replace('/^```(?:json)?\s*|\s*```\s*$/i', '', trim($content)));
        $extracted = json_decode($content, true);
        if (!is_array($extracted) && preg_match('/\{.*\}/s', $content, $jsonMatch)) {
            $extracted = json_decode($jsonMatch[0], true);
        }
        if (!is_array($extracted)) {
            Response::error('Could not parse the extraction result as JSON. Please try again.', 502);
        }

        $result = self::normalizeExtracted($extracted);
        if (!$result['lines']) {
            Response::error('No visit lines could be read from this PDF. Please check the file or enter the report manually.', 422);
        }

        Response::success($result, 'DCR extracted — review before saving');
    }

    // PUT /admin/dcr/{id}
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $data = $request->only([
            'employee_id', 'employee_name', 'report_date', 'area',
            'opening_km', 'closing_km', 'total_km', 'notes', 'lines',
        ]);
        if (!Dcr::update($id, $data)) {
            Response::error('DCR not found', 404);
        }
        Response::success(Dcr::find($id), 'Daily Call Report updated');
    }

    // POST /admin/dcr/{id}/approve
    public function approve(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Dcr::find($id)) {
            Response::error('DCR not found', 404);
        }
        $result = Dcr::approve($id, $request->user['user_id'] ?? null);
        Response::success(
            ['dcr' => Dcr::find($id), 'leads_seeded' => $result['seeded']],
            $result['seeded'] > 0 ? "Approved — {$result['seeded']} lead(s) created" : 'Approved'
        );
    }

    // DELETE /admin/dcr/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Dcr::find($id)) {
            Response::error('DCR not found', 404);
        }
        Dcr::delete($id);
        Response::success(null, 'DCR deleted');
    }

    // ─── PDF-extraction helpers ──────────────────────────────────────────────

    /**
     * Extract layout-preserving text from a PDF using poppler's pdftotext.
     * Returns null when the tool is unavailable, or the extracted text otherwise
     * (which may be an empty string for scanned / image-only PDFs).
     */
    private static function pdfToText(string $path): ?string
    {
        if (!self::shellAvailable()) {
            return null;
        }
        $bin = self::pdftotextBinary();
        if ($bin === null) {
            return null;
        }
        // $path is a PHP-generated upload temp path; escapeshellarg keeps it safe.
        $cmd = escapeshellarg($bin) . ' -layout -q -enc UTF-8 ' . escapeshellarg($path) . ' - 2>/dev/null';
        $out = @shell_exec($cmd);
        return is_string($out) ? $out : '';
    }

    private static function shellAvailable(): bool
    {
        if (!function_exists('shell_exec')) {
            return false;
        }
        $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
        return !in_array('shell_exec', $disabled, true);
    }

    private static function pdftotextBinary(): ?string
    {
        foreach (['/usr/bin/pdftotext', '/usr/local/bin/pdftotext', '/opt/homebrew/bin/pdftotext'] as $candidate) {
            if (is_file($candidate) && is_executable($candidate)) {
                return $candidate;
            }
        }
        $which = @shell_exec('command -v pdftotext 2>/dev/null');
        $which = is_string($which) ? trim($which) : '';
        return $which !== '' ? $which : null;
    }

    /**
     * Coerce the model output into the exact { header, lines } shape used by the
     * DCR form, dropping unknown keys and empty rows and clamping enum fields.
     */
    private static function normalizeExtracted(array $raw): array
    {
        $h = is_array($raw['header'] ?? null) ? $raw['header'] : [];
        $header = [
            'employee_name' => trim((string)($h['employee_name'] ?? '')),
            'report_date'   => self::normalizeDate((string)($h['report_date'] ?? '')),
            'area'          => trim((string)($h['area'] ?? '')),
            'opening_km'    => (float)($h['opening_km'] ?? 0),
            'closing_km'    => (float)($h['closing_km'] ?? 0),
            'total_km'      => (float)($h['total_km'] ?? 0),
            'notes'         => trim((string)($h['notes'] ?? '')),
        ];

        $lines    = [];
        $rawLines = is_array($raw['lines'] ?? null) ? $raw['lines'] : [];
        foreach ($rawLines as $ln) {
            if (!is_array($ln)) {
                continue;
            }
            $customer = trim((string)($ln['customer'] ?? ''));
            $mobile   = preg_replace('/\D+/', '', (string)($ln['mobile'] ?? '')) ?? '';
            if ($customer === '' && $mobile === '') {
                continue;
            }
            $status = strtolower(trim((string)($ln['cust_status'] ?? '')));
            $type   = strtolower(trim((string)($ln['cust_type'] ?? '')));
            $lines[] = [
                'customer'    => $customer,
                'address'     => trim((string)($ln['address'] ?? '')),
                'mobile'      => $mobile,
                'model'       => trim((string)($ln['model'] ?? '')),
                'cust_status' => in_array($status, ['new', 'existing'], true) ? $status : 'new',
                'cust_type'   => in_array($type, ['customer', 'prospect'], true) ? $type : 'customer',
                'category'    => trim((string)($ln['category'] ?? '')),
                'stamping'    => trim((string)($ln['stamping'] ?? '')),
                'service'     => trim((string)($ln['service'] ?? '')),
                'payment'     => trim((string)($ln['payment'] ?? '')),
                'remarks'     => trim((string)($ln['remarks'] ?? '')),
                'staff_sign'  => trim((string)($ln['staff_sign'] ?? '')),
            ];
        }

        return ['header' => $header, 'lines' => $lines];
    }

    private static function normalizeDate(string $s): string
    {
        $s = trim($s);
        if ($s === '') {
            return '';
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
            return $s;
        }
        // DD/MM/YYYY or DD-MM-YY(YY)
        if (preg_match('#^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$#', $s, $m)) {
            $y = strlen($m[3]) === 2 ? '20' . $m[3] : $m[3];
            return sprintf('%04d-%02d-%02d', (int)$y, (int)$m[2], (int)$m[1]);
        }
        $ts = strtotime($s);
        return $ts ? date('Y-m-d', $ts) : '';
    }
}
