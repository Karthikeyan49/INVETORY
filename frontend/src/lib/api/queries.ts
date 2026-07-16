/**
 * Customer Queries API
 * GET /admin/queries
 * GET /admin/queries/{id}
 * PUT /admin/queries/{id}/reply
 */
import { apiFetch } from "./client";

export type QueryStatus = "New" | "In Progress" | "Resolved";

export interface Query {
  id: string;
  _queryId: number;
  customerId: number | null;
  name: string;
  email: string;
  message: string;
  date: string;
  status: QueryStatus;
  adminReply: string;
}

interface ApiQueryRow {
  query_id: number;
  customer_id: number | null;
  query_number: string;
  name: string;
  email: string;
  message: string;
  admin_reply: string | null;
  status: string;
  created_at: string;
}

interface Paginated<T> { success: boolean; data: T[] }
interface Envelope<T>  { success: boolean; data: T }

function rowToQuery(row: ApiQueryRow): Query {
  return {
    id:         row.query_number,
    _queryId:   row.query_id,
    customerId: row.customer_id ?? null,
    name:       row.name,
    email:      row.email,
    message:    row.message,
    date:       (row.created_at || "").slice(0, 10),
    status:     (row.status as QueryStatus) || "New",
    adminReply: row.admin_reply || "",
  };
}

export const queriesApi = {
  async list(): Promise<Query[]> {
    const res = await apiFetch<Paginated<ApiQueryRow>>("/admin/queries?limit=100");
    return (res.data ?? []).map(rowToQuery);
  },

  /** Queries/enquiries logged against a specific customer. */
  async listForCustomer(customerId: number): Promise<Query[]> {
    const res = await apiFetch<Paginated<ApiQueryRow>>(`/admin/queries?customer_id=${customerId}&limit=100`);
    return (res.data ?? []).map(rowToQuery);
  },

  /** Log a new enquiry/query, optionally tied to a customer. */
  async create(input: { name: string; email?: string; message: string; customer_id?: number | null }): Promise<Query> {
    const res = await apiFetch<Envelope<ApiQueryRow>>("/admin/queries", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return rowToQuery(res.data);
  },

  async reply(queryId: number, adminReply: string, status: QueryStatus): Promise<void> {
    await apiFetch<Envelope<unknown>>(`/admin/queries/${queryId}/reply`, {
      method: "PUT",
      body: JSON.stringify({ admin_reply: adminReply, status }),
    });
  },
};
