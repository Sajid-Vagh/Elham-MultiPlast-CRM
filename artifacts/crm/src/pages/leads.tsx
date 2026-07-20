import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListContacts, useListUsers, useDeleteContact, useBulkDeleteContacts, getListContactsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Trash2, MessageSquare, MoreVertical, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";
import { onContactChange, onDealChange } from "@/lib/query-invalidation";
import { UserAvatar } from "@/components/user-avatar";
import { ExportDropdown } from "@/components/export-dropdown";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";

export default function Leads() {
  const [search, setSearch] = useState("");
  const [salesOwnerId, setSalesOwnerId] = useState<number | undefined>();
  const [city, setCity] = useState<string | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [unitFilter, setUnitFilter] = useState<string | undefined>();

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

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteContact = useDeleteContact();
  const bulkDelete = useBulkDeleteContacts();

  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const { units: activeUnits } = useActiveUnits();

  // Fetch category counts
  const { data: categoryCounts } = useQuery({
    queryKey: ["category-counts"],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch("/api/categories/counts", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      return res.json() as Promise<{ category: string; count: number }[]>;
    },
    staleTime: 30_000,
  });

  const totalCount = useMemo(() => {
    if (!categoryCounts) return 0;
    return categoryCounts.reduce((sum, c) => sum + c.count, 0);
  }, [categoryCounts]);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["leads-contacts", search, salesOwnerId, city, categoryFilter, unitFilter],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (isAdmin && salesOwnerId) params.set("salesOwnerId", String(salesOwnerId));
      if (city) params.set("city", city);
      if (categoryFilter) params.set("category", categoryFilter);
      if (unitFilter) params.set("unit", unitFilter);
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
  const { data: users } = useListUsers();

  const allIds = contacts?.map(c => c.id) ?? [];
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
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground mt-1">Manage and track your contacts.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown exportUrl="/api/exports/contacts" filename="Leads" />
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
            placeholder="Search leads..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-no-cap="1"
          />
        </div>
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
        <Select value={unitFilter || "all"} onValueChange={(v) => setUnitFilter(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Units" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit</SelectItem>
            {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category filter tabs with counts */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1 ${
            !categoryFilter
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          onClick={() => setCategoryFilter(undefined)}
        >
          All
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            !categoryFilter ? "bg-white/20" : "bg-background/80"
          }`}>
            {totalCount}
          </span>
        </button>
        {CATEGORIES.map(cat => {
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
              onClick={() => setCategoryFilter(categoryFilter === cat ? undefined : cat)}
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
              <TableHead>Mobile</TableHead>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Comments</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : contacts?.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No leads found.</TableCell></TableRow>
            ) : (
              contacts?.map((contact) => {
                const isSelected = selectedIds.has(contact.id);
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
                      <Link href={`/leads/${contact.id}`} className="hover:underline text-primary">
                        {contact.name}
                      </Link>
                    </TableCell>
                    <TableCell>{contact.companyName || "-"}</TableCell>
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
                    </TableCell>
                    <TableCell>{contact.unit || PENDING_UNIT_ASSIGNMENT}</TableCell>
                    <TableCell className="max-w-[150px]">
                      {contact.customerComments ? (
                        <div className="group relative">
                          <span className="text-xs text-muted-foreground cursor-pointer block truncate">
                            {contact.customerComments.length > 100
                              ? `${contact.customerComments.slice(0, 100)}...`
                              : contact.customerComments}
                          </span>
                          {contact.customerComments.length > 100 && (
                            <div className="fixed z-50 hidden group-hover:block">
                              <div className="absolute bottom-0 left-0 bg-popover border rounded-md shadow-lg p-3 text-xs whitespace-pre-wrap max-w-xs max-h-48 overflow-y-auto">
                                {contact.customerComments}
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
