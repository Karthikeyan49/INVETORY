<?php
declare(strict_types=1);

/**
 * Funding — Capital & Loans ledger. Feeds the Balance Sheet (capital, loan
 * balance) and the financing section of the Cash Flow statement.
 */
class Funding
{
    public const TYPES = ['capital', 'loan_in', 'loan_repaid'];

    public static function all(array $filters = []): array
    {
        $where  = [];
        $params = [];
        if (!empty($filters['type']) && in_array($filters['type'], self::TYPES, true)) {
            $where[] = 'entry_type = ?';
            $params[] = $filters['type'];
        }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $rows = Database::fetchAll("SELECT * FROM funding_entries $clause ORDER BY entry_date DESC, id DESC", $params);
        foreach ($rows as &$r) {
            $r['amount'] = (float)$r['amount'];
        }
        return $rows;
    }

    public static function find(int $id): ?array
    {
        return Database::fetch("SELECT * FROM funding_entries WHERE id = ? LIMIT 1", [$id]) ?: null;
    }

    public static function create(array $data): int
    {
        $type = in_array($data['entry_type'] ?? '', self::TYPES, true) ? $data['entry_type'] : 'capital';
        return Database::insert(
            "INSERT INTO funding_entries (entry_type, amount, entry_date, party, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                $type,
                max(0.0, (float)($data['amount'] ?? 0)),
                !empty($data['entry_date']) ? (string)$data['entry_date'] : null,
                isset($data['party']) && $data['party'] !== '' ? trim((string)$data['party']) : null,
                isset($data['notes']) && $data['notes'] !== '' ? trim((string)$data['notes']) : null,
                !empty($data['created_by']) ? (int)$data['created_by'] : null,
            ]
        );
    }

    public static function destroy(int $id): bool
    {
        if (!self::find($id)) {
            return false;
        }
        Database::execute("DELETE FROM funding_entries WHERE id = ?", [$id]);
        return true;
    }

    /**
     * Totals up to an optional as-of date.
     * @return array{capital: float, loan_in: float, loan_repaid: float, loan_outstanding: float}
     */
    public static function summary(?string $asOf = null): array
    {
        $where  = '';
        $params = [];
        if ($asOf) {
            $where = 'WHERE (entry_date IS NULL OR entry_date <= ?)';
            $params[] = $asOf;
        }
        $row = Database::fetch(
            "SELECT
                COALESCE(SUM(CASE WHEN entry_type='capital'     THEN amount ELSE 0 END),0) AS capital,
                COALESCE(SUM(CASE WHEN entry_type='loan_in'     THEN amount ELSE 0 END),0) AS loan_in,
                COALESCE(SUM(CASE WHEN entry_type='loan_repaid' THEN amount ELSE 0 END),0) AS loan_repaid
             FROM funding_entries $where",
            $params
        ) ?: ['capital' => 0, 'loan_in' => 0, 'loan_repaid' => 0];
        $capital    = (float)$row['capital'];
        $loanIn     = (float)$row['loan_in'];
        $loanRepaid = (float)$row['loan_repaid'];
        return [
            'capital'          => $capital,
            'loan_in'          => $loanIn,
            'loan_repaid'      => $loanRepaid,
            'loan_outstanding' => max(0.0, round($loanIn - $loanRepaid, 2)),
        ];
    }
}
