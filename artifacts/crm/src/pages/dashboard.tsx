import { useState, useMemo } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {   Briefcase, Users, DollarSign, TrendingUp, AlertCircle, PhoneCall, X, Clock, Phone, FolderTree, UserCheck, BarChart3, ChevronRight, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";
import { STAGE_CHART_COLORS } from "@/lib/deal-stages";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, Tooltip, LineChart, Line, Sector } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useActiveUnits } from "@/lib/use-active-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { useAllUsers } from "@/lib/use-all-users";
import { PENDING_UNIT_ASSIGNMENT, isPendingUnit } from "@/lib/unit-constants";
import { usePrivacyMode } from "@/lib/use-privacy-mode";
import { customerLabel } from "@/lib/customer-label";
import { useDateFilter, getLabel } from "@/lib/use-date-filter";
import { useOwnerFilter } from "@/lib/global-filters";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import { dedupeById } from "@/lib/parse-notes";

function daysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type OverdueActivity = {
  id: number;
  callStatus?: string | null;
  followUpDate?: string | null;
  contactId?: number | null;
  dealId?: number | null;
  contact?: { id?: number; name?: string; mobile?: string; unit?: string; customerCode?: string | null; salesOwnerId?: number | null } | null;
  deal?: { id?: number; contactId?: number; contact?: { id?: number; name?: string; mobile?: string; unit?: string; customerCode?: string | null; salesOwnerId?: number | null } | null } | null;
};

const PIE_COLORS = ["#f87171","#fb923c","#fbbf24","#a3e635","#34d399","#60a5fa","#a78bfa","#f472b6","#94a3b8"];

export default function Dashboard() {
  const [followUpDateFilter, setFollowUpDateFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useOwnerFilter();
  const [unitFilter, setUnitFilter] = useUnitFilter();
  const [dateFilter, setDateFilter] = useDateFilter();
  const [privacyHidden, togglePrivacy] = usePrivacyMode();
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const { units: activeUnits } = useActiveUnits();

  const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
  const authHeaders = { Authorization: `Bearer ${token}` };

  const { data: kpi } = useQuery({
    queryKey: ["dashboard-kpi", ownerFilter, unitFilter, dateFilter.preset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ownerFilter) params.set("ownerId", ownerFilter);
      if (unitFilter !== "All") params.set("unit", unitFilter);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      params.set("today", todayStr());
      // Client-local HH:MM so the backend's "Pending" split of today's tasks
      // (time already passed) is decided in the user's timezone, not the
      // server's — same reason the `today` param exists.
      const now = new Date();
      params.set("nowTime", `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
      const res = await fetch(`/api/dashboard/kpi?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) return null;
      return res.json() as Promise<{
        totalContacts: number; totalDeals: number; wonDeals: number; lostDeals: number; winRate: number; lostLeads: number;
        activeDeals: number; totalWonValue: number;         categoryCounts: { category: string; count: number }[];
        unitStats: Record<string, number>; totalCalls: number; todayTotal: number; todayCompleted: number; todayPending: number;
        overdueCount: number; newLeadsThisMonth: number; myClientsCount: number;
        newOrders: number; newOrderRevenue: number; repeatOrders: number; repeatOrderRevenue: number; totalOrderRevenue: number;
      }>;
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const { data: salesPerformance } = useQuery({
    queryKey: ["dashboard-sales-performance", ownerFilter, unitFilter, dateFilter.preset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ownerFilter) params.set("ownerId", ownerFilter);
      if (unitFilter !== "All") params.set("unit", unitFilter);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      const res = await fetch(`/api/dashboard/sales-performance?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) return [];
      return res.json() as Promise<{
        userId: number; userName: string; colorCode: string; profilePhoto?: string | null; unit: string;
        totalContacts: number; totalDeals: number; wonDeals: number; lostDeals: number;
        activeDeals: number; totalWonValue: number; myClients: number;
        conversionRate: number; followUpRate: number;
      }[]>;
    },
    enabled: !!token && isAdmin,
    staleTime: 30_000,
  });

  const { data: charts } = useQuery({
    queryKey: ["dashboard-charts", ownerFilter, unitFilter, dateFilter.preset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (ownerFilter) params.set("ownerId", ownerFilter);
      if (unitFilter !== "All") params.set("unit", unitFilter);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      const res = await fetch(`/api/dashboard/charts?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) return null;
      return res.json() as Promise<{
        categoryDistribution: { name: string; value: number }[];
        dealStageDistribution: { stage: string; count: number }[];
        monthlyTrends: { month: string; contacts: number; deals: number }[];
      }>;
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  const { data: dueContacts } = useQuery({
    queryKey: ["due-contacts", ownerFilter, unitFilter, dateFilter.preset],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("followUpDue", "true");
      if (ownerFilter) params.set("salesOwnerId", ownerFilter);
      if (unitFilter !== "All") params.set("unit", unitFilter);
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      const res = await fetch(`/api/contacts?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) return [];
      return res.json() as Promise<any[]>;
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const { data: overdueActivities } = useQuery<OverdueActivity[]>({
    queryKey: ["dashboard-overdue-activities", ownerFilter, unitFilter, dateFilter.preset, dateFilter.startDate, dateFilter.endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      if (!isAdmin && me?.id) params.set("userId", String(me.id));
      if (isAdmin && ownerFilter) params.set("salesPersonId", ownerFilter);
      params.set("callStatus", "Pending");
      const res = await fetch(`/api/activities?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const { data: users } = useAllUsers(isAdmin);

  const unitStats = useMemo(() => {
    return kpi?.unitStats ?? {};
  }, [kpi]);

  const overdueList = useMemo(() => {
    if (!overdueActivities) return [];
    // Mirror the Activity page's "Overdue" filter exactly (follow-ups.tsx):
    // followUpDate < today && callStatus === "Pending" (date-only, local today).
    const today = todayStr();
    let list = dedupeById(overdueActivities).filter(a =>
      !!a.followUpDate && a.followUpDate < today && (a.callStatus || "Pending") === "Pending"
    );
    // Unit filter — same as the Activity page (contact unit, pending-unit = no unit)
    if (unitFilter !== "All") {
      list = list.filter(a => {
        const contactUnit = a.contact?.unit || a.deal?.contact?.unit;
        if (unitFilter === PENDING_UNIT_ASSIGNMENT) return isPendingUnit(contactUnit);
        return contactUnit === unitFilter;
      });
    }
    return list.sort((a, b) => (a.followUpDate || "").localeCompare(b.followUpDate || ""));
  }, [overdueActivities, unitFilter]);

  const filteredDueContacts = useMemo(() => {
    if (!dueContacts) return undefined;
    const deduped = dedupeById(dueContacts);
    return followUpDateFilter
      ? deduped.filter(c => c.nextCallDate === followUpDateFilter)
      : deduped;
  }, [dueContacts, followUpDateFilter]);

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your sales performance and pipeline.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All Units" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Units</SelectItem>
              <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit Assignment</SelectItem>
              {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
          {isAdmin && users && (
            <Select value={ownerFilter} onValueChange={v => setOwnerFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All Owners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Owners</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <ClearFiltersButton />
          <Button variant="ghost" size="icon" onClick={togglePrivacy} className="h-8 w-8 text-muted-foreground" title={privacyHidden ? "Show financial values" : "Hide financial values"}>
            {privacyHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/leads" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{isAdmin ? "Total Leads" : "My Leads"}</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi?.totalContacts ?? 0}</div>
              <p className="text-xs text-muted-foreground">{dateFilter.preset === "all" ? "" : `+${kpi?.newLeadsThisMonth ?? 0} ${getLabel(dateFilter.preset).toLowerCase()}`}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/deals" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{isAdmin ? "Active Deals" : "My Deals"}</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi?.activeDeals ?? 0}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/reports?view=won_deals" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Won Value</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{privacyHidden ? "₹ *******" : `₹${kpi?.totalWonValue?.toLocaleString() || 0}`}</div>
              <p className="text-xs text-muted-foreground">{kpi?.totalDeals} total deals</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/reports" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi?.winRate ?? 0}%</div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Calls + Additional KPI mini-cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Link href="/follow-ups" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out border-blue-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">All Activities</CardTitle>
              <Phone className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-blue-600">{kpi?.totalCalls ?? 0}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/follow-ups?status=Pending" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out border-orange-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Today&apos;s Pending</CardTitle>
              <Clock className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-orange-600">{kpi?.todayPending ?? 0}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/follow-ups?status=Overdue" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out border-red-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Overdue</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-red-600">{kpi?.overdueCount ?? 0}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/leads?category=My%20Client" className="block">
          <Card className="hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out border-purple-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">My Clients</CardTitle>
              <UserCheck className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-purple-600">{kpi?.myClientsCount ?? 0}</div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── SALES PERFORMANCE (admin only) ── */}
      {isAdmin && salesPerformance && salesPerformance.length > 0 && (
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-500" />
                Sales Performance
              </CardTitle>
              <Badge variant="outline" className="text-xs">{salesPerformance.length} users</Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sales Person</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Deals</TableHead>
                  <TableHead className="text-green-600">Won</TableHead>
                  <TableHead className="text-red-500">Lost</TableHead>
                  <TableHead>Won Value</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead>Conv. Rate</TableHead>
                   <TableHead>Activity %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesPerformance.map(row => (
                  <TableRow key={row.userId} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                        <div className="flex items-center gap-2">
                        <UserAvatar profilePhoto={row.profilePhoto} name={row.userName} className="w-7 h-7 border border-[#E5E7EB]" />
                        <span className="font-medium">{row.userName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.unit}</TableCell>
                    <TableCell>{row.totalContacts}</TableCell>
                    <TableCell>{row.totalDeals}</TableCell>
                    <TableCell className="text-green-600 font-medium">{row.wonDeals}</TableCell>
                    <TableCell className="text-red-500">{row.lostDeals}</TableCell>
                    <TableCell>{privacyHidden ? "₹ *******" : `₹${row.totalWonValue.toLocaleString()}`}</TableCell>
                    <TableCell>{row.myClients}</TableCell>
                    <TableCell>
                      <span className={`font-medium ${row.conversionRate >= 20 ? "text-green-600" : row.conversionRate >= 10 ? "text-amber-600" : "text-red-500"}`}>
                        {row.conversionRate}%
                      </span>
                    </TableCell>
                    <TableCell>{row.followUpRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── OVERDUE FOLLOW-UPS ── */}
      {overdueList.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 hover:shadow-lg transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <CardTitle className="text-red-700">Overdue Activities ({overdueList.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {overdueList.slice(0, 9).map(a => {
                const contact = a.contact || a.deal?.contact;
                const owner = contact?.salesOwnerId ? users.find(u => u.id === contact.salesOwnerId) : undefined;
                const diff = a.followUpDate ? daysDiff(a.followUpDate) : 0;
                const contactId = contact?.id || a.contactId || a.deal?.contactId;
                return (
                  <Link key={a.id} href={contactId ? `/leads/${contactId}` : "/follow-ups"}>
                    <div className="flex items-center gap-3 p-3 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors cursor-pointer">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-red-100">
                        <PhoneCall className="h-4 w-4 text-red-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{customerLabel(contact?.name || "Unknown", (contact as any)?.customerCode)}</p>
                        {owner && (
                          <div className="flex items-center gap-1">
                            <UserAvatar profilePhoto={owner.profilePhoto} name={owner.name} className="w-2 h-2" />
                            <span className="text-xs text-muted-foreground">{owner.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                          {Math.abs(diff)}d overdue
                        </span>
                        {contact?.mobile && (
                          <p className="text-xs text-muted-foreground mt-0.5">{contact.mobile}</p>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
            {overdueList.length > 9 && (
              <Link href="/follow-ups?status=Overdue">
                <p className="text-sm text-red-600 text-center mt-3 hover:underline cursor-pointer">
                  View all {overdueList.length} overdue follow-ups <ChevronRight className="h-3 w-3 inline" />
                </p>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── CHARTS SECTION ── */}
      {charts && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Category Distribution Pie */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <PieChart className="h-4 w-4 text-orange-500" />
                Category Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart margin={{ top: 30, right: 30, bottom: 70, left: 30 }}>
                  <Pie
                    data={charts.categoryDistribution.filter((d: any) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius="70%"
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
                  >
                    {charts.categoryDistribution.filter((d: any) => d.value > 0).map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    offset={20}
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      const total = charts.categoryDistribution.filter((x: any) => x.value > 0).reduce((s: number, x: any) => s + x.value, 0);
                      const pct = ((d.value / total) * 100).toFixed(1);
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                          <p className="font-medium">{d.name}</p>
                          <p>Contacts: {d.value}</p>
                          <p className="text-muted-foreground">{pct}%</p>
                        </div>
                      );
                    }}
                  />
                  <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 24 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Deal Stage Distribution Bar */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart3 className="h-4 w-4 text-blue-500" />
                Deal Stages
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={charts.dealStageDistribution} margin={{ top: 20, right: 20, left: 45, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={55} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
                  <Tooltip />
                  <Bar dataKey="count" name="Deals" radius={[3,3,0,0]}>
                    {charts.dealStageDistribution.map((entry, i) => (
                      <Cell key={i} fill={STAGE_CHART_COLORS[entry.stage] || PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Monthly Trends Line */}
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Monthly Trends (12m)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={charts.monthlyTrends} margin={{ top: 20, right: 20, left: 45, bottom: 75 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
                  <Tooltip />
                  <Line type="monotone" dataKey="contacts" stroke="#3b82f6" name="Leads" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="deals" stroke="#10b981" name="Deals" strokeWidth={2} dot={false} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── FOLLOW-UP REMINDERS ── */}
      {dueContacts && dueContacts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50 hover:shadow-lg transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-orange-700">
                <AlertCircle className="h-5 w-5" />
                Activity Reminders
                <Badge className="ml-1 bg-orange-500 text-white">
                  {filteredDueContacts?.length ?? 0}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Filter by date:</label>
                <Input
                  type="date"
                  value={followUpDateFilter}
                  onChange={e => setFollowUpDateFilter(e.target.value)}
                  className="w-38 h-8 text-sm"
                />
                {followUpDateFilter && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => setFollowUpDateFilter("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredDueContacts?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No follow-ups on {new Date(followUpDateFilter + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDueContacts?.map((contact) => {
                  const diff = contact.nextCallDate ? daysDiff(contact.nextCallDate) : 0;
                  const isOverdue = diff < 0;
                  const isToday = diff === 0;
                  return (
                    <Link key={contact.id} href={`/leads/${contact.id}`}>
                      <div className="flex items-center gap-3 p-3 bg-white border border-orange-200 rounded-md hover:bg-orange-50 transition-colors cursor-pointer">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isOverdue ? "bg-red-100" : "bg-orange-100"}`}>
                          <PhoneCall className={`h-4 w-4 ${isOverdue ? "text-red-600" : "text-orange-600"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{customerLabel(contact.name, (contact as any).customerCode)}</p>
                          {contact.salesOwner && (
                            <div className="flex items-center gap-1">
                              <UserAvatar profilePhoto={contact.salesOwner.profilePhoto} name={contact.salesOwner.name} className="w-2 h-2" />
                              <span className="text-xs text-muted-foreground">{contact.salesOwner.name}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isOverdue ? "bg-red-100 text-red-700" : isToday ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                            {isToday ? "Today" : isOverdue ? `${Math.abs(diff)}d overdue` : `In ${diff}d`}
                          </span>
                          {contact.mobile && (
                            <p className="text-xs text-muted-foreground mt-0.5">{contact.mobile}</p>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── UNIT STATS ── */}
      {isAdmin && Object.keys(unitStats).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Object.entries(unitStats).map(([unit, count]) => (
            <Card key={unit} className="hover:translate-y-[-3px] hover:shadow-lg transition-all duration-200 ease-out">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{unit}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{count}</div>
                <p className="text-xs text-muted-foreground">Leads</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── CATEGORY SUMMARY ── */}
      {kpi?.categoryCounts && kpi.categoryCounts.some(c => c.count > 0) && (
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FolderTree className="h-5 w-5 text-orange-500" />
                Category Summary
              </CardTitle>
              <Link href="/categories">
                <Badge className="cursor-pointer bg-orange-100 text-orange-700 hover:bg-orange-200 border-0">
                  View All
                </Badge>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {kpi.categoryCounts.map(({ category, count }) => (
                <Link key={category} href={`/categories`} className="block">
                  <div className="text-center p-3 rounded-lg border hover:translate-y-[-3px] hover:shadow-lg cursor-pointer transition-all duration-200 ease-out">
                    <span className="text-2xl">{category === "My Client" ? "⭐" : category === "Regular Follow up" ? "📋" : "📁"}</span>
                    <p className="text-lg font-bold mt-1" style={{ color: CATEGORY_COLORS[category] }}>
                      {count}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{category}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PIPELINE OVERVIEW ── */}
      <Card className="hover:shadow-lg transition-shadow duration-200">
        <CardHeader>
          <CardTitle>Pipeline Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {charts?.dealStageDistribution.filter(s => s.stage !== "Won" && s.stage !== "Lost").map((stageCount) => {
              const maxCount = Math.max(...charts.dealStageDistribution.filter(s => s.stage !== "Won" && s.stage !== "Lost").map(s => s.count), 1);
              return (
                <div key={stageCount.stage} className="flex items-center">
                  <div className="w-32 text-sm font-medium">{stageCount.stage}</div>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden mx-4">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(stageCount.count / maxCount) * 100}%`,
                        backgroundColor: STAGE_CHART_COLORS[stageCount.stage] || "#3b82f6",
                      }}
                    />
                  </div>
                  <div className="w-24 text-right text-sm text-muted-foreground">
                    {stageCount.count} deals
                  </div>
                </div>
              );
            })}
            {(!charts?.dealStageDistribution || charts.dealStageDistribution.filter(s => s.stage !== "Won" && s.stage !== "Lost").length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">No active deals in pipeline.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
