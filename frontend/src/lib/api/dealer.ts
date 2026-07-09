/* eslint-disable @typescript-eslint/no-explicit-any */
// Dealer-facing API — scoped server-side to the logged-in dealer (user_type='dealer').
import { apiFetch } from "./client";

export type Row = Record<string, any>;
type Env<T> = { success: boolean; data: T; pagination?: Row };
type Pag<T> = { success: boolean; data: T[]; pagination?: Row };

const qs = (p: Row = {}) => {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") s.set(k, String(v)); });
  const t = s.toString();
  return t ? `?${t}` : "";
};

export const dealerApi = {
  profile: () => apiFetch<Env<Row>>("/dealer/profile").then((r) => r.data),
  dashboard: () => apiFetch<Env<Row>>("/dealer/dashboard").then((r) => r.data),
  customers: (params?: Row) => apiFetch<Pag<Row>>(`/dealer/customers${qs({ limit: 100, ...params })}`).then((r) => r.data ?? []),
  createCustomer: (payload: Row) =>
    apiFetch<Env<Row>>("/dealer/customers", { method: "POST", body: JSON.stringify(payload) }).then((r) => r.data),
  updateCustomer: (id: number, payload: Row) =>
    apiFetch<Env<Row>>(`/dealer/customers/${id}`, { method: "PUT", body: JSON.stringify(payload) }).then((r) => r.data),
  priceList: (dealerCustomerId?: number) =>
    apiFetch<Env<Row>>(`/dealer/price-list${qs({ dealer_customer_id: dealerCustomerId })}`).then((r) => r.data),
  createOrder: (payload: Row) =>
    apiFetch<Env<Row>>("/dealer/orders", { method: "POST", body: JSON.stringify(payload) }).then((r) => r.data),
};
