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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Phone, PhoneOff, Search, Eye, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";
import { onActivityChange } from "@/lib/query-invalidation";
import { dedupeById, parseNotesText } from "@/lib/parse-notes";
import { CategoryBadge } from "@/components/category-badge";
import { ExportButton } from "@/components/export-button";
import { useActiveUnits } from "@/lib/use-active-units";
import { useUnitFilter } from "@/lib/use-unit-filter";
import { PENDING_UNIT_ASSIGNMENT, isPendingUnit } from "@/lib/unit-constants";
import { useDateFilter } from "@/lib/use-date-filter";
import { useOwnerFilter, useStatusFilter } from "@/lib/global-filters";
import { customerLabel } from "@/lib/customer-label";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import ActivityDetailDrawer from "@/components/activity-detail-drawer";
import CustomerProfileDrawer from "@/components/customer-profile-drawer";
import { FlexibleTimeInput } from "@/components/flexible-time-input";
import { deriveFollowUpStatus } from "@/lib/follow-up-status";

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

function getStatusBadge(status: string | null | undefined, followUpDate?: string | null, followUpTime?: string | null): { label: string; className: string } {
  if (status === "Completed") return { label: "Completed", className: "bg-green-100 text-green-700 border-green-200" };
  if (status === "Cancelled") return { label: "Cancelled", className: "bg-red-100 text-red-700 border-red-200" };
  if (status === "No Response") return { label: "No Response", className: "bg-gray-100 text-gray-600 border-gray-200" };
  // Date+time aware: Overdue = past date; Pending = today with time passed;
  // Today = today with time still ahead; Upcoming = future/no date.
  const derived = deriveFollowUpStatus(status, followUpDate, followUpTime);
  if (derived === "Overdue") return { label: "Overdue", className: "bg-red-100 text-red-700 border-red-200" };
  if (derived === "Pending") return { label: "Pending", className: "bg-yellow-100 text-yellow-700 border-yellow-200" };
  if (derived === "Today") return { label: "Today", className: "bg-orange-100 text-orange-700 border-orange-200" };
  return { label: "Upcoming", className: "bg-blue-100 text-blue-700 border-blue-200" };
}

function parseNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  return parseNotesText(notes) || "";
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "Upcoming", label: "Upcoming" },
  { value: "Today", label: "Today" },
  { value: "Overdue", label: "Overdue" },
  { value: "Pending", label: "Pending" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "Call", label: "Phone Call" },
  { value: "WhatsApp", label: "WhatsApp" },
  { value: "Meeting", label: "Meeting" },
  { value: "Email", label: "Email" },
  { value: "Video Call", label: "Video Call" },
  { value: "Site Visit", label: "Site Visit" },
];

const TYPE_VALUE_ALIASES: Record<string, string[]> = {
  Call: ["Call", "Phone Call"],
};

const SORT_OPTIONS = [
  { value: "date-asc", label: "Date (Ascending)" },
  { value: "date-desc", label: "Date (Descending)" },
  { value: "status", label: "Status" },
  { value: "name", label: "Customer Name" },
];

export default function FollowUps() {
  const [location, setLocation] = useLocation();
  const [dateFilter, setDateFilter] = useDateFilter();
  const [unitFilter, setUnitFilter] = useUnitFilter();
  const [globalOwner, setGlobalOwner] = useOwnerFilter();
  const [globalStatus, setGlobalStatus] = useStatusFilter();
  const ownerFilter = globalOwner || undefined;
  const setOwnerFilter = (v: string | undefined) => setGlobalOwner(v ?? "");
  const statusFilter = globalStatus === "All" ? "all" : globalStatus;
  const setStatusFilter = (v: string) => setGlobalStatus(v === "all" ? "All" : v);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date-asc");
  const [page, setPage] = useState(1);
  const [modalActivity, setModalActivity] = useState<FollowUpActivity | null>(null);
  const [customerDrawerContactId, setCustomerDrawerContactId] = useState<number | null>(null);
  const [callConfirmActivity, setCallConfirmActivity] = useState<FollowUpActivity | null>(null);
  const [callConfirmSaving, setCallConfirmSaving] = useState(false);
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const { data: users } = useCustomerFacingUsers();
  const isAdmin = me?.role === "admin";
  const { units: activeUnits } = useActiveUnits();

  // Deep-link support: the Dashboard's metric cards navigate here with a
  // `?status=` query param (Overdue / Pending / Today). Read it from the URL
  // and apply it to the Status dropdown so the page loads with exactly the
  // clicked category pre-filtered. Re-runs whenever the param changes, so
  // clicking another card while already on this page also re-filters.
  const statusParam = useMemo(() => {
    if (typeof window === "undefined") return null;
    const search = window.location.search || (location.includes("?") ? location.split("?")[1] : "");
    if (!search) return null;
    const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
    return params.get("status");
  }, [location]);

  useEffect(() => {
    if (!statusParam) return;
    setGlobalStatus(statusParam === "all" ? "All" : statusParam);
    setPage(1);
  }, [statusParam, setGlobalStatus]);

  type FollowUpActivity = {
    id: number; type: string; notes?: string | null;
    notesDisplay?: string | null;
    followUpDate?: string | null; followUpTime?: string | null;
    callStatus?: string | null; createdBy?: number | null;
    followUpType?: string | null; priority?: string | null;
    dealId: number; contactId?: number | null;
    user?: { id: number; name: string } | null;
    deal?: { id: number; contactId?: number; contact?: { id?: number; name?: string; mobile?: string; companyName?: string; unit?: string; category?: string; customerCode?: string | null; customerComments?: string | null; salesOwnerId?: number | null; salesOwner?: { name: string } | null } | null } | null;
    contact?: { id?: number; name?: string; mobile?: string; companyName?: string; unit?: string; category?: string; customerCode?: string | null; customerComments?: string | null; salesOwnerId?: number | null; salesOwner?: { name: string } | null } | null;
  };

  const { data: activities, isLoading, refetch } = useQuery<FollowUpActivity[]>({
    queryKey: ["follow-up-activities", dateFilter.preset, dateFilter.startDate, dateFilter.endDate, isAdmin ? ownerFilter || "all" : me?.id, unitFilter],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      if (dateFilter.startDate) params.set("startDate", dateFilter.startDate);
      if (dateFilter.endDate) params.set("endDate", dateFilter.endDate);
      if (!isAdmin && me?.id) {
        params.set("userId", String(me.id));
      }
    if (isAdmin && ownerFilter) {
      params.set("salesPersonId", ownerFilter);
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

  const handlePhoneAction = (activityId: number, currentStatus: string | null | undefined) => {
    if (currentStatus === "Pending") {
      const activity = activities?.find(a => a.id === activityId) || null;
      if (activity) {
        setCallConfirmActivity(activity);
      }
      return;
    }
    const newStatus = "Pending";
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

  const handleCallConfirmNo = () => {
    if (!callConfirmActivity) return;
    setCallConfirmSaving(true);
    updateActivity.mutate(
      { id: callConfirmActivity.id, data: { callStatus: "Completed" } as any },
      {
        onSuccess: () => {
          toast({ title: "Call marked as Completed" });
          refetch();
          onActivityChange(queryClient);
          setCallConfirmActivity(null);
          setCallConfirmSaving(false);
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
          setCallConfirmSaving(false);
        }
      }
    );
  };

  const handleCallConfirmYes = () => {
    if (!callConfirmActivity) return;
    setCallConfirmSaving(true);
    updateActivity.mutate(
      { id: callConfirmActivity.id, data: { callStatus: "Completed" } as any },
      {
        onSuccess: () => {
          toast({ title: "Call marked as Completed" });
          refetch();
          onActivityChange(queryClient);
          const activity = callConfirmActivity;
          setCallConfirmActivity(null);
          setCallConfirmSaving(false);
          setModalActivity(activity);
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
          setCallConfirmSaving(false);
        }
      }
    );
  };

  const handleOpenCustomerDrawer = (activity: FollowUpActivity) => {
    const cId = activity.contact?.id || activity.deal?.contact?.id || activity.contactId || null;
    if (cId) setCustomerDrawerContactId(cId);
  };

  // Filters, search, sort
  const filteredActivities = useMemo(() => {
    if (!activities) return [];
    let list = dedupeById(activities);

    // Unit filter
    if (unitFilter !== "All") {
      list = list.filter(a => {
        const contactUnit = a.contact?.unit || a.deal?.contact?.unit;
        if (unitFilter === PENDING_UNIT_ASSIGNMENT) return isPendingUnit(contactUnit);
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
        const code = (a.contact?.customerCode || a.deal?.contact?.customerCode || "").toLowerCase();
        const mobile = (a.contact?.mobile || a.deal?.contact?.mobile || "");
        const company = (a.contact?.companyName || a.deal?.contact?.companyName || "").toLowerCase();
        return name.includes(q) || code.includes(q) || mobile.includes(q) || company.includes(q);
      });
    }

    // Status filter — default: only show active pending activities.
    // Date-based buckets are time-aware via deriveFollowUpStatus:
    // Overdue = past date; Pending = today + time passed; Today = today +
    // time still ahead; Upcoming = future date (or no date).
    if (statusFilter === "all") {
      list = list.filter(a => (a.callStatus || "Pending") === "Pending");
    } else if (statusFilter === "Upcoming" || statusFilter === "Today" || statusFilter === "Overdue" || statusFilter === "Pending") {
      list = list.filter(a => deriveFollowUpStatus(a.callStatus, a.followUpDate, a.followUpTime) === statusFilter);
    } else {
      list = list.filter(a => (a.callStatus || "Pending") === statusFilter);
    }

    // Type filter — match either the `type` or `followUpType` column
    if (typeFilter !== "all") {
      const targets = TYPE_VALUE_ALIASES[typeFilter] || [typeFilter];
      list = list.filter(a => targets.includes(a.type || "") || targets.includes(a.followUpType || ""));
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
          const getOrder = (s: string | null | undefined, d?: string | null, t?: string | null) =>
            order[deriveFollowUpStatus(s, d, t)] ?? 2;
          return getOrder(a.callStatus, a.followUpDate, a.followUpTime) - getOrder(b.callStatus, b.followUpDate, b.followUpTime);
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
        <ExportButton
          exportUrl="/api/exports/activities"
          filename="Activities"
          onBeforeExport={() => ({
            status: statusFilter === "all" ? "" : statusFilter,
            ownerId: ownerFilter || "",
            unit: unitFilter && unitFilter !== "All" ? unitFilter : "",
            search: searchQuery,
            type: typeFilter === "all" ? "" : typeFilter,
            dateFrom: dateFilter.startDate || "",
            dateTo: dateFilter.endDate || "",
          })}
        />
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, code, phone, company..."
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
              <Select value={unitFilter} onValueChange={v => { setUnitFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Units</SelectItem>
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
              <ClearFiltersButton onClear={() => { setSearchQuery(""); setTypeFilter("all"); }} />
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
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
            {filteredActivities.length > 0 && (
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredActivities.length} result{filteredActivities.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary card */}
      {dateFilter.preset === "today" && !isLoading && filteredActivities.length > 0 && (
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
              {dateFilter.startDate
                ? `No follow-ups found for the selected date range.`
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
                    const contactCode = activity.contact?.customerCode || activity.deal?.contact?.customerCode || null;
                    const contactMobile = activity.contact?.mobile || activity.deal?.contact?.mobile || "-";
                    const companyName = activity.contact?.companyName || activity.deal?.contact?.companyName || "-";
                    const salesPerson = activity.user?.name || (activity.contact?.salesOwner?.name) || "-";
                    const isTerminal = activity.callStatus === "Completed" || activity.callStatus === "Cancelled";
                    const statusBadge = getStatusBadge(activity.callStatus, activity.followUpDate, activity.followUpTime);
                    const contactId = activity.contact?.id || activity.deal?.contact?.id;
                    const leadUrl = contactId ? `/leads/${contactId}` : null;

                    return (
                      <TableRow
                        key={activity.id}
                        className={`${isTerminal ? "opacity-60" : ""} cursor-pointer hover:bg-muted/50`}
                        onClick={() => handleOpenCustomerDrawer(activity)}
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{customerLabel(contactName, contactCode)}</span>
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
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => { if (contactId) setLocation(`/leads/${contactId}`); else handleOpenCustomerDrawer(activity); }} title="Customer Profile">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className={`h-7 w-7 ${activity.callStatus === "Pending" ? "text-orange-600" : "text-muted-foreground"}`} onClick={() => handlePhoneAction(activity.id, activity.callStatus)} title={activity.callStatus === "Pending" ? "Mark as Completed" : "Mark as Pending"}>
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
                  {parseNotes(editingActivity.notesDisplay)}
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
                <FlexibleTimeInput value={editTime} onChange={setEditTime} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditFollowUp} disabled={updateActivity.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Call Completion Confirmation Dialog */}
      <AlertDialog open={callConfirmActivity !== null} onOpenChange={(open) => { if (!open) setCallConfirmActivity(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Call Action</AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to schedule the next follow-up call?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={callConfirmSaving}>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={handleCallConfirmNo} disabled={callConfirmSaving}>
              {callConfirmSaving ? "Saving..." : "No"}
            </Button>
            <Button onClick={handleCallConfirmYes} disabled={callConfirmSaving}>
              {callConfirmSaving ? "Saving..." : "Yes"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ActivityDetailDrawer
        open={modalActivity !== null}
        onOpenChange={(open) => { if (!open) setModalActivity(null); }}
        contactId={modalActivity?.contactId || modalActivity?.deal?.contactId || modalActivity?.contact?.id || 0}
        dealId={modalActivity?.dealId}
        contactName={modalActivity?.contact?.name || modalActivity?.deal?.contact?.name}
        contactCompany={modalActivity?.contact?.companyName || modalActivity?.deal?.contact?.companyName}
        contactMobile={modalActivity?.contact?.mobile || modalActivity?.deal?.contact?.mobile}
        activity={modalActivity ? { id: modalActivity.id, type: modalActivity.type, notesDisplay: modalActivity.notesDisplay, notes: modalActivity.notes, callStatus: modalActivity.callStatus, followUpType: modalActivity.followUpType } : null}
      />

      <CustomerProfileDrawer
        contactId={customerDrawerContactId}
        open={customerDrawerContactId !== null}
        onOpenChange={(open) => { if (!open) setCustomerDrawerContactId(null); }}
      />
    </div>
  );
}
