import { useState, useMemo, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetContact, useListDeals, useListActivities, useCreateDeal,
  useUpdateContact, useDeleteContact, useListUsers, useListContactProformaInvoices, getListContactProformaInvoicesQueryKey,
  getGetContactQueryKey, useUpdateDeal
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Phone, Plus, Trash2, FolderTree, MessageSquare, Pencil, Calendar, ChevronRight, Bell, Paperclip, Copy, ExternalLink, CheckCircle, XCircle, RotateCcw, User, Building, ListOrdered, FileText, Search, Tag } from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { CategoryBadge } from "@/components/category-badge";
import { CATEGORY_COLORS } from "@/lib/categories";
import { MoveCategoryDialog } from "@/components/move-category-dialog";
import { DocumentManager } from "@/components/document-manager";
import { DocumentUploadDialog } from "@/components/document-upload-dialog";
import ActivityDetailDrawer from "@/components/activity-detail-drawer";
import { PiSentDialog } from "@/components/pi-sent-dialog";
import { STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { INDUSTRIES } from "@/lib/constants";
import { useActiveUnits } from "@/lib/use-active-units";
import { onContactChange, onDealChange, onActivityChange } from "@/lib/query-invalidation";
import { parseNotesText, parseNotesDisplay, dedupeById } from "@/lib/parse-notes";

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return localDateStr(new Date()); }
function daysAgoStr(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }
function monthStartStr() { const d = new Date(); d.setDate(1); return localDateStr(d); }

const QUICK_BTNS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 Days" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All" },
];

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const contactId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: contact, isLoading } = useGetContact(contactId, { query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId) } });
  const { data: deals } = useListDeals({ contactId: contactId });
  const { data: activities } = useListActivities({ contactId: contactId });
  const { data: users } = useListUsers();
  const { units: activeUnits } = useActiveUnits();
  const { data: contactProformas } = useListContactProformaInvoices(contactId, { query: { enabled: !!contactId, queryKey: getListContactProformaInvoicesQueryKey(contactId) } });

  // Mark the lead as read when viewed so the unread dot clears on the Leads table.
  // No optimistic cache update — role-based read state (isReadByAdmin vs
  // isReadByAssignee) means setting isRead=true client-side is incorrect.
  // The query refetches when the user navigates back to /leads.
  useEffect(() => {
    if (!contact || contact.isRead) return;
    fetch(`/api/contacts/${contact.id}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["unread-lead-count"] });
    }).catch(() => {});
  }, [contact?.id]);

  const createDeal = useCreateDeal();
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();
  const updateDeal = useUpdateDeal();

  const [newDealStage, setNewDealStage] = useState("New");
  const [newDealTitle, setNewDealTitle] = useState("");
  const [newDealProductionUnit, setNewDealProductionUnit] = useState("");
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const openDealDialog = () => {
    setNewDealProductionUnit(contact?.unit || "");
    setDealDialogOpen(true);
  };
  const [piSentDialogOpen, setPiSentDialogOpen] = useState(false);
  const [piSentDealId, setPiSentDealId] = useState<number | null>(null);

  const [editTitleDealId, setEditTitleDealId] = useState<number | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [editTitleOpen, setEditTitleOpen] = useState(false);

  const [actDealId, setActDealId] = useState("");
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [completingActivity, setCompletingActivity] = useState<any>(null);

  const [expandedDeals, setExpandedDeals] = useState<string[]>([]);
  const [timelineSearch, setTimelineSearch] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteActId, setDeleteActId] = useState<number | null>(null);
  const [showMoveCategory, setShowMoveCategory] = useState(false);
  const [uploadDocOpen, setUploadDocOpen] = useState(false);

  // Customer Comments
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [editComment, setEditComment] = useState("");
  const [showFullComment, setShowFullComment] = useState(false);

  const { data: commentHistory } = useQuery({
    queryKey: ["comment-history", contactId],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/comments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: number; comment: string; updatedBy: number; updatedAt: string; updatedByName: string }>>;
    },
    enabled: !!contactId,
    staleTime: 10_000,
  });

  // Category History
  const { data: categoryHistory } = useQuery({
    queryKey: ["category-history", contactId],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/category-history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: number; previousCategory: string | null; newCategory: string; changedBy: number; changedByName: string; reason: string | null; createdAt: string }>>;
    },
    enabled: !!contactId,
    staleTime: 10_000,
  });

  // Timeline
  const { data: timeline } = useQuery({
    queryKey: ["timeline", contactId],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/timeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ type: string; description: string; notes?: string; followUpDate?: string; callStatus?: string; dealStage?: string; dealValue?: number; user?: { id?: number; name: string } | null; isEdited?: boolean; createdAt: string; updatedAt?: string }>>;
    },
    enabled: !!contactId,
    staleTime: 10_000,
  });

  // Notifications
  const { data: notifications } = useQuery({
    queryKey: ["contact-notifications", contactId],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: number; type: string; title: string; message: string; readAt: string | null; createdAt: string }>>;
    },
    enabled: !!contactId,
    staleTime: 30_000,
  });

  // Upcoming Follow-up
  const { data: upcomingFollowUp } = useQuery({
    queryKey: ["upcoming-followup", contactId],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/activities?contactId=${contactId}&upcoming=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const pending = data?.filter?.((a: any) => a.type === "FollowUp" && a.callStatus === "Pending");
      return pending?.length > 0 ? pending[0] : null;
    },
    enabled: !!contactId,
    staleTime: 10_000,
  });

  // Edit contact inline dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editField, setEditField] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editReason, setEditReason] = useState("");

  // Mark Lost dialog
  const [lostOpen, setLostOpen] = useState(false);
  const [lostSubmitting, setLostSubmitting] = useState(false);

  // Activity modal

  // Activity date filter
  const [actQuick, setActQuick] = useState("all");
  const [actFromDate, setActFromDate] = useState("");
  const [actToDate, setActToDate] = useState("");

  const applyQuick = (key: string) => {
    setActQuick(key);
    if (key === "today")     { setActFromDate(todayStr()); setActToDate(todayStr()); }
    else if (key === "yesterday") { setActFromDate(daysAgoStr(1)); setActToDate(daysAgoStr(1)); }
    else if (key === "week") { setActFromDate(daysAgoStr(6)); setActToDate(todayStr()); }
    else if (key === "month"){ setActFromDate(monthStartStr()); setActToDate(todayStr()); }
    else { setActFromDate(""); setActToDate(""); }
  };

  const parseNote = (notes: string | null | undefined): string | null => parseNotesText(notes);

  // Deal-centric timeline: flat chronological list per deal (no General group, no nested drawers)
  const dealTimeline = useMemo(() => {
    type FlatEvent = {
      key: string; date: string; kind: "lead" | "deal" | "followup" | "pi" | "won" | "lost";
      label: string; detail?: string | null; meta?: string | null; activityId?: number; dateInLabel?: boolean;
    };
    const formatDay = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const dateOk = (d: string) => {
      const day = d.slice(0, 10);
      if (actFromDate && day < actFromDate) return false;
      if (actToDate && day > actToDate) return false;
      return true;
    };
    const searchLower = timelineSearch.toLowerCase();
    const matchesSearch = (e: FlatEvent) =>
      !timelineSearch ||
      e.label.toLowerCase().includes(searchLower) ||
      (e.detail || "").toLowerCase().includes(searchLower) ||
      (e.meta || "").toLowerCase().includes(searchLower);

    const groups: Array<{ deal: (typeof deals extends (infer D)[] | undefined ? D : never) | null; events: FlatEvent[]; lastActivity: string | null }> = [];

    const existing = [...(deals || [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Always open with a lead-created marker so the lead's origin is visible
    const leadDate = contact?.createdAt;

    for (const deal of existing) {
      const events: FlatEvent[] = [];

      if (leadDate && dateOk(leadDate)) {
        events.push({
          key: `lead-${deal.id}`, date: leadDate, kind: "lead",
          label: `Lead created on ${formatDay(leadDate)}`,
          dateInLabel: true,
        });
      }

      const dealCreated = deal.createdAt;
      if (dateOk(dealCreated)) {
        events.push({
          key: `deal-created-${deal.id}`, date: dealCreated, kind: "deal",
          label: `Deal created: ${deal.title || "Untitled Deal"} on ${formatDay(dealCreated)}`,
          dateInLabel: true,
        });
      }

      // Only human-input follow-up activities (Call/Meeting/FollowUp) with the
      // user's actual comment/notes. System audit logs (Note rows auto-generated
      // for "changed Follow-up Date/Status", "PI Sent", "Deal Stage Changed", etc.)
      // are hidden entirely so the timeline stays a clean story.
      const dealActs = dedupeById(activities || [])
        .filter(a => a.dealId === deal.id && (a.type === "Call" || a.type === "Meeting" || a.type === "FollowUp"))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      let followUpNum = 0;
      for (const act of dealActs) {
        if (!dateOk(act.createdAt)) continue;
        followUpNum++;
        events.push({
          key: `act-${act.id}`, date: act.createdAt, kind: "followup",
          label: `Follow-up ${followUpNum}`,
          detail: parseNote(act.notes) || parseNote((act as any).notesDisplay) || null,
          meta: act.callStatus || null,
          activityId: act.id,
        });
      }

      // Proforma invoices for this deal
      for (const pi of (contactProformas || [])) {
        const piDealId = (pi as any).dealId;
        if (piDealId !== deal.id || !dateOk(pi.createdAt || "")) continue;
        events.push({
          key: `pi-${pi.id}`, date: pi.createdAt || dealCreated, kind: "pi",
          label: "Proforma Invoice sent",
          detail: pi.invoiceNumber || null,
          meta: pi.status || null,
        });
      }

      // Won / Lost terminal events
      if (deal.stage === "Won" && deal.completedAt) {
        events.push({
          key: `won-${deal.id}`, date: deal.completedAt, kind: "won",
          label: "Deal Won",
          meta: deal.totalValue ? `₹${Number(deal.totalValue).toLocaleString()}` : null,
        });
      } else if (deal.stage === "Lost" && deal.completedAt) {
        events.push({
          key: `lost-${deal.id}`, date: deal.completedAt, kind: "lost",
          label: "Deal Lost",
          meta: deal.lostReason || null,
        });
      }

      const filtered = events
        .filter(matchesSearch)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      groups.push({
        deal,
        events: filtered,
        lastActivity: filtered.length > 0 ? filtered[filtered.length - 1].date : null,
      });
    }

    // Sort deal groups newest-first by their most recent event; groups with no events drop out
    const withEvents = groups.filter(g => g.events.length > 0);
    withEvents.sort((a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
    return withEvents;
  }, [contact, deals, activities, contactProformas, actFromDate, actToDate, timelineSearch]);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!contact) return <div className="p-8">Contact not found.</div>;

  const owner = contact.salesOwner;
  const deal = deals && deals.length > 0 ? deals[0] : null;
  const commentsText = parseNotesText(contact.customerComments) || "";

  const handleDeleteActivity = () => {
    if (!deleteActId) return;
    const token = localStorage.getItem("crm_token");
    fetch(`/api/activities/${deleteActId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to delete activity", variant: "destructive" });
        return;
      }
      onActivityChange(queryClient, undefined, contactId);
      toast({ title: "Activity deleted" });
      setDeleteActId(null);
    }).catch(() => {
      toast({ title: "Failed to delete activity", variant: "destructive" });
    });
  };

  const handleCreateDeal = () => {
    if (!newDealStage) return;
    createDeal.mutate({ data: { contactId, stage: newDealStage as any, title: newDealTitle || null, salesOwnerId: contact.salesOwnerId, productionUnit: newDealProductionUnit || null } }, {
      onSuccess: () => {
        onDealChange(queryClient, undefined, contactId);
        setDealDialogOpen(false); setNewDealTitle(""); setNewDealProductionUnit("");
        toast({ title: "Deal created" });
      },
      onError: () => toast({ title: "Error creating deal", variant: "destructive" }),
    });
  };

  const handleSaveDealTitle = () => {
    if (!editTitleDealId) return;
    updateDeal.mutate(
      { id: editTitleDealId, data: { title: editTitleValue || null } },
      {
        onSuccess: () => {
          onDealChange(queryClient, editTitleDealId, contactId);
          setEditTitleOpen(false);
          setEditTitleDealId(null);
          setEditTitleValue("");
          toast({ title: "Deal title updated" });
        },
        onError: () => toast({ title: "Error updating deal title", variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    deleteContact.mutate({ id: contactId }, {
      onSuccess: () => {
        onContactChange(queryClient, contactId);
        toast({ title: `"${contact.name}" deleted` });
        setLocation("/leads");
      },
      onError: () => toast({ title: "Failed to delete lead", variant: "destructive" }),
    });
  };

  const handleInlineEdit = (field: string, value: string) => {
    const payload: any = { [field]: value || null };
    if (field === "unit" && editReason.trim()) {
      payload.unitChangeReason = editReason.trim();
    }
    updateContact.mutate({ id: contactId, data: payload }, {
      onSuccess: () => {
        onContactChange(queryClient, contactId);
        toast({ title: `${field} updated` });
        setEditDialogOpen(false);
        setEditReason("");
      },
      onError: () => toast({ title: "Error updating", variant: "destructive" }),
    });
  };

  const handleMarkLost = (data: { lostReason: string; otherReason: string; lostNotes: string; lostCategory?: string }) => {
    setLostSubmitting(true);
    fetch(`/api/contacts/${contactId}/mark-lost`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      body: JSON.stringify(data),
    }).then(async (res) => {
      setLostSubmitting(false);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to mark as Lost", variant: "destructive" });
        return;
      }
      setLostOpen(false);
      onContactChange(queryClient, contactId);
      onDealChange(queryClient, undefined, contactId);
      toast({ title: "Inquiry marked as Lost" });
    }).catch(() => {
      setLostSubmitting(false);
      toast({ title: "Error", description: "Failed to mark as Lost. Please try again.", variant: "destructive" });
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const infield = (label: string, field: string, value: string | null | undefined, placeholder: string = "") => (
    <div className="flex items-center justify-between group">
      <div>
        <span className="text-xs text-muted-foreground">{label}: </span>
        <span>{value || "-"}</span>
      </div>
      <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => { setEditField(field); setEditValue(value || ""); setEditDialogOpen(true); }} title={`Edit ${label}`}>
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* ===== SUMMARY CARD ===== */}
      <Card className="sticky top-0 z-10 shadow-sm border-b">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Button variant="ghost" size="sm" className="shrink-0 -ml-2" onClick={() => { if (window.history.length > 1) window.history.back(); else setLocation("/leads"); }}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {owner && (
                  <div className="flex items-center gap-2" title={owner.name}>
                    <UserAvatar profilePhoto={owner.profilePhoto} name={owner.name} className="w-6 h-6 shrink-0" />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{owner.name}</span>
                  </div>
                )}
                <h1 className="text-xl font-bold truncate">{contact.name}</h1>
                {(contact as any).customerCode && <Badge variant="secondary" className="text-[11px] font-mono">{(contact as any).customerCode}</Badge>}
                <CategoryBadge category={(contact as any).category} />
                {(contact as any).customerSince && (contact as any).category !== "My Client" && (
                  <Badge
                    className="text-[11px] font-medium border-0"
                    style={{ backgroundColor: `${CATEGORY_COLORS["My Client"]}20`, color: CATEGORY_COLORS["My Client"] }}
                    title={`Customer since ${(contact as any).customerSince}`}
                  >
                    My Client
                  </Badge>
                )}
                {contact.tags && <Badge variant="outline" className="text-[10px]">{contact.tags}</Badge>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                {contact.companyName && <span className="flex items-center gap-1"><Building className="h-3 w-3" />{contact.companyName}</span>}
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{contact.mobile}</span>
                {deal && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STAGE_BADGE_COLORS[deal.stage] || "bg-gray-100"}`}>{deal.stage}</span>}
                {upcomingFollowUp && <span className="flex items-center gap-1 text-primary"><Calendar className="h-3 w-3" />{upcomingFollowUp.followUpDate}</span>}
                {(contact as any).customerSince && <span>Customer since {(contact as any).customerSince}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              {contact.category !== "My Client" && !contact.isMyClient && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowMoveCategory(true)}><FolderTree className="h-3 w-3 mr-1" /> Move</Button>}
              <Link href={`/leads/${contactId}/edit`}><Button size="sm" variant="outline" className="h-7 text-xs">Edit</Button></Link>
              <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setDeleteOpen(true)}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ========== LEFT SIDEBAR ========== */}
        <div className="lg:col-span-1 space-y-4">
          {/* Section 1: Customer Information */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {infield("Name", "name", contact.name)}
              {infield("Company", "companyName", contact.companyName)}
              {infield("Mobile", "mobile", contact.mobile)}
              {contact.otherPhone && infield("Alt Phone", "otherPhone", contact.otherPhone)}
              {infield("Email", "email", contact.email)}
              {contact.otherEmail && infield("Alt Email", "otherEmail", contact.otherEmail)}
              {infield("Address", "address", contact.address)}
              {infield("City", "city", contact.city)}
              {infield("State", "state", (contact as any).state)}
              {infield("Lead Source", "leadSource", contact.leadSource)}
              {infield("Industry", "industry", contact.industry)}
              {infield("Unit", "unit", contact.unit || PENDING_UNIT_ASSIGNMENT)}
              {infield("Inquiry Date", "inquiryDate", contact.inquiryDate)}
              {infield("Customer Since", "customerSince", (contact as any).customerSince)}
              {infield("Customer Status", "customerStatus", (contact as any).customerStatus)}
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Created: {new Date(contact.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  {contact.commentUpdatedAt && <span>Updated: {new Date(contact.commentUpdatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Customer Comments */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Customer Comments
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditComment(commentsText); setCommentDialogOpen(true); }} title="Edit Comments">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {commentsText ? (
                <div>
                  <p className="whitespace-pre-wrap text-sm">
                    {showFullComment || commentsText.length <= 100
                      ? commentsText
                      : `${commentsText.slice(0, 100)}...`}
                  </p>
                  {commentsText.length > 100 && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs mt-1" onClick={() => setShowFullComment(!showFullComment)}>
                      {showFullComment ? "View Less" : "View More"}
                    </Button>
                  )}
                  {contact.commentUpdatedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Last updated: {new Date(contact.commentUpdatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {(contact as any).commentUpdatedByUser?.name ? ` by ${(contact as any).commentUpdatedByUser.name}` : ""}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">No customer comments recorded.</p>
              )}
            </CardContent>
          </Card>

          {/* Section 3: Next Follow-up */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Next Follow-up
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingFollowUp ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-medium">{upcomingFollowUp.followUpDate}</span>
                    {upcomingFollowUp.followUpTime && <span className="text-muted-foreground">at {upcomingFollowUp.followUpTime}</span>}
                  </div>
                  {(() => {
                    const today2 = new Date();
                    const todayStr = `${today2.getFullYear()}-${String(today2.getMonth() + 1).padStart(2, "0")}-${String(today2.getDate()).padStart(2, "0")}`;
                    const isOverdue = upcomingFollowUp.followUpDate < todayStr;
                    const isToday = upcomingFollowUp.followUpDate === todayStr;
                    const statusBadge = isOverdue
                      ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200 text-[10px]">Overdue</Badge>
                      : isToday
                      ? <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200 text-[10px]">Today</Badge>
                      : <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 text-[10px]">Upcoming</Badge>;
                    return statusBadge;
                  })()}
                  {upcomingFollowUp.followUpType && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Type:</span>
                      <Badge variant="outline" className="text-[10px]">{upcomingFollowUp.followUpType}</Badge>
                    </div>
                  )}
                  {upcomingFollowUp.priority && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Priority:</span>
                      <Badge variant="outline" className={`text-[10px] ${
                        upcomingFollowUp.priority === "High" ? "text-red-600 border-red-200" :
                        upcomingFollowUp.priority === "Low" ? "text-green-600 border-green-200" :
                        "text-amber-600 border-amber-200"
                      }`}>{upcomingFollowUp.priority}</Badge>
                    </div>
                  )}
                  {upcomingFollowUp.user?.name && (
                    <div className="text-xs text-muted-foreground">
                      Assigned to: <span className="font-medium">{upcomingFollowUp.user.name}</span>
                    </div>
                  )}
                  {upcomingFollowUp.notes && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2.5 rounded-md">{parseNotesDisplay(upcomingFollowUp.notes, upcomingFollowUp.notesDisplay)}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => { setActDealId(deal?.id?.toString() || ""); setCompletingActivity(upcomingFollowUp); setActivityModalOpen(true); }}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Mark as Complete
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setActDealId(deal?.id?.toString() || ""); setCompletingActivity(null); setActivityModalOpen(true); }}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Reschedule
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(`tel:${contact.mobile}`)}>
                      <Phone className="h-3 w-3 mr-1" /> Call
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">No upcoming follow-up scheduled.</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setActDealId(deal?.id?.toString() || ""); setCompletingActivity(null); setActivityModalOpen(true); }}>
                    <Calendar className="h-3 w-3 mr-1" /> Schedule Follow-up
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 5: Deal Information */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Deal Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              {deal ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Stage</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_BADGE_COLORS[deal.stage] || "bg-gray-100"}`}>{deal.stage}</span>
                  </div>
                  {deal.totalValue != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Expected Value</span>
                      <span className="font-medium">â‚¹{Number(deal.totalValue).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Probability</span>
                    <span>{deal.probability}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Created</span>
                    <span className="text-xs">{new Date(deal.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                  {deal.updatedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Updated</span>
                      <span className="text-xs">{new Date(deal.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    </div>
                  )}
                  <Link href={`/leads/${contactId}`}>
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-2">
                      <ExternalLink className="h-3 w-3 mr-1" /> Open Deal
                    </Button>
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">No deal exists for this contact.</p>
                   <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openDealDialog}>
                    <Plus className="h-3 w-3 mr-1" /> Create Deal
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 9: Proforma Invoices */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Proforma Invoices
                </CardTitle>
                <Link href={`/proforma-invoices?contactId=${contactId}`}>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={(e) => {
                    e.preventDefault();
                    setLocation(`/proforma-invoices?contactId=${contactId}`);
                  }}>View All</Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <ProformaInvoiceList contactId={contactId} />
            </CardContent>
          </Card>

          {/* Section 10: Documents */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> Documents
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <DocumentManager contactId={contactId} compact />
            </CardContent>
          </Card>

          {/* Section 11: Quick Actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setCommentDialogOpen(true)}>
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" /> Edit Comments
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => { setActDealId(deal?.id?.toString() || ""); setActivityModalOpen(true); }}>
                  <Calendar className="h-3.5 w-3.5 shrink-0" /> Schedule Follow-up
                </Button>
                {contact.category !== "My Client" && !contact.isMyClient && (
                  <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setShowMoveCategory(true)}>
                    <FolderTree className="h-3.5 w-3.5 shrink-0" /> Move Category
                  </Button>
                )}
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={openDealDialog}>
                  <Plus className="h-3.5 w-3.5 shrink-0" /> Create Deal
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setLocation(`/proforma-invoices?contactId=${contactId}`)}>
                  <FileText className="h-3.5 w-3.5 shrink-0" /> Create Proforma
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setLocation(`/proforma-invoices?contactId=${contactId}&repeat=true`)}>
                  <Copy className="h-3.5 w-3.5 shrink-0" /> Repeat Order
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setUploadDocOpen(true)}>
                  <Paperclip className="h-3.5 w-3.5 shrink-0" /> Upload Document
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => window.open(`tel:${contact.mobile}`)}>
                  <Phone className="h-3.5 w-3.5 shrink-0" /> Call Customer
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => copyToClipboard(contact.mobile)}>
                  <Copy className="h-3.5 w-3.5 shrink-0" /> Copy Mobile
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setLostOpen(true)}>
                  <XCircle className="h-3.5 w-3.5 shrink-0" /> Mark Lost
                </Button>
                <Link href={`/leads/${contactId}/edit`} className="sm:col-span-2">
                  <Button size="sm" variant="default" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3">
                    <Pencil className="h-3.5 w-3.5 shrink-0" /> Edit Lead
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <MarkLostDialog
            open={lostOpen}
            onOpenChange={setLostOpen}
            onSave={handleMarkLost}
            saving={lostSubmitting}
            hideCategory={contact?.category === "My Client"}
          />
          <PiSentDialog
            open={piSentDialogOpen}
            onOpenChange={setPiSentDialogOpen}
            contactId={contactId}
            dealId={piSentDealId || deal?.id}
            mobile={contact?.mobile}
          />
        </div>

        {/* ========== RIGHT CONTENT ========== */}
        <div className="lg:col-span-2 space-y-4">
          {/* ===== GROUPED ACTIVITY TIMELINE ===== */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ListOrdered className="h-3.5 w-3.5" /> Activity Timeline
                  <Badge variant="outline" className="text-[10px] font-normal ml-1">{dealTimeline.reduce((n, g) => n + g.events.length, 0)}</Badge>
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => { setActDealId(deal?.id?.toString() || ""); setActivityModalOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Activity
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filters row */}
              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_BTNS.map(b => (
                  <button key={b.key} className={`date-quick-btn ${actQuick === b.key ? "active" : ""}`} onClick={() => applyQuick(b.key)}>
                    {b.label}
                  </button>
                ))}
                <span className="text-muted-foreground text-xs ml-1">|</span>
                <Input type="date" value={actFromDate} onChange={e => { setActFromDate(e.target.value); setActQuick("custom"); }} className="h-7 w-36 text-xs" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={actToDate} onChange={e => { setActToDate(e.target.value); setActQuick("custom"); }} className="h-7 w-36 text-xs" />
                <div className="relative ml-auto min-w-[160px] max-w-[200px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input placeholder="Search timeline..." value={timelineSearch}
                    onChange={e => setTimelineSearch(e.target.value)} className="h-7 pl-7 text-xs" />
                </div>
              </div>

              {/* Deal-centric Accordion Timeline */}
              {dealTimeline.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 border rounded-lg bg-card">
                  {actQuick !== "all" || timelineSearch ? "No events match your filters." : "No deals yet. Create a deal to see its timeline."}
                </p>
              ) : (
                <Accordion type="multiple" value={expandedDeals} onValueChange={setExpandedDeals} className="space-y-2">
                  {dealTimeline.map((group, gi) => {
                    const accordionVal = `deal-${group.deal?.id}`;
                    const formatDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

                    const KIND_STYLE: Record<string, { dot: string; text: string; badge?: string }> = {
                      lead:     { dot: "bg-blue-500", text: "text-blue-700" },
                      deal:     { dot: "bg-emerald-500", text: "text-emerald-700" },
                      followup: { dot: "bg-orange-500", text: "text-orange-700" },
                      pi:       { dot: "bg-indigo-500", text: "text-indigo-700" },
                      won:      { dot: "bg-green-600", text: "text-green-700" },
                      lost:     { dot: "bg-red-500", text: "text-red-700" },
                    };

                    return (
                      <AccordionItem key={accordionVal} value={accordionVal} className="border rounded-lg overflow-hidden">
                        <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/30 [&[data-state=open]]:bg-muted/20">
                          <div className="flex-1 flex items-center justify-between mr-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <FolderTree className="h-4 w-4 text-amber-600 shrink-0" />
                              {group.deal && (
                                <div className="min-w-0">
                                  <span className="text-sm font-semibold truncate block">Deal {gi + 1} {group.deal.title ? `(${group.deal.title})` : ""}</span>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>{formatDate(group.deal.createdAt)}</span>
                                    {group.deal.totalValue && <span className="font-medium text-foreground">₹{Number(group.deal.totalValue).toLocaleString()}</span>}
                                    <span className={`px-1.5 py-0 rounded-full font-medium ${STAGE_BADGE_COLORS[group.deal.stage] || "bg-gray-100"}`}>{group.deal.stage}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
                              {group.lastActivity && <span>Last: {formatDate(group.lastActivity)}</span>}
                              <Badge variant="outline" className="text-[10px]">{group.events.length} events</Badge>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-3 pb-3 pt-0">
                          <div className="mt-1">
                            {group.events.map((ev) => {
                              const st = KIND_STYLE[ev.kind] || KIND_STYLE.lead;
                              return (
                                <div key={ev.key} className="flex items-start gap-2 py-1.5 group/event">
                                  <div className="flex flex-col items-center pt-1.5">
                                    <span className={`w-2.5 h-2.5 rounded-full ring-2 ring-background ${st.dot}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={`text-[11px] font-medium ${st.text}`}>{ev.label}</span>
                                      {!ev.dateInLabel && <span className="text-[10px] text-muted-foreground">{formatDate(ev.date)}</span>}
                                      {ev.meta && (
                                        <Badge variant="outline" className={`text-[9px] px-1 py-0 ${ev.kind === "followup" && ev.meta === "Completed" ? "border-green-300 text-green-700" : ev.kind === "followup" && ev.meta === "Cancelled" ? "border-red-300 text-red-700" : ev.kind === "followup" ? "border-orange-300 text-orange-700" : "border-gray-300 text-gray-600"}`}>
                                          {ev.meta}
                                        </Badge>
                                      )}
                                    </div>
                                    {ev.detail && <p className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-0.5">{ev.detail}</p>}
                                  </div>
                                  {ev.activityId && (
                                    <button
                                      onClick={() => setDeleteActId(ev.activityId!)}
                                      className="h-5 w-5 rounded hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-600 opacity-0 group-hover/event:opacity-100 transition-opacity shrink-0 mt-1"
                                      title="Delete activity"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </CardContent>
          </Card>

          {/* Section 7: Category History */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Category History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!categoryHistory || categoryHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No category changes recorded.</p>
              ) : (
                <div className="space-y-2">
                  {categoryHistory.map((h) => (
                    <div key={h.id} className="flex items-start gap-2 p-2 border rounded text-sm">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: "#f3e8ff" }}><Tag className="h-3.5 w-3.5" style={{ color: "#a855f7" }} /></div>
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap text-xs">
                          <CategoryBadge category={h.previousCategory || undefined} />
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          <CategoryBadge category={h.newCategory} />
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          <span>by {h.changedByName || `User #${h.changedBy}`}</span>
                          <span>{new Date(h.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Existing Deals section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Deals</h2>
              <Dialog open={dealDialogOpen} onOpenChange={setDealDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Deal</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Deal</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div><Label>Title (optional)</Label><Input value={newDealTitle} onChange={e => setNewDealTitle(e.target.value)} placeholder="Deal title" /></div>
                    <div><Label>Stage</Label>
                      <Select value={newDealStage} onValueChange={setNewDealStage}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["New","CL Sent","Price Given","Samples Sent","Samples Received"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Production Unit</Label>
                      <Select value={newDealProductionUnit || PENDING_UNIT_ASSIGNMENT} onValueChange={(v) => setNewDealProductionUnit(v === PENDING_UNIT_ASSIGNMENT ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Select production unit" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Not assigned</SelectItem>
                          {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT && u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleCreateDeal} disabled={createDeal.isPending} className="w-full">Create</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <Dialog open={editTitleOpen} onOpenChange={setEditTitleOpen}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader><DialogTitle>Edit Deal Title</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>Deal Title</Label>
                    <Input
                      value={editTitleValue}
                      onChange={(e) => setEditTitleValue(e.target.value)}
                      placeholder="Enter deal title"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setEditTitleOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveDealTitle} disabled={updateDeal.isPending}>Save</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <div className="space-y-2">
              {deals?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-card">No deals yet.</p>}
              {deals?.map(d => (
                <Link key={d.id} href={`/leads/${contactId}`}>
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{d.title || `Deal #${d.id}`}</p>
                      <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.totalValue && <span className="text-sm font-medium">â‚¹{Number(d.totalValue).toLocaleString()}</span>}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_BADGE_COLORS[d.stage] || "bg-gray-100"}`}>{d.stage}</span>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit deal title"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditTitleDealId(d.id);
                          setEditTitleValue(d.title || "");
                          setEditTitleOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Section 8: Notification History */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" /> Notification History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!notifications || notifications.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No notifications recorded.</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {notifications.slice(0, 20).map((n) => (
                    <div key={n.id} className="flex items-start gap-2 p-2 border rounded text-sm">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: n.readAt ? "#f3f4f6" : "#dbeafe" }}>
                        <Bell className="h-3 w-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{n.title}</span>
                          {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-1">{n.message}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}
                  {notifications.length > 20 && <p className="text-xs text-center text-muted-foreground">+{notifications.length - 20} more</p>}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ===== DIALOGS ===== */}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{contact.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this lead along with all their deals and activity history. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete Lead</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Customer Comments Edit Dialog */}
      <Dialog open={commentDialogOpen} onOpenChange={(open) => { setCommentDialogOpen(open); if (!open) setShowFullComment(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Customer Comments</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Comments</Label>
              <Textarea value={editComment} onChange={e => setEditComment(e.target.value)} placeholder="Enter customer comments (payment terms, requirements, decision makers...)" rows={6} />
            </div>
            {commentHistory && commentHistory.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Comment History</Label>
                <div className="max-h-48 overflow-y-auto space-y-2 mt-1 border rounded-md p-2 bg-muted/30">
                  {commentHistory.map((h) => (
                    <div key={h.id} className="text-xs border-b border-muted pb-2 last:border-0">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <span className="font-medium text-foreground">{h.updatedByName || `User #${h.updatedBy}`}</span>
                        <span>{new Date(h.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{parseNotesText(h.comment) || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCommentDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              updateContact.mutate({ id: contactId, data: { customerComments: editComment || null } }, {
                onSuccess: () => {
                  onContactChange(queryClient, contactId);
                  toast({ title: "Customer comments updated" });
                  setCommentDialogOpen(false);
                },
                onError: () => toast({ title: "Failed to update comments", variant: "destructive" }),
              });
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit {editField}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>{editField}</Label>
              {editField === "unit" ? (
                <Select value={editValue || PENDING_UNIT_ASSIGNMENT} onValueChange={(v) => setEditValue(v === PENDING_UNIT_ASSIGNMENT ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Not assigned</SelectItem>
                    {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : editField === "industry" ? (
                <Select value={editValue || "__none__"} onValueChange={(v) => setEditValue(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select Industry" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={editValue} onChange={e => setEditValue(e.target.value)} />
              )}
            </div>
            {editField === "unit" && (
              <div>
                <Label>Reason for change (optional)</Label>
                <Input value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g. Customer requested Surat factory" />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEditDialogOpen(false); setEditReason(""); }}>Cancel</Button>
            <Button onClick={() => handleInlineEdit(editField, editValue)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity Modal */}
      <ActivityDetailDrawer
        open={activityModalOpen}
        onOpenChange={(open) => { if (!open) { setActivityModalOpen(false); setCompletingActivity(null); } }}
        contactId={contactId}
        dealId={deal?.id || (actDealId ? Number(actDealId) : null)}
        contactName={contact?.name ?? undefined}
        contactCompany={contact?.companyName ?? undefined}
        contactMobile={contact?.mobile ?? undefined}
        activity={completingActivity ? {
          id: completingActivity.id,
          type: completingActivity.type,
          notesDisplay: completingActivity.notesDisplay,
          notes: completingActivity.notes,
          callStatus: completingActivity.callStatus,
          followUpType: completingActivity.followUpType,
        } : null}
      />

      <MoveCategoryDialog
        open={showMoveCategory}
        onOpenChange={setShowMoveCategory}
        contactIds={[contactId]}
        currentCategory={(contact as any).category}
        onSuccess={() => {
          onContactChange(queryClient, contactId);
        }}
      />

      {/* Upload Document Dialog */}
      <DocumentUploadDialog
        open={uploadDocOpen}
        onOpenChange={setUploadDocOpen}
        contactId={contactId}
        onSuccess={() => {
          onContactChange(queryClient, contactId);
        }}
      />

      {/* Delete Activity Confirmation */}
      <AlertDialog open={deleteActId !== null} onOpenChange={(open) => { if (!open) setDeleteActId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this activity?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteActId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteActivity} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProformaInvoiceList({ contactId }: { contactId: number }) {
  const { data: proformas, isLoading } = useListContactProformaInvoices(contactId, {
    query: { queryKey: getListContactProformaInvoicesQueryKey(contactId), enabled: !!contactId, staleTime: 10_000 },
  });

  const displayList = (proformas || []);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>;
  if (displayList.length === 0) return <p className="text-xs text-muted-foreground">No proforma invoices yet.</p>;

  return (
    <div className="space-y-1.5">
      {displayList.map((p) => (
        <Link key={p.id} href={`/proforma-invoices`} className="block">
          <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.invoiceNumber}</span>
              <Badge className={`text-[10px] px-1.5 py-0 ${(p.status === "Draft" ? "bg-gray-100 text-gray-700" : p.status === "Sent" ? "bg-blue-100 text-blue-700" : p.status === "Approved" ? "bg-green-100 text-green-700" : p.status === "Rejected" ? "bg-red-100 text-red-700" : "bg-purple-100 text-purple-700")}`}>
                {p.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground font-medium">â‚¹{Number(p.grandTotal || 0).toLocaleString("en-IN")}</span>
              <span className="text-muted-foreground text-[10px]">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
