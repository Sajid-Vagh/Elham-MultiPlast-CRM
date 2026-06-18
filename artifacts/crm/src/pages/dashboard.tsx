import { useState, useMemo, useEffect } from "react";
import { useGetReportSummary, useGetPipelineReport, useListContacts, useListActivities, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Briefcase, Users, DollarSign, TrendingUp, AlertCircle, PhoneCall, X, Clock, Phone, CheckCircle2, FolderTree } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";

function daysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]!;
}

export default function Dashboard() {
  const [followUpDateFilter, setFollowUpDateFilter] = useState("");
  const [categoryCounts, setCategoryCounts] = useState<{ category: string; count: number }[]>([]);
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";

  useEffect(() => {
    fetch("/api/categories/counts", {
      headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
    })
      .then(r => r.json())
      .then(data => setCategoryCounts(data))
      .catch(() => {});
  }, []);

  const { data: summary, isLoading: isLoadingSummary } = useGetReportSummary();
  const { data: pipeline, isLoading: isLoadingPipeline } = useGetPipelineReport();
  const { data: dueContacts, isLoading: isLoadingDue } = useListContacts({ followUpDue: true });
  const { data: todayActivities } = useListActivities({ date: todayStr() });
  const { data: allContacts } = useListContacts();

  const unitStats = useMemo(() => {
    if (!allContacts) return { Himatnagar: 0, Rajkot: 0, Surat: 0 };
    const stats: Record<string, number> = {};
    for (const c of allContacts) {
      const u = c.unit || "Unassigned";
      stats[u] = (stats[u] || 0) + 1;
    }
    return { Himatnagar: stats.Himatnagar || 0, Rajkot: stats.Rajkot || 0, Surat: stats.Surat || 0 };
  }, [allContacts]);

  const todayStats = useMemo(() => {
    if (!todayActivities) return { today: 0, completed: 0, pending: 0 };
    const total = todayActivities.length;
    const completed = todayActivities.filter(a => a.callStatus === "Completed").length;
    return { today: total, completed, pending: total - completed };
  }, [todayActivities]);

  const overdueCount = useMemo(() => {
    if (!dueContacts) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueContacts.filter(c => {
      if (!c.nextCallDate) return false;
      const d = new Date(c.nextCallDate);
      d.setHours(0, 0, 0, 0);
      return d < today;
    }).length;
  }, [dueContacts]);

  if (isLoadingSummary || isLoadingPipeline) {
    return <div className="p-8 flex items-center justify-center h-full">Loading dashboard...</div>;
  }

  // Filter follow-ups by selected date
  const filteredDueContacts = followUpDateFilter
    ? dueContacts?.filter(c => c.nextCallDate === followUpDateFilter)
    : dueContacts;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your sales performance and pipeline.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{isAdmin ? "Total Leads" : "My Leads"}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalContacts || 0}</div>
            <p className="text-xs text-muted-foreground">
              +{summary?.newLeadsThisMonth || 0} this month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{isAdmin ? "Active Deals" : "My Deals"}</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.activeDeals || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Won Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{summary?.totalWonValue?.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.totalDeals ? Math.round((summary.wonDeals / summary.totalDeals) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {summary?.wonDeals} won / {summary?.lostDeals} lost
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Today's Calls Widget */}
      {!isLoadingDue && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/follow-ups" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-blue-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Today's Calls</CardTitle>
                <Phone className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{todayStats.today}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/follow-ups" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-green-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{todayStats.completed}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/follow-ups" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-orange-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending</CardTitle>
                <Clock className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">{todayStats.pending}</div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/follow-ups" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-red-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overdue</CardTitle>
                <AlertCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{overdueCount}</div>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {/* Follow-up reminders — overdue/due-today contacts */}
      {!isLoadingDue && dueContacts && dueContacts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-orange-700">
                <AlertCircle className="h-5 w-5" />
                Follow-up Reminders
                <Badge className="ml-1 bg-orange-500 text-white">
                  {filteredDueContacts?.length ?? 0}
                </Badge>
              </CardTitle>
              {/* Date filter */}
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
                          <p className="font-medium text-sm truncate">{contact.name}</p>
                          {contact.salesOwner && (
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: contact.salesOwner.colorCode }} />
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

        {/* Unit-wise Stats */}
        {isAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {["Himatnagar", "Rajkot", "Surat"].map(u => (
              <Card key={u}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{u}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{unitStats[u as keyof typeof unitStats]}</div>
                  <p className="text-xs text-muted-foreground">Leads</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Category Summary Widget */}
        {categoryCounts.length > 0 && (
          <Card>
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {categoryCounts.map(({ category, count }) => (
                  <Link key={category} href={`/categories`} className="block">
                    <div className="text-center p-3 rounded-lg border hover:shadow-sm transition-shadow cursor-pointer">
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

        <Card>
          <CardHeader>
            <CardTitle>Pipeline Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pipeline?.map((stageCount) => (
                <div key={stageCount.stage} className="flex items-center">
                  <div className="w-32 text-sm font-medium">{stageCount.stage}</div>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden mx-4">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${pipeline.reduce((acc, curr) => Math.max(acc, curr.count), 0) > 0
                          ? (stageCount.count / pipeline.reduce((acc, curr) => Math.max(acc, curr.count), 0)) * 100
                          : 0}%`
                      }}
                    />
                  </div>
                  <div className="w-24 text-right text-sm text-muted-foreground">
                    {stageCount.count} deals
                  </div>
                </div>
              ))}
              {!pipeline?.length && (
                <p className="text-sm text-muted-foreground text-center py-4">No active deals in pipeline.</p>
              )}
            </div>
          </CardContent>
        </Card>
    </div>
  );
}
