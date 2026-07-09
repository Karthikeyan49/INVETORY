import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeIndianRupee, FileDown, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  employeeAdvancesApi,
  employeesApi,
  type Employee,
  type EmployeeAdvance,
  type EmployeeAdvancePayload,
} from "@/lib/api/hr";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";
import { ScrollableX } from "@/components/ui/scrollable-x";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const emptyForm = (employeeId = ""): EmployeeAdvancePayload => ({
  employeeId,
  advanceDate: today(),
  payrollMonth: currentMonth(),
  amount: 0,
  notes: "",
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong";

export default function AdvanceRegister() {
  const [month, setMonth] = useState(currentMonth());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<EmployeeAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeAdvance | null>(null);
  const [form, setForm] = useState<EmployeeAdvancePayload>(emptyForm());

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active), [employees]);

  const load = useCallback(async (selectedMonth = month) => {
    setLoading(true);
    try {
      const [employeeRows, advanceRows] = await Promise.all([
        employeesApi.list(),
        employeeAdvancesApi.list({ month: selectedMonth }),
      ]);
      setEmployees(employeeRows);
      setRows(advanceRows);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(month); }, [load, month]);

  const stats = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    const employeesWithAdvance = new Set(rows.map((row) => row.employeeId)).size;
    return { total, count: rows.length, employeesWithAdvance };
  }, [rows]);

  const openCreate = () => {
    const initialEmployee = activeEmployees[0]?.id ?? employees[0]?.id ?? "";
    setEditing(null);
    setForm({ ...emptyForm(initialEmployee), payrollMonth: month });
    setDialogOpen(true);
  };

  const openEdit = (advance: EmployeeAdvance) => {
    setEditing(advance);
    setForm({
      employeeId: advance.employeeId,
      advanceDate: advance.advanceDate,
      payrollMonth: advance.payrollMonth,
      amount: advance.amount,
      notes: advance.notes ?? "",
    });
    setDialogOpen(true);
  };

  const setField = <K extends keyof EmployeeAdvancePayload>(key: K, value: EmployeeAdvancePayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (!form.employeeId) { toast.error("Employee is required"); return; }
    if (!form.advanceDate) { toast.error("Advance date is required"); return; }
    if (!form.payrollMonth) { toast.error("Payroll month is required"); return; }
    if (Number(form.amount) <= 0) { toast.error("Advance amount must be greater than zero"); return; }

    try {
      if (editing) await employeeAdvancesApi.update(editing.id, form);
      else await employeeAdvancesApi.create(form);
      toast.success(editing ? "Advance updated" : "Advance added");
      setDialogOpen(false);
      setMonth(form.payrollMonth);
      await load(form.payrollMonth);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (advance: EmployeeAdvance) => {
    if (!window.confirm(`Delete advance for ${advance.employeeName}?`)) return;
    try {
      await employeeAdvancesApi.remove(advance.id);
      toast.success("Advance deleted");
      await load(month);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const columns: ExportColumn<EmployeeAdvance>[] = [
    { header: "Date", key: "advanceDate" },
    { header: "Payroll Month", key: "payrollMonth" },
    { header: "Emp ID", key: "employeeId" },
    { header: "Name", key: "employeeName" },
    { header: "Designation", key: "designation" },
    { header: "Amount", key: (row) => row.amount.toLocaleString("en-IN") },
    { header: "Notes", key: "notes" },
  ];

  const exportRows = () => {
    if (!rows.length) return;
    exportToExcel({ sheetName: `Advances ${month}`, columns, rows, filename: `advance-register-${month}` });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Advance Register</h1>
          <p className="text-muted-foreground">Record employee advances and deduct them from the selected payroll month.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <Label className="text-xs">Payroll Month</Label>
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </div>
          <Button variant="outline" onClick={exportRows} disabled={!rows.length}>
            <FileDown className="h-4 w-4" /> Excel
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Advance
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Advance Entries" value={String(stats.count)} subtitle={month} icon={WalletCards} />
        <StatCard title="Employees" value={String(stats.employeesWithAdvance)} subtitle="with advance" icon={BadgeIndianRupee} />
        <StatCard title="Total Advance" value={inr(stats.total)} subtitle="deducted in payroll" icon={BadgeIndianRupee} />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Designation</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-left px-4 py-3 font-medium">Notes</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Loading...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No advance entries for this month.</td></tr>}
              {!loading && rows.map((advance) => (
                <tr key={advance.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">{advance.advanceDate}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{advance.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{advance.employeeId}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{advance.designation || "-"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(advance.amount)}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-sm truncate">{advance.notes || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(advance)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(advance)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Advance" : "Add Advance"}</DialogTitle>
            <DialogDescription>Advance amount is deducted when payroll is generated for the selected month.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <Label>Employee</Label>
              <Select value={form.employeeId} onValueChange={(value) => setField("employeeId", value)}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name} ({employee.id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Advance Date</Label><Input type="date" value={form.advanceDate} onChange={(event) => setField("advanceDate", event.target.value)} /></div>
            <div><Label>Payroll Month</Label><Input type="month" value={form.payrollMonth} onChange={(event) => setField("payrollMonth", event.target.value)} /></div>
            <div className="md:col-span-2">
              <Label>Advance Amount</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={form.amount ? String(form.amount) : ""}
                onChange={(event) => {
                  const cleaned = event.target.value.replace(/[^\d.]/g, "").replace(/^0+(?=\d)/, "");
                  setField("amount", cleaned === "" ? 0 : Number(cleaned));
                }}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes ?? ""} onChange={(event) => setField("notes", event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Add advance"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
