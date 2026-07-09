/**
 * Shared exporters: PDF (jsPDF) and Excel (xlsx).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export interface ExportColumn<T> {
  header: string;
  key: keyof T | ((row: T) => string | number);
  align?: "left" | "right" | "center";
}

function valueOf<T>(row: T, key: ExportColumn<T>["key"]): string | number {
  if (typeof key === "function") return key(row);
  const v = row[key as keyof T];
  return v == null ? "" : (v as unknown as string | number);
}

export function exportToPdf<T>(opts: {
  title: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  filename: string;
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text(opts.title, 40, 40);
  if (opts.subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(opts.subtitle, 40, 58);
  }
  autoTable(doc, {
    startY: 75,
    head: [opts.columns.map((c) => c.header)],
    body: opts.rows.map((r) => opts.columns.map((c) => String(valueOf(r, c.key)))),
    headStyles: { fillColor: [38, 132, 89], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 6 },
    alternateRowStyles: { fillColor: [245, 247, 245] },
  });
  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}

export function exportToExcel<T>(opts: {
  sheetName: string;
  columns: ExportColumn<T>[];
  rows: T[];
  filename: string;
}) {
  const aoa: (string | number)[][] = [
    opts.columns.map((c) => c.header),
    ...opts.rows.map((r) => opts.columns.map((c) => valueOf(r, c.key))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName.slice(0, 31));
  XLSX.writeFile(wb, opts.filename.endsWith(".xlsx") ? opts.filename : `${opts.filename}.xlsx`);
}
