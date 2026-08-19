import { useState, useMemo, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useListContacts, useDeleteContact, useBulkDeleteContacts, getListContactsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Trash2, MessageSquare, MoreVertical, XCircle, CheckCheck, Mail, MailOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";
import { onContactChange, onDealChange } from "@/lib/query-invalidation";
import { UserAvatar } from "@/components/user-avatar";
import { ExportButton } from "@/components/export-button";
import { useActiveUnits } from "@/lib/use-active-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { useDateFilter } from "@/lib/use-date-filter";
import { useOwnerFilter } from "@/lib/global-filters";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { parseNotesText } from "@/lib/parse-notes";

const LEAD_FLAGS_KEY = "crm_lead_flags";

// ── Scroll position restoration ──────────────────────────────────────────
// The layout scrolls an inner <main data-scroll-region> container, not the
// window, so window.scrollY is always 0 here. Before a lead row is opened we
// stash the container's scrollTop on the CURRENT /leads history entry via
// history.replaceState (the entry we're about to leave). When the user returns
// with the browser/Back button, that exact entry is restored and we re-apply
// the offset after the list has rendered, then clear the marker so a later
// sidebar navigation to /leads starts from the top instead of re-applying a
// stale position.
const LEADS_SCROLL_STATE_KEY = "leadsScrollY";

const getLeadsScrollContainer = () => document.querySelector<HTMLElement>("main[data-scroll-region]");

const saveLeadsScrollPosition = () => {
  const el = getLeadsScrollContainer();
  if (!el) return;
  const prev = window.history.state && typeof window.history.state === "object"
    ? window.history.state as Record<string, unknown>
    : {};
  window.history.replaceState({ ...prev, [LEADS_SCROLL_STATE_KEY]: el.scrollTop }, "");
};

function loadLeadFlags(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LEAD_FLAGS_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function LeadFlagCell({ leadId, value, onSave }: { leadId: number; value: string; onSave: (id: number, value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(leadId, draft);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground block max-w-[120px] truncate cursor-text text-left"
        title={value || "Click to add a note"}
        onClick={() => { setDraft(value); setEditing(true); }}
      >
        {value || <span className="text-muted-foreground/60">—</span>}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      className="h-7 w-[120px] text-xs"
      data-no-cap="1"
      placeholder="Flag / note"
    />
  );
}

export default function Leads() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [globalOwner, setGlobalOwner] = useOwnerFilter();
  const salesOwnerId = globalOwner ? Number(globalOwner) : undefined;
  const setSalesOwnerId = (v: number | undefined) => setGlobalOwner(v === undefined ? "" : String(v));
  const [city, setCity] = useState<string | undefined>();
  // Category tab is synced to the URL (?category=...) so the browser Back
  // button from a lead detail page restores the exact tab the user was on.
  const urlCategory = useMemo(() => {
    const p = new URLSearchParams(searchStr);
    return p.get("category") || undefined;
  }, [searchStr]);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(urlCategory);
  const [unitFilter, setUnitFilter] = useUnitFilter();
  const [dateFilter, setDateFilter] = useDateFilter();
  const [hasDealFilter, setHasDealFilter] = useState<"all" | "yes" | "no">("all");

  const updateCategoryFilter = (next: string | undefined) => {
    setCategoryFilter(next);
    const p = new URLSearchParams(searchStr);
    if (next) p.set("category", next);
    else p.delete("category");
    const qs = p.toString();
    navigate(qs ? `/leads?${qs}` : "/leads", { replace: true });
  };

  // Mark Lost
  const [lostContactId, setLostContactId] = useState<number | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostSubmitting, setLostSubmitting] = useState(false);
  const [lostIsExistingClient, setLostIsExistingClient] = useState(false);

  // Single delete
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteName, setDeleteName] = useState<string>("");

  // Bulk selection & delete
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [markAllReadSubmitting, setMarkAllReadSubmitting] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteContact = useDeleteContact();
  const bulkDelete = useBulkDeleteContacts();

  // Personal flag/note column — localStorage only, never sent to the backend
  const [leadFlags, setLeadFlags] = useState<Record<string, string>>(loadLeadFlags);
  const setLeadFlag = (id: number, value: string) => {
    setLeadFlags(prev => {
      const next = { ...prev };
      if (value.trim() === "") delete next[String(id)];
      else next[String(id)] = value.trim();
      try { localStorage.setItem(LEAD_FLAGS_KEY, JSON.stringify(next)); } catch { /* storage full/unavailable */ }
      return next;
    });
  };

  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const canSeeExistingClient = me?.role === "admin" || me?.role === "production" || me?.role === "production_and_support";
  const { units: activeUnits } = useActiveUnits();

  // Fetch category counts (using same filters as the list for consistency)
  const { data: categoryCounts } = useQuery({
    queryKey: ["category-counts", unitFilter, dateFilter.startDate, dateFilter.endDate],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const countParams = new URLSearchParams();
      if (unitFilter !== "All") countParams.set("unit", unitFilter);
      if (dateFilter.startDate) countParams.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) countParams.set("endDate", dateFilter.endDate);
      const qs = countParams.toString();
      const res = await fetch(`/api/categories/counts${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      return res.json() as Promise<{ category: string; count: number }[]>;
    },
    staleTime: 10_000,
  });

  const totalCount = useMemo(() => {
    if (!categoryCounts) return 0;
    return categoryCounts
      .filter(c => c.category !== "Existing Client")
      .reduce((sum, c) => sum + c.count, 0);
  }, [categoryCounts]);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["leads-contacts", search, salesOwnerId, city, categoryFilter, unitFilter, dateFilter.preset, dateFilter.startDate, dateFilter.endDate],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (isAdmin && salesOwnerId) params.set("salesOwnerId", String(salesOwnerId));
      if (city) params.set("city", city);
      if (categoryFilter) params.set("category", categoryFilter);
      if (unitFilter !== "All") params.set("unit", unitFilter);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      const res = await fetch(`/api/contacts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json() as any[];
      console.log("[DEBUG] leads-list - unit values:", JSON.stringify(data.map((c: any) => ({ id: c.id, name: c.name, unit: c.unit, unitType: typeof c.unit }))));
      return data;
    },
    staleTime: 10_000,
  });
  const { data: users } = useCustomerFacingUsers();

  // Restore the saved scroll offset once the list has rendered. Runs after the
  // initial load flips isLoading=false (data present, table in the DOM), then
  // clears the marker so subsequent /leads mounts start at the top.
  useEffect(() => {
    if (isLoading) return;
    const state = window.history.state;
    const saved = state && typeof state === "object"
      ? (state as Record<string, unknown>)[LEADS_SCROLL_STATE_KEY]
      : undefined;
    if (saved == null) return;
    const current = window.history.state;
    if (current && typeof current === "object") {
      const next = { ...(current as Record<string, unknown>) };
      delete next[LEADS_SCROLL_STATE_KEY];
      window.history.replaceState(next, "");
    }
    const el = getLeadsScrollContainer();
    if (el) el.scrollTop = Number(saved);
  }, [isLoading]);

  const unreadCount = contacts?.filter((c: any) => !c.isRead).length ?? 0;

  // Frontend filter: Has Deal
  const filteredContacts = useMemo(() => {
    if (!contacts) return contacts;
    if (hasDealFilter === "all") return contacts;
    return contacts.filter((c: any) => hasDealFilter === "yes" ? c.hasDeals : !c.hasDeals);
  }, [contacts, hasDealFilter]);

  const allIds = filteredContacts?.map(c => c.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const toggleOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSingleDeleteConfirm = () => {
    if (!deleteId) return;
    deleteContact.mutate({ id: deleteId }, {
      onSuccess: () => {
        onContactChange(queryClient);
        toast({ title: `"${deleteName}" deleted` });
        setDeleteId(null);
        setSelectedIds(prev => { const n = new Set(prev); n.delete(deleteId); return n; });
      },
      onError: () => {
        toast({ title: "Failed to delete lead", variant: "destructive" });
        setDeleteId(null);
      },
    });
  };

  const handleBulkDeleteConfirm = () => {
    const ids = Array.from(selectedIds);
    bulkDelete.mutate({ data: { ids } }, {
      onSuccess: (result) => {
        onContactChange(queryClient);
        toast({ title: `${result.deleted} lead${result.deleted !== 1 ? "s" : ""} deleted` });
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
      },
      onError: () => {
        toast({ title: "Bulk delete failed", variant: "destructive" });
        setBulkDeleteOpen(false);
      },
    });
  };

  const handleMarkLost = (data: { lostReason: string; otherReason: string; lostNotes: string; lostCategory?: string }) => {
    if (!lostContactId) return;
    setLostSubmitting(true);
    fetch(`/api/contacts/${lostContactId}/mark-lost`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      body: JSON.stringify(data),
    }).then(async (res) => {
      setLostSubmitting(false);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to mark as Lost", variant: "destructive" });
        return;
      }
      setLostOpen(false);
      setLostContactId(null);
      onContactChange(queryClient);
      toast({ title: "Inquiry marked as Lost" });
    }).catch(() => {
      setLostSubmitting(false);
      toast({ title: "Error", description: "Failed to mark as Lost. Please try again.", variant: "destructive" });
    });
  };

  const markLeadAsRead = (id: number) => {
    // Fire-and-forget background request to persist the read state.
    // Optimistic cache replacement is avoided because role-based read state
    // (isReadByAdmin vs isReadByAssignee) means setting isRead=true for ALL
    // cached contacts is incorrect — e.g. an admin reading a salesperson's lead
    // should not clear the salesperson's dot. The query will refetch on return.
    fetch(`/api/contacts/${id}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
    }).catch(() => {});
  };

  // Manual read/unread toggle from the row actions menu.
  const toggleReadMutation = useMutation({
    mutationFn: async ({ id, isRead }: { id: number; isRead: boolean }) => {
      const res = await fetch(`/api/contacts/${id}/read-status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("crm_token")}`,
        },
        body: JSON.stringify({ isRead }),
      });
      if (!res.ok) throw new Error("Failed to update read status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
      toast({ title: "Failed to update read status", description: err?.message || "Please try again", variant: "destructive" });
    },
  });

  const handleMarkAllRead = async () => {
    setMarkAllReadSubmitting(true);
    try {
      const res = await fetch("/api/contacts/mark-all-read", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to mark all read");
      const result = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({
        title: "All leads marked as read",
        description: result?.updated ? `${result.updated} lead${result.updated !== 1 ? "s" : ""} marked as read` : undefined,
      });
    } catch (err: any) {
      toast({ title: "Failed to mark all read", description: err?.message || "Please try again", variant: "destructive" });
    } finally {
      setMarkAllReadSubmitting(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground mt-1">Manage and track your contacts.</p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllRead} disabled={markAllReadSubmitting}>
              <CheckCheck className="mr-2 h-4 w-4" /> Mark All Read
            </Button>
          )}
          <ExportButton
            exportUrl="/api/exports/contacts"
            filename="Leads"
            onBeforeExport={() => ({
              category: categoryFilter || "",
              search,
              ownerId: salesOwnerId ? String(salesOwnerId) : "",
              unit: unitFilter && unitFilter !== "All" ? unitFilter : "",
              city: city || "",
              dateFrom: dateFilter.startDate || "",
              dateTo: dateFilter.endDate || "",
            })}
          />
          <Link href="/leads/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New Lead
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex gap-4 items-center bg-card p-4 border rounded-lg shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, company, phone..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-no-cap="1"
          />
        </div>
        <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
        {isAdmin && (
          <Select value={salesOwnerId?.toString() || "all"} onValueChange={(v) => setSalesOwnerId(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Owners</SelectItem>
              {users?.map(u => (
                <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Units" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Units</SelectItem>
            <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit</SelectItem>
            {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={hasDealFilter} onValueChange={(v) => setHasDealFilter(v as "all" | "yes" | "no")}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Has Deal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Leads</SelectItem>
            <SelectItem value="yes">Has Deal</SelectItem>
            <SelectItem value="no">No Deal</SelectItem>
          </SelectContent>
        </Select>
        <ClearFiltersButton onClear={() => { setSearch(""); setHasDealFilter("all"); }} />
      </div>

      {/* Category filter tabs with counts */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
            !categoryFilter
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          onClick={() => updateCategoryFilter(undefined)}
        >
          All
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            !categoryFilter ? "bg-white/20" : "bg-background/80"
          }`}>
            {totalCount}
          </span>
        </button>
        {CATEGORIES.filter(cat => cat !== "Existing Client" || canSeeExistingClient).map(cat => {
          const count = categoryCounts?.find(c => c.category === cat)?.count ?? 0;
          return (
            <button
              key={cat}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
                categoryFilter === cat
                  ? "text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              style={categoryFilter === cat ? { backgroundColor: CATEGORY_COLORS[cat] } : {}}
              onClick={() => updateCategoryFilter(categoryFilter === cat ? undefined : cat)}
            >
              {cat}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                categoryFilter === cat ? "bg-white/20" : "bg-background/80"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bulk action bar — shown when items are selected */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/8 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
            className="h-8"
          >
            Clear selection
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-8 gap-1.5"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}
          </Button>
        </div>
      )}

      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>My Note</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Deals</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Comments</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={14} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : filteredContacts?.length === 0 ? (
              <TableRow><TableCell colSpan={14} className="text-center py-8 text-muted-foreground">No leads found.</TableCell></TableRow>
            ) : (
              filteredContacts?.map((contact) => {
                const isSelected = selectedIds.has(contact.id);
                const commentsText = parseNotesText(contact.customerComments);
                return (
                  <TableRow
                    key={contact.id}
                    className={`group ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <TableCell className="pl-4" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(contact.id)}
                        aria-label={`Select ${contact.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {!contact.isRead && (
                        <span
                          className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ring-2 align-middle ${
                            contact.isRepeatEnquiry ? "bg-yellow-500 ring-yellow-200" : "bg-blue-500 ring-blue-200"
                          }`}
                          title={contact.isRepeatEnquiry ? "Unread repeat enquiry" : "Newly assigned lead"}
                          aria-label={contact.isRepeatEnquiry ? "Unread repeat enquiry" : "Newly assigned lead"}
                        />
                      )}
                      <Link
                        href={`/leads/${contact.id}`}
                        onClick={() => { saveLeadsScrollPosition(); markLeadAsRead(contact.id); }}
                        className="hover:underline text-primary"
                      >
                        {contact.name}
                      </Link>
                      {contact.customerCode && <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">({contact.customerCode})</span>}
                    </TableCell>
                    <TableCell>{contact.companyName || "-"}</TableCell>
                    <TableCell>
                      <LeadFlagCell leadId={contact.id} value={leadFlags[String(contact.id)] || ""} onSave={setLeadFlag} />
                    </TableCell>
                    <TableCell>{contact.mobile}</TableCell>
                    <TableCell>{contact.city || "-"}</TableCell>
                    <TableCell>{contact.state || "-"}</TableCell>
                    <TableCell>
                      {contact.salesOwner && (
                        <div className="flex items-center gap-2">
                          <UserAvatar profilePhoto={contact.salesOwner.profilePhoto} name={contact.salesOwner.name} className="w-3 h-3" />
                          <span className="text-sm">{contact.salesOwner.name}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact.industry ? (
                        <Badge variant="outline">{contact.industry}</Badge>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      {(contact as any).hasDeals ? (
                        <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">Yes</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        {contact.category && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: `${CATEGORY_COLORS[contact.category] || "#6b7280"}20`,
                              color: CATEGORY_COLORS[contact.category] || "#6b7280",
                            }}
                          >
                            {contact.category}
                          </span>
                        )}
                        {(contact as any).customerSince && (contact as any).category !== "My Client" && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: `${CATEGORY_COLORS["My Client"]}20`, color: CATEGORY_COLORS["My Client"] }}
                            title={`Customer since ${(contact as any).customerSince}`}
                          >
                            My Client
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{contact.unit || PENDING_UNIT_ASSIGNMENT}</TableCell>
                    <TableCell className="max-w-[150px]">
                      {commentsText ? (
                        <div className="group relative">
                          <span className="text-xs text-muted-foreground cursor-pointer block truncate">
                            {commentsText.length > 100
                              ? `${commentsText.slice(0, 100)}...`
                              : commentsText}
                          </span>
                          {commentsText.length > 100 && (
                            <div className="fixed z-50 hidden group-hover:block">
                              <div className="absolute bottom-0 left-0 bg-popover border rounded-md shadow-lg p-3 text-xs whitespace-pre-wrap max-w-xs max-h-48 overflow-y-auto">
                                {commentsText}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                           <DropdownMenuItem onClick={() => toggleReadMutation.mutate({ id: contact.id, isRead: !contact.isRead })}>
                            {contact.isRead ? (
                              <>
                                <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                                <span>Mark Unread</span>
                              </>
                            ) : (
                              <>
                                <MailOpen className="h-4 w-4 mr-2 text-primary" />
                                <span>Mark Read</span>
                              </>
                            )}
                          </DropdownMenuItem>
                           <DropdownMenuItem onClick={() => { setLostContactId(contact.id); setLostIsExistingClient(contact.category === "My Client"); setLostOpen(true); }}>
                            <XCircle className="h-4 w-4 mr-2 text-red-500" />
                            <span>Mark Lost</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => { setDeleteId(contact.id); setDeleteName(contact.name); }}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Single delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the lead and all their deals and activity history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSingleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size === 1 ? "this lead" : `all ${selectedIds.size} selected leads`} along with their deals and activity history.
              <span className="block mt-1 font-medium text-destructive">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteConfirm}
              disabled={bulkDelete.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDelete.isPending ? "Deleting..." : `Delete ${selectedIds.size} Lead${selectedIds.size !== 1 ? "s" : ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MarkLostDialog
        open={lostOpen}
        onOpenChange={(o) => { setLostOpen(o); if (!o) { setLostContactId(null); setLostIsExistingClient(false); } }}
        onSave={handleMarkLost}
        saving={lostSubmitting}
        hideCategory={lostIsExistingClient}
      />
    </div>
  );
}
