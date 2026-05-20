import { useGetReportSummary, useListActivities, useGetPipelineReport, useListContacts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Briefcase, Users, DollarSign, TrendingUp, Calendar, AlertCircle, PhoneCall } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

function daysDiff(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetReportSummary();
  const { data: activities, isLoading: isLoadingActivities } = useListActivities({ upcoming: true });
  const { data: pipeline, isLoading: isLoadingPipeline } = useGetPipelineReport();
  const { data: dueContacts, isLoading: isLoadingDue } = useListContacts({ followUpDue: true });

  if (isLoadingSummary || isLoadingActivities || isLoadingPipeline) {
    return <div className="p-8 flex items-center justify-center h-full">Loading dashboard...</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your sales performance and pipeline.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
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
            <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
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

      {/* Follow-up reminders — overdue/due-today contacts */}
      {!isLoadingDue && dueContacts && dueContacts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-orange-700">
              <AlertCircle className="h-5 w-5" />
              Follow-up Reminders
              <Badge className="ml-1 bg-orange-500 text-white">{dueContacts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {dueContacts.map((contact) => {
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
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${isOverdue ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
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
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Upcoming Activity Follow-ups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activities?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No upcoming follow-ups.</p>
              ) : (
                activities?.slice(0, 6).map((activity) => {
                  const diff = activity.followUpDate ? daysDiff(activity.followUpDate) : 0;
                  const isToday = diff === 0;
                  return (
                    <div key={activity.id} className="flex items-start gap-4 pb-4 border-b last:border-0 last:pb-0">
                      <div className={`p-2 rounded-full ${isToday ? "bg-orange-100" : "bg-primary/10"}`}>
                        <Calendar className={`h-4 w-4 ${isToday ? "text-orange-600" : "text-primary"}`} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {activity.type}
                          {activity.followUpType && activity.followUpType !== activity.type && (
                            <span className="text-muted-foreground font-normal"> → {activity.followUpType}</span>
                          )}
                        </p>
                        {activity.notes && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{activity.notes}</p>
                        )}
                        <p className={`text-xs font-medium ${isToday ? "text-orange-600" : "text-muted-foreground"}`}>
                          {isToday ? "Today" : `Due: ${new Date(activity.followUpDate || '').toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                        </p>
                      </div>
                      {activity.dealId && (
                        <Link href={`/deals/${activity.dealId}`} className="text-xs text-primary hover:underline flex-shrink-0">
                          View Deal
                        </Link>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1">
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
    </div>
  );
}
