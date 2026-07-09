/**
 * Smart Inventory API client (Prompts 2–7 backend).
 * Layers: Products, Zones, Stock, Movements, Intelligence, Reorder, Approvals.
 * Mirrors the phase2 client conventions: apiFetch<Envelope<T>>, qs(), data()/rows().
 */
import { apiFetch } from "./client";

export type ApiRow = Record<string, unknown>;

type Envelope<T> = { success: boolean; message?: string; data: T; pagination?: ApiRow };
type Paginated<T> = { success: boolean; data: T[]; pagination?: Pagination };

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

function qs(params: Record<string, string | number | undefined | null> = {}): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function data<T>(res: Envelope<T>): T {
  return res.data;
}

async function get<T>(path: string): Promise<T> {
  return data(await apiFetch<Envelope<T>>(path));
}

async function getList<T = ApiRow>(path: string): Promise<T[]> {
  const res = await apiFetch<Paginated<T> | Envelope<T[]>>(path);
  const d = (res as Envelope<T[]>).data;
  return Array.isArray(d) ? d : [];
}

async function post<T = ApiRow>(path: string, body: ApiRow | FormData = {}): Promise<T> {
  const init: RequestInit = body instanceof FormData
    ? { method: "POST", body }
    : { method: "POST", body: JSON.stringify(body) };
  return data(await apiFetch<Envelope<T>>(path, init));
}

async function put<T = ApiRow>(path: string, body: ApiRow = {}): Promise<T> {
  return data(await apiFetch<Envelope<T>>(path, { method: "PUT", body: JSON.stringify(body) }));
}

async function del(path: string): Promise<void> {
  await apiFetch(path, { method: "DELETE" });
}

// ── Domain types ────────────────────────────────────────────────────────────

export interface InvProduct {
  inv_product_id: number;
  name: string;
  sku: string;
  category: string | null;
  uom: string;
  hsn_code: string | null;
  reorder_level: string;
  reorder_quantity: string;
  standard_cost: string;
  selling_price: string;
  is_active: number;
  is_deleted: number;
  current_quantity?: string;
  available_quantity?: string;
  health_score?: string;
  created_at?: string;
  updated_at?: string;
}

export interface InvZone {
  zone_id: number;
  zone_name: string;
  zone_code: string;
  zone_type: string;
  warehouse_location: string | null;
  capacity: string;
  is_active: number;
  current_quantity?: string;
}

export interface InvMovement {
  movement_id: number;
  approval_id?: number;
  inv_product_id: number;
  zone_id: number;
  movement_type: string;
  quantity: string;
  unit_cost: string;
  total_value: string;
  approval_status: string;
  remarks: string | null;
  created_at: string;
  product_name?: string;
  sku?: string;
  zone_name?: string;
  zone_code?: string;
  moved_by_name?: string;
}

export interface InvApproval {
  approval_id: number;
  approval_type: string;
  movement_id: number;
  movement_type?: string;
  product?: string;
  sku?: string;
  quantity?: number;
  total_value?: number;
  requested_by?: string;
  requested_at?: string;
  hours_pending?: number;
  is_overdue?: boolean;
  remarks?: string | null;
}

export interface ApprovalStats {
  total_pending: number;
  total_approved_today: number;
  total_rejected_today: number;
  avg_approval_time_hours: number;
  overdue_approvals: number;
  by_type: Record<string, { pending: number; approved: number }>;
}

export interface IntelligenceSummary {
  generated_at: string;
  overview: { total_products: number; healthy: number; warning: number; at_risk: number; critical: number };
  dead_stock: { total_products: number; total_value: number; write_off_candidates: number };
  runout_risks: { critical: number; high: number; medium: number };
  abnormal_movements: { flagged_last_7_days: number; high_severity: number };
  top_risks: { product: string; risk: string; action: string }[];
}

export interface HealthScore {
  product_id: number;
  product_name: string;
  sku: string;
  health_score: number;
  risk_level: string;
  breakdown: Record<string, number>;
}

export interface DeadStockItem {
  product_id: number;
  product_name: string;
  sku: string;
  quantity_stuck: number;
  days_since_movement: number;
  estimated_value: number;
  severity: string;
  suggested_action: string;
}

export interface RunoutPrediction {
  product_id: number;
  product_name: string;
  sku: string;
  current_stock: number;
  avg_daily_consumption: number;
  days_until_stockout: number | null;
  predicted_stockout_date: string | null;
  risk_level: string;
  suggested_reorder_qty: number;
}

export interface AbnormalMovement {
  movement_id: number;
  product_name: string;
  sku: string;
  movement_type: string;
  quantity: number;
  total_value: number;
  zone_name: string;
  zone_type: string;
  created_at: string;
  flag_reasons: string[];
  severity: string;
  recommended_action: string;
}

export interface ExpiringBatch {
  movement_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  uom: string;
  batch_number: string | null;
  expiry_date: string;
  quantity: number;
  days_until_expiry: number;
  zone_name: string | null;
}

export interface ReorderSuggestion {
  suggestion_id: number;
  inv_product_id: number;
  product_name?: string;
  sku?: string;
  current_stock: string;
  reorder_level: string;
  suggested_quantity: string;
  prediction_basis: string;
  status: string;
  created_at: string;
}

export interface DealerDemandProfile {
  demand_id: number;
  dealer_id: number;
  dealer: string;
  inv_product_id: number;
  product: string;
  avg_monthly_consumption: string;
  last_order_date: string | null;
  predicted_next_order_date: string | null;
  suggested_reserve_qty: string;
  confidence_score: string;
}

export interface AllocationResultData {
  product_id?: number;
  allocations?: { zone_name?: string; zone_type?: string; quantity?: number }[];
  [key: string]: unknown;
}

// ── Products ────────────────────────────────────────────────────────────────

export const getInventoryProducts = (filters?: {
  search?: string; category?: string; status?: string; page?: number; limit?: number;
}) => getList<InvProduct>(`/admin/inventory/products${qs(filters)}`);

export const createInventoryProduct = (payload: ApiRow) =>
  post<InvProduct>("/admin/inventory/products", payload);

export const updateInventoryProduct = (id: number, payload: ApiRow) =>
  put<InvProduct>(`/admin/inventory/products/${id}`, payload);

export const deleteInventoryProduct = (id: number) =>
  del(`/admin/inventory/products/${id}`);

export const searchInventoryProducts = (query: string) =>
  getList<InvProduct>(`/admin/inventory/products/search${qs({ q: query })}`);

// ── Zones ───────────────────────────────────────────────────────────────────

export const getInventoryZones = () => getList<InvZone>("/admin/inventory/zones");

export const createInventoryZone = (payload: ApiRow) =>
  post<InvZone>("/admin/inventory/zones", payload);

export const updateInventoryZone = (id: number, payload: ApiRow) =>
  put<InvZone>(`/admin/inventory/zones/${id}`, payload);

export const getZoneDistribution = (productId?: number) =>
  get<ApiRow>(`/admin/inventory/zones/distribution${qs({ product_id: productId })}`);

// ── Stock ───────────────────────────────────────────────────────────────────

export const receiveStock = (payload: ApiRow) =>
  post("/admin/inventory/stock/receive", payload);

export const getLowStock = () => getList("/admin/inventory/stock/low-stock");

export const getProductStock = (productId: number) =>
  get<ApiRow>(`/admin/inventory/stock/${productId}`);

export const triggerAllocation = (payload: ApiRow) =>
  post<AllocationResultData>("/admin/inventory/allocate", payload);

export const getAllocationHistory = (productId: number) =>
  get<AllocationResultData>(`/admin/inventory/allocate/${productId}`);

// ── Movements ───────────────────────────────────────────────────────────────

export const getMovements = (filters?: {
  movement_type?: string; product_id?: number; approval_status?: string;
  date_from?: string; date_to?: string; page?: number; limit?: number;
}) => getList<InvMovement>(`/admin/inventory/movements${qs(filters)}`);

export const issueToEmployee = (payload: ApiRow) =>
  post("/admin/inventory/movements/employee-issue", payload);

export const allocateToDealer = (payload: ApiRow) =>
  post("/admin/inventory/movements/dealer-allocation", payload);

export const recordProductionUse = (payload: ApiRow) =>
  post("/admin/inventory/movements/production-use", payload);

export const transferZones = (payload: ApiRow) =>
  post("/admin/inventory/movements/transfer", payload);

export const markDamaged = (payload: ApiRow | FormData) =>
  post("/admin/inventory/movements/damaged", payload);

export const emergencyUse = (payload: ApiRow) =>
  post("/admin/inventory/movements/emergency", payload);

export const returnToVendor = (payload: ApiRow) =>
  post("/admin/inventory/movements/return-vendor", payload);

export const cycleCountAdjust = (payload: ApiRow) =>
  post("/admin/inventory/movements/cycle-count", payload);

export const getMovementPendingApprovals = () =>
  getList<InvMovement>("/admin/inventory/movements/pending-approvals");

// ── Intelligence ────────────────────────────────────────────────────────────

export const getIntelligenceSummary = () =>
  get<IntelligenceSummary>("/admin/inventory/intelligence/summary");

export const getHealthScores = () =>
  get<HealthScore[]>("/admin/inventory/intelligence/health-scores");

export const getDeadStock = (days?: number) =>
  get<DeadStockItem[]>(`/admin/inventory/intelligence/dead-stock${qs({ days })}`);

export const getRunoutPredictions = () =>
  get<RunoutPrediction[]>("/admin/inventory/intelligence/runout");

export const getAbnormalMovements = (days?: number) =>
  get<AbnormalMovement[]>(`/admin/inventory/intelligence/abnormal${qs({ days })}`);

export const getExpiringBatches = (days?: number) =>
  get<ExpiringBatch[]>(`/admin/inventory/intelligence/expiring${qs({ days })}`);

// ── Reorder ─────────────────────────────────────────────────────────────────

export const getReorderSuggestions = (status?: string) =>
  getList<ReorderSuggestion>(`/admin/inventory/reorder/suggestions${qs({ status })}`);

export const generateReorderSuggestions = () =>
  post<ReorderSuggestion[]>("/admin/inventory/reorder/generate");

export const getDealerDemandProfiles = () =>
  get<DealerDemandProfile[]>("/admin/inventory/reorder/dealer-demand");

// ── Approvals ───────────────────────────────────────────────────────────────

export const getPendingApprovals = () =>
  get<InvApproval[]>("/admin/inventory/approvals/pending");

export const getApprovalStats = () =>
  get<ApprovalStats>("/admin/inventory/approvals/stats");

export const getApprovalHistory = (filters?: {
  approval_type?: string; status?: string; date_from?: string; date_to?: string;
}) => getList<InvApproval>(`/admin/inventory/approvals/history${qs(filters)}`);

export const approveRequest = (id: number, remarks: string) =>
  post(`/admin/inventory/approvals/${id}/approve`, { remarks });

export const rejectRequest = (id: number, remarks: string) =>
  post(`/admin/inventory/approvals/${id}/reject`, { remarks });

// ── Interconnections (Prompt 9) ─────────────────────────────────────────────

export interface DealerReservationItem {
  inv_product_id: number;
  product: string;
  sku: string;
  avg_monthly_consumption: string;
  suggested_reserve_qty: string;
  confidence_score: string;
  predicted_next_order_date: string | null;
  actual_reserved_qty: number;
}

export interface DealerReservationSummary {
  dealer_id: number;
  dealer: string;
  product_count: number;
  total_suggested_reserve: number;
  total_actual_reserved: number;
  items: DealerReservationItem[];
}

export const getDealerReservationSummary = (dealerId: number) =>
  get<DealerReservationSummary>(`/admin/inventory/reorder/dealer/${dealerId}`);

export interface EmployeeInventoryConsumption {
  employee_id: number;
  employee_name: string;
  department: string;
  last_30_days: {
    total_issues: number;
    total_quantity: number;
    total_value: number;
    most_issued_product: string | null;
  };
  consumption_history: {
    movement_id: number;
    product_id: number;
    product_name: string;
    sku: string;
    uom: string;
    quantity: number;
    unit_cost: number;
    total_value: number;
    remarks: string | null;
    created_at: string;
  }[];
}

export const getEmployeeInventoryConsumption = (employeeKey: string) =>
  get<EmployeeInventoryConsumption>(`/admin/employees/${employeeKey}/inventory-consumption`);

export interface InventoryValuationByZone {
  zone_id: number;
  zone_name: string;
  zone_code: string;
  zone_type: string;
  stock_value: number;
  total_quantity: number;
}

export interface InventoryValuation {
  total_value: number;
  by_zone: InventoryValuationByZone[];
}

export const getInventoryValuation = () =>
  get<InventoryValuation>("/admin/finance/inventory-valuation");

export interface DamagedStockWriteoff {
  total_value: number;
  total_quantity: number;
  items: ApiRow[];
}

export const getDamagedStockWriteoff = () =>
  get<DamagedStockWriteoff>("/admin/finance/damaged-stock-writeoff");
