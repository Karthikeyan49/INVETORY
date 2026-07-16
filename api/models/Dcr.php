<?php
declare(strict_types=1);

/**
 * Dcr — Daily Call Report (R13 / T11), form code F-SVS-01. A field-visit report
 * with a header (employee, area, KM) and visit lines. Approving a report can
 * seed follow-ups (leads) from prospect lines, linking field visits → leads.
 */
class Dcr
{
    public const STATUS = ['submitted', 'approved'];

    public static function nextNo(): string
    {
        $count = Database::count('SELECT COUNT(*) AS cnt FROM dcr');
        return 'DCR-' . date('Y') . '-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
    }

    /** @return array{rows: array, total: int} */
    public static function all(array $filters = [], int $page = 1, int $limit = 100): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['status']) && in_array($filters['status'], self::STATUS, true)) {
            $where[] = 'd.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['employee_id'])) {
            $where[] = 'd.employee_id = ?';
            $params[] = (int)$filters['employee_id'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'd.report_date >= ?';
            $params[] = (string)$filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'd.report_date <= ?';
            $params[] = (string)$filters['to'];
        }
        if (!empty($filters['search'])) {
            $where[] = '(d.employee_name LIKE ? OR d.dcr_no LIKE ? OR d.area LIKE ?)';
            $like = '%' . $filters['search'] . '%';
            array_push($params, $like, $like, $like);
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $total = Database::count("SELECT COUNT(*) AS cnt FROM dcr d $clause", $params);
        $offset = ($page - 1) * $limit;
        $rows = Database::fetchAll(
            "SELECT d.*, (SELECT COUNT(*) FROM dcr_lines l WHERE l.dcr_id = d.id) AS line_count
             FROM dcr d $clause ORDER BY d.report_date DESC, d.id DESC LIMIT $limit OFFSET $offset",
            $params
        );
        foreach ($rows as &$r) {
            self::cast($r);
        }
        unset($r);
        return ['rows' => $rows, 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch("SELECT * FROM dcr WHERE id = ? LIMIT 1", [$id]);
        if (!$row) {
            return null;
        }
        self::cast($row);
        $row['lines'] = self::lines($id);
        return $row;
    }

    public static function lines(int $dcrId): array
    {
        $rows = Database::fetchAll("SELECT * FROM dcr_lines WHERE dcr_id = ? ORDER BY sort_order ASC, id ASC", [$dcrId]);
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id'];
            $r['dcr_id'] = (int)$r['dcr_id'];
            $r['followup_id'] = $r['followup_id'] ? (int)$r['followup_id'] : null;
        }
        return $rows;
    }

    private static function cast(array &$r): void
    {
        $r['id'] = (int)$r['id'];
        $r['employee_id'] = $r['employee_id'] ? (int)$r['employee_id'] : null;
        foreach (['opening_km', 'closing_km', 'total_km'] as $f) {
            $r[$f] = (float)($r[$f] ?? 0);
        }
        if (isset($r['line_count'])) {
            $r['line_count'] = (int)$r['line_count'];
        }
    }

    public static function create(array $data): int
    {
        $lines = is_array($data['lines'] ?? null) ? $data['lines'] : [];
        $opening = (float)($data['opening_km'] ?? 0);
        $closing = (float)($data['closing_km'] ?? 0);
        $total = $closing > $opening ? round($closing - $opening, 1) : (float)($data['total_km'] ?? 0);

        $id = Database::insert(
            "INSERT INTO dcr
                (dcr_no, employee_id, employee_name, report_date, area, opening_km, closing_km, total_km, status, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                self::nextNo(),
                !empty($data['employee_id']) ? (int)$data['employee_id'] : null,
                trim((string)$data['employee_name']),
                !empty($data['report_date']) ? (string)$data['report_date'] : date('Y-m-d'),
                isset($data['area']) && $data['area'] !== '' ? trim((string)$data['area']) : null,
                $opening, $closing, $total,
                in_array($data['status'] ?? '', self::STATUS, true) ? $data['status'] : 'submitted',
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
        self::replaceLines($id, $lines);
        return $id;
    }

    public static function update(int $id, array $data): bool
    {
        $existing = self::find($id);
        if (!$existing) {
            return false;
        }
        $opening = array_key_exists('opening_km', $data) ? (float)$data['opening_km'] : (float)$existing['opening_km'];
        $closing = array_key_exists('closing_km', $data) ? (float)$data['closing_km'] : (float)$existing['closing_km'];
        $total = $closing > $opening ? round($closing - $opening, 1) : (float)($data['total_km'] ?? $existing['total_km']);

        Database::execute(
            "UPDATE dcr SET employee_id = ?, employee_name = ?, report_date = ?, area = ?,
                    opening_km = ?, closing_km = ?, total_km = ?, notes = ? WHERE id = ?",
            [
                array_key_exists('employee_id', $data) ? (!empty($data['employee_id']) ? (int)$data['employee_id'] : null) : $existing['employee_id'],
                array_key_exists('employee_name', $data) ? trim((string)$data['employee_name']) : $existing['employee_name'],
                array_key_exists('report_date', $data) ? (string)$data['report_date'] : $existing['report_date'],
                array_key_exists('area', $data) ? (trim((string)$data['area']) ?: null) : $existing['area'],
                $opening, $closing, $total,
                array_key_exists('notes', $data) ? (trim((string)$data['notes']) ?: null) : $existing['notes'],
                $id,
            ]
        );
        if (array_key_exists('lines', $data) && is_array($data['lines'])) {
            self::replaceLines($id, $data['lines']);
        }
        return true;
    }

    private static function replaceLines(int $dcrId, array $lines): void
    {
        Database::execute("DELETE FROM dcr_lines WHERE dcr_id = ?", [$dcrId]);
        $i = 0;
        foreach ($lines as $ln) {
            $customer = trim((string)($ln['customer'] ?? ''));
            $mobile = trim((string)($ln['mobile'] ?? ''));
            if ($customer === '' && $mobile === '') {
                continue;
            }
            Database::insert(
                "INSERT INTO dcr_lines
                    (dcr_id, sort_order, customer, address, mobile, model, cust_status, cust_type, category, stamping, service, payment, remarks, staff_sign)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $dcrId, $i++,
                    $customer ?: null,
                    trim((string)($ln['address'] ?? '')) ?: null,
                    $mobile ?: null,
                    trim((string)($ln['model'] ?? '')) ?: null,
                    trim((string)($ln['cust_status'] ?? '')) ?: null,
                    trim((string)($ln['cust_type'] ?? '')) ?: null,
                    trim((string)($ln['category'] ?? '')) ?: null,
                    trim((string)($ln['stamping'] ?? '')) ?: null,
                    trim((string)($ln['service'] ?? '')) ?: null,
                    trim((string)($ln['payment'] ?? '')) ?: null,
                    trim((string)($ln['remarks'] ?? '')) ?: null,
                    trim((string)($ln['staff_sign'] ?? '')) ?: null,
                ]
            );
        }
    }

    /**
     * Approve the report and seed follow-ups (leads) from prospect lines that
     * don't yet have one — connecting field visits → leads (§1a).
     * @return array{seeded:int}
     */
    public static function approve(int $id, ?int $actorId): array
    {
        $dcr = self::find($id);
        if (!$dcr) {
            return ['seeded' => 0];
        }
        Database::execute(
            "UPDATE dcr SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
            [$actorId ?: null, $id]
        );

        $seeded = 0;
        if (class_exists('Followup')) {
            foreach ($dcr['lines'] as $ln) {
                $isProspect = strtolower((string)($ln['cust_type'] ?? '')) === 'prospect';
                if (!$isProspect || !empty($ln['followup_id']) || empty($ln['customer'])) {
                    continue;
                }
                // Cross-DCR dedup: skip if this prospect already has an open lead
                // (same mobile, or same name when no mobile was captured).
                if (Followup::openLeadExists($ln['mobile'] ?? null, $ln['customer'])) {
                    continue;
                }
                try {
                    $fid = Followup::create([
                        'customer_name' => $ln['customer'],
                        'mobile'        => $ln['mobile'] ?? null,
                        'title'         => 'Lead from DCR ' . $dcr['dcr_no'] . ($dcr['area'] ? ' — ' . $dcr['area'] : ''),
                        'category'      => $ln['category'] ?: 'Field visit',
                        'note'          => trim(($ln['model'] ? 'Model: ' . $ln['model'] . '. ' : '') . ($ln['remarks'] ?? '')) ?: null,
                        'assigned_to'   => $dcr['employee_id'] ?? null,
                        'status'        => 'open',
                        'created_by'    => $actorId,
                    ]);
                    Database::execute("UPDATE dcr_lines SET followup_id = ? WHERE id = ?", [$fid, $ln['id']]);
                    $seeded++;
                } catch (\Throwable $e) {
                    // best-effort lead seeding
                }
            }
        }
        return ['seeded' => $seeded];
    }

    public static function delete(int $id): bool
    {
        Database::execute("DELETE FROM dcr_lines WHERE dcr_id = ?", [$id]);
        return Database::execute("DELETE FROM dcr WHERE id = ?", [$id]) >= 0;
    }
}
