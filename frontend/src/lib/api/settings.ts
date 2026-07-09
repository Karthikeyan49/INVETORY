import { apiFetch } from "./client";

export interface SettingsData {
  company_name: string;
  gstin: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  // Optional company branding + bank details printed on quotations/invoices
  company_bank_name?: string;
  company_bank_account?: string;
  company_bank_ifsc?: string;
  company_bank_branch?: string;
  company_subtitle?: string;
  company_primary_color?: string;
  company_logo?: string;
  contact_email: string;
  contact_phone: string;
  contact_address: string;
  delivery_fee: number;
  gst_rate: number;
  quotation_terms?: string;
  invoice_terms?: string;
  notifications: {
    order_alerts: boolean;
    low_stock: boolean;
    dealer_commission: boolean;
  };
  /** 12-hour AM/PM string, e.g. "10:30 AM" — morning check-in cutoff. Late check-ins → Half-day; no check-in → Auto-Absent. */
  attendance_cutoff_time: string;
  /** 12-hour AM/PM string, e.g. "05:00 PM" — evening check-out cutoff. Early check-outs → Half-day. */
  attendance_checkout_cutoff_time: string;
  /** CSV of weekday numbers (0=Sun … 6=Sat), e.g. "1,2,3,4,5,6". Auto-absent skips non-listed days. */
  attendance_working_days: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}

export const settingsApi = {
  get(): Promise<SettingsData> {
    return apiFetch<ApiResponse<SettingsData>>("/admin/settings").then((r) => r.data);
  },

  update(payload: Partial<SettingsData>): Promise<SettingsData> {
    return apiFetch<ApiResponse<SettingsData>>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }).then((r) => r.data);
  },
};
