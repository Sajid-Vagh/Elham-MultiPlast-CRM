import { useGetReportSummary, useListActivities, useGetPipelineReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Briefcase, Users, DollarSign, TrendingUp, Calendar } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetReportSummary();
  const { data: activities, isLoading: isLoadingActivities } = useListActivities({ upcoming: true });
  const { data: pipeline, isLoading: isLoadingPipeline } = useGetPipelineReport();

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Upcoming Follow-ups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activities?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No upcoming follow-ups.</p>
              ) : (
                activities?.slice(0, 5).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-4 pb-4 border-b last:border-0 last:pb-0">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {activity.type} - {activity.followUpType}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {activity.notes}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Due: {new Date(activity.followUpDate || '').toLocaleDateString()}
                      </p>
                    </div>
                    {activity.dealId && (
                      <Link href={`/deals/${activity.dealId}`} className="text-xs text-primary hover:underline">
                        View Deal
                      </Link>
                    )}
                  </div>
                ))
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
