/**
 * Delivery challan PDF (download from the Deliveries page).
 * Renders the exact "Sri Vari Scales" DELIVERY CHALLAN letterhead template.
 * Off-books "extra" figures are intentionally NOT printed on the challan.
 */
import { buildDeliveryChallan } from "./srivariScalesPdf";
import { ensurePdfFonts } from "./pdfFonts";
import type { DeliveryNote } from "./api/deliveries";

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v);
}

export async function downloadChallanPdf(c: DeliveryNote): Promise<void> {
  await ensurePdfFonts();
  const doc = buildDeliveryChallan({
    refNo: c.challan_no,
    date: fmtDate(c.delivery_date),
    to: c.customer_name || "",
    model: c.machine_model || c.items || "",
    machineNo: c.machine_code || "",
    qty: "1NO",
    amount: Number(c.amount || 0),
    total: Number(c.amount || 0),
  });
  doc.save(`${String(c.challan_no).replace(/[^\w.-]+/g, "_")}.pdf`);
}
