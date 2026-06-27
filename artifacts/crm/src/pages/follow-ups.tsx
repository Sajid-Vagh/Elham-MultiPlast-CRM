import { useState, useMemo } from "react";
import { useListActivities, useUpdateActivity, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, ArrowLeft, Phone, PhoneOff, X, Clock, Filter, FolderTree, Eye, Pencil, History } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { CategoryBadge } from "@/components/category-badge";
import { MoveCategoryDialog } from "@/components/move-category-dialog";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "-";
  try {
    const [h, m] = time.split(":");
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${m} ${ampm}`;
  } catch {
    return time;
  }
}

export default function FollowUps() {
  const [dateFilter, setDateFilter] = useState("");
  const [showToday, setShowToday] = useState(false);
  const [unitFilter, setUnitFilter] = useState<string | undefined>();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const [, setLocation] = useLocation();

  const activeDate = useMemo(() => {
    if (showToday) return todayStr();
    return dateFilter || "";
  }, [dateFilter, showToday]);

  const { data: activities, isLoading, refetch } = useListActivities(
    activeDate ? { date: activeDate, ...(isAdmin ? {} : { userId: me?.id }) } : { upcoming: true, ...(isAdmin ? {} : { userId: me?.id }) },
    { query: { staleTime: 30_000 } }
  );

  const activeUnit = unitFilter;
  const filteredActivities = useMemo(() => {
    if (!activities) return [];
    if (!activeUnit) return activities;
    return activities.filter(a => {
      const contactUnit = a.contact?.unit || a.deal?.contact?.unit;
      return contactUnit === activeUnit;
    });
  }, [activities, activeUnit]);

  const updateActivity = useUpdateActivity();

  const pendingCount = useMemo(() => {
    if (!filteredActivities) return 0;
    return filteredActivities.filter(a => a.callStatus !== "Completed").length;
  }, [filteredActivities]);

  const handleToggleStatus = (activityId: number, currentStatus: string | null | undefined) => {
    const newStatus = currentStatus === "Completed" ? "Pending" : "Completed";
    updateActivity.mutate(
      { id: activityId, data: { callStatus: newStatus } },
      {
        onSuccess: () => {
          toast({ title: `Call marked as ${newStatus}` });
          refetch();
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
        }
      }
    );
  };

  const todayDate = todayStr();

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Follow-ups</h1>
          <p className="text-muted-foreground mt-1">View and manage scheduled follow-ups.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {activeDate ? (
                <>Follow-ups for {new Date(activeDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</>
              ) : (
                <>Upcoming Follow-ups</>
              )}
              {activities && filteredActivities.length > 0 && (
                <Badge variant="secondary" className="ml-1">{filteredActivities.length}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={unitFilter || "all"} onValueChange={(v) => setUnitFilter(v === "all" ? undefined : v)}>
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue placeholder="All Units" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  <SelectItem value="Himatnagar">Himatnagar</SelectItem>
                  <SelectItem value="Rajkot">Rajkot</SelectItem>
                  <SelectItem value="Surat">Surat</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={showToday ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setShowToday(prev => !prev);
                  setDateFilter("");
                }}
              >
                <Clock className="h-3.5 w-3.5" />
                Today's Calls
                {showToday && pendingCount > 0 && (
                  <Badge className="ml-1 bg-white/20 text-white text-[10px] h-4 px-1.5">
                    {pendingCount} pending
                  </Badge>
                )}
              </Button>
              <div className="flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={e => {
                    setDateFilter(e.target.value);
                    setShowToday(false);
                  }}
                  className="w-38 h-8 text-sm"
                />
                {dateFilter && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    onClick={() => setDateFilter("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">Loading follow-ups...</div>
          ) : !filteredActivities || filteredActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {activeDate
                ? `No follow-ups found for ${new Date(activeDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`
                : "No upcoming follow-ups."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Contact Number</TableHead>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Follow-up Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Sales Person</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredActivities.map((activity) => {
                  const contactName = activity.contact?.name || activity.deal?.contact?.name || "-";
                  const contactMobile = activity.contact?.mobile || activity.deal?.contact?.mobile || "-";
                  const companyName = activity.contact?.companyName || activity.deal?.contact?.companyName || "-";
                  const contactUnit = activity.contact?.unit || activity.deal?.contact?.unit || "-";
                  const salesPerson = activity.user?.name || (activity.contact?.salesOwner?.name) || "-";
                  const isCompleted = activity.callStatus === "Completed";
                  const time = activity.followUpTime;

                  const contactId = activity.contact?.id || activity.deal?.contact?.id;
                  const leadUrl = contactId ? `/leads/${contactId}` : null;

                  return (
                    <TableRow
                      key={activity.id}
                      className={`${isCompleted ? "opacity-60" : ""} cursor-pointer hover:bg-muted/50`}
                      onClick={() => { if (leadUrl) setLocation(leadUrl); }}
                    >
                      <TableCell className="font-medium">{contactName}</TableCell>
                      <TableCell>{contactMobile}</TableCell>
                      <TableCell>{companyName}</TableCell>
                      <TableCell>
                        <CategoryBadge category={activity.contact?.category || activity.deal?.contact?.category} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{contactUnit}</Badge>
                      </TableCell>
                      <TableCell>{activity.followUpDate ? new Date(activity.followUpDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "-"}</TableCell>
                      <TableCell>{formatTime(time)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={activity.notes || ""}>{activity.notes || "-"}</TableCell>
                      <TableCell>{salesPerson}</TableCell>
                      <TableCell>
                        <Badge variant={isCompleted ? "secondary" : "default"} className="text-[11px]">
                          {isCompleted ? "Completed" : "Pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="w-28">
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => { if (leadUrl) setLocation(leadUrl); }}
                            title="View Lead"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => { if (leadUrl) setLocation(`${leadUrl}/edit`); }}
                            title="Edit Lead"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => { if (leadUrl) setLocation(leadUrl); }}
                            title="Activity History"
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-7 w-7 ${isCompleted ? "text-green-600" : "text-orange-600"}`}
                            onClick={() => handleToggleStatus(activity.id, activity.callStatus)}
                            title={isCompleted ? "Mark as Pending" : "Mark as Completed"}
                          >
                            {isCompleted ? <PhoneOff className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showToday && !isLoading && filteredActivities && filteredActivities.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-3">
            <p className="text-sm text-amber-700 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              You have <strong>{pendingCount}</strong> pending call{pendingCount !== 1 ? "s" : ""} scheduled today.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
