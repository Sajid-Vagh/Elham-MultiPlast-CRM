import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useGetPipelineReport, useGetReportByOwner, useGetReportByCity,
  useGetReportByProduct, useListUsers, useGetReportLostReasons, useGetMe
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, Tooltip, Sector } from "recharts";
import { TrendingUp, Users, Briefcase, DollarSign, XCircle, Download, Search, Phone, ExternalLink, Eye, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/user-avatar";
import { STAGE_CHART_COLORS } from "@/lib/deal-stages";
import { useActiveUnits } from "@/lib/use-active-units";
import { ExportDropdown } from "@/components/export-dropdown";

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Input type="month" value={value} onChange={e => onChange(e.target.value)} className="w-40" />;
}

function UnitPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { units: activeUnits } = useActiveUnits();
  return (
    <Select value={value || "all"} onValueChange={v => onChange(v === "all" ? "" : v)}>
      <SelectTrigger className="w-36"><SelectValue placeholder="All Units" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Units</SelectItem>
        {activeUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}



const PIE_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#60a5fa","#a78bfa","#f472b6","#94a3b8"];

function downloadCSV(data: any[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        const str = val == null ? "" : String(val);
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
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [month, setMonth] = useState("");
  const [unit, setUnit] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [activeTab, setActiveTab] = useState("pipeline");
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailData, setDetailData] = useState<{ data?: any[]; records?: any[]; total: number; totalValue: number } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [, navigate] = useLocation();

  const { data: summary } = useQuery({
    queryKey: ["report-summary", ownerId, unit],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (ownerId) params.set("ownerId", ownerId);
      if (unit) params.set("unit", unit);
      const res = await fetch(`/api/reports/summary?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json() as Promise<{ totalContacts: number; totalDeals: number; wonDeals: number; lostDeals: number; activeDeals: number; totalWonValue: number; upcomingFollowUps: number; newLeadsThisMonth?: number }>;
    },
    enabled: !!localStorage.getItem("crm_token"),
    staleTime: 30_000,
  });
  const { data: pipeline } = useGetPipelineReport({ month: month || undefined, unit: unit || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byOwner } = useGetReportByOwner({ month: month || undefined, unit: unit || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byCity } = useGetReportByCity({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byProduct } = useGetReportByProduct({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { toast } = useToast();
  const { data: lostReasons } = useGetReportLostReasons({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined, unit: unit || undefined });
  const { data: me } = useGetMe();
  const { data: users } = useListUsers();
  const canViewAllReports = me?.role === "admin" || me?.canViewAllReports;

  const totalLost = lostReasons?.reduce((s, r) => s + r.count, 0) ?? 0;

  const goDeals = (stage?: string, owner?: number) => {
    const p = new URLSearchParams();
    if (stage) p.set("stage", stage);
    if (owner) p.set("owner", String(owner));
    navigate(`/deals?${p.toString()}`);
  };

  const getCurrentTabData = useCallback(() => {
    switch (activeTab) {
      case "pipeline": return pipeline;
      case "by-owner": return byOwner;
      case "by-city": return byCity;
      case "by-product": return byProduct;
      case "lost-reasons": return lostReasons;
      default: return [];
    }
  }, [activeTab, pipeline, byOwner, byCity, byProduct, lostReasons]);

  const exportCSV = useCallback(() => {
    const data = getCurrentTabData() ?? [];
    downloadCSV(data, `report-${activeTab}.csv`);
  }, [getCurrentTabData, activeTab]);

  const exportPrint = useCallback(() => {
    window.print();
  }, []);

  const exportExcel = useCallback(() => {
    const data = getCurrentTabData() ?? [];
    downloadCSV(data, `report-${activeTab}.csv`);
  }, [getCurrentTabData, activeTab]);

  const fetchLostDetail = useCallback(async (reason: string) => {
    setDetailLoading(true);
    setSelectedReason(reason);
    setDetailSearch("");
    try {
      const token = localStorage.getItem("crm_token");
      const p = new URLSearchParams();
      p.set("reason", reason);
      if (month) p.set("month", month);
      if (unit) p.set("unit", unit);
      if (ownerId) p.set("salesOwnerId", ownerId);
      const url = `/api/reports/lost-reasons/detail?${p.toString()}`;
      console.log("Fetching lost detail:", url);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
        setDetailOpen(true);
        toast({ title: "Lost Records", description: `${data.length} records loaded` });
      } else {
        const text = await res.text();
        console.error("Lost detail fetch failed:", res.status, text);
        toast({ title: "Error", description: `Server returned ${res.status}: ${text.slice(0, 200)}`, variant: "destructive" });
      }
    } catch (err) {
      console.error("Failed to fetch lost reason detail", err);
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [month, unit, ownerId]);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">Sales analytics and performance</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><Briefcase className="h-8 w-8 text-primary/60" /><div><p className="text-xs text-muted-foreground">Total Deals</p><p className="text-2xl font-bold">{summary?.totalDeals ?? 0}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><TrendingUp className="h-8 w-8 text-green-500/60" /><div><p className="text-xs text-muted-foreground">Won</p><p className="text-2xl font-bold text-green-600">{summary?.wonDeals ?? 0}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Users className="h-8 w-8 text-blue-500/60" /><div><p className="text-xs text-muted-foreground">Leads</p><p className="text-2xl font-bold">{summary?.totalContacts ?? 0}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><DollarSign className="h-8 w-8 text-amber-500/60" /><div><p className="text-xs text-muted-foreground">Won Value</p><p className="text-xl font-bold">₹{Number(summary?.totalWonValue ?? 0).toLocaleString()}</p></div></CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="by-owner">By Owner</TabsTrigger>
            <TabsTrigger value="by-city">By City</TabsTrigger>
            <TabsTrigger value="by-product">By Product</TabsTrigger>
            <TabsTrigger value="lost-reasons">
              <XCircle className="h-3.5 w-3.5 mr-1 text-red-400" />
              Lost Reasons
            </TabsTrigger>
          </TabsList>
          <div className="flex gap-2 flex-wrap">
            <MonthPicker value={month} onChange={setMonth} />
            <UnitPicker value={unit} onChange={setUnit} />
            {canViewAllReports && (
              <Select value={ownerId || "all"} onValueChange={v => setOwnerId(v === "all" ? "" : v)}>
                <SelectTrigger className="w-36"><SelectValue placeholder="All Owners" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2 flex-wrap mb-4">
          <ExportDropdown
            exportUrl="/api/exports/reports"
            filename="Pipeline_Report"
          />
        </div>

        {/* ── PIPELINE TAB ── */}
        <TabsContent value="pipeline">
          <Card>
            <CardHeader><CardTitle>Pipeline by Stage</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pipeline ?? []} margin={{ top: 20, right: 30, left: 45, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="stage" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
                  <Bar dataKey="count" name="count" radius={[4,4,0,0]}>
                    {pipeline?.map((entry, i) => <Cell key={i} fill={STAGE_CHART_COLORS[entry.stage] || "#94a3b8"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground text-center mb-2 mt-1">Click any row to view those deals →</p>
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Deals</TableHead>
                    <TableHead>Total Value</TableHead>
                    <TableHead>Probability</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipeline?.map(row => (
                    <TableRow
                      key={row.stage}
                      className="cursor-pointer hover:bg-primary/5 transition-colors"
                      onClick={() => goDeals(row.stage)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STAGE_CHART_COLORS[row.stage] || "#94a3b8" }} />
                          <span className="font-medium">{row.stage}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-primary">{row.count}</TableCell>
                      <TableCell>₹{Number(row.totalValue).toLocaleString()}</TableCell>
                      <TableCell>{row.probability}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY OWNER TAB ── */}
        <TabsContent value="by-owner">
          <Card>
            <CardHeader>
              <CardTitle>Performance by Sales Owner</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Click a number to view those deals in the pipeline →</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Won</TableHead>
                    <TableHead>Lost</TableHead>
                    <TableHead>Won Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byOwner?.map(row => (
                    <TableRow key={row.userId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar profilePhoto={(row as any).profilePhoto} name={row.userName} className="w-3 h-3" />
                          <span className="font-medium">{row.userName}</span>
                        </div>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:underline hover:text-primary font-medium"
                        onClick={() => goDeals(undefined, row.userId)}
                        title="View all deals for this owner"
                      >
                        {row.totalDeals}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:underline hover:text-blue-600"
                        onClick={() => navigate(`/deals?owner=${row.userId}`)}
                        title="View active deals"
                      >
                        {row.activeDeals}
                      </TableCell>
                      <TableCell
                        className="text-green-600 font-medium cursor-pointer hover:underline"
                        onClick={() => goDeals("Won", row.userId)}
                        title="View won deals"
                      >
                        {row.wonDeals}
                      </TableCell>
                      <TableCell
                        className="text-red-500 cursor-pointer hover:underline"
                        onClick={() => goDeals("Lost", row.userId)}
                        title="View lost deals"
                      >
                        {row.lostDeals}
                      </TableCell>
                      <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY CITY TAB ── */}
        <TabsContent value="by-city">
          <Card>
            <CardHeader><CardTitle>Performance by City</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>City</TableHead>
                    <TableHead>Total Deals</TableHead>
                    <TableHead className="text-green-600">Won</TableHead>
                    <TableHead>Won Value</TableHead>
                    <TableHead className="text-red-500">Lost</TableHead>
                    <TableHead>Lost Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byCity?.sort((a, b) => b.totalWonValue - a.totalWonValue).map(row => (
                    <TableRow key={row.city}>
                      <TableCell className="font-medium">{row.city}</TableCell>
                      <TableCell>{row.totalDeals}</TableCell>
                      <TableCell className="text-green-600 font-medium">{row.wonDeals}</TableCell>
                      <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                      <TableCell className="text-red-500 font-medium">{row.lostDeals}</TableCell>
                      <TableCell className="text-red-400">₹{Number(row.totalLostValue).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── BY PRODUCT TAB ── */}
        <TabsContent value="by-product">
          <Card>
            <CardHeader><CardTitle>Performance by Product</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Deals</TableHead>
                    <TableHead>Total Qty</TableHead>
                    <TableHead>Total Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byProduct?.sort((a, b) => b.totalValue - a.totalValue).map(row => (
                    <TableRow key={row.productId}>
                      <TableCell className="font-medium">{row.productName}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">{row.productCode}</TableCell>
                      <TableCell>{row.dealCount}</TableCell>
                      <TableCell>{row.totalQuantity}</TableCell>
                      <TableCell>₹{Number(row.totalValue).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── LOST REASONS TAB ── */}
        <TabsContent value="lost-reasons">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle>Lost Deals by Reason</CardTitle></CardHeader>
              <CardContent>
                {!lostReasons?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No lost deals found for the selected filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart margin={{ top: 30, right: 30, bottom: 30, left: 30 }}>
                      <Pie
                        data={lostReasons}
                        dataKey="count"
                        nameKey="reason"
                        cx="50%"
                        cy="50%"
                        outerRadius="75%"
                        activeIndex={activePieIndex ?? undefined}
                        activeShape={(props: any) => {
                          const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
                          return (
                            <Sector
                              cx={cx}
                              cy={cy}
                              innerRadius={innerRadius}
                              outerRadius={Math.min(outerRadius + 6, cx, cy)}
                              startAngle={startAngle}
                              endAngle={endAngle}
                              fill={fill}
                              opacity={0.85}
                            />
                          );
                        }}
                        onMouseEnter={(_: any, index: number) => setActivePieIndex(index)}
                        onMouseLeave={() => setActivePieIndex(null)}
                        onClick={(entry: any) => fetchLostDetail(entry.reason)}
                        className="cursor-pointer"
                      >
                        {lostReasons.map((row, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} onClick={() => fetchLostDetail(row.reason)} />
                        ))}
                      </Pie>
                      <Tooltip
                        offset={20}
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          const pct = ((d.count / totalLost) * 100).toFixed(1);
                          return (
                            <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                              <p className="font-medium">{d.reason}</p>
                              <p>Lost: {d.count}</p>
                              <p className="text-muted-foreground">{pct}%</p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Reason Breakdown</span>
                  {totalLost > 0 && <span className="text-sm font-normal text-muted-foreground">{totalLost} total lost</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!lostReasons?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No data</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reason</TableHead>
                        <TableHead>Deals</TableHead>
                        <TableHead>Share</TableHead>
                        <TableHead>Lost Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lostReasons.map((row, i) => (
                        <TableRow
                          key={row.reason}
                          className="cursor-pointer hover:bg-primary/5 transition-colors"
                          onClick={() => fetchLostDetail(row.reason)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                              <span className="font-medium">{row.reason}</span>
                            </div>
                          </TableCell>
                          <TableCell>{row.count}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-muted rounded-full w-16">
                                <div
                                  className="h-2 rounded-full"
                                  style={{
                                    width: `${totalLost > 0 ? (row.count / totalLost) * 100 : 0}%`,
                                    backgroundColor: PIE_COLORS[i % PIE_COLORS.length]
                                  }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {totalLost > 0 ? Math.round((row.count / totalLost) * 100) : 0}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-red-500">₹{Number(row.totalValue).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── LOST REASON DETAIL SHEET ── */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-[90vw] max-w-[90vw] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-xl">
              <XCircle className="h-5 w-5 text-red-400" />
              Lost Reason: {selectedReason}
            </SheetTitle>
          </SheetHeader>

              {detailLoading ? (
            <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading...</p></div>
          ) : detailData ? (
            <div className="mt-6 space-y-4">
              {/* Totals */}
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-sm"><span className="text-muted-foreground">Total Records: </span><span className="font-semibold">{detailData.total}</span></div>
                <div className="text-sm"><span className="text-muted-foreground">Total Lost Value: </span><span className="font-semibold text-red-500">₹{detailData.totalValue.toLocaleString()}</span></div>
              </div>

              {/* Search + Export */}
              {(() => {
                const records: any[] = detailData.data ?? detailData.records ?? [];
                const searchQ = detailSearch.toLowerCase();
                const filtered = detailSearch
                  ? records.filter((r: any) =>
                      (r.customerName?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.companyName?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.mobile ?? "").includes(detailSearch) ||
                      (r.city?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.salesPerson?.toLowerCase() ?? "").includes(searchQ) ||
                      (r.notes?.toLowerCase() ?? "").includes(searchQ)
                    )
                  : records;
                return (
                  <>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="relative w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search records..."
                          value={detailSearch}
                          onChange={e => setDetailSearch(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
                          if (!filtered.length) return;
                          const headers = ["Customer Name","Company Name","Mobile","City","Sales Person","Unit","Product","Type","Lost Date","Lost Reason","Notes","Deal Value"];
                          const csv = [
                            headers.join(","),
                            ...filtered.map((r: any) =>
                              headers.map(h => {
                                const key: Record<string, string> = {
                                  "Customer Name": "customerName",
                                  "Company Name": "companyName",
                                  "Mobile": "mobile",
                                  "City": "city",
                                  "Sales Person": "salesPerson",
                                  "Unit": "unit",
                                  "Product": "product",
                                  "Type": "type",
                                  "Lost Date": "lostDate",
                                  "Lost Reason": "lostReason",
                                  "Notes": "notes",
                                  "Deal Value": "dealValue",
                                };
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
                          a.download = `lost-reason-${selectedReason}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        }}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => window.print()}>
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Print
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</p>
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
                            <TableHead className="whitespace-nowrap">Lost Date</TableHead>
                            <TableHead className="whitespace-nowrap">Lost Reason</TableHead>
                            <TableHead className="whitespace-nowrap">Notes</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Deal Value</TableHead>
                            <TableHead className="whitespace-nowrap text-center">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((r: any) => (
                            <TableRow key={`${r.type}-${r.id}`}>
                              <TableCell className="font-medium whitespace-nowrap">
                                <Link to={`/lead/${r.contactId}`} className="hover:underline text-primary">
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
                              <TableCell className="whitespace-nowrap max-w-[140px] truncate" title={r.lostReason}>
                                {r.lostReason}
                              </TableCell>
                              <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground" title={r.notes}>
                                {r.notes || "—"}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap text-red-500 font-medium">
                                {r.dealValue ? `₹${Number(r.dealValue).toLocaleString()}` : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1 justify-center">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    title="Open Customer"
                                    asChild
                                  >
                                    <Link to={`/lead/${r.contactId}`}>
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                  </Button>
                                  {r.dealId && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title="Open Deal"
                                      asChild
                                    >
                                      <Link to={`/deal/${r.dealId}`}>
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
                              <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                                No records match your search.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
