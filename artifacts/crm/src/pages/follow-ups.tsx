import { useState, useMemo } from "react";
import { useUpdateActivity, useGetMe, getListActivitiesQueryKey, getListDealsQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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

  type FollowUpActivity = {
    id: number; type: string; notes?: string | null;
    notesDisplay?: string | null;
    followUpDate?: string | null; followUpTime?: string | null;
    callStatus?: string | null; createdBy?: number | null;
    dealId: number; contactId?: number | null;
    user?: { id: number; name: string } | null;
    deal?: { id: number; contactId?: number; contact?: { id?: number; name?: string; mobile?: string; companyName?: string; unit?: string; category?: string; salesOwner?: { name: string } | null } | null } | null;
    contact?: { id?: number; name?: string; mobile?: string; companyName?: string; unit?: string; category?: string; salesOwner?: { name: string } | null } | null;
  };

  const { data: activities, isLoading, refetch } = useQuery<FollowUpActivity[]>({
    queryKey: ["follow-up-activities", activeDate, isAdmin ? "all" : me?.id],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (activeDate) {
        params.set("date", activeDate);
      } else {
        params.set("upcoming", "true");
      }
      if (!isAdmin && me?.id) {
        params.set("userId", String(me.id));
      }
      const res = await fetch(`/api/activities?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 30_000,
  });

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
  const queryClient = useQueryClient();

  const pendingCount = useMemo(() => {
    if (!filteredActivities) return 0;
    return filteredActivities.filter(a => a.callStatus === "Pending").length;
  }, [filteredActivities]);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<FollowUpActivity | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editStatus, setEditStatus] = useState("Pending");

  const openEditDialog = (activity: FollowUpActivity) => {
    setEditingActivity(activity);
    setEditNotes("");
    setEditDate(activity.followUpDate || "");
    setEditTime(activity.followUpTime || "");
    setEditStatus(activity.callStatus || "Pending");
    setEditDialogOpen(true);
  };

  const handleEditFollowUp = () => {
    if (!editingActivity) return;
    const data: Record<string, any> = {};
    if (editNotes.trim()) data.notes = editNotes.trim();
    if (editDate !== editingActivity.followUpDate) data.followUpDate = editDate || null;
    if (editTime !== editingActivity.followUpTime) data.followUpTime = editTime || null;
    if (editStatus !== (editingActivity.callStatus || "Pending")) data.callStatus = editStatus;

    if (Object.keys(data).length === 0) {
      setEditDialogOpen(false);
      return;
    }

    updateActivity.mutate(
      { id: editingActivity.id, data: data as any },
      {
        onSuccess: () => {
          toast({ title: "Follow-up updated" });
          refetch();
          queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["follow-up-activities"] });
          queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
          setEditDialogOpen(false);
        },
        onError: () => {
          toast({ title: "Failed to update follow-up", variant: "destructive" });
        },
      }
    );
  };

  const handleToggleStatus = (activityId: number, currentStatus: string | null | undefined) => {
    const newStatus = currentStatus === "Pending" ? "Completed" : "Pending";
    updateActivity.mutate(
      { id: activityId, data: { callStatus: newStatus } as any },
      {
        onSuccess: () => {
          toast({ title: `Call marked as ${newStatus}` });
          refetch();
          queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["follow-up-activities"] });
          queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
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
                  const isCancelled = activity.callStatus === "Cancelled";
                  const isNoResponse = activity.callStatus === "No Response";
                  const isTerminal = isCompleted || isCancelled || isNoResponse;
                  const time = activity.followUpTime;

                  const contactId = activity.contact?.id || activity.deal?.contact?.id;
                  const leadUrl = contactId ? `/leads/${contactId}` : null;

                  return (
                    <TableRow
                      key={activity.id}
                      className={`${isTerminal ? "opacity-60" : ""} cursor-pointer hover:bg-muted/50`}
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
                      <TableCell className="max-w-[200px] truncate" title={activity.notesDisplay || activity.notes || ""}>{activity.notesDisplay || activity.notes || "-"}</TableCell>
                      <TableCell>{salesPerson}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            isCompleted ? "secondary" :
                            isCancelled ? "destructive" :
                            isNoResponse ? "outline" :
                            "default"
                          }
                          className={`text-[11px] ${isCancelled ? "text-red-600 border-red-300" : ""} ${isNoResponse ? "text-amber-600 border-amber-300" : ""}`}
                        >
                          {activity.callStatus || "Pending"}
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
                            onClick={() => openEditDialog(activity)}
                            title="Edit Follow-up"
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
                            className={`h-7 w-7 ${activity.callStatus === "Pending" ? "text-orange-600" : "text-muted-foreground"}`}
                            onClick={() => handleToggleStatus(activity.id, activity.callStatus)}
                            title={activity.callStatus === "Pending" ? "Mark as Completed" : "Mark as Pending"}
                          >
                            {activity.callStatus === "Pending" ? <Phone className="h-3.5 w-3.5" /> : <PhoneOff className="h-3.5 w-3.5" />}
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

      {/* Follow-up Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {editingActivity?.notesDisplay && (
              <div>
                <Label className="text-xs text-muted-foreground">Notes History</Label>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded-md max-h-32 overflow-y-auto mt-1">
                  {editingActivity.notesDisplay}
                </div>
              </div>
            )}
            <div>
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                  <SelectItem value="No Response">No Response</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>New Notes (appended to history)</Label>
              <Textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                placeholder="Add notes for this follow-up..."
                rows={4}
              />
            </div>
            <div>
              <Label>Follow-up Date</Label>
              <Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
            </div>
            {editDate && (
              <div>
                <Label>Follow-up Time</Label>
                <Input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditFollowUp} disabled={updateActivity.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
