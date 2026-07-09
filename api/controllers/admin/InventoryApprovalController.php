<?php
declare(strict_types=1);

class InventoryApprovalController
{
    /** GET /admin/inventory/approvals — list/history with optional filters. */
    public function index(Request $request): void
    {
        $filters = [
            'approval_type' => $request->query('approval_type'),
            'status'        => $request->query('status'),
            'from'          => $request->query('date_from'),
            'to'            => $request->query('date_to'),
        ];
        Response::success((new ApprovalWorkflow())->getApprovalHistory($filters));
    }

    /** GET /admin/inventory/approvals/pending — pending approvals for the caller. */
    public function getPending(Request $request): void
    {
        $workflow = new ApprovalWorkflow();
        $workflow->expirePendingApprovals();

        $userId = isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
        Response::success($workflow->getPendingApprovals($userId));
    }

    /** GET /admin/inventory/approvals/stats */
    public function getStats(Request $request): void
    {
        Response::success((new ApprovalWorkflow())->getApprovalStats());
    }

    /** GET /admin/inventory/approvals/history */
    public function getHistory(Request $request): void
    {
        $filters = [
            'approval_type' => $request->query('approval_type'),
            'status'        => $request->query('status'),
            'from'          => $request->query('date_from'),
            'to'            => $request->query('date_to'),
        ];
        Response::success((new ApprovalWorkflow())->getApprovalHistory($filters));
    }

    /** GET /admin/inventory/approvals/{id} */
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid approval ID', 400);
        }

        $row = Database::fetch(
            "SELECT a.*, m.movement_type, m.quantity, m.total_value, m.zone_id,
                    p.name AS product, p.sku,
                    req.name AS requested_by_name,
                    apr.name AS approved_by_name,
                    rej.name AS rejected_by_name,
                    TIMESTAMPDIFF(HOUR, a.created_at, NOW()) AS hours_pending
             FROM inventory_approvals a
             JOIN inventory_stock_movements m ON m.movement_id = a.movement_id
             JOIN inventory_products p ON p.inv_product_id = m.inv_product_id
             LEFT JOIN users req ON req.user_id = a.requested_by
             LEFT JOIN users apr ON apr.user_id = a.approved_by
             LEFT JOIN users rej ON rej.user_id = a.rejected_by
             WHERE a.approval_id = ?
             LIMIT 1",
            [$id]
        );
        if ($row === null) {
            Response::error('Approval not found', 404);
        }

        Response::success($row);
    }

    /** POST /admin/inventory/approvals/{id}/approve */
    public function approve(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid approval ID', 400);
        }

        $data = $request->only(['remarks']);
        Validator::make($data, [
            'remarks' => 'string',
        ])->validate();

        $this->decide($request, $id, 'approve', (string)($data['remarks'] ?? ''), 'Approval granted; movement applied');
    }

    /** POST /admin/inventory/approvals/{id}/reject */
    public function reject(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid approval ID', 400);
        }

        $data = $request->only(['remarks']);
        Validator::make($data, [
            'remarks' => 'required|string|min:10',
        ])->validate();

        $this->decide($request, $id, 'reject', (string)$data['remarks'], 'Approval rejected; movement reversed');
    }

    /** POST /admin/inventory/approvals/escalate */
    public function escalate(Request $request): void
    {
        $hours = (int)$request->input('hours_threshold', 24);
        if ($hours <= 0) {
            $hours = 24;
        }
        Response::success((new ApprovalWorkflow())->escalateOverdueApprovals($hours), 'Overdue approvals escalated');
    }

    // ── helper ────────────────────────────────────────────────────────────────

    /**
     * Run an approve/reject decision with the caller as the approver, mapping the
     * workflow's RuntimeExceptions to 422 (consistent with InventoryMovementController).
     */
    private function decide(Request $request, int $approvalId, string $decision, string $remarks, string $successMessage): void
    {
        $approvedBy = isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
        if ($approvedBy <= 0) {
            Response::error('Authenticated approver required', 401);
        }

        try {
            $result = (new ApprovalWorkflow())->processApproval($approvalId, $decision, $approvedBy, $remarks);
        } catch (Throwable $e) {
            error_log('Approval decision error: ' . $e->getMessage());
            if ($e instanceof RuntimeException && $e->getMessage() === 'Approval has already been actioned') {
                Response::error('Approval already actioned', 409);
            }
            Response::error($e instanceof RuntimeException ? $e->getMessage() : 'Approval decision failed', 422);
        }

        Response::success($result, $successMessage);
    }
}
