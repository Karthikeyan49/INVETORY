<?php
declare(strict_types=1);

/**
 * InventoryPermissions — fine-grained, in-controller permission checks for the
 * Smart Inventory module that go beyond what the route-level 'admin:roles' guard
 * can express (e.g. action-specific checks shared across multiple routes).
 *
 * Route-level access is already enforced by AdminMiddleware via guard strings on
 * each route in api/index.php. This helper covers the remaining cases where a
 * single route serves multiple actions or a service needs to check permissions
 * outside the routing layer.
 */
class InventoryPermissions
{
    private const MATRIX = [
        'products.read'        => ['owner', 'store_keeper', 'accountant', 'hr', 'sales'],
        'products.write'       => ['owner', 'store_keeper'],
        'zones.read'           => ['owner', 'store_keeper', 'accountant'],
        'zones.write'          => ['owner', 'store_keeper'],
        'stock.receive'        => ['owner', 'store_keeper'],
        'stock.bulk_import'    => ['owner', 'store_keeper'],
        'movements.read'       => ['owner', 'store_keeper', 'accountant', 'hr', 'sales'],
        'movements.issue'      => ['owner', 'store_keeper', 'hr'],
        'movements.dealer'     => ['owner', 'store_keeper', 'sales'],
        'movements.production' => ['owner', 'store_keeper'],
        'movements.transfer'   => ['owner', 'store_keeper'],
        'movements.damaged'    => ['owner', 'store_keeper'],
        'movements.emergency'  => ['owner'],
        'movements.adjustment' => ['owner'],
        'intelligence.read'    => ['owner', 'store_keeper', 'accountant'],
        'reorder.read'         => ['owner', 'store_keeper', 'accountant'],
        'reorder.generate'     => ['owner', 'store_keeper'],
        'approvals.read'       => ['owner', 'store_keeper', 'accountant'],
        'approvals.action'     => ['owner', 'store_keeper'],
        'finance.inventory'    => ['owner', 'accountant'],
        'reports.inventory'    => ['owner', 'store_keeper', 'accountant'],
    ];

    public static function check(string $action, array $user): bool
    {
        if (($user['user_type'] ?? '') !== 'admin') {
            return false;
        }

        $role = AdminMiddleware::normalizeStaffRole($user['staff_role'] ?? null) ?? 'owner';

        return in_array($role, self::MATRIX[$action] ?? [], true);
    }

    public static function enforce(string $action, array $user): void
    {
        if (!self::check($action, $user)) {
            Response::error('Access denied', 403);
        }
    }
}
