import { useState } from "react";
import { Link } from "wouter";
import { useListContacts, useListUsers, useDeleteContact, useBulkDeleteContacts, getListContactsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";

export default function Leads() {
  const [search, setSearch] = useState("");
  const [salesOwnerId, setSalesOwnerId] = useState<number | undefined>();
  const [city, setCity] = useState<string | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [unitFilter, setUnitFilter] = useState<string | undefined>();

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

  const { data: contacts, isLoading } = useListContacts({
    search: search || undefined,
    salesOwnerId: isAdmin ? salesOwnerId : undefined,
    city: city || undefined,
    category: categoryFilter,
    unit: unitFilter || undefined,
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
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
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
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
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

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground mt-1">Manage and track your contacts.</p>
        </div>
        <Link href="/leads/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Lead
          </Button>
        </Link>
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
            <SelectItem value="Himatnagar">Himatnagar</SelectItem>
            <SelectItem value="Rajkot">Rajkot</SelectItem>
            <SelectItem value="Surat">Surat</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            !categoryFilter
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          onClick={() => setCategoryFilter(undefined)}
        >
          All
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              categoryFilter === cat
                ? "text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            style={categoryFilter === cat ? { backgroundColor: CATEGORY_COLORS[cat] } : {}}
            onClick={() => setCategoryFilter(categoryFilter === cat ? undefined : cat)}
          >
            {cat}
          </button>
        ))}
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
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: contact.salesOwner.colorCode || '#ccc' }}
                          />
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
                    <TableCell>{contact.unit || "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleteId(contact.id);
                          setDeleteName(contact.name);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
    </div>
  );
}
