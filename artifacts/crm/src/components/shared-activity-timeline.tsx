import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useGetContact,
  useGetDeal,
  useListDeals,
  useListActivities,
  useListContactProformaInvoices,
  useUpdateActivity,
  getGetContactQueryKey,
  getGetDealQueryKey,
  getListDealsQueryKey,
  getListActivitiesQueryKey,
  getListContactProformaInvoicesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Phone,
  Plus,
  Trash2,
  FolderTree,
  MessageSquare,
  Calendar,
  Users,
  FileText,
  Search,
  EyeOff,
  Eye,
  StickyNote,
  CheckCircle,
  XCircle,
  ListOrdered,
  User,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ActivityDetailDrawer from "@/components/activity-detail-drawer";
import { STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { onContactChange, onDealChange, onActivityChange } from "@/lib/query-invalidation";
import { dedupeById, parseDetailedNotes, type DetailedNote } from "@/lib/parse-notes";
import { formatCurrency } from "@/lib/currency";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() {
  return localDateStr(new Date());
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}
function monthStartStr() {
  const d = new Date();
  d.setDate(1);
  return localDateStr(d);
}

const QUICK_BTNS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 Days" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All" },
];

function parseDateToLocal(d?: string | Date | null) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  const ymdMatch = typeof d === "string" ? d.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (ymdMatch && typeof d === "string" && !d.includes("T")) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(y, m, day);
  }
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function getDayKey(d?: string | null) {
  if (!d) return "";
  const ymdMatch = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch && !d.includes("T")) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d.slice(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDay(d?: string | Date | null) {
  if (!d) return "";
  try {
    const dt = parseDateToLocal(d);
    return dt ? dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : (typeof d === "string" ? d : "");
  } catch {
    return typeof d === "string" ? d : "";
  }
}

function formatTime(d?: string | Date | null) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "" : dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

function formatTimeString(t?: string | null) {
  if (!t) return "";
  const trimmed = t.trim();
  if (!trimmed) return "";
  if (/am|pm/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${minute} ${ampm}`;
  }
  return trimmed;
}

function computeSortTimestamp(dateStr?: string | null, timeStr?: string | null) {
  if (!dateStr) return 0;
  const dayKey = getDayKey(dateStr);
  if (!dayKey) return 0;
  let h = 9;
  let m = 0;
  if (timeStr) {
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
    if (match) {
      h = parseInt(match[1], 10);
      m = parseInt(match[2], 10);
      const ampm = match[3]?.toUpperCase();
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
    }
  }
  const ymdMatch = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const mon = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(y, mon, day, h, m, 0).getTime();
  }
  return new Date(dateStr).getTime() || 0;
}

export interface SharedActivityTimelineProps {
  contactId?: number | null;
  leadId?: number | null;
  dealId?: number | null;
  showHeader?: boolean;
  compact?: boolean;
  hideDealsManagement?: boolean;
  className?: string;
  onActivityChanged?: () => void;
}

export function SharedActivityTimeline({
  contactId: propContactId,
  leadId: propLeadId,
  dealId: propDealId,
  showHeader = true,
  compact = false,
  hideDealsManagement = false,
  className = "",
  onActivityChanged,
}: SharedActivityTimelineProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // If dealId is provided, fetch deal details (useful for resolving contactId)
  const { data: fetchedDeal } = useGetDeal(propDealId!, {
    query: { enabled: !!propDealId, queryKey: getGetDealQueryKey(propDealId!) },
  });

  const effectiveContactId =
    propContactId ??
    propLeadId ??
    fetchedDeal?.contactId ??
    (fetchedDeal as any)?.contact?.id ??
    null;

  const { data: fetchedContact, isLoading: loadingContact } = useGetContact(effectiveContactId!, {
    query: { enabled: !!effectiveContactId, queryKey: getGetContactQueryKey(effectiveContactId!) },
  });

  const { data: fetchedDeals, isLoading: loadingDeals } = useListDeals(
    { contactId: effectiveContactId! },
    { query: { enabled: !!effectiveContactId, queryKey: getListDealsQueryKey({ contactId: effectiveContactId! }) } }
  );

  const { data: fetchedActivities, isLoading: loadingActivities } = useListActivities(
    { contactId: effectiveContactId! },
    { query: { enabled: !!effectiveContactId, queryKey: getListActivitiesQueryKey({ contactId: effectiveContactId! }) } }
  );

  // Fallback activities if contactId couldn't be resolved but dealId is provided
  const { data: fallbackDealActivities } = useListActivities(
    { dealId: propDealId! },
    { query: { enabled: !!propDealId && !effectiveContactId, queryKey: getListActivitiesQueryKey({ dealId: propDealId! }) } }
  );

  const { data: fetchedProformas } = useListContactProformaInvoices(effectiveContactId!, {
    query: {
      enabled: !!effectiveContactId,
      queryKey: getListContactProformaInvoicesQueryKey(effectiveContactId!),
    },
  });

  const contact = fetchedContact || (fetchedDeal as any)?.contact || null;
  const allDeals = useMemo(() => {
    if (fetchedDeals && fetchedDeals.length > 0) return fetchedDeals;
    if (fetchedDeal) return [fetchedDeal];
    return [];
  }, [fetchedDeals, fetchedDeal]);

  const activities = (fetchedActivities && fetchedActivities.length > 0 ? fetchedActivities : fallbackDealActivities) || [];
  const contactProformas = fetchedProformas || [];

  // Filter state
  const [actQuick, setActQuick] = useState("all");
  const [actFromDate, setActFromDate] = useState("");
  const [actToDate, setActToDate] = useState("");
  const [timelineSearch, setTimelineSearch] = useState("");
  const [showHiddenDeals, setShowHiddenDeals] = useState(false);

  const applyQuick = (key: string) => {
    setActQuick(key);
    if (key === "today") {
      setActFromDate(todayStr());
      setActToDate(todayStr());
    } else if (key === "yesterday") {
      setActFromDate(daysAgoStr(1));
      setActToDate(daysAgoStr(1));
    } else if (key === "week") {
      setActFromDate(daysAgoStr(6));
      setActToDate(todayStr());
    } else if (key === "month") {
      setActFromDate(monthStartStr());
      setActToDate(todayStr());
    } else {
      setActFromDate("");
      setActToDate("");
    }
  };

  // Activity modal state
  const [actDealId, setActDealId] = useState("");
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [completingActivity, setCompletingActivity] = useState<any>(null);

  // Call Action confirmation dialog
  const [callConfirmActivity, setCallConfirmActivity] = useState<{ activity: any; dealId: number | null } | null>(null);
  const [callConfirmSaving, setCallConfirmSaving] = useState(false);
  const updateActivityMutation = useUpdateActivity();

  const handleCallConfirmNo = () => {
    if (!callConfirmActivity) return;
    setCallConfirmSaving(true);
    updateActivityMutation.mutate(
      { id: callConfirmActivity.activity.id, data: { callStatus: "Completed" } as any },
      {
        onSuccess: () => {
          toast({ title: "Call marked as Completed" });
          onActivityChange(queryClient, callConfirmActivity.dealId || undefined, effectiveContactId || undefined);
          setCallConfirmActivity(null);
          setCallConfirmSaving(false);
          onActivityChanged?.();
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
          setCallConfirmSaving(false);
        },
      }
    );
  };

  const handleCallConfirmYes = () => {
    if (!callConfirmActivity) return;
    const { activity, dealId } = callConfirmActivity;
    setCallConfirmActivity(null);
    setActDealId(String(activity?.dealId ?? dealId ?? ""));
    setCompletingActivity(activity);
    setActivityModalOpen(true);
  };

  // Delete activity confirmation
  const [deleteActId, setDeleteActId] = useState<number | null>(null);

  // Delete deal confirmation
  const [deleteDealOpen, setDeleteDealOpen] = useState(false);
  const [deleteDealId, setDeleteDealId] = useState<number | null>(null);
  const [deleteDealTitle, setDeleteDealTitle] = useState("");

  const deleteDealMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = localStorage.getItem("crm_token") || "";
      const res = await fetch(`/api/deals/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to delete deal" }));
        throw new Error(err.error || "Failed to delete deal");
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      onDealChange(queryClient, deleteDealId || undefined, effectiveContactId || undefined);
      onActivityChange(queryClient, deleteDealId || undefined, effectiveContactId || undefined);
      if (effectiveContactId) onContactChange(queryClient, effectiveContactId);
      toast({ title: "Deal deleted successfully" });
      setDeleteDealOpen(false);
      setDeleteDealId(null);
      setDeleteDealTitle("");
      onActivityChanged?.();
    },
    onError: (err: any) => {
      toast({
        title: "Could not delete deal",
        description: err?.message || "Failed to delete deal",
        variant: "destructive",
      });
    },
  });

  // Deal timeline visibility toggle
  const setDealTimelineVisibility = useMutation({
    mutationFn: async ({ dealId, hidden }: { dealId: number; hidden: boolean }) => {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("crm_token")}`,
        },
        body: JSON.stringify({ isHiddenFromTimeline: hidden }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Failed to update deal"));
      return res.json();
    },
    onSuccess: (_data, vars) => {
      onDealChange(queryClient, vars.dealId, effectiveContactId || undefined);
      if (effectiveContactId) {
        queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(effectiveContactId) });
      }
      toast({ title: vars.hidden ? "Deal hidden from timeline" : "Deal visible in timeline again" });
      onActivityChanged?.();
    },
    onError: () => toast({ title: "Could not update deal visibility", variant: "destructive" }),
  });

  // Accordion open/close state
  const [expandedDeals, setExpandedDeals] = useState<string[]>([]);
  const [dealsExpandedInitialized, setDealsExpandedInitialized] = useState(false);

  // Timeline events computation
  const dealTimeline = useMemo(() => {
    type TimelineEvent = {
      key: string;
      date: string;
      timeStr: string;
      dayKey: string;
      dayFormatted: string;
      kind: "lead" | "deal" | "followup" | "pi" | "won" | "lost";
      channel?: "call" | "meeting" | "whatsapp" | "followup";
      title: string;
      subtitle?: string | null;
      detail?: string | null;
      notesList?: DetailedNote[];
      noteVariant?: "violet" | "orange";
      metaItems?: Array<{ label: string; value: string; isHighlight?: boolean }>;
      stageBadge?: { label: string; className?: string };
      dotColor: string;
      activityId?: number;
      createdAt?: string | Date | null;
      sortTime: number;
    };

    const dateOk = (d?: string | null) => {
      if (!d) return false;
      const day = getDayKey(d);
      if (actFromDate && day < actFromDate) return false;
      if (actToDate && day > actToDate) return false;
      return true;
    };

    const searchLower = timelineSearch.toLowerCase();
    const matchesSearch = (e: TimelineEvent) =>
      !timelineSearch ||
      e.title.toLowerCase().includes(searchLower) ||
      (e.subtitle || "").toLowerCase().includes(searchLower) ||
      (e.detail || "").toLowerCase().includes(searchLower) ||
      (e.stageBadge?.label || "").toLowerCase().includes(searchLower) ||
      (e.metaItems || []).some((m) => m.value.toLowerCase().includes(searchLower)) ||
      (e.notesList || []).some(
        (n) => n.text.toLowerCase().includes(searchLower) || (n.userName || "").toLowerCase().includes(searchLower)
      );

    const groups: Array<{
      deal: any;
      num: number;
      events: TimelineEvent[];
      dateGroups: Array<{ dayKey: string; dayFormatted: string; events: TimelineEvent[] }>;
      totalEventsCount: number;
      lastActivity: string | null;
    }> = [];

    const existing = [...allDeals].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // Static chronological numbers over ALL deals
    const dealNumbers = new Map<number, number>();
    existing.forEach((d, idx) => dealNumbers.set(d.id, idx + 1));

    // When dealId is specified, restrict to that specific deal
    const dealsToIterate = propDealId
      ? existing.filter((d) => Number(d.id) === Number(propDealId))
      : existing;

    // Hidden-from-timeline deals are skipped unless the user opted to reveal them
    const visibleDeals = showHiddenDeals
      ? dealsToIterate
      : dealsToIterate.filter((d) => !d.isHiddenFromTimeline);

    const leadDate = contact?.createdAt;

    for (const deal of visibleDeals) {
      const events: TimelineEvent[] = [];

      // Only the first chronological deal includes the "Lead created" milestone
      const isFirstDeal = existing.length > 0 && deal.id === existing[0]?.id;
      if (isFirstDeal && leadDate && dateOk(leadDate)) {
        const leadMeta: Array<{ label: string; value: string }> = [];
        if (contact?.mobile) leadMeta.push({ label: "Mobile", value: contact.mobile });
        if (contact?.salesOwner?.name) leadMeta.push({ label: "Owner", value: contact.salesOwner.name });
        if (contact?.unit) leadMeta.push({ label: "Unit", value: contact.unit });
        if (contact?.leadSource) leadMeta.push({ label: "Source", value: contact.leadSource });

        events.push({
          key: `lead-${deal.id}`,
          date: leadDate,
          timeStr: formatTime(leadDate),
          dayKey: getDayKey(leadDate),
          dayFormatted: formatDay(leadDate),
          kind: "lead",
          title: "Lead created",
          subtitle: contact?.name ? `${contact.name}${contact.companyName ? ` (${contact.companyName})` : ""}` : null,
          metaItems: leadMeta.length > 0 ? leadMeta : undefined,
          stageBadge: {
            label: "New Lead",
            className:
              "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
          },
          dotColor: "bg-blue-500",
          sortTime: new Date(leadDate).getTime(),
        });
      }

      const dealCreated = deal.createdAt;
      if (dateOk(dealCreated)) {
        const dealMeta: Array<{ label: string; value: string }> = [];
        if (deal.totalValue) dealMeta.push({ label: "Value", value: formatCurrency(deal.totalValue) });
        if (contact?.salesOwner?.name) dealMeta.push({ label: "Owner", value: contact.salesOwner.name });
        if (deal.productionUnit || contact?.unit) {
          dealMeta.push({ label: "Unit", value: deal.productionUnit || contact?.unit || "" });
        }

        events.push({
          key: `deal-created-${deal.id}`,
          date: dealCreated,
          timeStr: formatTime(dealCreated),
          dayKey: getDayKey(dealCreated),
          dayFormatted: formatDay(dealCreated),
          kind: "deal",
          title: "Deal created",
          subtitle: deal.title || "Untitled Deal",
          metaItems: dealMeta.length > 0 ? dealMeta : undefined,
          stageBadge: {
            label: deal.stage || "New",
            className: STAGE_BADGE_COLORS[deal.stage || "New"] || "bg-slate-100 text-slate-700",
          },
          dotColor: "bg-purple-500",
          sortTime: new Date(dealCreated).getTime(),
        });
      }

      // Human follow-up activities for this deal
      const dealActs = dedupeById(activities || []).filter(
        (a) =>
          Number(a.dealId) === Number(deal.id) &&
          (a.type === "Call" || a.type === "Meeting" || a.type === "FollowUp" || a.type === "WhatsApp")
      );

      const preparedActs = dealActs.map((act) => {
        const callStatus = act.callStatus || "Pending";
        const isPending = callStatus === "Pending";

        let dayKey = "";
        let dayFormatted = "";
        let timeStr = "";
        let sortTime = 0;
        let eventDate = "";

        if (isPending && act.followUpDate) {
          dayKey = getDayKey(act.followUpDate);
          dayFormatted = formatDay(act.followUpDate);
          timeStr = formatTimeString(act.followUpTime) || (act.createdAt ? formatTime(act.createdAt) : "");
          sortTime = computeSortTimestamp(act.followUpDate, act.followUpTime);
          eventDate = act.followUpDate;
        } else {
          const completionDate =
            callStatus === "Completed" && act.updatedAt
              ? act.updatedAt
              : act.followUpDate && !act.createdAt
              ? act.followUpDate
              : act.createdAt || act.followUpDate || "";
          dayKey = getDayKey(completionDate);
          dayFormatted = formatDay(completionDate);
          timeStr = act.updatedAt
            ? formatTime(act.updatedAt)
            : act.createdAt
            ? formatTime(act.createdAt)
            : formatTimeString(act.followUpTime) || "";
          sortTime = act.updatedAt
            ? new Date(act.updatedAt).getTime()
            : act.createdAt
            ? new Date(act.createdAt).getTime()
            : computeSortTimestamp(act.followUpDate, act.followUpTime);
          eventDate = typeof completionDate === "string" ? completionDate : new Date(completionDate).toISOString();
        }

        return {
          act,
          callStatus,
          isPending,
          dayKey,
          dayFormatted,
          timeStr,
          sortTime,
          eventDate,
        };
      });

      // Sort activities chronologically (oldest first) so Call 1, Call 2 are sequential
      preparedActs.sort((a, b) => a.sortTime - b.sortTime);

      let followUpNum = 0;
      for (const item of preparedActs) {
        const { act, callStatus, isPending, dayKey, dayFormatted, timeStr, eventDate, sortTime } = item;
        if (!dateOk(dayKey || eventDate)) continue;
        followUpNum++;

        const rawNote = act.notes || (act as any).note || (act as any).notesDisplay;
        const notesList = parseDetailedNotes(rawNote);

        const statusBadge =
          callStatus === "Completed"
            ? {
                label: "Completed",
                className:
                  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
              }
            : callStatus === "Cancelled"
            ? {
                label: "Cancelled",
                className:
                  "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800",
              }
            : {
                label: "Pending",
                className:
                  "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800",
              };

        const dotColor = isPending ? "bg-amber-500" : callStatus === "Cancelled" ? "bg-red-500" : "bg-emerald-500";

        const isCall = act.type === "Call" || (act as any).followUpType === "Call";
        const isMeeting = act.type === "Meeting" || (act as any).followUpType === "Meeting";
        const isWhatsapp = act.type === "WhatsApp" || (act as any).followUpType === "WhatsApp";
        const typeLabel = isCall ? "Call" : isMeeting ? "Meeting" : isWhatsapp ? "WhatsApp" : "Follow-up";
        const channel = isCall ? "call" : isMeeting ? "meeting" : isWhatsapp ? "whatsapp" : "followup";

        const metaItems: Array<{ label: string; value: string; isHighlight?: boolean }> = [];
        const actorName = (act as any).user?.name || (act as any).createdByName;
        if (actorName) {
          metaItems.push({ label: "Logged By", value: actorName });
        }
        if (act.priority && act.priority !== "Medium") {
          metaItems.push({ label: "Priority", value: act.priority });
        }

        events.push({
          key: `act-${act.id}`,
          date: eventDate,
          timeStr,
          dayKey,
          dayFormatted,
          kind: "followup",
          channel,
          title: `${typeLabel} ${followUpNum}`,
          notesList: notesList.length > 0 ? notesList : undefined,
          noteVariant: isPending ? "orange" : "violet",
          metaItems: metaItems.length > 0 ? metaItems : undefined,
          stageBadge: statusBadge,
          dotColor,
          activityId: act.id,
          createdAt: act.createdAt,
          sortTime,
        });
      }

      // Proforma invoices for this deal
      for (const pi of contactProformas || []) {
        const piDealId = (pi as any).dealId;
        if (Number(piDealId) !== Number(deal.id)) continue;
        const piDate = pi.createdAt || dealCreated;
        if (!dateOk(piDate)) continue;
        const piMeta: Array<{ label: string; value: string }> = [];
        const piTotal = (pi as any).totalAmount ?? (pi as any).grandTotal;
        if (piTotal) piMeta.push({ label: "Amount", value: formatCurrency(piTotal) });
        if (pi.status) piMeta.push({ label: "Status", value: pi.status });

        events.push({
          key: `pi-${pi.id}`,
          date: piDate,
          timeStr: formatTime(piDate),
          dayKey: getDayKey(piDate),
          dayFormatted: formatDay(piDate),
          kind: "pi",
          title: "PI Sent",
          subtitle: `Proforma Invoice #${pi.invoiceNumber || ""}`,
          metaItems: piMeta.length > 0 ? piMeta : undefined,
          stageBadge: {
            label: "PI Sent",
            className: STAGE_BADGE_COLORS["PI Sent"] || "bg-indigo-100 text-indigo-700",
          },
          dotColor: "bg-indigo-500",
          sortTime: new Date(piDate).getTime(),
        });
      }

      // Won / Lost milestone
      if (deal.stage === "Won" && deal.completedAt && dateOk(deal.completedAt)) {
        const wonMeta: Array<{ label: string; value: string }> = [];
        if (deal.totalValue) wonMeta.push({ label: "Won Value", value: formatCurrency(deal.totalValue) });

        events.push({
          key: `won-${deal.id}`,
          date: deal.completedAt,
          timeStr: formatTime(deal.completedAt),
          dayKey: getDayKey(deal.completedAt),
          dayFormatted: formatDay(deal.completedAt),
          kind: "won",
          title: "Deal Won",
          subtitle: "Deal closed successfully",
          metaItems: wonMeta.length > 0 ? wonMeta : undefined,
          stageBadge: { label: "Won", className: STAGE_BADGE_COLORS["Won"] || "bg-green-100 text-green-700" },
          dotColor: "bg-emerald-600",
          sortTime: new Date(deal.completedAt).getTime(),
        });
      } else if (deal.stage === "Lost" && deal.completedAt && dateOk(deal.completedAt)) {
        const lostMeta: Array<{ label: string; value: string }> = [];
        if (deal.lostReason) lostMeta.push({ label: "Reason", value: deal.lostReason });

        events.push({
          key: `lost-${deal.id}`,
          date: deal.completedAt,
          timeStr: formatTime(deal.completedAt),
          dayKey: getDayKey(deal.completedAt),
          dayFormatted: formatDay(deal.completedAt),
          kind: "lost",
          title: "Deal Lost",
          subtitle: `Reason: ${deal.lostReason || "Not specified"}`,
          detail: (deal as any).lostNotes ? (deal as any).lostNotes : null,
          metaItems: lostMeta.length > 0 ? lostMeta : undefined,
          stageBadge: { label: "Lost", className: STAGE_BADGE_COLORS["Lost"] || "bg-red-100 text-red-700" },
          dotColor: "bg-red-500",
          sortTime: new Date(deal.completedAt).getTime(),
        });
      }

      const filtered = events
        .filter(matchesSearch)
        .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0));

      const dateGroupMap = new Map<string, { dayKey: string; dayFormatted: string; events: TimelineEvent[] }>();
      for (const ev of filtered) {
        if (!dateGroupMap.has(ev.dayKey)) {
          dateGroupMap.set(ev.dayKey, {
            dayKey: ev.dayKey,
            dayFormatted: ev.dayFormatted,
            events: [],
          });
        }
        dateGroupMap.get(ev.dayKey)!.events.push(ev);
      }
      const dateGroups = Array.from(dateGroupMap.values());

      groups.push({
        deal,
        num: dealNumbers.get(deal.id) ?? 0,
        events: filtered,
        dateGroups,
        totalEventsCount: filtered.length,
        lastActivity: filtered.length > 0 ? filtered[filtered.length - 1].date : null,
      });
    }

    const withEvents = groups.filter((g) => g.events.length > 0);
    withEvents.sort(
      (a, b) => new Date(b.deal?.createdAt || 0).getTime() - new Date(a.deal?.createdAt || 0).getTime()
    );
    return withEvents;
  }, [
    allDeals,
    propDealId,
    activities,
    contactProformas,
    contact,
    actFromDate,
    actToDate,
    timelineSearch,
    showHiddenDeals,
  ]);

  // Expand the active deal or most recent deal on initial load
  useEffect(() => {
    if (!dealsExpandedInitialized && dealTimeline.length > 0) {
      if (propDealId) {
        setExpandedDeals([`deal-${propDealId}`]);
      } else {
        const mostRecent = [...dealTimeline].sort((a, b) => {
          const timeA = a.deal?.createdAt ? new Date(a.deal.createdAt).getTime() : 0;
          const timeB = b.deal?.createdAt ? new Date(b.deal.createdAt).getTime() : 0;
          return timeB - timeA;
        })[0];

        if (mostRecent?.deal?.id) {
          setExpandedDeals([`deal-${mostRecent.deal.id}`]);
        } else if (dealTimeline[0]?.deal?.id) {
          setExpandedDeals([`deal-${dealTimeline[0].deal.id}`]);
        }
      }
      setDealsExpandedInitialized(true);
    }
  }, [dealTimeline, dealsExpandedInitialized, propDealId]);

  const hiddenDealsCount = (allDeals || []).filter((d) => d.isHiddenFromTimeline).length;
  const totalEventsCount = dealTimeline.reduce((n, g) => n + g.events.length, 0);

  const isLoading = (loadingContact || loadingDeals || loadingActivities) && allDeals.length === 0 && activities.length === 0;

  const timelineContent = (
    <div className={`space-y-4 ${className}`}>
      {/* Quick Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {QUICK_BTNS.map((b) => (
            <Button
              key={b.key}
              size="sm"
              variant={actQuick === b.key ? "default" : "outline"}
              className="text-xs h-7 px-2.5"
              onClick={() => applyQuick(b.key)}
            >
              {b.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Input
              type="date"
              value={actFromDate}
              onChange={(e) => {
                setActFromDate(e.target.value);
                setActQuick("");
              }}
              className="h-7 w-28 text-xs p-1"
            />
            <span>to</span>
            <Input
              type="date"
              value={actToDate}
              onChange={(e) => {
                setActToDate(e.target.value);
                setActQuick("");
              }}
              className="h-7 w-28 text-xs p-1"
            />
          </div>

          <div className="relative min-w-[140px] flex-1 sm:w-44">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search timeline..."
              value={timelineSearch}
              onChange={(e) => setTimelineSearch(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Accordion Deal Groups */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : dealTimeline.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6 border rounded-lg bg-card">
          {(actQuick !== "all" || timelineSearch) && !(allDeals || []).some((d) => d.isHiddenFromTimeline)
            ? "No events match your filters."
            : showHiddenDeals && hiddenDealsCount === (allDeals || []).length && hiddenDealsCount > 0
            ? "All deals are hidden from this timeline."
            : propDealId
            ? "No activities or milestones recorded for this deal yet."
            : "No deals yet. Create a deal to see its timeline."}
        </p>
      ) : (
        <Accordion type="multiple" value={expandedDeals} onValueChange={setExpandedDeals} className="space-y-3">
          {dealTimeline.map((group) => {
            const accordionVal = `deal-${group.deal?.id}`;
            const formatDateStr = (d: string) => {
              try {
                const dt = new Date(d);
                return isNaN(dt.getTime())
                  ? d
                  : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
              } catch {
                return d;
              }
            };

            const dealActs = (activities || [])
              .filter((a) => Number(a.dealId) === Number(group.deal?.id))
              .sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id
              );
            const latestDealActivity = dealActs[0] || null;
            const scheduledActivity =
              latestDealActivity && (latestDealActivity.callStatus || "Pending") === "Pending"
                ? latestDealActivity
                : dealActs.find((a) => (a.callStatus || "Pending") === "Pending") || null;
            const isScheduled = !!scheduledActivity;

            return (
              <AccordionItem
                key={accordionVal}
                value={accordionVal}
                className="border border-border/80 rounded-xl overflow-hidden relative group/deal bg-card shadow-xs"
              >
                {/* Actions on this deal card */}
                <div className="absolute right-3 top-2.5 z-10 flex items-center gap-1.5">
                  {group.deal &&
                    (isScheduled ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-6 text-[11px] px-2 py-0 bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1 shadow-xs border-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCallConfirmActivity({ activity: scheduledActivity, dealId: group.deal!.id });
                        }}
                        title="Call action for scheduled call"
                      >
                        <Phone className="h-3 w-3" /> Call
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2 py-0 border-border/80 hover:bg-muted/80 text-foreground font-medium flex items-center gap-1 shadow-2xs"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActDealId(String(group.deal!.id));
                          setCompletingActivity(null);
                          setActivityModalOpen(true);
                        }}
                        title="Add Activity for this deal"
                      >
                        <Plus className="h-3 w-3" /> Activity
                      </Button>
                    ))}
                  {group.deal &&
                    group.deal.stage !== "Won" &&
                    group.deal.stage !== "Lost" &&
                    !hideDealsManagement && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteDealId(group.deal!.id);
                          setDeleteDealTitle(group.deal!.title || `Deal ${group.num}`);
                          setDeleteDealOpen(true);
                        }}
                        className="h-6 w-6 rounded bg-background/90 border flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 opacity-0 group-hover/deal:opacity-100 focus:opacity-100 transition-opacity"
                        title="Delete deal"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  {!hideDealsManagement && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        group.deal &&
                          setDealTimelineVisibility.mutate({
                            dealId: group.deal.id,
                            hidden: !group.deal.isHiddenFromTimeline,
                          });
                      }}
                      disabled={setDealTimelineVisibility.isPending}
                      className="h-6 w-6 rounded bg-background/90 border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 opacity-0 group-hover/deal:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-40"
                      title={group.deal?.isHiddenFromTimeline ? "Show this deal in timeline" : "Hide this deal from timeline"}
                    >
                      {group.deal?.isHiddenFromTimeline ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>

                <AccordionTrigger className="px-4 py-3 pr-32 sm:pr-40 hover:no-underline hover:bg-muted/40 [&[data-state=open]]:bg-muted/20 relative z-10">
                  <div className="flex-1 flex items-center justify-between mr-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                        <FolderTree className="h-4 w-4" />
                      </div>
                      {group.deal && (
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-foreground truncate block">
                              Deal {group.num} {group.deal.title ? `(${group.deal.title})` : ""}
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                                STAGE_BADGE_COLORS[group.deal.stage] || "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {group.deal.stage}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>Created: {formatDateStr(group.deal.createdAt)}</span>
                            </span>
                            {group.deal.totalValue && (
                              <span className="font-semibold text-foreground">
                                💰 {formatCurrency(group.deal.totalValue)}
                              </span>
                            )}
                            {contact?.salesOwner?.name && (
                              <span className="flex items-center gap-1">
                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>{contact.salesOwner.name}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      {group.lastActivity && (
                        <span className="hidden md:inline">Last: {formatDateStr(group.lastActivity)}</span>
                      )}
                      <Badge variant="outline" className="text-[11px] font-medium bg-background">
                        {group.totalEventsCount} events
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-3 sm:px-6 pb-4 pt-1 overflow-hidden">
                  <div className="space-y-4">
                    {group.dateGroups.map((dGroup) => (
                      <div key={dGroup.dayKey} className="relative">
                        {/* Date Header Chip */}
                        <div className="flex items-center gap-3 my-4 first:mt-1 px-1 sm:px-2">
                          <div className="flex-1 h-px bg-border/60" />
                          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/80 border border-border/80 text-xs font-semibold text-muted-foreground shadow-xs">
                            <Calendar className="h-3.5 w-3.5 text-primary" />
                            <span>{dGroup.dayFormatted}</span>
                          </div>
                          <div className="flex-1 h-px bg-border/60" />
                        </div>

                        {/* Timeline Events for this Date */}
                        <div className="relative space-y-3.5 pb-2">
                          {/* Vertical Timeline Line */}
                          <div className="absolute left-[18px] sm:left-[83px] -translate-x-1/2 top-4 bottom-4 w-0.5 bg-border/80 z-0" />

                          {dGroup.events.map((ev) => {
                            const EventIcon =
                              ev.channel === "call"
                                ? Phone
                                : ev.channel === "whatsapp"
                                ? MessageSquare
                                : ev.channel === "meeting"
                                ? Users
                                : ev.kind === "lead"
                                ? User
                                : ev.kind === "deal"
                                ? FolderTree
                                : ev.kind === "pi"
                                ? FileText
                                : ev.kind === "won"
                                ? CheckCircle
                                : ev.kind === "lost"
                                ? XCircle
                                : Calendar;

                            return (
                              <div key={ev.key} className="relative flex items-start gap-3 group/event">
                                {/* Desktop Time */}
                                <div className="hidden sm:block w-16 text-right pt-3.5 shrink-0">
                                  <span className="text-xs font-semibold text-muted-foreground">{ev.timeStr}</span>
                                </div>

                                {/* Connected Dot on vertical line */}
                                <div className="absolute sm:relative left-[18px] sm:left-auto top-4 sm:top-3.5 -translate-x-1/2 sm:translate-x-0 shrink-0 z-10">
                                  <span className={`block w-3.5 h-3.5 rounded-full ring-4 ring-card ${ev.dotColor}`} />
                                </div>

                                {/* Event Content Card */}
                                <div className="flex-1 min-w-0 ml-8 sm:ml-0 bg-card hover:bg-muted/20 border border-border/80 rounded-xl p-3.5 shadow-xs transition-colors">
                                  {/* Mobile Time */}
                                  <div className="sm:hidden text-[10px] font-semibold text-muted-foreground mb-1">
                                    {ev.timeStr}
                                  </div>

                                  {/* Header row */}
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex items-start gap-2.5">
                                      <div
                                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                                          ev.kind === "lead"
                                            ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                                            : ev.kind === "deal"
                                            ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                                            : ev.kind === "pi"
                                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                                            : ev.kind === "won"
                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                            : ev.kind === "lost"
                                            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                            : ev.noteVariant === "violet"
                                            ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                                            : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                        }`}
                                      >
                                        <EventIcon className="h-3.5 w-3.5" />
                                      </div>
                                      <div className="min-w-0">
                                        <span className="text-sm font-bold text-foreground block">{ev.title}</span>
                                        {ev.subtitle && (
                                          <p className="text-xs text-muted-foreground truncate">{ev.subtitle}</p>
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {ev.stageBadge && (
                                        <span
                                          onClick={(e) => {
                                            if (ev.activityId && ev.stageBadge?.label === "Pending") {
                                              e.stopPropagation();
                                              const act = (activities || []).find((a) => a.id === ev.activityId);
                                              if (act) {
                                                setCompletingActivity(act);
                                                setActDealId(
                                                  act.dealId ? String(act.dealId) : group.deal?.id ? String(group.deal.id) : ""
                                                );
                                                setActivityModalOpen(true);
                                              }
                                            }
                                          }}
                                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                                            ev.stageBadge.label === "Pending"
                                              ? "cursor-pointer hover:ring-2 hover:ring-amber-400 "
                                              : ""
                                          }${ev.stageBadge.className || "bg-muted text-muted-foreground border-border"}`}
                                          title={
                                            ev.stageBadge.label === "Pending"
                                              ? "Click to log activity outcome"
                                              : undefined
                                          }
                                        >
                                          {ev.stageBadge.label}
                                        </span>
                                      )}
                                      {ev.stageBadge?.label === "Pending" && ev.activityId && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 text-[11px] px-2 py-0 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/60"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const act = (activities || []).find((a) => a.id === ev.activityId);
                                            if (act) {
                                              setCompletingActivity(act);
                                              setActDealId(
                                                act.dealId ? String(act.dealId) : group.deal?.id ? String(group.deal.id) : ""
                                              );
                                              setActivityModalOpen(true);
                                            }
                                          }}
                                        >
                                          Log Activity
                                        </Button>
                                      )}
                                      {ev.activityId && (
                                        <button
                                          type="button"
                                          onClick={() => setDeleteActId(ev.activityId!)}
                                          className="h-6 w-6 rounded hover:bg-red-50 dark:hover:bg-red-950/50 flex items-center justify-center text-muted-foreground hover:text-red-600 opacity-0 group-hover/event:opacity-100 transition-opacity ml-1"
                                          title="Delete activity"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Meta tags */}
                                  {ev.metaItems && ev.metaItems.length > 0 && (
                                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                      {ev.metaItems.map((meta, mi) => (
                                        <div
                                          key={mi}
                                          className={`px-2.5 py-0.5 rounded-md border text-xs font-medium flex items-center gap-1.5 ${
                                            meta.isHighlight
                                              ? "bg-amber-500/15 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200"
                                              : "bg-muted/60 border-border/80 text-muted-foreground"
                                          }`}
                                        >
                                          {meta.label === "Next Follow-up" && (
                                            <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                          )}
                                          {meta.label === "Logged By" && (
                                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                                          )}
                                          {meta.label === "Owner" && (
                                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                                          )}
                                          {meta.label === "Mobile" && (
                                            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                          )}
                                          <span className="text-foreground/70">{meta.label}:</span>
                                          <span className="font-semibold text-foreground">{meta.value}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Structured Notes */}
                                  {ev.notesList && ev.notesList.length > 0 && (
                                    <div className="mt-2.5 space-y-1.5">
                                      {ev.notesList.map((n, ni) => {
                                        const isPendingAct = ev.stageBadge?.label === "Pending";
                                        const isOriginalFollowUp =
                                          !isPendingAct && ev.notesList!.length > 1 && ni === 0;
                                        const isViolet = !isPendingAct && !isOriginalFollowUp;
                                        const noteTime =
                                          isPendingAct && ev.createdAt
                                            ? formatTime(ev.createdAt)
                                            : formatTimeString(n.time) ||
                                              (ev.createdAt ? formatTime(ev.createdAt) : "");
                                        const noteDate = n.date || (ev.createdAt ? formatDay(ev.createdAt) : "");
                                        return (
                                          <div
                                            key={ni}
                                            className={`rounded-lg border p-2.5 text-xs text-foreground ${
                                              isViolet
                                                ? "bg-purple-500/10 border-purple-200/80 dark:border-purple-900/60"
                                                : "bg-amber-500/10 border-amber-200/80 dark:border-amber-900/60"
                                            }`}
                                          >
                                            <div
                                              className={`flex items-center justify-between text-[11px] font-semibold mb-1 ${
                                                isViolet
                                                  ? "text-purple-900 dark:text-purple-300"
                                                  : "text-amber-900 dark:text-amber-300"
                                              }`}
                                            >
                                              <div className="flex items-center gap-1.5">
                                                <StickyNote
                                                  className={`h-3.5 w-3.5 shrink-0 ${
                                                    isViolet
                                                      ? "text-purple-600 dark:text-purple-400"
                                                      : "text-amber-600 dark:text-amber-400"
                                                  }`}
                                                />
                                                <span>
                                                  {isViolet
                                                    ? n.userName
                                                      ? `Discussion Note by ${n.userName}`
                                                      : "Discussion Note"
                                                    : n.userName
                                                    ? `Next Follow-up Note by ${n.userName}`
                                                    : "Follow-up Note"}
                                                </span>
                                              </div>
                                              {(noteDate || noteTime) && (
                                                <span className="text-muted-foreground font-normal text-[10px]">
                                                  {noteDate}
                                                  {noteDate && noteTime ? " " : ""}
                                                  {noteTime}
                                                </span>
                                              )}
                                            </div>
                                            <p className="whitespace-pre-wrap font-normal leading-relaxed text-foreground/90 pl-5">
                                              {n.text}
                                            </p>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Detail text */}
                                  {ev.detail && (
                                    <div className="mt-2.5 text-xs text-muted-foreground whitespace-pre-wrap bg-muted/40 border border-border/60 rounded-md p-2 flex items-start gap-2">
                                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                      <span className="flex-1">{ev.detail}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {hiddenDealsCount > 0 && !hideDealsManagement && (
        <button
          onClick={() => setShowHiddenDeals((v) => !v)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-dashed rounded-lg hover:bg-muted/30 transition-colors"
          title={showHiddenDeals ? "Hide the hidden deal cards again" : "Reveal deals hidden from this timeline"}
        >
          <EyeOff className="h-3 w-3" />
          {showHiddenDeals
            ? `Hide ${hiddenDealsCount} hidden deal${hiddenDealsCount === 1 ? "" : "s"} again`
            : `${hiddenDealsCount} hidden deal${hiddenDealsCount === 1 ? "" : "s"} — show`}
        </button>
      )}

      {/* Activity Detail Drawer Modal */}
      <ActivityDetailDrawer
        open={activityModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setActivityModalOpen(false);
            setCompletingActivity(null);
            setActDealId("");
          }
        }}
        contactId={effectiveContactId || 0}
        dealId={completingActivity?.dealId || (actDealId ? Number(actDealId) : propDealId || null)}
        contactName={contact?.name ?? undefined}
        contactCompany={contact?.companyName ?? undefined}
        contactMobile={contact?.mobile ?? undefined}
        activity={
          completingActivity
            ? {
                id: completingActivity.id,
                type: completingActivity.type,
                notesDisplay: completingActivity.notesDisplay,
                notes: completingActivity.notes,
                callStatus: completingActivity.callStatus,
                followUpType: completingActivity.followUpType,
              }
            : null
        }
        defaultScheduleNext={!!completingActivity}
        onSuccess={() => {
          onActivityChange(
            queryClient,
            Number(actDealId) || propDealId || undefined,
            effectiveContactId || undefined
          );
          if (effectiveContactId) onContactChange(queryClient, effectiveContactId);
          onDealChange(
            queryClient,
            Number(actDealId) || propDealId || undefined,
            effectiveContactId || undefined
          );
          onActivityChanged?.();
        }}
      />

      {/* Call Action Confirmation Dialog */}
      <AlertDialog
        open={callConfirmActivity !== null}
        onOpenChange={(open) => {
          if (!open) setCallConfirmActivity(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Call Action</AlertDialogTitle>
            <AlertDialogDescription>Do you want to schedule the next follow-up call?</AlertDialogDescription>
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

      {/* Delete Activity Confirmation Dialog */}
      <AlertDialog
        open={deleteActId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteActId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Activity</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this activity? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!deleteActId) return;
                const res = await fetch(`/api/activities/${deleteActId}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
                });
                if (res.ok) {
                  onActivityChange(queryClient, propDealId || undefined, effectiveContactId || undefined);
                  toast({ title: "Activity deleted" });
                  onActivityChanged?.();
                } else {
                  toast({ title: "Failed to delete activity", variant: "destructive" });
                }
                setDeleteActId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Deal Confirmation Dialog */}
      <AlertDialog
        open={deleteDealOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteDealOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteDealTitle}&rdquo;? All activities and items associated with
              this deal will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDealMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteDealMutation.isPending}
              onClick={() => {
                if (deleteDealId) deleteDealMutation.mutate(deleteDealId);
              }}
            >
              {deleteDealMutation.isPending ? "Deleting..." : "Delete Deal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (!showHeader) {
    return timelineContent;
  }

  return (
    <Card id="activity-timeline-section">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-primary" />
              <span>Activity Timeline</span>
            </CardTitle>
            <Badge variant="outline" className="text-[10px] font-normal ml-1">
              {totalEventsCount}
            </Badge>
          </div>
          {effectiveContactId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setActDealId(propDealId ? String(propDealId) : allDeals[0]?.id ? String(allDeals[0].id) : "");
                setCompletingActivity(null);
                setActivityModalOpen(true);
              }}
              className="h-8 text-xs flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Activity
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>{timelineContent}</CardContent>
    </Card>
  );
}

export default SharedActivityTimeline;
