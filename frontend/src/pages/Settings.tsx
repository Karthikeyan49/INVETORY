import { User, Bell, Mail, Phone, MapPin, Clock, Pencil, Plus, LogOut, FileText, BadgeIndianRupee } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { settingsApi, type SettingsData } from "@/lib/api/settings";
import { attendanceApi, type AttendanceShift } from "@/lib/api/hr";
import { downloadSampleQuotation, downloadSampleInvoice } from "@/lib/templateEngine/samples";

// ── Cutoff AM/PM helpers — keep the canonical string "HH:MM AM|PM" ───────────
type Period = "AM" | "PM";
const parseCutoff = (val: string): { hour: string; minute: string; period: Period } => {
  const m = (val || "").trim().match(/^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM)$/i);
  if (!m) return { hour: "10", minute: "30", period: "AM" };
  return { hour: m[1].padStart(2, "0"), minute: m[2], period: m[3].toUpperCase() as Period };
};
const buildCutoff = (hour: string, minute: string, period: Period) =>
  `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} ${period}`;

const DEFAULTS: SettingsData = {
  company_name: "Inventory Management System",
  gstin: "",
  company_email: "",
  company_phone: "",
  company_address: "",
  company_bank_name: "",
  company_bank_account: "",
  company_bank_ifsc: "",
  company_bank_branch: "",
  contact_email: "",
  contact_phone: "",
  contact_address: "",
  company_primary_color: "#1f5a3a",
  delivery_fee: 150,
  gst_rate: 18,
  quotation_terms: "",
  invoice_terms: "",
  notifications: { order_alerts: true, low_stock: true, dealer_commission: false },
  attendance_cutoff_time: "10:30 AM",
  attendance_checkout_cutoff_time: "05:00 PM",
  attendance_working_days: "1,2,3,4,5,6",
  leave_credit_days: 20,
};

// The auto-absent / attendance-cutoff configuration card is hidden per B8. The
// code stays wired (cutoffs/working-days still drive attendance) but isn't shown.
const SHOW_AUTO_ABSENT_CARD = false;

// Weekday picker — value is date('w') number (0=Sun … 6=Sat), matching the backend.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const parseWorkingDays = (csv: string): Set<number> => {
  const set = new Set<number>();
  (csv || "").split(",").forEach((p) => {
    const n = parseInt(p.trim(), 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 6) set.add(n);
  });
  return set;
};

type ShiftForm = Omit<AttendanceShift, "id"> & { id?: string };

const emptyShiftForm = (): ShiftForm => ({
  name: "",
  startTime: "09:00",
  endTime: "17:00",
  workingHours: 8,
  graceMinutes: 0,
  isDefault: false,
  active: true,
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong";

export default function SettingsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [shifts, setShifts] = useState<AttendanceShift[]>([]);
  const [shiftForm, setShiftForm] = useState<ShiftForm>(emptyShiftForm());
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [savingShift, setSavingShift] = useState(false);

  // Same logout behavior previously triggered from the top header.
  const handleLogout = () => {
    logout();
    toast.success("Logged out successfully");
    navigate("/login");
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [settingsData, shiftRows] = await Promise.all([
          settingsApi.get(),
          attendanceApi.shifts.list(),
        ]);
        setSettings(settingsData);
        setShifts(shiftRows);
      } catch (error: unknown) {
        toast.error(errorMessage(error));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  // ── section-level save helpers ──────────────────────────────────────────────

  async function save(payload: Partial<SettingsData>, successMsg: string) {
    setSaving(true);
    try {
      const updated = await settingsApi.update(payload);
      setSettings(updated);
      toast.success(successMsg);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  const handleSaveProfile = () => {
    if (!settings.company_name || !settings.company_email) {
      toast.error("Company name and email are required");
      return;
    }
    save({
      company_name:    settings.company_name,
      gstin:           settings.gstin,
      company_email:   settings.company_email,
      company_phone:   settings.company_phone,
      company_address: settings.company_address,
      company_bank_name:    settings.company_bank_name,
      company_bank_account: settings.company_bank_account,
      company_bank_ifsc:    settings.company_bank_ifsc,
      company_bank_branch:  settings.company_bank_branch,
      company_primary_color: settings.company_primary_color,
    }, "Company profile saved");
  };

  const handleSaveColor = () => {
    save(
      { company_primary_color: settings.company_primary_color || "#1f5a3a" },
      "Brand color saved"
    );
  };

  const handleSaveTerms = () => {
    save(
      {
        quotation_terms: settings.quotation_terms ?? "",
        invoice_terms: settings.invoice_terms ?? "",
      },
      "Terms & conditions saved"
    );
  };

  const handleSaveContact = () => {
    if (!settings.contact_email || !settings.contact_phone || !settings.contact_address) {
      toast.error("All contact fields are required");
      return;
    }
    save({
      contact_email:   settings.contact_email,
      contact_phone:   settings.contact_phone,
      contact_address: settings.contact_address,
    }, "Contact info updated — changes will reflect in the mobile app");
  };

  const handleSaveAttendance = () => {
    const ci = parseCutoff(settings.attendance_cutoff_time);
    const co = parseCutoff(settings.attendance_checkout_cutoff_time);
    if (!ci.hour || !ci.minute || !co.hour || !co.minute) {
      toast.error("Please pick valid cutoff times");
      return;
    }
    const working = parseWorkingDays(settings.attendance_working_days);
    if (working.size === 0) {
      toast.error("Select at least one working day");
      return;
    }
    save(
      {
        attendance_cutoff_time:          buildCutoff(ci.hour, ci.minute, ci.period),
        attendance_checkout_cutoff_time: buildCutoff(co.hour, co.minute, co.period),
        // Persist in a stable weekday order (Sun→Sat) as CSV
        attendance_working_days:         [0, 1, 2, 3, 4, 5, 6].filter((d) => working.has(d)).join(","),
      },
      "Attendance settings updated"
    );
  };

  const toggleWorkingDay = (day: number) => {
    const set = parseWorkingDays(settings.attendance_working_days);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    setField("attendance_working_days", [0, 1, 2, 3, 4, 5, 6].filter((d) => set.has(d)).join(","));
  };

  const resetShiftForm = () => setShiftForm(emptyShiftForm());

  const editShift = (shift: AttendanceShift) => setShiftForm({ ...shift });

  const saveShift = async () => {
    if (!shiftForm.name.trim()) {
      toast.error("Shift name is required");
      return;
    }
    if (!shiftForm.startTime || !shiftForm.endTime) {
      toast.error("Start time and end time are required");
      return;
    }

    setSavingShift(true);
    try {
      const payload = {
        name: shiftForm.name.trim(),
        startTime: shiftForm.startTime,
        endTime: shiftForm.endTime,
        workingHours: Number(shiftForm.workingHours) || 8,
        graceMinutes: Number(shiftForm.graceMinutes) || 0,
        isDefault: shiftForm.isDefault,
        active: shiftForm.active,
      };
      if (shiftForm.id) {
        await attendanceApi.shifts.update(shiftForm.id, payload);
      } else {
        await attendanceApi.shifts.create(payload);
      }
      const shiftRows = await attendanceApi.shifts.list();
      setShifts(shiftRows);
      resetShiftForm();
      toast.success(shiftForm.id ? "Shift updated" : "Shift created");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setSavingShift(false);
    }
  };

  // ── field helpers ───────────────────────────────────────────────────────────

  const setField = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const toggleNotification = async (key: keyof SettingsData["notifications"]) => {
    const newVal = !settings.notifications[key];
    const next   = { ...settings.notifications, [key]: newVal };
    setSettings(prev => ({ ...prev, notifications: next }));
    try {
      await settingsApi.update({ notifications: next });
      const labels: Record<string, string> = {
        order_alerts:      "New order notifications",
        low_stock:         "Low stock alerts",
        dealer_commission: "Dealer commission updates",
      };
      toast.success(`${labels[key]} ${newVal ? "enabled" : "disabled"}`);
    } catch {
      setSettings(prev => ({ ...prev, notifications: settings.notifications }));
      toast.error("Failed to update notification setting");
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading settings…</div>;

  const notifItems = [
    { key: "order_alerts"      as const, title: "New order notifications",    desc: "Get notified when a new order is placed" },
    { key: "low_stock"         as const, title: "Low stock alerts",            desc: "Alert when raw materials fall below threshold" },
    { key: "dealer_commission" as const, title: "Dealer commission updates",   desc: "Weekly dealer earnings summary" },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your account, contact info, and preferences</p>
      </div>

      {/* Company Profile */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 text-card-foreground">
          <User className="h-5 w-5" />
          <h2 className="font-semibold">Company Profile</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-card-foreground">Company Name</label>
            <Input value={settings.company_name} onChange={e => setField("company_name", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium text-card-foreground">GSTIN</label>
            <Input value={settings.gstin} onChange={e => setField("gstin", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium text-card-foreground">Email</label>
            <Input value={settings.company_email} onChange={e => setField("company_email", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium text-card-foreground">Phone</label>
            <Input value={settings.company_phone} onChange={e => setField("company_phone", e.target.value)} className="mt-1" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">Address</label>
          <Input value={settings.company_address} onChange={e => setField("company_address", e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">Brand Color</label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">Primary color used for theming across the app.</p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Brand color picker"
              value={settings.company_primary_color || "#1f5a3a"}
              onChange={e => setField("company_primary_color", e.target.value)}
              className="h-10 w-12 rounded-md border border-input bg-background p-1 cursor-pointer"
            />
            <Input
              value={settings.company_primary_color ?? ""}
              onChange={e => setField("company_primary_color", e.target.value)}
              placeholder="#1f5a3a"
              className="w-36 font-mono"
            />
            <Button variant="outline" size="sm" onClick={handleSaveColor} disabled={saving}>
              Save color
            </Button>
          </div>
        </div>
        <div className="pt-2 border-t">
          <p className="text-sm font-medium text-card-foreground mb-2">Bank details <span className="text-xs text-muted-foreground">(printed on quotations &amp; invoices)</span></p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-card-foreground">Bank Name</label>
              <Input value={settings.company_bank_name ?? ""} onChange={e => setField("company_bank_name", e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-card-foreground">Account Number</label>
              <Input value={settings.company_bank_account ?? ""} onChange={e => setField("company_bank_account", e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-card-foreground">IFSC</label>
              <Input value={settings.company_bank_ifsc ?? ""} onChange={e => setField("company_bank_ifsc", e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-card-foreground">Branch</label>
              <Input value={settings.company_bank_branch ?? ""} onChange={e => setField("company_bank_branch", e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>
        <Button onClick={handleSaveProfile} disabled={saving}>Save Changes</Button>
      </div>

      {/* Terms & Conditions — default text printed on quotations & invoices */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-card-foreground">
          <FileText className="h-5 w-5" />
          <h2 className="font-semibold">Terms &amp; Conditions</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Default terms printed on the PDFs. A new quotation pre-fills the Quotation terms (still editable per quotation); invoices use the Invoice terms. One point per line.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-card-foreground">Quotation Terms</label>
            <Textarea
              value={settings.quotation_terms ?? ""}
              onChange={e => setField("quotation_terms", e.target.value)}
              placeholder={"1. 50% Advance payment\n2. 50% at Delivery\n3. Freight Charge Extra"}
              className="mt-1 min-h-[160px] resize-y font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-card-foreground">Invoice Terms</label>
            <Textarea
              value={settings.invoice_terms ?? ""}
              onChange={e => setField("invoice_terms", e.target.value)}
              placeholder={"1. Payment Terms: 100% advance before processing.\n2. Goods once sold are not returnable.\n3. All disputes subject to local jurisdiction."}
              className="mt-1 min-h-[160px] resize-y font-mono text-sm"
            />
          </div>
        </div>
        <Button onClick={handleSaveTerms} disabled={saving}>Save Terms</Button>
      </div>

      {/* Document Templates — preview the PDF engine output */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-card-foreground">
          <FileText className="h-5 w-5" />
          <h2 className="font-semibold">Document Templates</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">Quotations and invoices are rendered by the template engine using the company profile above. Preview the layouts with sample data:</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadSampleQuotation()}>Preview Quotation PDF</Button>
          <Button variant="outline" onClick={() => downloadSampleInvoice()}>Preview Tax Invoice PDF</Button>
        </div>
      </div>

      {/* Contact Us — shown in mobile app */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-card-foreground">
            <Phone className="h-5 w-5" />
            <h2 className="font-semibold">Contact Us (Mobile App)</h2>
          </div>
          <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full">Shown in app</span>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">These details are displayed in the "Contact Us" section of the mobile app.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-card-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email Address
            </label>
            <Input value={settings.contact_email} onChange={e => setField("contact_email", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium text-card-foreground flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Phone Number
            </label>
            <Input value={settings.contact_phone} onChange={e => setField("contact_phone", e.target.value)} className="mt-1" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Office Address
          </label>
          <Textarea value={settings.contact_address} onChange={e => setField("contact_address", e.target.value)} className="mt-1" rows={2} />
        </div>
        <Button onClick={handleSaveContact} disabled={saving}>Update Contact Info</Button>
      </div>

      {/* Shift timings */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-card-foreground">
            <Clock className="h-5 w-5" />
            <h2 className="font-semibold">Shift Timings</h2>
          </div>
          <Button variant="outline" size="sm" onClick={resetShiftForm}>
            <Plus className="h-4 w-4" /> New Shift
          </Button>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          These shifts are stored in the database and used by QR attendance, manual attendance, late entry, and overtime calculations.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.15fr] gap-4">
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-muted/50 text-sm font-medium">Existing Shifts</div>
            <div className="divide-y max-h-[280px] overflow-auto">
              {shifts.map((shift) => (
                <div key={shift.id} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{shift.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {shift.startTime}-{shift.endTime} · {shift.workingHours} hrs
                      {shift.graceMinutes ? ` · ${shift.graceMinutes} min grace` : ""}
                      {shift.isDefault ? " · Default" : ""}
                      {!shift.active ? " · Inactive" : ""}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => editShift(shift)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {shifts.length === 0 && (
                <div className="px-3 py-8 text-sm text-muted-foreground text-center">No shifts created.</div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Shift Name</Label>
              <Input value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="General Shift" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Time</Label>
                <Input type="time" value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} />
              </div>
              <div>
                <Label>End Time</Label>
                <Input type="time" value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Working Hours</Label>
                <Input
                  type="number"
                  min="1"
                  max="24"
                  step="0.25"
                  value={shiftForm.workingHours}
                  onChange={(e) => setShiftForm({ ...shiftForm, workingHours: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Grace Minutes</Label>
                <Input
                  type="number"
                  min="0"
                  max="240"
                  value={shiftForm.graceMinutes}
                  onChange={(e) => setShiftForm({ ...shiftForm, graceMinutes: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="shift-default" className="cursor-pointer">Default shift</Label>
                <Switch id="shift-default" checked={shiftForm.isDefault} onCheckedChange={(checked) => setShiftForm({ ...shiftForm, isDefault: checked })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="shift-active" className="cursor-pointer">Active</Label>
                <Switch id="shift-active" checked={shiftForm.active} onCheckedChange={(checked) => setShiftForm({ ...shiftForm, active: checked })} />
              </div>
            </div>
            <Button onClick={saveShift} disabled={savingShift}>
              {savingShift ? "Saving…" : shiftForm.id ? "Update Shift" : "Create Shift"}
            </Button>
          </div>
        </div>
      </div>

      {/* Attendance cutoffs — auto-absent card (hidden per B8) */}
      {SHOW_AUTO_ABSENT_CARD && (
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 text-card-foreground">
          <Clock className="h-5 w-5" />
          <h2 className="font-semibold">Attendance Cutoff Time</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          Late check-ins (after the morning cutoff) and early check-outs (before
          the evening cutoff) are marked <span className="font-medium">Half-day</span>.
          Employees with no check-in by the morning cutoff are auto-marked
          <span className="font-medium"> Absent</span>. Manual entries are never overridden.
        </p>

        {(() => {
          const hours   = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
          const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

          const renderPicker = (
            label: string,
            sublabel: string,
            field: "attendance_cutoff_time" | "attendance_checkout_cutoff_time",
          ) => {
            const { hour, minute, period } = parseCutoff(settings[field]);
            const setCut = (h: string, m: string, p: Period) =>
              setField(field, buildCutoff(h, m, p));
            return (
              <div className="space-y-1">
                <Label className="text-sm">{label}</Label>
                <p className="text-xs text-muted-foreground">{sublabel}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Select value={hour} onValueChange={(v) => setCut(v, minute, period)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {hours.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">:</span>
                  <Select value={minute} onValueChange={(v) => setCut(hour, v, period)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {minutes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={period} onValueChange={(v) => setCut(hour, minute, v as Period)}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">AM</SelectItem>
                      <SelectItem value="PM">PM</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground ml-2">
                    Current: <span className="font-medium text-card-foreground">{settings[field]}</span>
                  </span>
                </div>
              </div>
            );
          };

          return (
            <div className="space-y-5">
              {renderPicker(
                "Check-in cutoff",
                "Check-ins after this time → Half-day. No check-in by this time → Auto-Absent.",
                "attendance_cutoff_time",
              )}
              {renderPicker(
                "Check-out cutoff",
                "Check-outs before this time → Half-day.",
                "attendance_checkout_cutoff_time",
              )}
            </div>
          );
        })()}

        {/* Working days — auto-absent only runs on selected days */}
        <div className="space-y-2 border-t pt-5">
          <Label className="text-sm">Working days</Label>
          <p className="text-xs text-muted-foreground">
            Auto-Absent marking runs only on the selected days. Unselected days
            (e.g. weekends/holidays) are skipped — no one is marked Absent.
          </p>
          {(() => {
            const selected = parseWorkingDays(settings.attendance_working_days);
            return (
              <div className="flex flex-wrap gap-2 mt-1">
                {WEEKDAYS.map((d) => {
                  const on = selected.has(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleWorkingDay(d.value)}
                      className={
                        "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                        (on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted")
                      }
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <Button onClick={handleSaveAttendance} disabled={saving}>Save Attendance Settings</Button>
      </div>
      )}

      {/* Payroll — leave credit configuration */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-card-foreground">
          <BadgeIndianRupee className="h-5 w-5" />
          <h2 className="font-semibold">Payroll</h2>
        </div>
        <div className="space-y-1 max-w-sm">
          <Label className="text-sm">Leave credit days</Label>
          <p className="text-xs text-muted-foreground">
            Present days required to earn <span className="font-medium">1 leave credit</span>.
            Payroll uses this to compute each employee's available leave credits.
          </p>
          <Input
            type="number"
            min="1"
            max="31"
            step="1"
            className="mt-1 w-32"
            value={String(settings.leave_credit_days ?? 20)}
            onChange={(e) => setField("leave_credit_days", e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </div>
        <Button
          onClick={() => {
            const n = Number(settings.leave_credit_days);
            if (!Number.isFinite(n) || n < 1 || n > 31) {
              toast.error("Leave credit days must be a number between 1 and 31");
              return;
            }
            save({ leave_credit_days: n }, "Payroll settings updated");
          }}
          disabled={saving}
        >
          Save Payroll Settings
        </Button>
      </div>

      {/* Notifications */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 text-card-foreground">
          <Bell className="h-5 w-5" />
          <h2 className="font-semibold">Notifications</h2>
        </div>
        {notifItems.map(n => (
          <div key={n.key} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm text-card-foreground">{n.title}</p>
              <p className="text-xs text-muted-foreground">{n.desc}</p>
            </div>
            <Switch checked={settings.notifications[n.key]} onCheckedChange={() => toggleNotification(n.key)} />
          </div>
        ))}
      </div>

      {/* Account / Logout */}
      <div className="bg-card rounded-xl border p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 text-card-foreground">
          <LogOut className="h-5 w-5" />
          <h2 className="font-semibold">Account</h2>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm text-card-foreground">Sign out</p>
            <p className="text-xs text-muted-foreground">End your session and return to the login screen.</p>
          </div>
          <Button variant="destructive" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}
