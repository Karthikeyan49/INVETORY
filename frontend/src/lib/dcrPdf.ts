/**
 * Daily Call Report PDF (R13 / T11) — form code F-SVS-01. Header (employee /
 * date / area / KM / status) + the visit-lines table matching the reference in
 * docs/reference-pdfs/dcr-daily-call-report.pdf.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Dcr } from "./api/dcr";

export function downloadDcrPdf(d: Dcr): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const L = 32;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(196, 30, 30);
  doc.text("SRI VARI SCALES", L, 40);
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Daily Call Report - F-SVS-01", L, 58);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40);
  doc.text(`Employee: ${d.employee_name}`, L, 78);
  doc.text(`Date: ${d.report_date}`, L + 300, 78);
  doc.text(`Area: ${d.area || "—"}`, L + 470, 78);
  doc.text(`Opening KM: ${d.opening_km}  |  Closing KM: ${d.closing_km}  |  Total KM: ${d.total_km}`, L, 94);
  doc.text(`Status: ${d.status}`, L + 470, 94);

  const lines = d.lines ?? [];
  autoTable(doc, {
    startY: 108,
    head: [["#", "Customer", "Address", "Mobile", "Model", "Status", "Type", "Category", "Stamping", "Service", "Payment", "Remarks", "Staff Sign"]],
    body: lines.map((l, i) => [
      String(i + 1),
      l.customer ?? "",
      l.address ?? "",
      l.mobile ?? "",
      l.model ?? "",
      l.cust_status ?? "",
      l.cust_type ?? "",
      l.category ?? "",
      l.stamping ?? "",
      l.service ?? "",
      l.payment ?? "",
      l.remarks ?? "",
      l.staff_sign ?? "",
    ]),
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [38, 132, 89], textColor: 255, fontSize: 8 },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 80 }, 2: { cellWidth: 90 }, 3: { cellWidth: 60 } },
  });

  doc.save(`${d.dcr_no}.pdf`);
}
