import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useGetPipelineReport, useGetReportByOwner, useGetReportByCity,
  useGetReportByProduct, useGetReportSummary, useListUsers, useGetReportLostReasons, useGetMe
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import { TrendingUp, Users, Briefcase, DollarSign, XCircle, Download } from "lucide-react";

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Input type="month" value={value} onChange={e => onChange(e.target.value)} className="w-40" />;
}

function UnitPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value || "all"} onValueChange={v => onChange(v === "all" ? "" : v)}>
      <SelectTrigger className="w-36"><SelectValue placeholder="All Units" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Units</SelectItem>
        {["Himatnagar","Surat","Rajkot"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const STAGE_COLORS: Record<string, string> = {
  "New": "#94a3b8", "CL Sent": "#60a5fa", "Price Given": "#fbbf24",
  "Samples Sent": "#fb923c", "Samples Received": "#a78bfa", "PI Sent": "#818cf8",
  "Won": "#4ade80", "Lost": "#f87171",
};

const PIE_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#60a5fa","#a78bfa","#f472b6","#94a3b8"];

const TAB_EXCEL_ENDPOINTS: Record<string, string> = {
  pipeline: "/api/reports/deals",
  "by-owner": "/api/reports/deals",
  "by-city": "/api/reports/leads",
  "by-product": "/api/reports/deals",
  "lost-reasons": "/api/reports/deals",
};

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
  const [, navigate] = useLocation();

  const { data: summary } = useGetReportSummary();
  const { data: pipeline } = useGetPipelineReport({ month: month || undefined, unit: unit || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byOwner } = useGetReportByOwner({ month: month || undefined, unit: unit || undefined });
  const { data: byCity } = useGetReportByCity({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byProduct } = useGetReportByProduct({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
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
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (unit) params.set("unit", unit);
    if (ownerId) params.set("ownerId", ownerId);
    const endpoint = TAB_EXCEL_ENDPOINTS[activeTab] || "/api/reports/deals";
    window.open(`${window.location.origin}${endpoint}?${params.toString()}`, "_blank");
  }, [month, unit, ownerId, activeTab]);

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
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5 mr-1" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPrint}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Excel
          </Button>
        </div>

        {/* ── PIPELINE TAB ── */}
        <TabsContent value="pipeline">
          <Card>
            <CardHeader><CardTitle>Pipeline by Stage</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pipeline ?? []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Bar dataKey="count" name="count" radius={[4,4,0,0]}>
                    {pipeline?.map((entry, i) => <Cell key={i} fill={STAGE_COLORS[entry.stage] || "#94a3b8"} />)}
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
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STAGE_COLORS[row.stage] || "#94a3b8" }} />
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
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: row.colorCode }} />
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
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={lostReasons}
                        dataKey="count"
                        nameKey="reason"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ reason, percent }) => `${reason} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={true}
                      >
                        {lostReasons.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
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
                        <TableRow key={row.reason}>
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
    </div>
  );
}
