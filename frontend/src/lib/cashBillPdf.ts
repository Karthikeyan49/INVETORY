/**
 * Cash Bill PDF (download from the Cash Bills page).
 * Renders the exact "Sri Vari Scales" CASH BILL letterhead template (F/SVS/34).
 */
import { buildCashBill } from "./srivariScalesPdf";
import { ensurePdfFonts } from "./pdfFonts";
import type { CashBill } from "./api/cashBills";

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v);
}

export async function downloadCashBillPdf(c: CashBill): Promise<void> {
  await ensurePdfFonts();
  const doc = buildCashBill({
    refNo: c.bill_no,
    date: fmtDate(c.bill_date),
    to: c.customer_name || "",
    cellNo: c.cell_no || "",
    description: c.description || c.machine_model || "",
    qty: c.qty || "1NO",
    amount: Number(c.amount || 0),
    total: Number(c.total ?? c.amount ?? 0),
  });
  doc.save(`${String(c.bill_no).replace(/[^\w.-]+/g, "_")}.pdf`);
}
