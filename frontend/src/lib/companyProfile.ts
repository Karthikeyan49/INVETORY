import { apiFetch } from "@/lib/api/client";

/** Per-tenant company profile used on generated documents (invoices/quotations). */
export type CompanyProfile = {
  name: string; subtitle: string; gstin: string;
  logo: string;
  primaryColor: string;
  email: string; phone: string; address: string;
  bankName: string; bankAccount: string; bankIfsc: string; bankBranch: string;
};

const FALLBACK: CompanyProfile = {
  name: "Your Company", subtitle: "", logo: "", primaryColor: "#2ea0da", gstin: "", email: "", phone: "", address: "",
  bankName: "", bankAccount: "", bankIfsc: "", bankBranch: "",
};

let cache: CompanyProfile | null = null;

type Env = { success: boolean; data: any };

/** Fetch & cache the current tenant's company profile (call once after login). */
export async function loadCompanyProfile(): Promise<CompanyProfile> {
  try {
    const r = await apiFetch<Env>("/admin/settings");
    const d = r.data ?? {};
    cache = {
      name: d.company_name || "Your Company",
      subtitle: d.company_subtitle || "",
      logo: d.company_logo || "",
      primaryColor: d.company_primary_color || "#2ea0da",
      gstin: d.gstin || "",
      email: d.company_email || "",
      phone: d.company_phone || "",
      address: d.company_address || "",
      bankName: d.company_bank_name || "",
      bankAccount: d.company_bank_account || "",
      bankIfsc: d.company_bank_ifsc || "",
      bankBranch: d.company_bank_branch || "",
    };
  } catch {
    cache = cache ?? FALLBACK;
  }
  return cache;
}

/** Cached profile (FALLBACK until loaded). Safe to call from sync PDF code. */
export function getCompanyProfile(): CompanyProfile {
  return cache ?? FALLBACK;
}
