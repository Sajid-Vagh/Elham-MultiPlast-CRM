import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";
import { CategoryBadge } from "@/components/category-badge";
import { MoveCategoryDialog } from "@/components/move-category-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

function CategoryCard({ name, count, color, onClick }: { name: string; count: number; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative overflow-hidden rounded-xl border-2 border-gray-100 p-5 text-left transition-all hover:shadow-md hover:border-gray-200 bg-white w-full"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{name}</p>
          <p className="text-3xl font-bold mt-1" style={{ color }}>{count}</p>
        </div>
        <span className="text-3xl">{name === "My Client" ? "⭐" : name === "Regular Follow up" ? "📋" : "📁"}</span>
      </div>
      <div
        className="absolute bottom-0 left-0 h-1"
        style={{ width: `${Math.min(100, count * 5)}%`, backgroundColor: color }}
      />
    </button>
  );
}

export default function CategoriesPage() {
  const [, setLocation] = useLocation();
  const [counts, setCounts] = useState<{ category: string; count: number }[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [unitFilter, setUnitFilter] = useState<string | undefined>();
  const perPage = 20;
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const userUnit = me?.unit && me.unit !== "All" ? me.unit : undefined;
  const activeUnit = isAdmin ? unitFilter : userUnit;

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeUnit) params.set("unit", activeUnit);

    let cancelled = false;

    fetch(`/api/categories/counts?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
    })
      .then(r => r.json())
      .then(data => { if (!cancelled && Array.isArray(data)) setCounts(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [activeUnit]);

  const contactsFetchRef = useRef(0);

  const selectCategory = async (category: string) => {
    setActiveCategory(category);
    setPage(1);
    setSelectedIds([]);

    const fetchId = ++contactsFetchRef.current;
    try {
      const params = new URLSearchParams();
      if (activeUnit) params.set("unit", activeUnit);

      const res = await fetch(`/api/categories/${encodeURIComponent(category)}/contacts?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (contactsFetchRef.current === fetchId) {
          setContacts(data);
        }
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to load contacts", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (activeCategory) {
      selectCategory(activeCategory);
    }
  }, [activeUnit]);

  const filteredContacts = useMemo(() => {
    if (!search) return contacts;
    const s = search.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(s) ||
        c.companyName?.toLowerCase().includes(s) ||
        c.mobile?.includes(s) ||
        c.city?.toLowerCase().includes(s)
    );
  }, [contacts, search]);

  const totalPages = Math.ceil(filteredContacts.length / perPage);
  const paginatedContacts = filteredContacts.slice((page - 1) * perPage, page * perPage);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === paginatedContacts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedContacts.map((c) => c.id));
    }
  };

  const exportCsv = () => {
    const headers = ["Name", "Company", "Mobile", "City", "Unit", "Category", "Assigned To", "Deal Stage", "Last Follow-up", "Next Follow-up"];
    const rows = contacts.map((c) => [
      c.name, c.companyName || "", c.mobile, c.city || "", c.unit || "",
      c.category || "",
      c.salesOwner?.name || "", c.deals?.map((d: any) => d.stage).join(", ") || "",
      c.lastCallDate || "", c.nextCallDate || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeCategory || "categories"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-6">Loading...</div>;

  const countMap = new Map(counts.map((c) => [c.category, c.count]));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categories</h1>
        <div className="flex gap-2">
          {activeCategory && (
            <>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation("/import")}
              >
                Import
              </Button>
            </>
          )}
        </div>
      </div>

      {!userUnit && (
        <div className="flex items-center gap-3">
          <Select value={unitFilter || "all"} onValueChange={(v) => setUnitFilter(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-[180px]">
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
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CATEGORIES.map((cat) => (
          <CategoryCard
            key={cat}
            name={cat}
            count={countMap.get(cat) ?? 0}
            color={CATEGORY_COLORS[cat]}
            onClick={() => selectCategory(cat)}
          />
        ))}
      </div>

      {activeCategory && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <span>{activeCategory === "My Client" ? "⭐" : activeCategory === "Regular Follow up" ? "📋" : "📁"}</span>
                {activeCategory}
                <span className="text-sm font-normal text-muted-foreground">
                  ({filteredContacts.length} records)
                </span>
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setActiveCategory(null); setContacts([]); }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, company, phone, city..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
              {selectedIds.length > 0 && (
                <Button size="sm" onClick={() => setShowMoveDialog(true)}>
                  Move ({selectedIds.length})
                </Button>
              )}
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={paginatedContacts.length > 0 && selectedIds.length === paginatedContacts.length}
                        onCheckedChange={selectAll}
                      />
                    </TableHead>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Deal Stage</TableHead>
                    <TableHead>Last Follow-up</TableHead>
                    <TableHead>Next Follow-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedContacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        No records found
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedContacts.map((c) => (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/leads/${c.id}`)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.includes(c.id)}
                            onCheckedChange={() => toggleSelect(c.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.companyName || "-"}</TableCell>
                        <TableCell>{c.mobile}</TableCell>
                        <TableCell>{c.city || "-"}</TableCell>
                        <TableCell>{c.unit || "-"}</TableCell>
                        <TableCell>{c.salesOwner?.name || "-"}</TableCell>
                        <TableCell><CategoryBadge category={c.category} /></TableCell>
                        <TableCell>
                          {c.deals?.length > 0
                            ? c.deals.map((d: any) => d.stage).join(", ")
                            : "-"}
                        </TableCell>
                        <TableCell>{c.lastCallDate ? new Date(c.lastCallDate).toLocaleDateString() : "-"}</TableCell>
                        <TableCell>{c.nextCallDate ? new Date(c.nextCallDate).toLocaleDateString() : "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <MoveCategoryDialog
        open={showMoveDialog}
        onOpenChange={setShowMoveDialog}
        contactIds={selectedIds}
        currentCategory={activeCategory}
        onSuccess={() => {
          selectCategory(activeCategory!);
          setSelectedIds([]);
        }}
      />
    </div>
  );
}
