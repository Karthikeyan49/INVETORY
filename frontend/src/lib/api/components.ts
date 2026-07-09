import { apiFetch } from "@/lib/api/client";

type Envelope<T> = { success?: boolean; message?: string; data: T };

export type LibraryComponent = {
  component_id: number;
  name: string;
  make?: string;
  default_unit?: string;
  default_qty?: number;
  category?: string;
};

export async function listComponents(): Promise<LibraryComponent[]> {
  const res = await apiFetch<Envelope<LibraryComponent[]>>("/admin/quotation-components");
  return res.data ?? [];
}

export async function createComponent(
  input: Omit<LibraryComponent, "component_id">
): Promise<LibraryComponent> {
  const res = await apiFetch<Envelope<LibraryComponent>>("/admin/quotation-components", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function bulkCreateComponents(
  items: Omit<LibraryComponent, "component_id">[]
): Promise<LibraryComponent[]> {
  try {
    const res = await apiFetch<Envelope<LibraryComponent[]>>("/admin/quotation-components/bulk", {
      method: "POST",
      body: JSON.stringify({ components: items }),
    });
    return res.data ?? [];
  } catch (e: any) {
    // Fall back to per-item creation if the bulk endpoint is unavailable.
    const msg = String(e?.message ?? "");
    if (!msg.includes("404")) throw e;
    const out: LibraryComponent[] = [];
    for (const it of items) {
      try {
        out.push(await createComponent(it));
      } catch {
        /* best-effort: skip the ones that fail */
      }
    }
    return out;
  }
}

export async function deleteComponent(id: number): Promise<void> {
  await apiFetch(`/admin/quotation-components/${id}`, { method: "DELETE" });
}
