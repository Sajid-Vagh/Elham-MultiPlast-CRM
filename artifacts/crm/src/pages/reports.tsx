import { useState } from "react";
import { useGetPipelineReport, useGetReportByOwner, useGetReportByCity, useGetReportByProduct, useGetReportSummary, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, Users, Briefcase, DollarSign } from "lucide-react";

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

export default function Reports() {
  const [month, setMonth] = useState("");
  const [unit, setUnit] = useState("");
  const [ownerId, setOwnerId] = useState("");

  const { data: summary } = useGetReportSummary();
  const { data: pipeline } = useGetPipelineReport({ month: month || undefined, unit: unit || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byOwner } = useGetReportByOwner({ month: month || undefined, unit: unit || undefined });
  const { data: byCity } = useGetReportByCity({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: byProduct } = useGetReportByProduct({ month: month || undefined, salesOwnerId: ownerId ? Number(ownerId) : undefined });
  const { data: users } = useListUsers();

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

      <Tabs defaultValue="pipeline">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="by-owner">By Owner</TabsTrigger>
            <TabsTrigger value="by-city">By City</TabsTrigger>
            <TabsTrigger value="by-product">By Product</TabsTrigger>
          </TabsList>
          <div className="flex gap-2 flex-wrap">
            <MonthPicker value={month} onChange={setMonth} />
            <UnitPicker value={unit} onChange={setUnit} />
            <Select value={ownerId || "all"} onValueChange={v => setOwnerId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All Owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Owners</SelectItem>
                {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value="pipeline">
          <Card>
            <CardHeader><CardTitle>Pipeline by Stage</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pipeline ?? []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v, n) => [v, n === "count" ? "Deals" : "Value"]} />
                  <Bar dataKey="count" name="count" radius={[4,4,0,0]}>
                    {pipeline?.map((entry, i) => <Cell key={i} fill={STAGE_COLORS[entry.stage] || "#94a3b8"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <Table className="mt-4">
                <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead>Deals</TableHead><TableHead>Total Value</TableHead><TableHead>Probability</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pipeline?.map(row => (
                    <TableRow key={row.stage}>
                      <TableCell><span className="font-medium">{row.stage}</span></TableCell>
                      <TableCell>{row.count}</TableCell>
                      <TableCell>₹{Number(row.totalValue).toLocaleString()}</TableCell>
                      <TableCell>{row.probability}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-owner">
          <Card>
            <CardHeader><CardTitle>Performance by Sales Owner</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Owner</TableHead><TableHead>Total</TableHead><TableHead>Active</TableHead><TableHead>Won</TableHead><TableHead>Lost</TableHead><TableHead>Won Value</TableHead></TableRow></TableHeader>
                <TableBody>
                  {byOwner?.map(row => (
                    <TableRow key={row.userId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: row.colorCode }} />
                          <span className="font-medium">{row.userName}</span>
                        </div>
                      </TableCell>
                      <TableCell>{row.totalDeals}</TableCell>
                      <TableCell>{row.activeDeals}</TableCell>
                      <TableCell className="text-green-600 font-medium">{row.wonDeals}</TableCell>
                      <TableCell className="text-red-500">{row.lostDeals}</TableCell>
                      <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-city">
          <Card>
            <CardHeader><CardTitle>Performance by City</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>City</TableHead><TableHead>Total Deals</TableHead><TableHead>Won</TableHead><TableHead>Won Value</TableHead></TableRow></TableHeader>
                <TableBody>
                  {byCity?.sort((a, b) => b.totalWonValue - a.totalWonValue).map(row => (
                    <TableRow key={row.city}>
                      <TableCell className="font-medium">{row.city}</TableCell>
                      <TableCell>{row.totalDeals}</TableCell>
                      <TableCell className="text-green-600">{row.wonDeals}</TableCell>
                      <TableCell>₹{Number(row.totalWonValue).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-product">
          <Card>
            <CardHeader><CardTitle>Performance by Product</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Code</TableHead><TableHead>Deals</TableHead><TableHead>Total Qty</TableHead><TableHead>Total Value</TableHead></TableRow></TableHeader>
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
      </Tabs>
    </div>
  );
}
