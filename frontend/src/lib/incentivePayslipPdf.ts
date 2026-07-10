/**
 * Incentive payslip (R7 / T10) — a compact payslip for an output-based incentive
 * payment, kept distinct from the fixed-payroll payslip. Off-books extra is only
 * present on the payload for the extended login, so it prints only when set.
 */
import jsPDF from "jspdf";
import type { Incentive } from "./api/incentives";
import { BASIS_LABELS } from "./api/incentives";

const inr = (n: number | null | undefined) =>
  `Rs. ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function downloadIncentivePayslip(inc: Incentive): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const L = 48, R = 547, cx = (L + R) / 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(196, 30, 30);
  doc.text("SRI VARI SCALES", cx, 60, { align: "center" });
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text("INCENTIVE PAYSLIP", cx, 82, { align: "center" });

  doc.setDrawColor(180);
  doc.line(L, 96, R, 96);

  const payee = inc.employee_name || inc.person_name;
  let y = 124;
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(90);
    doc.text(label, L, y);
    doc.setFont("helvetica", "normal"); doc.setTextColor(20);
    doc.text(value, L + 150, y);
    y += 22;
  };
  row("Payee", payee);
  if (inc.employee_designation) row("Designation", inc.employee_designation);
  row("Reference", `INC-${String(inc.id).padStart(4, "0")}`);
  row("Period", inc.period || "—");
  row("Basis", BASIS_LABELS[inc.basis] ?? inc.basis);
  if (inc.basis === "percentage") {
    row("Turnover base", inr(inc.base_amount));
    row("Rate", `${inc.rate}%`);
  } else {
    row("Rate", inr(inc.rate));
    row("Units", String(inc.units));
  }

  y += 8;
  doc.setDrawColor(180);
  doc.line(L, y, R, y);
  y += 26;

  const total = Number(inc.amount || 0) + Number(inc.extra_amount || 0);
  const amountRow = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 13 : 11);
    doc.setTextColor(bold ? 196 : 40, bold ? 30 : 40, bold ? 30 : 40);
    doc.text(label, L, y);
    doc.text(value, R, y, { align: "right" });
    y += bold ? 26 : 22;
  };
  amountRow("Incentive amount", inr(inc.amount));
  if (inc.extra_amount && inc.extra_amount > 0) amountRow("Additional amount", inr(inc.extra_amount));
  amountRow("Total payable", inr(total), true);

  y += 10;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
  row2(doc, L, y, "Status", inc.status.toUpperCase());
  y += 20;
  if (inc.status === "paid") {
    row2(doc, L, y, "Paid on", inc.paid_on || "—"); y += 20;
    row2(doc, L, y, "Mode", `${inc.payment_category || "—"}${inc.utr_no ? ` · UTR ${inc.utr_no}` : ""}`); y += 20;
  }

  doc.setTextColor(120);
  doc.setFontSize(9);
  doc.text("For SRI VARI SCALES", R, 760, { align: "right" });
  doc.text("Authorised Signatory", R, 792, { align: "right" });

  doc.save(`incentive-payslip-INC-${String(inc.id).padStart(4, "0")}.pdf`);
}

function row2(doc: jsPDF, x: number, y: number, label: string, value: string) {
  doc.setFont("helvetica", "bold"); doc.setTextColor(90);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal"); doc.setTextColor(20);
  doc.text(value, x + 150, y);
}
