import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Briefcase, DollarSign, Download, Printer, Search, ExternalLink, Eye, Copy, ArrowLeft, Trophy } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { parseNotesText } from "@/lib/parse-notes";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";
import { useDateFilter } from "@/lib/use-date-filter";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { useOwnerFilter } from "@/lib/global-filters";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";

// Full-page view of every WON deal — the same data + table that the Reports
// page shows in its stage-detail drawer (GET /api/reports/stage-detail?stage=Won),
// promoted to a dedicated route (/won-deals) linked from the Dashboard's
// "Won Value" card. Respects the shared global filters (date range / unit /
// owner) exactly like Dashboard and Reports do.
export default function WonDeals() {
  const [, navigate] = useLocation();
  const [dateFilter, setDateFilter] = useDateFilter();
  const [unit, setUnit] = useUnitFilter();
  const [ownerId, setOwnerId] = useOwnerFilter();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: me } = useGetMe();
  const { data: users } = useCustomerFacingUsers();
  const { units: activeUnits } = useActiveUnits();
  const canViewAllReports = me?.role === "admin" || me?.canViewAllReports;

  const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;

  const { data: result, isLoading } = useQuery({
    queryKey: ["won-deals", dateFilter.startDate, dateFilter.endDate, unit, ownerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("stage", "Won");
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      if (unit !== "All") params.set("unit", unit);
      if (ownerId) params.set("salesOwnerId", ownerId);
      const res = await fetch(`/api/reports/stage-detail?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{ success: boolean; data: any[]; total: number }>;
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const records: any[] = useMemo(() => result?.data ?? [], [result]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.toLowerCase();
    return records.filter(r =>
      (r.customerName?.toLowerCase() ?? "").includes(q) ||
      (r.companyName?.toLowerCase() ?? "").includes(q) ||
      (r.mobile ?? "").includes(searchQuery) ||
      (r.city?.toLowerCase() ?? "").includes(q) ||
      (r.salesPerson?.toLowerCase() ?? "").includes(q) ||
      (r.notes?.toLowerCase() ?? "").includes(q)
    );
  }, [records, searchQuery]);

  const totalValue = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.dealValue ?? 0), 0),
    [filtered]
  );

  // Same CSV shape as the Reports drawer's Won-mode export
  const downloadCsv = () => {
    if (!filtered.length) return;
    const headers = ["Customer Name","Company Name","Mobile","City","Sales Person","Unit","Product","Type","Won Date","Notes","Deal Value"];
    const key: Record<string, string> = {
      "Customer Name": "customerName",
      "Company Name": "companyName",
      "Mobile": "mobile",
      "City": "city",
      "Sales Person": "salesPerson",
      "Unit": "unit",
      "Product": "product",
      "Type": "type",
      "Won Date": "lostDate",
      "Notes": "notes",
      "Deal Value": "dealValue",
    };
    const csv = [
      headers.join(","),
      ...filtered.map((r: any) =>
        headers.map(h => {
          const val = r[key[h]] ?? "";
          const str = String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Won-deals.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} title="Back to Dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-green-600" />
            Won Deals
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Every deal closed as Won under the current filters.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Briefcase className="h-8 w-8 text-green-500/60" />
            <div>
              <p className="text-xs text-muted-foreground">Total Won Deals</p>
              <p className="text-2xl font-bold">{isLoading ? "…" : records.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="h-8 w-8 text-amber-500/60" />
            <div>
              <p className="text-xs text-muted-foreground">Total Won Value</p>
              <p className="text-2xl font-bold text-green-600">₹{totalValue.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Global filters — same shared state as Dashboard / Reports */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Units" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Units</SelectItem>
              <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit</SelectItem>
              {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
          {canViewAllReports && (
            <Select value={ownerId || "all"} onValueChange={v => setOwnerId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All Owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Owners</SelectItem>
                {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <ClearFiltersButton />
        </div>
      </div>

      {/* Search + Export */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search records..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="h-3.5 w-3.5 mr-1" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5 mr-1" />
            Print
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {records.length} record{records.length !== 1 ? "s" : ""}
      </p>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Customer Name</TableHead>
              <TableHead className="whitespace-nowrap">Company Name</TableHead>
              <TableHead className="whitespace-nowrap">Mobile</TableHead>
              <TableHead className="whitespace-nowrap">City</TableHead>
              <TableHead className="whitespace-nowrap">Sales Person</TableHead>
              <TableHead className="whitespace-nowrap">Unit</TableHead>
              <TableHead className="whitespace-nowrap">Product</TableHead>
              <TableHead className="whitespace-nowrap">Type</TableHead>
              <TableHead className="whitespace-nowrap">Completed Date</TableHead>
              <TableHead className="whitespace-nowrap">Notes</TableHead>
              <TableHead className="whitespace-nowrap text-right">Deal Value</TableHead>
              <TableHead className="whitespace-nowrap text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">Loading won deals…</TableCell>
              </TableRow>
            ) : (
              <>
                {filtered.map((r: any) => (
                  <TableRow key={`${r.type}-${r.id}`}>
                    <TableCell className="font-medium whitespace-nowrap">
                      <Link href={`/leads/${r.contactId}`} className="hover:underline text-primary">
                        {r.customerName}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.companyName}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-sm">{r.mobile}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.city}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.salesPerson}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.unit}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.product || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={r.type === "deal" ? "default" : "secondary"} className="text-xs">
                        {r.type === "deal" ? "Deal" : "Lead"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.lostDate ? new Date(r.lostDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground" title={parseNotesText(r.notes) || undefined}>
                      {parseNotesText(r.notes) || "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-medium text-green-600">
                      {r.dealValue ? `₹${Number(r.dealValue).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Open Customer" asChild>
                          <Link href={`/leads/${r.contactId}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        {r.dealId && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Open Deal" asChild>
                            <Link href={`/leads/${r.contactId}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Copy Mobile"
                          onClick={() => { navigator.clipboard.writeText(r.mobile); }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      No won deals match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
