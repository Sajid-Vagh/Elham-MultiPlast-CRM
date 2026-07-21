import { useState, useMemo, useEffect } from "react";
import { useUpdateActivity, useGetMe } from "@workspace/api-client-react";
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
import { Calendar, ArrowLeft, Phone, PhoneOff, X, Clock, Search, Eye, Pencil, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";
import { onActivityChange } from "@/lib/query-invalidation";
import { CategoryBadge } from "@/components/category-badge";
import { ExportDropdown } from "@/components/export-dropdown";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import ActivityDetailDrawer from "@/components/activity-detail-drawer";

const PAGE_SIZE = 15;

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

function getStatusBadge(status: string | null | undefined, followUpDate?: string | null): { label: string; className: string } {
  if (status === "Completed") return { label: "Completed", className: "bg-green-100 text-green-700 border-green-200" };
  if (status === "Cancelled") return { label: "Cancelled", className: "bg-red-100 text-red-700 border-red-200" };
  if (status === "No Response") return { label: "No Response", className: "bg-gray-100 text-gray-600 border-gray-200" };
  if (followUpDate) {
    const today = todayStr();
    if (followUpDate < today) return { label: "Overdue", className: "bg-red-100 text-red-700 border-red-200" };
    if (followUpDate === today) return { label: "Today", className: "bg-orange-100 text-orange-700 border-orange-200" };
  }
  return { label: "Upcoming", className: "bg-blue-100 text-blue-700 border-blue-200" };
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "Upcoming", label: "Upcoming" },
  { value: "Today", label: "Today" },
  { value: "Overdue", label: "Overdue" },
  { value: "Pending", label: "Pending" },
  { value: "Completed", label: "Completed" },
  { value: "Cancelled", label: "Cancelled" },
  { value: "No Response", label: "No Response" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "Phone Call", label: "Phone Call" },
  { value: "WhatsApp", label: "WhatsApp" },
  { value: "Meeting", label: "Meeting" },
  { value: "Email", label: "Email" },
  { value: "Video Call", label: "Video Call" },
  { value: "Site Visit", label: "Site Visit" },
];

const SORT_OPTIONS = [
  { value: "date-asc", label: "Date (Ascending)" },
  { value: "date-desc", label: "Date (Descending)" },
  { value: "status", label: "Status" },
  { value: "name", label: "Customer Name" },
];

export default function FollowUps() {
  const [dateFilter, setDateFilter] = useState("");
  const [showToday, setShowToday] = useState(false);
  const [unitFilter, setUnitFilter] = useState<string | undefined>();
  const [ownerFilter, setOwnerFilter] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date-desc");
  const [page, setPage] = useState(1);
  const [drawerActivity, setDrawerActivity] = useState<FollowUpActivity | null>(null);
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const { data: users } = useCustomerFacingUsers();
  const isAdmin = me?.role === "admin";
  const { units: activeUnits } = useActiveUnits();

  const activeDate = useMemo(() => {
    if (showToday) return todayStr();
    return dateFilter || "";
  }, [dateFilter, showToday]);

  type FollowUpActivity = {
    id: number; type: string; notes?: string | null;
    notesDisplay?: string | null;
    followUpDate?: string | null; followUpTime?: string | null;
    callStatus?: string | null; createdBy?: number | null;
    followUpType?: string | null; priority?: string | null;
    dealId: number; contactId?: number | null;
    user?: { id: number; name: string } | null;
    deal?: { id: number; contactId?: number; contact?: { id?: number; name?: string; mobile?: string; companyName?: string; unit?: string; category?: string; customerComments?: string | null; salesOwnerId?: number | null; salesOwner?: { name: string } | null } | null } | null;
    contact?: { id?: number; name?: string; mobile?: string; companyName?: string; unit?: string; category?: string; customerComments?: string | null; salesOwnerId?: number | null; salesOwner?: { name: string } | null } | null;
  };

  const { data: activities, isLoading, refetch } = useQuery<FollowUpActivity[]>({
    queryKey: ["follow-up-activities", activeDate, isAdmin ? ownerFilter || "all" : me?.id, unitFilter],
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
      if (isAdmin && ownerFilter) {
        params.set("userId", ownerFilter);
      }
      const res = await fetch(`/api/activities?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 30_000,
  });

  const updateActivity = useUpdateActivity();
  const queryClient = useQueryClient();

  const pendingCount = useMemo(() => {
    if (!activities) return 0;
    return activities.filter(a => a.callStatus === "Pending").length;
  }, [activities]);

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
          onActivityChange(queryClient);
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
          onActivityChange(queryClient);
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
        }
      }
    );
  };

  // Filters, search, sort
  const filteredActivities = useMemo(() => {
    if (!activities) return [];
    let list = [...activities];

    // Unit filter
    if (unitFilter) {
      list = list.filter(a => {
        const contactUnit = a.contact?.unit || a.deal?.contact?.unit;
        return contactUnit === unitFilter;
      });
    }

    // Owner filter (admin only)
    if (isAdmin && ownerFilter) {
      list = list.filter(a => {
        const ownerId = a.contact?.salesOwnerId || a.deal?.contact?.salesOwnerId;
        return ownerId === Number(ownerFilter);
      });
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a => {
        const name = (a.contact?.name || a.deal?.contact?.name || "").toLowerCase();
        const mobile = (a.contact?.mobile || a.deal?.contact?.mobile || "");
        const company = (a.contact?.companyName || a.deal?.contact?.companyName || "").toLowerCase();
        return name.includes(q) || mobile.includes(q) || company.includes(q);
      });
    }

    // Status filter — default: only show active pending activities
    if (statusFilter === "all") {
      list = list.filter(a => (a.callStatus || "Pending") === "Pending");
    } else if (statusFilter === "Upcoming") {
      list = list.filter(a => {
        if (a.callStatus !== "Pending") return false;
        const today = todayStr();
        return a.followUpDate ? a.followUpDate > today : true;
      });
    } else if (statusFilter === "Today") {
      const today = todayStr();
      list = list.filter(a => a.followUpDate === today && a.callStatus === "Pending");
    } else if (statusFilter === "Overdue") {
      const today = todayStr();
      list = list.filter(a => a.followUpDate && a.followUpDate < today && a.callStatus === "Pending");
    } else {
      list = list.filter(a => (a.callStatus || "Pending") === statusFilter);
    }

    // Type filter
    if (typeFilter !== "all") {
      list = list.filter(a => (a.followUpType || a.type) === typeFilter);
    }

    // Sort
    list.sort((a, b) => {
      switch (sortBy) {
        case "date-asc":
          return (a.followUpDate || "").localeCompare(b.followUpDate || "");
        case "date-desc":
          return (b.followUpDate || "").localeCompare(a.followUpDate || "");
        case "status": {
          const order = { "Overdue": 0, "Today": 1, "Upcoming": 2, "Pending": 3, "No Response": 4, "Completed": 5, "Cancelled": 6 };
          const getOrder = (s: string | null | undefined, d?: string | null) => {
            if (s === "Completed") return 5;
            if (s === "Cancelled") return 6;
            if (s === "No Response") return 4;
            if (d) {
              const t = todayStr();
              if (d < t) return 0;
              if (d === t) return 1;
            }
            if (s === "Pending") return 3;
            return 2;
          };
          return getOrder(a.callStatus, a.followUpDate) - getOrder(b.callStatus, b.followUpDate);
        }
        case "name": {
          const nameA = (a.contact?.name || a.deal?.contact?.name || "").toLowerCase();
          const nameB = (b.contact?.name || b.deal?.contact?.name || "").toLowerCase();
          return nameA.localeCompare(nameB);
        }
        default:
          return 0;
      }
    });

    return list;
  }, [activities, unitFilter, ownerFilter, isAdmin, searchQuery, statusFilter, typeFilter, sortBy]);

  // Pagination
  const totalPages = Math.ceil(filteredActivities.length / PAGE_SIZE);
  const paginatedActivities = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredActivities.slice(start, start + PAGE_SIZE);
  }, [filteredActivities, page]);

  // Reset page when filters change
  useEffect(() => {
    if (page > Math.ceil(filteredActivities.length / PAGE_SIZE)) {
      setPage(1);
    }
  }, [filteredActivities.length, page]);

  const todayDate = todayStr();

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Activity</h1>
            <p className="text-sm text-muted-foreground">View and manage all scheduled activities.</p>
          </div>
        </div>
        <ExportDropdown exportUrl="/api/exports/activities" filename="Activities" />
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, company..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={unitFilter || "all"} onValueChange={v => { setUnitFilter(v === "all" ? undefined : v); setPage(1); }}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit</SelectItem>
                  {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
              {isAdmin && (
                <Select value={ownerFilter || "all"} onValueChange={v => { setOwnerFilter(v === "all" ? undefined : v); setPage(1); }}>
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue placeholder="Sales Person" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sales Persons</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Button
              variant={showToday ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { setShowToday(prev => !prev); setDateFilter(""); setPage(1); }}
            >
              <Clock className="h-3.5 w-3.5" />
              Today
              {showToday && pendingCount > 0 && (
                <Badge className="ml-1 bg-white/20 text-white text-[10px] h-4 px-1.5">
                  {pendingCount}
                </Badge>
              )}
            </Button>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={dateFilter}
                onChange={e => { setDateFilter(e.target.value); setShowToday(false); setPage(1); }}
                className="w-36 h-8 text-xs"
              />
              {dateFilter && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setDateFilter("")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {filteredActivities.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredActivities.length} result{filteredActivities.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary card */}
      {showToday && !isLoading && filteredActivities.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="py-3">
            <p className="text-sm text-orange-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              You have <strong>{filteredActivities.filter(a => a.callStatus === "Pending").length}</strong> pending follow-up{filteredActivities.filter(a => a.callStatus === "Pending").length !== 1 ? "s" : ""} scheduled today.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Table Card */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading follow-ups...</div>
          ) : !paginatedActivities || paginatedActivities.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-16">
              {activeDate
                ? `No follow-ups found for ${new Date(activeDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`
                : "No follow-ups match your filters."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider">Customer</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider hidden md:table-cell">Company</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider hidden lg:table-cell">Category</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider">Date</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">Time</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider hidden lg:table-cell">Type</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider hidden xl:table-cell">Sales Person</TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedActivities.map((activity) => {
                    const contactName = activity.contact?.name || activity.deal?.contact?.name || "-";
                    const contactMobile = activity.contact?.mobile || activity.deal?.contact?.mobile || "-";
                    const companyName = activity.contact?.companyName || activity.deal?.contact?.companyName || "-";
                    const salesPerson = activity.user?.name || (activity.contact?.salesOwner?.name) || "-";
                    const isTerminal = activity.callStatus === "Completed" || activity.callStatus === "Cancelled";
                    const statusBadge = getStatusBadge(activity.callStatus, activity.followUpDate);
                    const contactId = activity.contact?.id || activity.deal?.contact?.id;
                    const leadUrl = contactId ? `/leads/${contactId}` : null;

                    return (
                      <TableRow
                        key={activity.id}
                        className={`${isTerminal ? "opacity-60" : ""} cursor-pointer hover:bg-muted/50`}
                        onClick={() => setDrawerActivity(activity)}
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{contactName}</span>
                            <span className="text-xs text-muted-foreground">{contactMobile}</span>
                            <span className="text-xs text-muted-foreground md:hidden">{companyName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">{companyName}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <CategoryBadge category={activity.contact?.category || activity.deal?.contact?.category} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm">{activity.followUpDate ? new Date(activity.followUpDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "-"}</span>
                            <span className="text-xs text-muted-foreground sm:hidden">{formatTime(activity.followUpTime)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm">{formatTime(activity.followUpTime)}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {activity.followUpType && (
                            <Badge variant="outline" className="text-[10px]">{activity.followUpType}</Badge>
                          )}
                          {activity.priority && (
                            <span className={`ml-1 text-[10px] ${
                              activity.priority === "High" ? "text-red-500" :
                              activity.priority === "Low" ? "text-green-500" : "text-amber-500"
                            }`}>{activity.priority}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] px-2 py-0.5 border ${statusBadge.className}`}>
                            {statusBadge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-sm">{salesPerson}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setDrawerActivity(activity)} title="Preview Activity">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(activity)} title="Edit Follow-up">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className={`h-7 w-7 ${activity.callStatus === "Pending" ? "text-orange-600" : "text-muted-foreground"}`} onClick={() => handleToggleStatus(activity.id, activity.callStatus)} title={activity.callStatus === "Pending" ? "Mark as Completed" : "Mark as Pending"}>
                              {activity.callStatus === "Pending" ? <Phone className="h-3.5 w-3.5" /> : <PhoneOff className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages} ({filteredActivities.length} total)
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              if (p > totalPages) return null;
              return (
                <Button key={p} variant={page === p ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => setPage(p)}>
                  {p}
                </Button>
              );
            })}
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
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

      <ActivityDetailDrawer
        activity={drawerActivity as any}
        open={drawerActivity !== null}
        onClose={() => setDrawerActivity(null)}
        onEdit={(act) => { setDrawerActivity(null); openEditDialog(act as FollowUpActivity); }}
      />
    </div>
  );
}
