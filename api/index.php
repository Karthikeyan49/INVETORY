<?php
declare(strict_types=1);

// --- Bootstrap ----------------------------------------------------------------
define('ROOT_PATH', __DIR__);

require_once ROOT_PATH . '/config/app.php';
require_once ROOT_PATH . '/core/Response.php';

// --- Error handling -----------------------------------------------------------
if (defined('APP_ENV') && APP_ENV === 'production') {
    error_reporting(0);
    ini_set('display_errors', '0');
} else {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
}

set_exception_handler(function (Throwable $e) {
    error_log('[Unhandled] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (class_exists('Response')) {
        Response::error(
            (!defined('APP_ENV') || APP_ENV === 'development') ? $e->getMessage() : 'Internal server error',
            500
        );
    } else {
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Internal server error']);
    }
});

// --- CORS ---------------------------------------------------------------------
$_allowedOrigins = array_filter(array_map('trim', explode(',', defined('CORS_ORIGIN') ? CORS_ORIGIN : '')));
// Local dev origins are only trusted outside production.
if (!defined('APP_ENV') || APP_ENV !== 'production') {
    $_allowedOrigins[] = 'http://localhost:8080';
    $_allowedOrigins[] = 'http://localhost:8081';
}
$_requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
$_corsHeader = in_array($_requestOrigin, $_allowedOrigins, true) ? $_requestOrigin : ($_allowedOrigins[0] ?? 'https://api.inventory.com');
header('Access-Control-Allow-Origin: ' . $_corsHeader);
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Client-Type');
header('Access-Control-Max-Age: 86400'); // cache preflight 24h so the browser stops re-sending OPTIONS before every request
unset($_allowedOrigins, $_requestOrigin, $_corsHeader);
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- JWT secret guard ---------------------------------------------------------
if (
    !defined('JWT_SECRET') ||
    strlen(JWT_SECRET) < 32 ||
    JWT_SECRET === 'CHANGE_THIS_TO_A_LONG_RANDOM_STRING_AT_LEAST_64_CHARS'
) {
    error_log('[Config] JWT_SECRET is missing or is still the default placeholder');
    Response::error('Server misconfiguration', 500);
}

// --- 415 Unsupported Media Type -----------------------------------------------
$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$contentType   = $_SERVER['CONTENT_TYPE'] ?? '';

if (
    in_array($requestMethod, ['POST', 'PUT', 'PATCH'], true) &&
    !empty($contentType) &&
    !str_contains($contentType, 'application/json') &&
    !str_contains($contentType, 'application/x-www-form-urlencoded') &&
    !str_contains($contentType, 'multipart/form-data')
) {
    Response::error('Unsupported Media Type. Use application/json', 415);
}

// --- Requires -----------------------------------------------------------------
require_once ROOT_PATH . '/config/database.php';
require_once ROOT_PATH . '/core/AppException.php';
require_once ROOT_PATH . '/core/Database.php';
require_once ROOT_PATH . '/core/Request.php';
require_once ROOT_PATH . '/core/Router.php';
require_once ROOT_PATH . '/services/NumberSequence.php';
require_once ROOT_PATH . '/services/FileStore.php';
require_once ROOT_PATH . '/services/ImportEngine.php';
require_once ROOT_PATH . '/services/SmartAllocationEngine.php';
require_once ROOT_PATH . '/services/MovementEngine.php';
require_once ROOT_PATH . '/services/InventoryIntelligence.php';
require_once ROOT_PATH . '/services/ReorderIntelligence.php';
require_once ROOT_PATH . '/services/DemandForecast.php';
require_once ROOT_PATH . '/services/ApprovalWorkflow.php';
require_once ROOT_PATH . '/services/GstinLookupService.php';
require_once ROOT_PATH . '/helpers/JWT.php';
require_once ROOT_PATH . '/helpers/Money.php';
require_once ROOT_PATH . '/helpers/Validator.php';
require_once ROOT_PATH . '/helpers/InventoryPermissions.php';
require_once ROOT_PATH . '/helpers/TimesFmClient.php';
require_once ROOT_PATH . '/middleware/AuthMiddleware.php';
require_once ROOT_PATH . '/middleware/RateLimitMiddleware.php';

require_once ROOT_PATH . '/models/User.php';
require_once ROOT_PATH . '/models/Product.php';
require_once ROOT_PATH . '/models/Order.php';
require_once ROOT_PATH . '/models/Employee.php';
require_once ROOT_PATH . '/models/AttendanceShift.php';
require_once ROOT_PATH . '/models/Attendance.php';
require_once ROOT_PATH . '/models/AttendanceAnalytics.php';
require_once ROOT_PATH . '/models/Payroll.php';
require_once ROOT_PATH . '/models/Incentive.php';
require_once ROOT_PATH . '/models/EmployeeAdvance.php';
require_once ROOT_PATH . '/models/EmployeeCompliance.php';
require_once ROOT_PATH . '/models/HrImport.php';
require_once ROOT_PATH . '/models/DataImportMapper.php';
require_once ROOT_PATH . '/models/Vendor.php';
require_once ROOT_PATH . '/models/PurchaseRequest.php';
require_once ROOT_PATH . '/models/Inventory.php';
require_once ROOT_PATH . '/models/InventoryProduct.php';
require_once ROOT_PATH . '/models/InventoryZone.php';
require_once ROOT_PATH . '/models/InventoryStock.php';
require_once ROOT_PATH . '/models/InventoryMovement.php';
require_once ROOT_PATH . '/models/InventoryAllocation.php';
require_once ROOT_PATH . '/models/PurchaseOrder.php';
require_once ROOT_PATH . '/models/Payment.php';
require_once ROOT_PATH . '/models/PaymentInstallment.php';
require_once ROOT_PATH . '/models/PoRegister.php';
require_once ROOT_PATH . '/models/SalesDocument.php';
require_once ROOT_PATH . '/models/TestCertificate.php';
require_once ROOT_PATH . '/models/GstCompliance.php';
require_once ROOT_PATH . '/models/DealerNetwork.php';
require_once ROOT_PATH . '/models/FinanceAnalytics.php';
require_once ROOT_PATH . '/models/Machine.php';
require_once ROOT_PATH . '/models/MachineIssue.php';
require_once ROOT_PATH . '/models/MachineMovement.php';
require_once ROOT_PATH . '/models/InventoryItem.php';
require_once ROOT_PATH . '/models/Spare.php';
require_once ROOT_PATH . '/models/Purchase.php';
require_once ROOT_PATH . '/models/Funding.php';
require_once ROOT_PATH . '/models/Stamping.php';
require_once ROOT_PATH . '/models/Followup.php';
require_once ROOT_PATH . '/models/Dcr.php';
require_once ROOT_PATH . '/models/DeliveryNote.php';
require_once ROOT_PATH . '/models/CashBill.php';
require_once ROOT_PATH . '/helpers/GroqAPI.php';
require_once ROOT_PATH . '/controllers/AuthController.php';
require_once ROOT_PATH . '/controllers/UserController.php';
require_once ROOT_PATH . '/controllers/ProductController.php';
require_once ROOT_PATH . '/controllers/OrderController.php';
require_once ROOT_PATH . '/controllers/StatisticsController.php';
require_once ROOT_PATH . '/controllers/QueryController.php';
require_once ROOT_PATH . '/controllers/MachineController.php';
require_once ROOT_PATH . '/controllers/MachineIssueController.php';
require_once ROOT_PATH . '/controllers/InventoryItemController.php';
require_once ROOT_PATH . '/controllers/SpareController.php';
require_once ROOT_PATH . '/controllers/PurchaseController.php';
require_once ROOT_PATH . '/controllers/FundingController.php';
require_once ROOT_PATH . '/controllers/StampingController.php';
require_once ROOT_PATH . '/controllers/FollowupController.php';
require_once ROOT_PATH . '/controllers/DeliveryController.php';
require_once ROOT_PATH . '/controllers/CashBillController.php';

// Admin
require_once ROOT_PATH . '/middleware/AdminMiddleware.php';
require_once ROOT_PATH . '/controllers/admin/AdminUserController.php';
require_once ROOT_PATH . '/controllers/admin/AdminProductController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInvoiceController.php';
require_once ROOT_PATH . '/controllers/admin/HistoricalInvoiceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInvoiceProductController.php';
require_once ROOT_PATH . '/controllers/admin/AdminQueryController.php';
require_once ROOT_PATH . '/controllers/admin/AdminSettingsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPricingController.php';
require_once ROOT_PATH . '/controllers/admin/AdminExpenseController.php';
require_once ROOT_PATH . '/controllers/admin/AdminFinanceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminReportsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminEmployeeController.php';
require_once ROOT_PATH . '/controllers/admin/AdminAttendanceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPayrollController.php';
require_once ROOT_PATH . '/controllers/admin/AdminIncentiveController.php';
require_once ROOT_PATH . '/controllers/admin/AdminDcrController.php';
require_once ROOT_PATH . '/controllers/admin/AdminEmployeeAdvanceController.php';
require_once ROOT_PATH . '/helpers/GroqClient.php';
require_once ROOT_PATH . '/helpers/DataBridge.php';
require_once ROOT_PATH . '/controllers/ChatController.php';
require_once ROOT_PATH . '/controllers/admin/AdminNotificationController.php';
require_once ROOT_PATH . '/controllers/admin/AdminGstLookupController.php';
require_once ROOT_PATH . '/controllers/admin/AdminAttachmentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminImportController.php';
require_once ROOT_PATH . '/controllers/admin/AdminVendorController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPurchaseRequestController.php';
require_once ROOT_PATH . '/controllers/admin/AdminProcurementController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPurchaseOrderController.php';
require_once ROOT_PATH . '/controllers/admin/AdminGoodsReceiptController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInventoryController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryProductController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryZoneController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryStockController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryAllocationController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryMovementController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryIntelligenceController.php';
require_once ROOT_PATH . '/controllers/admin/ReorderIntelligenceController.php';
require_once ROOT_PATH . '/controllers/admin/InventoryApprovalController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPaymentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminInstallmentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminPoRegisterController.php';
require_once ROOT_PATH . '/controllers/admin/AdminSalesDocumentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminQuotationController.php';
require_once ROOT_PATH . '/controllers/admin/AdminQuotationComponentController.php';
require_once ROOT_PATH . '/controllers/admin/AdminTestCertificateController.php';
require_once ROOT_PATH . '/controllers/admin/AdminGstComplianceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminDealerController.php';
require_once ROOT_PATH . '/controllers/admin/AdminFinancePlanningController.php';
require_once ROOT_PATH . '/controllers/admin/AdminComplianceController.php';
require_once ROOT_PATH . '/controllers/admin/AdminAttendanceAnalyticsController.php';
require_once ROOT_PATH . '/controllers/admin/AdminHrImportController.php';
require_once ROOT_PATH . '/controllers/admin/AdminDataInteropController.php';

// --- Routes -------------------------------------------------------------------
$router = new Router();

// Auth - public
$router->post('/auth/register', [AuthController::class, 'register']);
$router->post('/auth/login',    [AuthController::class, 'login']);
$router->post('/auth/refresh',  [AuthController::class, 'refresh']);
$router->post('/auth/forgot-password', [AuthController::class, 'forgotPassword']);
$router->post('/auth/send-otp',        [AuthController::class, 'sendOtp']);
$router->post('/auth/verify-otp',      [AuthController::class, 'verifyOtp']);
$router->post('/auth/reset-password',  [AuthController::class, 'resetPassword']);
$router->post('/auth/logout',   [AuthController::class, 'logout'],  true);
$router->get('/auth/me',        [AuthController::class, 'me'],      true);

// Users
$router->get('/users/{id}',               [UserController::class, 'show'],           true);
$router->get('/users/email/{email}',      [UserController::class, 'findByEmail'],    'admin'); // was auth=true → leaked any user's PII
$router->put('/users/{id}',               [UserController::class, 'update'],         true);
$router->put('/users/{id}/password',      [UserController::class, 'changePassword'], true);
$router->delete('/users/{id}',            [UserController::class, 'deactivate'],     true);
$router->get('/users/{userId}/orders',    [UserController::class, 'orders'],         true);

// Products - public read
$router->get('/products',                              [ProductController::class, 'index']);
$router->get('/products/sub-purposes',                 [ProductController::class, 'subPurposes']);
$router->get('/products/{id}',                         [ProductController::class, 'show']);
$router->get('/products/{id}/configurations',          [ProductController::class, 'configurations']);
$router->get('/products/{id}/price',                   [ProductController::class, 'price']);   // ?size=8mm[&purpose=...]
$router->get('/products/{id}/sizes',                   [ProductController::class, 'sizes']);    // distinct available sizes

// Machines (requirement.txt — Module 1) — staff-only back-office module
$router->get('/machines',                            [MachineController::class, 'index'],        'admin');
$router->get('/machines/dispatch-recommendations',   [MachineController::class, 'dispatch'],     'admin'); // Module 4 (before {id})
$router->get('/machines/alerts',                     [MachineController::class, 'alerts'],       'admin'); // line 8 (before {id})
$router->get('/machines/catalog',                    [MachineController::class, 'catalog'],      'admin'); // dropdown/autofill (before {id})
$router->get('/machines/tax-summary',                [MachineController::class, 'taxSummary'],   'admin'); // lines 2,18 (before {id})
$router->post('/machines',                           [MachineController::class, 'store'],        'admin');
$router->get('/machines/{id}',                       [MachineController::class, 'show'],         'admin');
$router->put('/machines/{id}',                       [MachineController::class, 'update'],       'admin');
$router->put('/machines/{id}/status',                [MachineController::class, 'updateStatus'], 'admin');
$router->get('/machine-movements',                   [MachineController::class, 'movementsFeed'], 'admin'); // global feed (before {id})
$router->get('/machines/{id}/movements',             [MachineController::class, 'movements'],    'admin');
$router->get('/machines/{id}/parts',                 [MachineController::class, 'parts'],        'admin');
$router->post('/machines/{id}/parts',                [MachineController::class, 'addPart'],      'admin');
$router->put('/machines/{id}/parts/{partId}',        [MachineController::class, 'updatePart'],   'admin'); // edit part
$router->post('/machines/{id}/parts/{partId}/transfer', [MachineController::class, 'transferPart'], 'admin'); // Module 3
$router->post('/machines/{id}/convert/delivery',     [MachineController::class, 'convertToDelivery'], 'admin');
$router->post('/machines/{id}/convert/invoice',      [MachineController::class, 'convertToInvoice'],  'admin:owner,accountant'); // creates invoice+order (revenue)

// Stampings (requirement.txt — Module 2) — staff-only
$router->get('/stampings',               [StampingController::class, 'index'],        'admin');
$router->get('/stampings/due',           [StampingController::class, 'due'],          'admin'); // before {id}-style
$router->get('/stampings/alerts',        [StampingController::class, 'alerts'],       'admin'); // dashboard buckets
$router->post('/stampings',              [StampingController::class, 'store'],        'admin');
$router->put('/stampings/{id}/renew',    [StampingController::class, 'renew'],        'admin');
$router->put('/stampings/{id}/status',   [StampingController::class, 'updateStatus'], 'admin');
$router->put('/stampings/{id}/fee',      [StampingController::class, 'updateFee'],    'admin:owner,accountant'); // fee = money
$router->put('/stampings/{id}',          [StampingController::class, 'update'],       'admin'); // cert/date/notes (non-money)

// Machine Issues — service / fault tracking — staff-only
$router->get('/machine-issues',              [MachineIssueController::class, 'index'],   'admin');
$router->post('/machine-issues',             [MachineIssueController::class, 'store'],   'admin');
$router->get('/machine-issues/{id}',         [MachineIssueController::class, 'show'],    'admin');
$router->put('/machine-issues/{id}',         [MachineIssueController::class, 'update'],  'admin');
$router->put('/machine-issues/{id}/resolve', [MachineIssueController::class, 'resolve'], 'admin');
$router->put('/machine-issues/{id}/reopen',  [MachineIssueController::class, 'reopen'],  'admin');
$router->delete('/machine-issues/{id}',      [MachineIssueController::class, 'destroy'], 'admin');

// Purchases — vendor purchases (cash/credit) → posts an expense → P&L (owner/accountant for writes)
$router->get('/purchases/locations',    [PurchaseController::class, 'locations'],    'admin'); // before {id}
$router->get('/purchases',              [PurchaseController::class, 'index'],        'admin');
$router->post('/purchases',             [PurchaseController::class, 'store'],        'admin:owner,accountant');
$router->get('/purchases/{id}',         [PurchaseController::class, 'show'],         'admin');
$router->put('/purchases/{id}',         [PurchaseController::class, 'update'],       'admin:owner,accountant');
$router->post('/purchases/{id}/payment',[PurchaseController::class, 'payment'],      'admin:owner,accountant');
$router->delete('/purchases/{id}',      [PurchaseController::class, 'destroy'],      'admin:owner,accountant');

// Inventory Items — simple stock register — staff-only
$router->get('/inventory-items',        [InventoryItemController::class, 'index'],   'admin');
$router->post('/inventory-items',       [InventoryItemController::class, 'store'],   'admin');
$router->get('/inventory-items/{id}',   [InventoryItemController::class, 'show'],    'admin');
$router->put('/inventory-items/{id}',   [InventoryItemController::class, 'update'],  'admin');
$router->delete('/inventory-items/{id}',[InventoryItemController::class, 'destroy'], 'admin');

// Spares — spare-parts stock register with low-stock + forecast (R6 / T6) — staff-only
$router->get('/spares/low-stock',       [SpareController::class, 'lowStock'],  'admin'); // before {id}
$router->get('/spares/forecast',        [SpareController::class, 'forecast'],  'admin'); // before {id}
$router->get('/spares',                 [SpareController::class, 'index'],     'admin');
$router->post('/spares',                [SpareController::class, 'store'],     'admin');
$router->get('/spares/{id}',            [SpareController::class, 'show'],       'admin');
$router->put('/spares/{id}',            [SpareController::class, 'update'],     'admin');
$router->post('/spares/{id}/move',      [SpareController::class, 'move'],       'admin');
$router->delete('/spares/{id}',         [SpareController::class, 'destroy'],    'admin');

// Delivery challans (requirement.txt — lines 6, 8, 14) — staff-only
$router->get('/deliveries',              [DeliveryController::class, 'index'],        'admin');
$router->post('/deliveries',             [DeliveryController::class, 'store'],        'admin');
$router->get('/deliveries/{id}',         [DeliveryController::class, 'show'],         'admin');
$router->put('/deliveries/{id}/status',  [DeliveryController::class, 'updateStatus'], 'admin');

// Cash bills (Sri Vari Cash Bill F/SVS/34) — static routes before {id}
$router->get('/cash-bills',              [CashBillController::class, 'index'],        'admin');
$router->post('/cash-bills',             [CashBillController::class, 'store'],        'admin');
$router->get('/cash-bills/{id}',         [CashBillController::class, 'show'],         'admin');
$router->delete('/cash-bills/{id}',      [CashBillController::class, 'destroy'],      'admin');

// Follow-ups (requirement.txt — Module 6) — staff-only
$router->get('/followups',               [FollowupController::class, 'index'],        'admin');
$router->get('/followups/due',           [FollowupController::class, 'due'],          'admin');
$router->post('/followups',              [FollowupController::class, 'store'],        'admin');
$router->put('/followups/{id}',          [FollowupController::class, 'update'],       'admin');

// Orders
$router->get('/orders',          [OrderController::class, 'index'],         'admin');       // ALL orders → staff only (customers use /users/{id}/orders)
$router->post('/orders',         [OrderController::class, 'store'],         true);          // customer places their own order
$router->get('/orders/{id}',     [OrderController::class, 'show'],          true);          // handler enforces admin-or-owner
$router->put('/orders/{id}/status',         [OrderController::class, 'updateStatus'],        'admin');                  // fulfilment = staff
$router->put('/orders/{id}/payment',        [OrderController::class, 'updatePayment'],       'admin');
$router->put('/orders/{id}/payment-status', [OrderController::class, 'updatePaymentStatus'], 'admin:owner,accountant'); // marks paid → generates invoice
$router->put('/orders/{id}/refund-status',  [OrderController::class, 'updateRefundStatus'],  'admin:owner,accountant');

// Admin manual order entry (staff enter walk-in orders by hand — no customer app)
$router->post('/admin/orders/from-document', [OrderController::class, 'storeFromDocument'], 'admin'); // order from invoice/challan
$router->post('/admin/orders',   [OrderController::class, 'storeManual'], 'admin');

// Statistics — staff-only (aggregate revenue/sales/customer metrics)
$router->get('/statistics/orders',        [StatisticsController::class, 'orders'],       'admin');
$router->get('/statistics/active-orders', [StatisticsController::class, 'activeOrders'], 'admin');
$router->get('/statistics/overview',      [StatisticsController::class, 'overview'],     'admin');
$router->get('/statistics/employees',     [StatisticsController::class, 'employees'],    'admin');
$router->get('/statistics/sales',         [StatisticsController::class, 'sales'],        'admin');
$router->get('/statistics/revenue',       [StatisticsController::class, 'revenue'],      'admin');
$router->get('/statistics/customers',     [StatisticsController::class, 'customers'],    'admin');

// Public Queries
$router->post('/queries', [QueryController::class, 'store']); // Auth optional (handled if token sent? Actually without AuthMiddleware user is null but that's fine for guests)


// --- Admin Routes (auth = 'admin' -> AuthMiddleware + AdminMiddleware) ---------

// Admin Users
$router->get('/admin/users/pending',           [AdminUserController::class, 'pending'],    'admin');
$router->post('/admin/users/{id}/approve',     [AdminUserController::class, 'approve'],    'admin');
$router->post('/admin/users/{id}/reject',      [AdminUserController::class, 'reject'],     'admin');
$router->get('/admin/users/{id}/stats',        [AdminUserController::class, 'orderStats'], 'admin');
$router->get('/admin/users/{id}/orders',       [AdminUserController::class, 'customerOrders'], 'admin');
$router->get('/admin/users',                   [AdminUserController::class, 'index'],      'admin');
$router->put('/admin/users/{id}/status',       [AdminUserController::class, 'updateStatus'],'admin:owner'); // (de)activate accounts
$router->post('/admin/users',               [AdminUserController::class,    'store'],        'admin:owner');
$router->post('/admin/users/find-or-create',[AdminUserController::class,    'findOrCreate'], 'admin');
$router->put('/admin/users/{id}',           [AdminUserController::class,    'update'],       'admin:owner'); // can set staff_role → owner-only
$router->delete('/admin/users/{id}',        [AdminUserController::class,    'destroy'],      'admin:owner');

// Customer Intelligence (dealer-network routes removed)
$router->post('/admin/customers/merge',               [AdminDealerController::class, 'mergeCustomers'],        'admin:owner');
$router->get('/admin/customers/analytics/summary',    [AdminDealerController::class, 'analyticsSummary'],      'admin:owner,accountant,sales');
$router->post('/admin/customer-metrics/recompute',    [AdminDealerController::class, 'recomputeMetrics'],      'admin:owner,accountant');
$router->get('/admin/customers/{id}/analytics',       [AdminDealerController::class, 'customerAnalytics'],     'admin:owner,accountant,sales');

// Admin Products
$router->post('/admin/products',             [AdminProductController::class,  'store'],   'admin');
$router->put('/admin/products/{id}',         [AdminProductController::class,  'update'],  'admin');
$router->delete('/admin/products/{id}',      [AdminProductController::class,  'destroy'], 'admin');

// Admin Product Pricing (size-based configurations)
$router->get('/admin/products/{id}/configurations',          [AdminPricingController::class, 'index'],   'admin');
$router->post('/admin/products/{id}/configurations',         [AdminPricingController::class, 'store'],   'admin');
$router->put('/admin/products/{id}/configurations/{cid}',    [AdminPricingController::class, 'update'],  'admin');
$router->delete('/admin/products/{id}/configurations/{cid}', [AdminPricingController::class, 'destroy'], 'admin');

// Admin Procurement - Vendors
$router->get('/admin/vendors',                  [AdminVendorController::class, 'index'],       'admin');
$router->get('/admin/vendors/analytics',        [AdminVendorController::class, 'analytics'],   'admin');
$router->post('/admin/vendors',                 [AdminVendorController::class, 'store'],       'admin:owner,accountant');
$router->get('/admin/vendors/{id}/performance', [AdminVendorController::class, 'performance'], 'admin');
$router->get('/admin/vendors/{id}',             [AdminVendorController::class, 'show'],        'admin');
$router->put('/admin/vendors/{id}',             [AdminVendorController::class, 'update'],      'admin:owner,accountant');
$router->delete('/admin/vendors/{id}',          [AdminVendorController::class, 'destroy'],     'admin:owner,accountant');

// Admin Procurement - Purchase Requests
$router->get('/admin/procurement/cockpit',            [AdminProcurementController::class, 'cockpit'],        'admin');
$router->get('/admin/procurement/reorder',            [AdminProcurementController::class, 'reorder'],        'admin');
$router->get('/admin/procurement/product-insight',    [AdminProcurementController::class, 'productInsight'],  'admin');
$router->get('/admin/purchase-requests',              [AdminPurchaseRequestController::class, 'index'],   'admin');
$router->post('/admin/purchase-requests',             [AdminPurchaseRequestController::class, 'store'],   'admin:owner,accountant,store_keeper');
$router->get('/admin/purchase-requests/{id}',         [AdminPurchaseRequestController::class, 'show'],    'admin');
$router->put('/admin/purchase-requests/{id}',         [AdminPurchaseRequestController::class, 'update'],  'admin:owner,accountant,store_keeper');
$router->post('/admin/purchase-requests/{id}/submit', [AdminPurchaseRequestController::class, 'submit'],  'admin:owner,accountant,store_keeper');
$router->post('/admin/purchase-requests/{id}/approve',[AdminPurchaseRequestController::class, 'approve'], 'admin:owner,accountant');
$router->post('/admin/purchase-requests/{id}/reject', [AdminPurchaseRequestController::class, 'reject'],  'admin:owner,accountant');
$router->delete('/admin/purchase-requests/{id}',      [AdminPurchaseRequestController::class, 'destroy'], 'admin:owner,accountant,store_keeper');

// Admin Procurement - Purchase Orders and Goods Receipts
$router->get('/admin/purchase-orders',                    [AdminPurchaseOrderController::class, 'index'],      'admin');
$router->post('/admin/purchase-orders',                   [AdminPurchaseOrderController::class, 'store'],      'admin:owner,accountant');
$router->get('/admin/purchase-orders/{id}/pdf',           [AdminPurchaseOrderController::class, 'pdf'],        'admin');
$router->post('/admin/purchase-orders/{id}/issue',        [AdminPurchaseOrderController::class, 'issue'],      'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/cancel',       [AdminPurchaseOrderController::class, 'cancel'],     'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/short-close',  [AdminPurchaseOrderController::class, 'shortClose'], 'admin:owner');
$router->post('/admin/purchase-orders/{id}/bill',         [AdminPurchaseOrderController::class, 'bill'],       'admin:owner,accountant');
$router->post('/admin/purchase-orders/{id}/receipts',     [AdminPurchaseOrderController::class, 'receive'],    'admin:owner,store_keeper');
$router->get('/admin/purchase-orders/{id}/payments',      [AdminPaymentController::class, 'poPayments'],       'admin');
$router->post('/admin/purchase-orders/{id}/payments',     [AdminPaymentController::class, 'storeForPurchaseOrder'], 'admin:owner,accountant');
$router->get('/admin/purchase-orders/{id}',               [AdminPurchaseOrderController::class, 'show'],       'admin');
$router->put('/admin/purchase-orders/{id}',               [AdminPurchaseOrderController::class, 'update'],     'admin:owner,accountant');

$router->get('/admin/goods-receipts',                     [AdminGoodsReceiptController::class, 'index'],       'admin');
$router->get('/admin/goods-receipts/{id}',                [AdminGoodsReceiptController::class, 'show'],        'admin');
$router->post('/admin/goods-receipts/{id}/void',          [AdminGoodsReceiptController::class, 'void'],        'admin:owner');

// Admin Inventory
$router->get('/admin/inventory',                          [AdminInventoryController::class, 'index'],          'admin');
$router->get('/admin/inventory/valuation',                [AdminInventoryController::class, 'valuation'],      'admin');
$router->get('/admin/inventory/locations',                [AdminInventoryController::class, 'locations'],      'admin');
$router->post('/admin/inventory/adjustments',             [AdminInventoryController::class, 'adjustment'],     'admin:owner,store_keeper');
$router->post('/admin/inventory/reconcile',               [AdminInventoryController::class, 'reconcile'],      'admin:owner');
$router->get('/admin/inventory/{productId}/movements',    [AdminInventoryController::class, 'movements'],      'admin');

// Smart Inventory — Products (static routes before {id} so /search & literals win)
$router->get('/admin/inventory/products/search',          [InventoryProductController::class, 'search'],   'admin');
$router->get('/admin/inventory/products',                 [InventoryProductController::class, 'index'],    'admin');
$router->post('/admin/inventory/products',                [InventoryProductController::class, 'store'],    'admin:owner,store_keeper');
$router->get('/admin/inventory/products/{id}',            [InventoryProductController::class, 'show'],     'admin');
$router->put('/admin/inventory/products/{id}',            [InventoryProductController::class, 'update'],   'admin:owner,store_keeper');
$router->delete('/admin/inventory/products/{id}',         [InventoryProductController::class, 'destroy'],  'admin:owner,store_keeper');

// Smart Inventory — Zones (static routes before {id})
$router->get('/admin/inventory/zones/active',             [InventoryZoneController::class, 'getActive'],   'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/zones/distribution',       [InventoryAllocationController::class, 'getZoneDistribution'], 'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/zones',                    [InventoryZoneController::class, 'index'],       'admin:owner,store_keeper,accountant');
$router->post('/admin/inventory/zones',                   [InventoryZoneController::class, 'store'],       'admin:owner,store_keeper');
$router->get('/admin/inventory/zones/{id}',               [InventoryZoneController::class, 'show'],        'admin:owner,store_keeper,accountant');
$router->put('/admin/inventory/zones/{id}',               [InventoryZoneController::class, 'update'],      'admin:owner,store_keeper');

// Smart Inventory — Stock (static routes before {productId})
$router->post('/admin/inventory/stock/receive',           [InventoryStockController::class, 'receiveStock'],  'admin:owner,store_keeper');
$router->post('/admin/inventory/stock/quality-check',     [InventoryStockController::class, 'qualityCheck'],  'admin:owner,store_keeper');
$router->post('/admin/inventory/stock/bulk-import',       [InventoryStockController::class, 'bulkImport'],    'admin:owner,store_keeper');
$router->get('/admin/inventory/stock/low-stock',          [InventoryStockController::class, 'getLowStock'],   'admin');
$router->get('/admin/inventory/stock/{productId}',        [InventoryStockController::class, 'getProductStock'], 'admin');

// Smart Inventory — Allocation Engine (static routes before {productId})
$router->post('/admin/inventory/allocate',                [InventoryAllocationController::class, 'triggerAllocation'],   'admin:owner,store_keeper');
$router->post('/admin/inventory/allocate/manual',         [InventoryAllocationController::class, 'manualOverride'],      'admin:owner,store_keeper');
$router->get('/admin/inventory/allocate/pending',         [InventoryAllocationController::class, 'getPendingAllocations'], 'admin:owner,store_keeper');
$router->get('/admin/inventory/allocate/{productId}',     [InventoryAllocationController::class, 'getAllocationHistory'], 'admin:owner,store_keeper');

// Smart Inventory — Movement Engine
// (static + 2-segment routes registered before /movements/{id})
$router->get('/admin/inventory/movements',                       [InventoryMovementController::class, 'index'],            'admin');
$router->post('/admin/inventory/movements/employee-issue',       [InventoryMovementController::class, 'employeeIssue'],    'admin:owner,store_keeper,hr');
$router->post('/admin/inventory/movements/dealer-allocation',    [InventoryMovementController::class, 'dealerAllocation'], 'admin:owner,store_keeper,sales');
$router->post('/admin/inventory/movements/production-use',       [InventoryMovementController::class, 'productionUse'],    'admin:owner,store_keeper');
$router->post('/admin/inventory/movements/transfer',             [InventoryMovementController::class, 'zoneTransfer'],     'admin:owner,store_keeper');
$router->post('/admin/inventory/movements/damaged',              [InventoryMovementController::class, 'markDamaged'],      'admin:owner,store_keeper');
$router->post('/admin/inventory/movements/return',               [InventoryMovementController::class, 'processReturn'],    'admin:owner,store_keeper');
$router->post('/admin/inventory/movements/return-vendor',        [InventoryMovementController::class, 'returnToVendor'],   'admin:owner,store_keeper');
$router->post('/admin/inventory/movements/emergency',            [InventoryMovementController::class, 'emergencyUse'],     'admin:owner');
$router->post('/admin/inventory/movements/adjustment',           [InventoryMovementController::class, 'adjustment'],       'admin:owner');
$router->post('/admin/inventory/movements/cycle-count',          [InventoryMovementController::class, 'cycleCountAdjustment'], 'admin:owner,store_keeper');
$router->get('/admin/inventory/movements/pending-approvals',     [InventoryMovementController::class, 'pendingApprovals'], 'admin');
$router->get('/admin/inventory/movements/product/{productId}',   [InventoryMovementController::class, 'byProduct'],        'admin');
$router->get('/admin/inventory/movements/{id}',                  [InventoryMovementController::class, 'show'],             'admin');

// Smart Inventory — Intelligence Hub (static routes before {productId})
$router->get('/admin/inventory/intelligence/health-scores',      [InventoryIntelligenceController::class, 'getAllHealthScores'],     'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/health/{productId}', [InventoryIntelligenceController::class, 'getProductHealth'],       'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/dead-stock/value',   [InventoryIntelligenceController::class, 'getDeadStockValue'],      'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/dead-stock',         [InventoryIntelligenceController::class, 'getDeadStock'],           'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/runout/{productId}', [InventoryIntelligenceController::class, 'getProductRunout'],       'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/runout',             [InventoryIntelligenceController::class, 'getAllRunouts'],          'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/abnormal',           [InventoryIntelligenceController::class, 'getAbnormalMovements'],   'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/expiring',           [InventoryIntelligenceController::class, 'getExpiringBatches'],     'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/intelligence/summary',            [InventoryIntelligenceController::class, 'getIntelligenceSummary'], 'admin:owner,store_keeper,accountant');

// Smart Inventory — Intelligence Hub Part 2 (Reorder / Dealer Demand / Consumption)
// (static + deeper-segment routes registered before single-{param} routes)
$router->post('/admin/inventory/reorder/generate',                    [ReorderIntelligenceController::class, 'generateSuggestions'],     'admin:owner,store_keeper');
$router->get('/admin/inventory/reorder/suggestions',                  [ReorderIntelligenceController::class, 'getAllSuggestions'],       'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/suggestions/{id}',             [ReorderIntelligenceController::class, 'getSuggestion'],           'admin:owner,store_keeper,accountant');
$router->put('/admin/inventory/reorder/suggestions/{id}',             [ReorderIntelligenceController::class, 'updateSuggestionStatus'],  'admin:owner,store_keeper');
$router->get('/admin/inventory/reorder/dealer-demand',                [ReorderIntelligenceController::class, 'getDealerDemandProfiles'], 'admin:owner,store_keeper,accountant');
$router->post('/admin/inventory/reorder/dealer/update',               [ReorderIntelligenceController::class, 'updateDealerDemand'],      'admin:owner,store_keeper');
$router->get('/admin/inventory/reorder/dealer/{dealerId}',            [ReorderIntelligenceController::class, 'getDealerDemand'],         'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/consumption/breakdown/{id}',   [ReorderIntelligenceController::class, 'getConsumptionBreakdown'], 'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/consumption/{id}',             [ReorderIntelligenceController::class, 'getConsumptionTrends'],    'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/top-dealers',                  [ReorderIntelligenceController::class, 'getTopDealers'],           'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/top-departments',              [ReorderIntelligenceController::class, 'getTopDepartments'],       'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/heatmap/{productId}',          [ReorderIntelligenceController::class, 'getHeatmap'],              'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/reorder/forecast/{productId}',         [ReorderIntelligenceController::class, 'getForecast'],             'admin:owner,store_keeper,accountant');

// Smart Inventory — Approval Workflow (static routes + {id}/action before {id})
$router->get('/admin/inventory/approvals',                    [InventoryApprovalController::class, 'index'],     'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/approvals/pending',            [InventoryApprovalController::class, 'getPending'], 'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/approvals/stats',              [InventoryApprovalController::class, 'getStats'],  'admin:owner,store_keeper,accountant');
$router->get('/admin/inventory/approvals/history',            [InventoryApprovalController::class, 'getHistory'], 'admin:owner,store_keeper,accountant');
$router->post('/admin/inventory/approvals/escalate',          [InventoryApprovalController::class, 'escalate'],  'admin:owner,store_keeper');
$router->post('/admin/inventory/approvals/{id}/approve',      [InventoryApprovalController::class, 'approve'],   'admin:owner,store_keeper');
$router->post('/admin/inventory/approvals/{id}/reject',       [InventoryApprovalController::class, 'reject'],    'admin:owner,store_keeper');
$router->get('/admin/inventory/approvals/{id}',               [InventoryApprovalController::class, 'show'],      'admin:owner,store_keeper,accountant');

// Admin Historical (Past) Invoices — imported via Data Upload, stored separately
$router->get('/admin/historical-invoices',     [HistoricalInvoiceController::class, 'index'], 'admin');

// Admin Invoices
$router->get('/admin/invoices',                [AdminInvoiceController::class, 'index'],    'admin');
$router->post('/admin/invoices',               [AdminInvoiceController::class, 'store'],    'admin:owner,accountant');
$router->post('/admin/invoices/gst',           [AdminInvoiceController::class, 'storeGst'], 'admin:owner,accountant');
$router->get('/admin/invoices/{id}/download',  [AdminInvoiceController::class, 'download'], 'admin');
$router->get('/admin/invoices/{id}/payments',  [AdminPaymentController::class, 'invoicePayments'], 'admin');
$router->post('/admin/invoices/{id}/payments', [AdminPaymentController::class, 'storeForInvoice'], 'admin:owner,accountant');
$router->get('/admin/invoices/{id}',           [AdminInvoiceController::class, 'show'],     'admin');
$router->put('/admin/invoices/{id}',           [AdminInvoiceController::class, 'update'],   'admin:owner,accountant');
$router->delete('/admin/invoices/{id}',        [AdminInvoiceController::class, 'destroy'],  'admin:owner,accountant');

// Admin Sales Billing - Payments and Receivables
$router->get('/admin/payments',                [AdminPaymentController::class, 'index'],    'admin');
$router->post('/admin/payments',               [AdminPaymentController::class, 'store'],    'admin:owner,accountant');
$router->get('/admin/payments/{id}/receipt',   [AdminPaymentController::class, 'receipt'],  'admin');
$router->post('/admin/payments/{id}/void',     [AdminPaymentController::class, 'void'],     'admin:owner,accountant');
$router->get('/admin/payments/{id}',           [AdminPaymentController::class, 'show'],     'admin');
$router->get('/admin/receivables/ageing',      [AdminPaymentController::class, 'receivablesAgeing'], 'admin');

// Reusable installment ledger (R12 / T3) — advance + N installments per document
$router->get('/admin/installments',            [AdminInstallmentController::class, 'index'],   'admin');
$router->post('/admin/installments',           [AdminInstallmentController::class, 'store'],   'admin:owner,accountant');
$router->delete('/admin/installments/{id}',    [AdminInstallmentController::class, 'destroy'], 'admin:owner,accountant');

// Purchase Order register (R10 / T4) + single-page Total Outstanding widget
$router->get('/admin/outstanding',             [AdminPoRegisterController::class, 'outstanding'], 'admin'); // before {id}
$router->get('/admin/po-register',             [AdminPoRegisterController::class, 'index'],    'admin');
$router->post('/admin/po-register',            [AdminPoRegisterController::class, 'store'],    'admin:owner,accountant');
$router->get('/admin/po-register/{id}',        [AdminPoRegisterController::class, 'show'],     'admin');
$router->put('/admin/po-register/{id}',        [AdminPoRegisterController::class, 'update'],   'admin:owner,accountant');
$router->delete('/admin/po-register/{id}',     [AdminPoRegisterController::class, 'destroy'],  'admin:owner,accountant');

// Admin Sales Billing - Quotations and Proformas
$router->get('/admin/sales-documents',                 [AdminSalesDocumentController::class, 'index'],        'admin');
$router->post('/admin/sales-documents',                [AdminSalesDocumentController::class, 'store'],        'admin:owner,accountant,sales');
$router->get('/admin/sales-documents/{id}/document',   [AdminSalesDocumentController::class, 'documentData'], 'admin');
$router->post('/admin/sales-documents/{id}/send',      [AdminSalesDocumentController::class, 'send'],         'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/accept',    [AdminSalesDocumentController::class, 'accept'],       'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/reject',    [AdminSalesDocumentController::class, 'reject'],       'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/cancel',    [AdminSalesDocumentController::class, 'cancel'],       'admin:owner,accountant,sales');
$router->post('/admin/sales-documents/{id}/convert',   [AdminSalesDocumentController::class, 'convert'],      'admin:owner,accountant,sales');
$router->get('/admin/sales-documents/{id}',            [AdminSalesDocumentController::class, 'show'],         'admin');
$router->put('/admin/sales-documents/{id}',            [AdminSalesDocumentController::class, 'update'],       'admin:owner,accountant,sales');

// Operations - Quotation Builder (pick-and-play quotations + branded PDF)
$router->get('/admin/quotations',          [AdminQuotationController::class, 'index'],   'admin');
$router->post('/admin/quotations',         [AdminQuotationController::class, 'store'],   'admin:owner,accountant,sales');
$router->get('/admin/quotations/{id}',     [AdminQuotationController::class, 'show'],    'admin');
$router->put('/admin/quotations/{id}',     [AdminQuotationController::class, 'update'],  'admin:owner,accountant,sales');
$router->delete('/admin/quotations/{id}',  [AdminQuotationController::class, 'destroy'], 'admin:owner,accountant,sales');

// Admin Quotation Builder - Component Library
$router->get('/admin/quotation-components',        [AdminQuotationComponentController::class, 'index'],     'admin');
$router->post('/admin/quotation-components',       [AdminQuotationComponentController::class, 'store'],     'admin:owner,accountant,sales');
$router->post('/admin/quotation-components/bulk',  [AdminQuotationComponentController::class, 'bulkStore'], 'admin:owner,accountant,sales');
$router->delete('/admin/quotation-components/{id}',[AdminQuotationComponentController::class, 'destroy'],   'admin:owner,accountant,sales');

// Admin Sales Billing - Test Certificates
$router->get('/admin/test-certificates',                    [AdminTestCertificateController::class, 'index'],           'admin');
$router->post('/admin/test-certificates',                   [AdminTestCertificateController::class, 'store'],           'admin:owner,store_keeper,sales');
$router->get('/admin/test-certificates/{id}/document',      [AdminTestCertificateController::class, 'certificateData'], 'admin');
$router->post('/admin/test-certificates/{id}/document',     [AdminTestCertificateController::class, 'uploadDocument'],  'admin:owner,store_keeper,sales');
$router->get('/admin/test-certificates/{id}/download',      [AdminTestCertificateController::class, 'downloadDocument'],'admin');
$router->post('/admin/test-certificates/{id}/issue',        [AdminTestCertificateController::class, 'issue'],           'admin:owner,store_keeper,sales');
$router->post('/admin/test-certificates/{id}/void',         [AdminTestCertificateController::class, 'void'],            'admin:owner');
$router->get('/admin/test-certificates/{id}',               [AdminTestCertificateController::class, 'show'],            'admin');
$router->put('/admin/test-certificates/{id}',               [AdminTestCertificateController::class, 'update'],          'admin:owner,store_keeper,sales');

// Admin GST Compliance
$router->get('/admin/gst-compliance',                       [AdminGstComplianceController::class, 'index'],     'admin:owner,accountant');
$router->get('/admin/gst-compliance/calculate',             [AdminGstComplianceController::class, 'calculate'], 'admin:owner,accountant');
$router->get('/admin/gst-compliance/{period}/export',       [AdminGstComplianceController::class, 'export'],    'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/save',        [AdminGstComplianceController::class, 'save'],      'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/review',      [AdminGstComplianceController::class, 'review'],    'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/file',        [AdminGstComplianceController::class, 'file'],      'admin:owner,accountant');
$router->post('/admin/gst-compliance/{period}/lock',        [AdminGstComplianceController::class, 'lock'],      'admin:owner');
$router->get('/admin/gst-compliance/{period}',              [AdminGstComplianceController::class, 'show'],      'admin:owner,accountant');

$router->get('/admin/invoice-products',        [AdminInvoiceProductController::class, 'index'],   'admin');
$router->post('/admin/invoice-products',       [AdminInvoiceProductController::class, 'store'],   'admin:owner,accountant,sales');
$router->put('/admin/invoice-products/{id}',   [AdminInvoiceProductController::class, 'update'],  'admin:owner,accountant,sales');
$router->delete('/admin/invoice-products/{id}',[AdminInvoiceProductController::class, 'destroy'], 'admin:owner,accountant,sales');

// Admin Expenses
$router->get('/admin/expenses/analytics',       [AdminFinancePlanningController::class, 'expenseAnalytics'], 'admin:owner,accountant');
$router->get('/admin/expenses',                [AdminExpenseController::class, 'index'],       'admin');
$router->get('/admin/expenses/summary',        [AdminExpenseController::class, 'summary'],     'admin');
$router->get('/admin/expenses/categories',     [AdminExpenseController::class, 'categories'],  'admin');
$router->post('/admin/expenses/extract-bill',  [AdminExpenseController::class, 'extractBill'], 'admin:owner,accountant');
$router->get('/admin/expenses/{id}',           [AdminExpenseController::class, 'show'],        'admin');
$router->post('/admin/expenses',               [AdminExpenseController::class, 'store'],       'admin:owner,accountant');
$router->put('/admin/expenses/{id}',           [AdminExpenseController::class, 'update'],      'admin:owner,accountant');
$router->delete('/admin/expenses/{id}',        [AdminExpenseController::class, 'destroy'],     'admin:owner,accountant');

// Admin Finance (Profit & Loss, Ratios, Config)
$router->get('/admin/finance/overlay',          [AdminFinancePlanningController::class, 'overlay'],       'admin:owner,accountant');
$router->get('/admin/finance/pnl',             [AdminFinanceController::class, 'pnl'],          'admin');
$router->get('/admin/finance/statements',      [AdminFinanceController::class, 'statements'],   'admin');
$router->get('/funding',                        [FundingController::class, 'index'],   'admin');
$router->post('/funding',                       [FundingController::class, 'store'],   'admin:owner,accountant'); // capital/loan ledger → Balance Sheet
$router->delete('/funding/{id}',                [FundingController::class, 'destroy'], 'admin:owner,accountant');
$router->get('/admin/finance/ratios',          [AdminFinanceController::class, 'ratios'],       'admin');
$router->get('/admin/finance/config',          [AdminFinanceController::class, 'config'],       'admin');
$router->put('/admin/finance/config',          [AdminFinanceController::class, 'updateConfig'], 'admin');
$router->get('/admin/finance/inventory-valuation',      [AdminFinanceController::class, 'inventoryValuation'],     'admin:owner,accountant');
$router->get('/admin/finance/inventory-value-movement', [AdminFinanceController::class, 'inventoryValueMovement'], 'admin:owner,accountant');
$router->get('/admin/finance/damaged-stock-writeoff',   [AdminFinanceController::class, 'damagedStockWriteoff'],   'admin:owner,accountant');

// Admin Finance Planning - Budgets and Benchmarks
$router->get('/admin/budgets',                  [AdminFinancePlanningController::class, 'budgets'],        'admin:owner,accountant');
$router->post('/admin/budgets',                 [AdminFinancePlanningController::class, 'createBudget'],   'admin:owner,accountant');
$router->get('/admin/budgets/{id}/vs-actual',   [AdminFinancePlanningController::class, 'budgetVsActual'], 'admin:owner,accountant');
$router->get('/admin/budgets/{id}',             [AdminFinancePlanningController::class, 'showBudget'],     'admin:owner,accountant');
$router->put('/admin/budgets/{id}',             [AdminFinancePlanningController::class, 'updateBudget'],   'admin:owner,accountant');
$router->get('/admin/benchmarks/status',        [AdminFinancePlanningController::class, 'benchmarkStatus'], 'admin:owner,accountant');
$router->get('/admin/benchmarks',               [AdminFinancePlanningController::class, 'benchmarks'],      'admin:owner,accountant');
$router->post('/admin/benchmarks',              [AdminFinancePlanningController::class, 'saveBenchmark'],   'admin:owner,accountant');

// Notifications
$router->get('/admin/notifications',           [AdminNotificationController::class, 'index'],   'admin');

// GST Lookup
$router->get('/admin/gst-lookup',              [AdminGstLookupController::class,   'lookup'],   'admin');


// Admin Reports
$router->get('/admin/reports/analytics',        [AdminFinancePlanningController::class, 'reportsAnalytics'], 'admin:owner,accountant');
$router->get('/admin/reports',                 [AdminReportsController::class, 'index'],        'admin');
$router->get('/admin/reports/inventory/stock-summary',      [AdminReportsController::class, 'inventoryStockSummary'],     'admin:owner,store_keeper,accountant');
$router->get('/admin/reports/inventory/movement-report',    [AdminReportsController::class, 'inventoryMovementReport'],   'admin:owner,store_keeper,accountant');
$router->get('/admin/reports/inventory/valuation-report',   [AdminReportsController::class, 'inventoryValuationReport'],  'admin:owner,store_keeper,accountant');
$router->get('/admin/reports/inventory/dealer-consumption', [AdminReportsController::class, 'inventoryDealerConsumption'],'admin:owner,store_keeper,accountant');
$router->get('/admin/reports/inventory/zone-analysis',      [AdminReportsController::class, 'inventoryZoneAnalysis'],     'admin:owner,store_keeper,accountant');

// Admin Quote Requests

// Admin Queries
$router->get('/admin/queries',              [AdminQueryController::class,    'index'],        'admin');
$router->post('/admin/queries',             [AdminQueryController::class,    'store'],        'admin');
$router->get('/admin/queries/{id}',         [AdminQueryController::class,    'show'],         'admin');
$router->put('/admin/queries/{id}/reply',   [AdminQueryController::class,    'reply'],        'admin');

// Admin FAQs (reorder must be before /{id} to avoid route collision)

// Admin Settings
$router->get('/admin/settings',             [AdminSettingsController::class, 'show'],         'admin');
$router->put('/admin/settings',             [AdminSettingsController::class, 'update'],       'admin:owner'); // bank account / GST rate / prefixes

// Admin Attachments
$router->get('/admin/attachments/{id}/download', [AdminAttachmentController::class, 'download'], 'admin');
$router->delete('/admin/attachments/{id}',        [AdminAttachmentController::class, 'destroy'],  'admin');

// Admin Import Engine
$router->get('/admin/import-jobs',              [AdminImportController::class, 'index'],  'admin:owner,accountant,hr');
$router->post('/admin/import-jobs',             [AdminImportController::class, 'store'],  'admin:owner,accountant,hr');
$router->get('/admin/import-jobs/{id}',         [AdminImportController::class, 'show'],   'admin:owner,accountant,hr');
$router->post('/admin/import-jobs/{id}/dry-run',[AdminImportController::class, 'dryRun'], 'admin:owner,accountant,hr');
$router->post('/admin/import-jobs/{id}/commit', [AdminImportController::class, 'commit'], 'admin:owner,accountant,hr');
$router->get('/admin/import-jobs/{id}/errors',  [AdminImportController::class, 'errors'], 'admin:owner,accountant,hr');

// Import-mapping support for the HR Import Wizard (CSV template + AI column mapping).
// The standalone Data Interop module was removed; these two endpoints remain because
// Employees/Attendance imports still rely on them.
$router->get('/admin/import/{module}/template',       [AdminDataInteropController::class, 'template'],    'admin:owner,accountant,hr');
$router->post('/admin/import/{module}/{job}/ai-map',  [AdminDataInteropController::class, 'aiMap'],       'admin:owner,accountant,hr');

// ─── Admin Employees ─────────────────────────────────────────────────────────
$router->get('/admin/employees',                      [AdminEmployeeController::class, 'index'],        'admin');
$router->post('/admin/employees/import',              [AdminHrImportController::class, 'employeeImport'],'admin:owner,hr');
$router->get('/admin/employees/import/{job}/errors',  [AdminHrImportController::class, 'employeeImportErrors'], 'admin:owner,hr');
$router->get('/admin/employees/{key}/compliance',     [AdminComplianceController::class, 'employeeRecords'], 'admin:owner,hr');
$router->post('/admin/employees/{key}/compliance',    [AdminComplianceController::class, 'storeForEmployee'], 'admin:owner,hr');
$router->get('/admin/employees/{id}/qr',              [AdminEmployeeController::class, 'qr'],           'admin');
$router->get('/admin/employees/{id}/profile',         [AdminEmployeeController::class, 'profile'],      'admin');
$router->get('/admin/employees/{id}/photo',           [AdminEmployeeController::class, 'photo'],        'admin');
$router->get('/admin/employees/{id}/insurance',       [AdminEmployeeController::class, 'insurance'],    'admin');
$router->get('/admin/employees/{id}/inventory-consumption', [AdminEmployeeController::class, 'inventoryConsumption'], 'admin');
$router->get('/admin/employees/{id}',                 [AdminEmployeeController::class, 'show'],         'admin');
$router->post('/admin/employees',                     [AdminEmployeeController::class, 'store'],        'admin');
$router->post('/admin/employees/{id}',                [AdminEmployeeController::class, 'update'],       'admin');
$router->put('/admin/employees/{id}/status',          [AdminEmployeeController::class, 'updateStatus'], 'admin');
$router->put('/admin/employees/{id}',                 [AdminEmployeeController::class, 'update'],       'admin');
$router->patch('/admin/employees/{id}',               [AdminEmployeeController::class, 'update'],       'admin');
$router->delete('/admin/employees/{id}',              [AdminEmployeeController::class, 'destroy'],      'admin');

// ─── Admin Attendance ────────────────────────────────────────────────────────
$router->get('/admin/attendance/analytics',           [AdminAttendanceAnalyticsController::class, 'analytics'], 'admin:owner,hr');
$router->get('/admin/attendance/anomalies',           [AdminAttendanceAnalyticsController::class, 'anomalies'], 'admin:owner,hr');
$router->post('/admin/attendance/import',             [AdminHrImportController::class, 'attendanceImport'], 'admin:owner,hr');
$router->get('/admin/attendance/import/{job}/errors', [AdminHrImportController::class, 'attendanceImportErrors'], 'admin:owner,hr');
$router->get('/admin/attendance',                     [AdminAttendanceController::class, 'index'],      'admin');
$router->get('/admin/attendance/cutoff', [AdminAttendanceController::class, 'cutoff'], 'admin');
$router->get('/admin/attendance/shifts',              [AdminAttendanceController::class, 'shifts'],     'admin');
$router->post('/admin/attendance/shifts',             [AdminAttendanceController::class, 'storeShift'], 'admin');
$router->put('/admin/attendance/shifts/{id}',         [AdminAttendanceController::class, 'updateShift'], 'admin');
$router->get('/admin/attendance/report',              [AdminAttendanceController::class, 'report'],     'admin');
$router->get('/admin/attendance/summary',             [AdminAttendanceController::class, 'summary'],    'admin');
$router->get('/admin/attendance/employee/{id}',       [AdminAttendanceController::class, 'byEmployee'], 'admin');
$router->post('/admin/attendance/scan',               [AdminAttendanceController::class, 'scan'],       'admin');
$router->post('/admin/attendance/manual',              [AdminAttendanceController::class, 'manual'],    'admin');
$router->post('/admin/attendance/check-in',           [AdminAttendanceController::class, 'checkIn'],    'admin');
$router->post('/admin/attendance/check-out',          [AdminAttendanceController::class, 'checkOut'],   'admin');
$router->post('/admin/attendance/auto-mark-absent',   [AdminAttendanceController::class, 'autoMarkAbsent'], 'admin');
$router->put('/admin/attendance/{id}',                [AdminAttendanceController::class, 'update'],     'admin');
$router->delete('/admin/attendance/{id}',             [AdminAttendanceController::class, 'destroy'],    'admin');

// ─── Admin Payroll ───────────────────────────────────────────────────────────
$router->get('/admin/payroll',                        [AdminPayrollController::class, 'index'],    'admin');
$router->get('/admin/payroll/report',                 [AdminPayrollController::class, 'report'],   'admin');
$router->get('/admin/payroll/{id}/history',           [AdminPayrollController::class, 'history'],  'admin');
$router->get('/admin/payroll/{id}',                   [AdminPayrollController::class, 'show'],     'admin');
$router->post('/admin/payroll/run',                   [AdminPayrollController::class, 'run'],      'admin:owner,accountant,hr');
$router->post('/admin/payroll/calculate',             [AdminPayrollController::class, 'calculate'],'admin:owner,accountant,hr');
$router->post('/admin/payroll/process',               [AdminPayrollController::class, 'process'],  'admin:owner,accountant,hr');

// ─── Admin Incentive Payments (R7 / T10) — output-based pay, separate from payroll
$router->get('/admin/incentives',                     [AdminIncentiveController::class, 'index'],   'admin');
$router->post('/admin/incentives',                    [AdminIncentiveController::class, 'store'],   'admin:owner,accountant,hr');
$router->get('/admin/incentives/{id}',                [AdminIncentiveController::class, 'show'],    'admin');
$router->put('/admin/incentives/{id}',                [AdminIncentiveController::class, 'update'],  'admin:owner,accountant,hr');
$router->post('/admin/incentives/{id}/pay',           [AdminIncentiveController::class, 'pay'],     'admin:owner,accountant,hr');
$router->delete('/admin/incentives/{id}',             [AdminIncentiveController::class, 'destroy'], 'admin:owner,accountant,hr');

// ─── Admin Daily Call Report (R13 / T11) — field visits → leads
$router->get('/admin/dcr',                            [AdminDcrController::class, 'index'],    'admin');
$router->get('/admin/dcr/areas',                      [AdminDcrController::class, 'areas'],    'admin');
$router->post('/admin/dcr',                           [AdminDcrController::class, 'store'],    'admin:owner,accountant,hr,sales');
$router->post('/admin/dcr/extract',                   [AdminDcrController::class, 'extract'],  'admin:owner,accountant,hr,sales');
$router->get('/admin/dcr/{id}',                       [AdminDcrController::class, 'show'],     'admin');
$router->put('/admin/dcr/{id}',                       [AdminDcrController::class, 'update'],   'admin:owner,accountant,hr,sales');
$router->post('/admin/dcr/{id}/approve',              [AdminDcrController::class, 'approve'],  'admin:owner,accountant,hr');
$router->delete('/admin/dcr/{id}',                    [AdminDcrController::class, 'destroy'],  'admin:owner,accountant,hr');

// ─── Admin Employee Advances ────────────────────────────────────────────────
$router->get('/admin/employee-advances',              [AdminEmployeeAdvanceController::class, 'index'],   'admin');
$router->post('/admin/employee-advances',             [AdminEmployeeAdvanceController::class, 'store'],   'admin:owner,accountant,hr');
$router->put('/admin/employee-advances/{id}',         [AdminEmployeeAdvanceController::class, 'update'],  'admin:owner,accountant,hr');
$router->delete('/admin/employee-advances/{id}',      [AdminEmployeeAdvanceController::class, 'destroy'], 'admin:owner,accountant,hr');

// ─── Admin Meetings ──────────────────────────────────────────────────────────

// ─── Admin HR Compliance ─────────────────────────────────────────────────────
$router->get('/admin/compliance/expiring',      [AdminComplianceController::class, 'expiring'],      'admin:owner,hr');
$router->get('/admin/compliance',               [AdminComplianceController::class, 'index'],         'admin:owner,hr');
$router->get('/admin/compliance/{id}/download', [AdminComplianceController::class, 'download'],      'admin:owner,hr');
$router->put('/admin/compliance/{id}',          [AdminComplianceController::class, 'update'],        'admin:owner,hr');
$router->delete('/admin/compliance/{id}',       [AdminComplianceController::class, 'destroy'],       'admin:owner,hr');

// ─── Admin SOPs ───────────────────────────────────────────────────────────────

// ─── Admin Workflows ─────────────────────────────────────────────────────────

// ─── Chat (staff assistant over business data — must be authenticated) ────────
$router->post('/chat',              [ChatController::class, 'send'],    'admin');
$router->get('/chat/history',       [ChatController::class, 'history'], 'admin');
$router->get('/chat/debug',         [ChatController::class, 'debug'],   'admin:owner'); // diagnostics; also stops leaking key prefix (see ChatController)
$router->get('/admin/chat/sessions',[ChatController::class, 'sessions'], 'admin');

// --- Rate limiting (before dispatch) ------------------------------------------
// Strict per-IP buckets on the brute-force surface (login / register / OTP /
// password reset), plus a general per-IP limiter on everything else.
// DISABLED per operational decision (2026-07-16): kept in the codebase but not
// invoked, so no per-IP throttling is active. Flip $_RATE_LIMIT_ENABLED to true
// when doing a deliberate security-hardening release.
$_RATE_LIMIT_ENABLED = false;
if ($_RATE_LIMIT_ENABLED) {
    $_rlMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $_rlPath   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
    $_rlPath   = preg_replace('#^/api#', '', $_rlPath) ?? $_rlPath;
    $_rlPath   = rtrim($_rlPath, '/') ?: '/';

    if ($_rlMethod === 'POST') {
        if ($_rlPath === '/auth/login') {
            RateLimitMiddleware::loginLimit();
        } elseif ($_rlPath === '/auth/register') {
            RateLimitMiddleware::registerLimit();
        } elseif (in_array($_rlPath, ['/auth/forgot-password', '/auth/send-otp', '/auth/verify-otp', '/auth/reset-password'], true)) {
            RateLimitMiddleware::otpLimit();
        }
    }
    RateLimitMiddleware::handle(); // general per-IP limiter
    unset($_rlMethod, $_rlPath);
}

// Dispatch
$router->dispatch();
