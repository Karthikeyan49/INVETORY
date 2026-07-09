import { useEffect, useMemo, useState } from "react";
import {
  Plus, Search, Pencil, Trash2, Users, CalendarClock, ClipboardList, ChevronRight, X,
  ImagePlus, Film, Play, Upload as UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  meetingsApi, RACI_ROLES, RACI_LABELS,
  type Meeting, type ActionItem, type ActionStatus, type RaciRole,
} from "@/lib/api/meetings";
import { employeesApi, type Employee } from "@/lib/api/hr";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { AuthImage } from "@/components/AuthImage";
import { AuthVideo } from "@/components/AuthVideo";

const today = () => new Date().toISOString().slice(0, 10);

const newRaciRow = () => ({ id: crypto.randomUUID(), deliverable: "", assignments: {} as Record<string, RaciRole> });
const newAction = (): ActionItem => ({
  id: crypto.randomUUID(), description: "", ownerId: "", dueDate: today(), status: "Open",
});

const emptyForm = (): Omit<Meeting, "id" | "createdAt"> => ({
  title: "", date: today(), time: "10:00", location: "", agenda: "", notes: "",
  attendees: [], raci: [newRaciRow()], actionItems: [],
});

const STATUS_COLOR: Record<ActionStatus, string> = {
  Open: "bg-muted text-muted-foreground",
  "In Progress": "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  Done: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
};

/** Derive an overall status from a list of action items */
function overallStatus(actionItems: ActionItem[]): ActionStatus {
  if (!actionItems.length) return "Open";
  if (actionItems.every((a) => a.status === "Done")) return "Done";
  if (actionItems.some((a) => a.status === "In Progress")) return "In Progress";
  return "Open";
}

const STATUS_ROW_STYLE: Record<ActionStatus, string> = {
  Open:        "bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-300",
  "In Progress": "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  Done:          "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
};

const isPhoto = (m: ApiRow) =>
  m.type === "photo" || String(m.mime_type ?? "").startsWith("image") || m.category === "meeting_photo";
// Locally-stored video (bytes behind auth). External videos use external_url instead.
const isLocalVideo = (m: ApiRow) =>
  !m.external_url && m.attachment_id && (
    String(m.mime_type ?? "").startsWith("video") ||
    m.category === "meeting_video" ||
    /\.(mp4|mov|webm)$/i.test(String(m.original_name ?? ""))
  );

/** Media gallery + inline upload for a single meeting, used inside the detail dialog. */
function MeetingMediaPanel({ meetingId }: { meetingId: number }) {
  const [media, setMedia] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<ApiRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setMedia(await phase2Api.hrCompliance.meetingMedia(meetingId));
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [meetingId]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      await phase2Api.hrCompliance.addMeetingMedia(meetingId, { file });
      toast.success("Media uploaded");
      await load();
    } catch (e: any) { toast.error(e.message); }
    finally { setUploading(false); }
  };

  const onDelete = async (attachmentId: number) => {
    try {
      await phase2Api.hrCompliance.removeMeetingMedia(meetingId, attachmentId);
      toast.success("Media deleted");
      setMedia((prev) => prev.filter((m) => m.attachment_id !== attachmentId));
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Media ({media.length})</h4>
        <label className="inline-flex">
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
          />
          <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${uploading ? "opacity-60 pointer-events-none" : "hover:bg-muted"}`}>
            <UploadIcon className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload"}
          </span>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4">Loading media…</p>
      ) : media.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No photos or videos for this meeting yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {media.map((m) => {
            const photo = isPhoto(m);
            const localVideo = isLocalVideo(m);
            return (
              <div key={m.attachment_id} className="rounded-lg border bg-card overflow-hidden shadow-sm group relative">
                <div className="aspect-video bg-muted flex items-center justify-center relative">
                  {photo ? (
                    <AuthImage
                      attachmentId={m.attachment_id}
                      alt={m.original_name || m.caption || "Meeting photo"}
                      className="h-full w-full object-cover cursor-zoom-in"
                      onClick={() => setLightbox(m)}
                    />
                  ) : localVideo ? (
                    <button
                      type="button"
                      onClick={() => setLightbox(m)}
                      className="h-full w-full flex items-center justify-center bg-black/5 hover:bg-black/10 transition-colors cursor-pointer"
                      aria-label="Play video"
                    >
                      <div className="rounded-full bg-black/50 p-3"><Play className="h-6 w-6 text-white fill-white" /></div>
                    </button>
                  ) : (
                    <div className="text-center text-xs text-muted-foreground px-3">
                      <Film className="h-6 w-6 mx-auto mb-1" />
                      {m.external_url ? "External video" : "Video"}
                    </div>
                  )}
                </div>
                <div className="p-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{m.original_name || "Media"}</p>
                    {m.caption && <p className="text-[11px] text-muted-foreground truncate">{m.caption}</p>}
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => onDelete(m.attachment_id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setLightbox(null)}>
            <X className="h-7 w-7" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
            {isLocalVideo(lightbox) ? (
              <AuthVideo
                attachmentId={lightbox.attachment_id}
                mimeType={lightbox.mime_type}
                fileName={lightbox.original_name}
                autoPlay
                className="max-h-[90vh] max-w-[90vw] rounded-lg"
              />
            ) : (
              <AuthImage
                attachmentId={lightbox.attachment_id}
                alt={lightbox.original_name || "Meeting photo"}
                className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function Meetings() {
  const [items, setItems] = useState<Meeting[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<Meeting | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "media">("details");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [confirmDelete, setConfirmDelete] = useState<Meeting | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [m, e] = await Promise.all([meetingsApi.list(), employeesApi.list()]);
      setItems(m); setEmployees(e);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const empMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);

  const filtered = useMemo(() => items.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.location.toLowerCase().includes(q);
  }), [items, search]);

  const stats = useMemo(() => {
    const upcoming = items.filter((m) => m.date >= today()).length;
    const totalActions = items.reduce((s, m) => s + m.actionItems.length, 0);
    const openActions = items.reduce((s, m) => s + m.actionItems.filter((a) => a.status !== "Done").length, 0);
    return { total: items.length, upcoming, totalActions, openActions };
  }, [items]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (m: Meeting) => {
    setEditing(m);
    // Explicitly build a clean form — strip snake_case keys so the camelCase
    // actionItems is the single source of truth inside the form state.
    setForm({
      title: m.title,
      date: m.date,
      time: m.time,
      location: m.location ?? "",
      agenda: m.agenda ?? "",
      notes: m.notes ?? "",
      attendees: m.attendees ?? [],
      raci: m.raci ?? [],
      actionItems: m.actionItems ?? [],
    });
    setDialogOpen(true);
  };

  const toggleAttendee = (empId: string) => setForm((f) => ({
    ...f, attendees: f.attendees.includes(empId) ? f.attendees.filter((x) => x !== empId) : [...f.attendees, empId],
  }));

  const setRaci = (rowId: string, empId: string, role: RaciRole) => setForm((f) => ({
    ...f,
    raci: f.raci.map((r) => r.id === rowId
      ? { ...r, assignments: { ...r.assignments, [empId]: role } }
      : r),
  }));

  const onSubmit = async () => {
    if (!form.title.trim()) { toast.error("Title required"); return; }
    if (form.attendees.length === 0) { toast.error("Add at least one attendee"); return; }
    try {
      // Explicitly include both key names so PHP backend always receives action items
      // regardless of whether it reads camelCase or snake_case from the JSON body.
      const payload = {
        title: form.title,
        date: form.date,
        time: form.time,
        location: form.location,
        agenda: form.agenda,
        notes: form.notes,
        attendees: form.attendees,
        raci: form.raci,
        actionItems: form.actionItems,   // camelCase — controller reads this
        action_items: form.actionItems,  // snake_case — fallback for controller
      };
      if (editing) await meetingsApi.update(editing.id!, payload as any);
      else await meetingsApi.create(form);
      toast.success(editing ? "Meeting updated" : "Meeting created");
      setDialogOpen(false); load();
    } catch (e: any) { toast.error(e.message); }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try { await meetingsApi.remove(confirmDelete.id); toast.success("Meeting removed"); setConfirmDelete(null); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const updateActionStatus = async (m: Meeting, aiId: string, status: ActionStatus) => {
    const updated = m.actionItems.map((a) => a.id === aiId ? { ...a, status } : a);
    try {
      // Send both key names so PHP always finds the data
      await meetingsApi.update(m.id!, { actionItems: updated, action_items: updated } as any);
      load();
      if (view?.id === m.id) setView({ ...m, actionItems: updated });
    }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Meetings &amp; RACI</h1>
          <p className="text-muted-foreground">Log meetings, capture decisions and assign responsibility.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" />New Meeting</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Meetings" value={String(stats.total)} subtitle="all time" icon={CalendarClock} />
        <StatCard title="Upcoming" value={String(stats.upcoming)} subtitle="from today" icon={Users} />
        <StatCard title="Action Items" value={String(stats.totalActions)} subtitle="total tracked" icon={ClipboardList} />
        <StatCard title="Open Actions" value={String(stats.openActions)} subtitle="needs follow-up" icon={ChevronRight} subtitleColor="muted" />
      </div>

      <div className="bg-card rounded-xl border p-4 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search meetings, location, ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Title</th>
                <th className="text-left px-4 py-3 font-medium">Date / Time</th>
                <th className="text-left px-4 py-3 font-medium">Location</th>
                <th className="text-right px-4 py-3 font-medium">Attendees</th>
                <th className="text-right px-4 py-3 font-medium">Actions Open</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No meetings.</td></tr>}
              {!loading && filtered.map((m) => {
                const total = m.actionItems.length;
                const openCount = m.actionItems.filter((a) => a.status !== "Done").length;
                // Badge colour: green = all done, orange = some open, red = all open (none done)
                const doneCount = total - openCount;
                const badgeClass = total === 0
                  ? "bg-gray-100 text-gray-500"
                  : openCount === 0
                    ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
                    : doneCount === 0
                      ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"
                      : "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300";
                // Status label for the clickable badge
                const statusLabel: string = total === 0
                  ? "Open"
                  : openCount === 0
                    ? "Done"
                    : doneCount === 0
                      ? "Open"
                      : "In Progress";
                const statusBadgeClass = statusLabel === "Done"
                  ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
                  : statusLabel === "In Progress"
                    ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-300";
                return (
                  <tr key={m.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-card-foreground">{m.id}</td>
                    <td className="px-4 py-3">{m.title}</td>
                    <td className="px-4 py-3">{m.date} <span className="text-muted-foreground">{m.time}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{m.location || "—"}</td>
                    <td className="px-4 py-3 text-right">{m.attendees.length}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeClass}`}>
                        {openCount} / {total}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setView(m)}
                          className={`text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap transition-opacity hover:opacity-80 cursor-pointer ${statusBadgeClass}`}
                        >
                          {statusLabel}
                        </button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(m)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableX>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!view} onOpenChange={(o) => { if (!o) { setView(null); setDetailTab("details"); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {view && (
            <>
              <DialogHeader>
                <DialogTitle>{view.title}</DialogTitle>
                <DialogDescription>
                  {view.id} · {view.date} {view.time} · {view.location || "No location"}
                </DialogDescription>
              </DialogHeader>

              {/* Detail tabs */}
              <div className="flex border-b">
                <button
                  onClick={() => setDetailTab("details")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${detailTab === "details" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  Details
                </button>
                <button
                  onClick={() => setDetailTab("media")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${detailTab === "media" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  <ImagePlus className="h-3.5 w-3.5" /> Media
                </button>
              </div>

              {detailTab === "media" && view.meeting_id != null && (
                <MeetingMediaPanel meetingId={Number(view.meeting_id)} />
              )}
              {detailTab === "media" && view.meeting_id == null && (
                <p className="text-sm text-muted-foreground py-4">Save this meeting first to attach media.</p>
              )}

              {detailTab === "details" && (
              <>
              <section className="space-y-1">
                <h4 className="text-sm font-semibold text-foreground">Agenda</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{view.agenda || "—"}</p>
              </section>

              <section className="space-y-1">
                <h4 className="text-sm font-semibold text-foreground">Notes</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{view.notes || "—"}</p>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-foreground mb-2">Attendees ({view.attendees.length})</h4>
                <div className="flex flex-wrap gap-2">
                  {view.attendees.map((id) => (
                    <span key={id} className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
                      {empMap[id]?.name ?? id}
                    </span>
                  ))}
                </div>
              </section>

              {/* RACI matrix */}
              {view.raci.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold text-foreground mb-2">RACI Matrix</h4>
                  <ScrollableX className="rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Deliverable</th>
                          {view.attendees.map((id) => (
                            <th key={id} className="px-2 py-2 font-medium text-center min-w-[80px]">
                              {empMap[id]?.name.split(" ")[0] ?? id}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {view.raci.map((r) => (
                          <tr key={r.id} className="border-t">
                            <td className="px-3 py-2 font-medium">{r.deliverable || "—"}</td>
                            {view.attendees.map((id) => {
                              const role = (r.assignments[id] ?? "-") as RaciRole;
                              return (
                                <td key={id} className="px-2 py-2 text-center">
                                  <span className={`inline-block w-7 h-7 leading-7 rounded-full text-[11px] font-bold ${RACI_LABELS[role].color}`}>{role === "-" ? "" : role}</span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollableX>
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
                    {RACI_ROLES.filter((r) => r !== "-").map((r) => (
                      <div key={r} className="flex items-center gap-1">
                        <span className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${RACI_LABELS[r].color}`}>{r}</span>
                        {RACI_LABELS[r].label}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Action items */}
              {view.actionItems.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold text-foreground mb-2">Action Items</h4>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2">Description</th>
                          <th className="text-left px-3 py-2">Owner</th>
                          <th className="text-left px-3 py-2">Due</th>
                          <th className="text-left px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.actionItems.map((a) => (
                          <tr key={a.id} className="border-t">
                            <td className="px-3 py-2">{a.description}</td>
                            <td className="px-3 py-2">{empMap[a.ownerId]?.name ?? a.ownerId}</td>
                            <td className="px-3 py-2">{a.dueDate}</td>
                            <td className="px-3 py-2">
                              <Select value={a.status} onValueChange={(v) => updateActionStatus(view, a.id, v as ActionStatus)}>
                                <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {(["Open", "In Progress", "Done"] as ActionStatus[]).map((s) => (
                                    <SelectItem key={s} value={s}>
                                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[s]}`}>{s}</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              </>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setView(null)}>Close</Button>
                <Button onClick={() => { openEdit(view); setView(null); }}>Edit</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.id}` : "New Meeting"}</DialogTitle>
            <DialogDescription>Schedule, log notes, assign RACI roles and capture action items.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2 md:col-span-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><Label>Time</Label><Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
            <div className="col-span-2 md:col-span-4"><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Conference room, Zoom link..." /></div>
            <div className="col-span-2 md:col-span-4"><Label>Agenda</Label><Textarea rows={2} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} /></div>
            <div className="col-span-2 md:col-span-4"><Label>Notes / Minutes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>

          <section>
            <Label className="block mb-2">Attendees</Label>
            <div className="flex flex-wrap gap-2">
              {employees.map((e) => {
                const sel = form.attendees.includes(e.id);
                return (
                  <button
                    key={e.id} type="button" onClick={() => toggleAttendee(e.id)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${sel ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted text-muted-foreground"}`}
                  >
                    {e.name}
                  </button>
                );
              })}
            </div>
          </section>

          {/* RACI editor */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <Label>RACI Matrix</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, raci: [...form.raci, newRaciRow()] })}>
                <Plus className="h-4 w-4" /> Add deliverable
              </Button>
            </div>
            {form.attendees.length === 0
              ? <p className="text-xs text-muted-foreground">Pick attendees first to assign RACI roles.</p>
              : (
                <ScrollableX className="rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium min-w-[180px]">Deliverable</th>
                        {form.attendees.map((id) => <th key={id} className="px-2 py-2 font-medium text-center">{empMap[id]?.name.split(" ")[0] ?? id}</th>)}
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.raci.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-1">
                            <Input value={r.deliverable} onChange={(e) => setForm({ ...form, raci: form.raci.map((x) => x.id === r.id ? { ...x, deliverable: e.target.value } : x) })} placeholder="e.g. Weekly QC report" />
                          </td>
                          {form.attendees.map((id) => (
                            <td key={id} className="px-1 py-1">
                              <Select value={r.assignments[id] ?? "-"} onValueChange={(v) => setRaci(r.id, id, v as RaciRole)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {RACI_ROLES.map((role) => <SelectItem key={role} value={role}>{role === "-" ? "—" : `${role} · ${RACI_LABELS[role].label}`}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </td>
                          ))}
                          <td>
                            <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, raci: form.raci.filter((x) => x.id !== r.id) })}><X className="h-4 w-4 text-destructive" /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableX>
              )}
          </section>

          {/* Action items */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <Label>Action Items</Label>
              <Button size="sm" variant="outline" onClick={() => setForm({ ...form, actionItems: [...form.actionItems, newAction()] })}>
                <Plus className="h-4 w-4" /> Add action
              </Button>
            </div>
            {form.actionItems.length === 0
              ? <p className="text-xs text-muted-foreground">No action items yet.</p>
              : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-2">Description</th>
                        <th className="text-left px-2 py-2 w-40">Owner</th>
                        <th className="text-left px-2 py-2 w-36">Due</th>
                        <th className="text-left px-2 py-2 w-32">Status</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.actionItems.map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="px-2 py-1">
                            <Input value={a.description} onChange={(e) => {
                              const val = e.target.value, aid = a.id;
                              setForm((f) => ({ ...f, actionItems: f.actionItems!.map((x) => x.id === aid ? { ...x, description: val } : x) }));
                            }} />
                          </td>
                          <td className="px-2 py-1">
                            <Select value={a.ownerId} onValueChange={(v) => {
                              const aid = a.id;
                              setForm((f) => ({ ...f, actionItems: f.actionItems!.map((x) => x.id === aid ? { ...x, ownerId: v } : x) }));
                            }}>
                              <SelectTrigger className="h-9"><SelectValue placeholder="Owner" /></SelectTrigger>
                              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1"><Input type="date" value={a.dueDate} onChange={(e) => {
                            const val = e.target.value, aid = a.id;
                            setForm((f) => ({ ...f, actionItems: f.actionItems!.map((x) => x.id === aid ? { ...x, dueDate: val } : x) }));
                          }} /></td>
                          <td className="px-2 py-1">
                            <Select value={a.status} onValueChange={(v) => {
                              const aid = a.id;
                              setForm((f) => ({ ...f, actionItems: f.actionItems!.map((x) => x.id === aid ? { ...x, status: v as ActionStatus } : x) }));
                            }}>
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>{(["Open", "In Progress", "Done"] as ActionStatus[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td>
                            <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, actionItems: form.actionItems.filter((x) => x.id !== a.id) })}><X className="h-4 w-4 text-destructive" /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={onSubmit}>{editing ? "Save changes" : "Create meeting"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && <>This will permanently remove <strong>{confirmDelete.id}</strong>: "{confirmDelete.title}".</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
