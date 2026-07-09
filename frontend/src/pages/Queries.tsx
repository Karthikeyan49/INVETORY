import { Search, Eye, User, Mail, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { queriesApi, type Query, type QueryStatus } from "@/lib/api/queries";
import { ScrollableX } from "@/components/ui/scrollable-x";

const statusColors: Record<string, string> = {
  "New":         "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "In Progress": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Resolved":    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export default function Queries() {
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [viewQuery, setViewQuery] = useState<Query | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState<QueryStatus>("In Progress");

  useEffect(() => {
    queriesApi.list()
      .then(setQueries)
      .catch(() => toast.error("Failed to load queries"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = queries.filter(q => {
    const matchSearch = q.name.toLowerCase().includes(search.toLowerCase()) ||
      q.email.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase()) ||
      q.message.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "All" || q.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const openView = (q: Query) => {
    setViewQuery(q);
    setReplyText(q.adminReply);
    setReplyStatus(q.status === "New" ? "In Progress" : q.status);
  };

  const handleReply = async () => {
    if (!viewQuery) return;
    setSaving(true);
    try {
      await queriesApi.reply(viewQuery._queryId, replyText, replyStatus);
      setQueries(prev => prev.map(q =>
        q.id === viewQuery.id ? { ...q, adminReply: replyText, status: replyStatus } : q
      ));
      toast.success(`Query ${viewQuery.id} updated`);
      setViewQuery(null);
    } catch {
      toast.error("Failed to update query");
    } finally {
      setSaving(false);
    }
  };

  const counts = {
    All:          queries.length,
    New:          queries.filter(q => q.status === "New").length,
    "In Progress": queries.filter(q => q.status === "In Progress").length,
    Resolved:     queries.filter(q => q.status === "Resolved").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">Customer Complaints</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage customer complaints submitted from the mobile app</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["All", "New", "In Progress", "Resolved"] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
              filterStatus === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {s} ({counts[s]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search queries..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 font-medium text-muted-foreground">Query ID</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Customer</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Message</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && filtered.map(q => (
                <tr key={q.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-3 font-mono text-xs text-primary">{q.id}</td>
                  <td className="p-3">
                    <div className="font-medium text-card-foreground">{q.name}</div>
                    <div className="text-xs text-muted-foreground">{q.email}</div>
                  </td>
                  <td className="p-3 max-w-xs truncate text-muted-foreground">{q.message}</td>
                  <td className="p-3 text-muted-foreground">{q.date}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={statusColors[q.status]}>{q.status}</Badge>
                  </td>
                  <td className="p-3">
                    <Button variant="ghost" size="sm" onClick={() => openView(q)}>
                      <Eye className="h-4 w-4 mr-1" /> View
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No queries found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>

      {/* View / Reply Dialog */}
      <Dialog open={!!viewQuery} onOpenChange={open => !open && setViewQuery(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Query {viewQuery?.id}</DialogTitle>
            <DialogDescription>View and respond to customer query</DialogDescription>
          </DialogHeader>
          {viewQuery && (
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-card-foreground">{viewQuery.name}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{viewQuery.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{viewQuery.date}</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-card-foreground">Customer Message</label>
                <div className="mt-1 bg-muted/20 border border-border rounded-lg p-3 text-sm text-card-foreground">
                  {viewQuery.message}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-card-foreground">Admin Reply</label>
                <Textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type your reply to the customer..."
                  className="mt-1"
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-card-foreground">Update Status</label>
                <Select value={replyStatus} onValueChange={v => setReplyStatus(v as QueryStatus)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewQuery(null)}>Cancel</Button>
            <Button onClick={handleReply} disabled={saving}>{saving ? "Saving…" : "Save & Update"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
