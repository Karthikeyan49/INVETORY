<?php
declare(strict_types=1);

/**
 * Cash Bill API — Sri Vari Cash Bill (F/SVS/34) records.
 * A cash bill can reference a machine and is downloaded as a PDF on the client.
 */
class CashBillController
{
    // GET /cash-bills
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 50)));
        $filters = [
            'search'        => $request->query('search'),
            'customer_id'   => $request->query('customer_id'),
            'customer_name' => $request->query('customer_name'),
        ];
        $result = CashBill::all($filters, $page, $limit);
        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $result['total'],
            'total_pages' => (int)ceil(max(1, $result['total']) / $limit),
            'next_bill'   => CashBill::nextBillNo(),
        ]);
    }

    // GET /cash-bills/{id}
    public function show(Request $request): void
    {
        $id  = (int)$request->param('id');
        $row = $id > 0 ? CashBill::find($id) : null;
        if (!$row) {
            Response::error('Cash bill not found', 404);
        }
        Response::success($row);
    }

    // POST /cash-bills
    public function store(Request $request): void
    {
        $data = $request->only([
            'bill_no', 'customer_id', 'customer_name', 'cell_no', 'machine_id',
            'description', 'qty', 'amount', 'total', 'bill_date', 'notes',
        ]);
        if (!isset($data['customer_name']) || trim((string)$data['customer_name']) === '') {
            Response::error('Customer name is required', 422);
        }
        $data['created_by'] = $request->user['user_id'] ?? null;
        $id = CashBill::create($data);
        Response::success(CashBill::find($id), 'Cash bill created', 201);
    }

    // DELETE /cash-bills/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0 || !CashBill::find($id)) {
            Response::error('Cash bill not found', 404);
        }
        CashBill::delete($id);
        Response::success(null, 'Cash bill deleted');
    }
}
