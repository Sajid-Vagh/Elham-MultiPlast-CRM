import { useState, useMemo, useRef, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetContact, useListDeals, useListActivities, useCreateDeal, useCreateActivity,
  useUpdateContact, useDeleteContact, useListUsers, useListContactProformaInvoices, getListContactProformaInvoicesQueryKey,
  getGetContactQueryKey, useGetMe
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Phone, Plus, Trash2, FolderTree, MessageSquare, Pencil, Calendar, ChevronRight, Bell, Paperclip, Copy, ExternalLink, CheckCircle, XCircle, RotateCcw, User, Building, ListOrdered, FileText, Factory, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { CategoryBadge } from "@/components/category-badge";
import { MoveCategoryDialog } from "@/components/move-category-dialog";
import { DocumentManager } from "@/components/document-manager";
import { DocumentUploadDialog } from "@/components/document-upload-dialog";
import { ScheduleFollowUpDialog } from "@/components/schedule-follow-up-dialog";
import { STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { onContactChange, onDealChange, onActivityChange } from "@/lib/query-invalidation";

const TIMELINE_ICONS: Record<string, { bg: string; icon: string }> = {
  "lead_created":    { bg: "#dbeafe", icon: "🆕" },
  "follow_up":       { bg: "#ffedd5", icon: "🔔" },
  "call":            { bg: "#dcfce7", icon: "📞" },
  "whatsapp":        { bg: "#ccfbf1", icon: "💬" },
  "email":           { bg: "#dbeafe", icon: "✉️" },
  "note":            { bg: "#fef9c3", icon: "📝" },
  "activity":        { bg: "#f3f4f6", icon: "•" },
  "category_change": { bg: "#f3e8ff", icon: "🏷️" },
  "comment_updated": { bg: "#e0f2fe", icon: "💬" },
  "deal_created":    { bg: "#d1fae5", icon: "🤝" },
  "deal_updated":    { bg: "#e0e7ff", icon: "📊" },
  "document_uploaded": { bg: "#fef9c3", icon: "📄" },
  "document_replaced": { bg: "#fce7f3", icon: "🔄" },
  "unit_change":       { bg: "#fef3c7", icon: "🏭" },
};

const ACT_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  "Call":     { bg: "#dcfce7", fg: "#15803d", icon: "📞" },
  "WhatsApp": { bg: "#ccfbf1", fg: "#0f766e", icon: "💬" },
  "Email":    { bg: "#dbeafe", fg: "#1d4ed8", icon: "✉️" },
  "Note":     { bg: "#fef9c3", fg: "#a16207", icon: "📝" },
  "FollowUp": { bg: "#ffedd5", fg: "#c2410c", icon: "🔔" },
};

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
  const { data: currentUser } = useGetMe();

  const createDeal = useCreateDeal();
  const createActivity = useCreateActivity();
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();

  const [newDealStage, setNewDealStage] = useState("New");
  const [newDealTitle, setNewDealTitle] = useState("");
  const [newDealLostReason, setNewDealLostReason] = useState("");
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const [actType, setActType] = useState("Call");
  const [actNotes, setActNotes] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [actFollowUpTime, setActFollowUpTime] = useState("");
  const [actFollowType, setActFollowType] = useState("Call");
  const [actDealId, setActDealId] = useState("");
  const [actDialogOpen, setActDialogOpen] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
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

  // Production Order for this contact
  const { data: productionOrder } = useQuery({
    queryKey: ["production-by-contact", contactId],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/production/by-contact/${contactId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{
        id: number; status: string; priority: string; expectedDispatchDate: string | null;
        productionUnit: string | null; productionRemarks: string | null;
        updatedAt: string; createdAt: string;
        lastUpdatedBy: { id: number; name: string } | null;
        assignedManager: { id: number; name: string } | null;
        createdByName: string | null; createdByRole: string | null;
        timeline: Array<{ id: number; status: string; notes: string | null; createdAt: string; createdByName: string | null }>;
        notes: Array<{ id: number; note: string; createdAt: string; createdByName: string | null }>;
        invoiceId: number | null; invoiceNumber: string | null;
      } | null>;
    },
    enabled: !!contactId,
    staleTime: 10_000,
  });

  // Production Messages (Order Conversation)
  const [messageText, setMessageText] = useState("");
  const { data: productionMessages, refetch: refetchMessages } = useQuery({
    queryKey: ["production-messages", productionOrder?.id],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/production/orders/${productionOrder!.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{
        id: number; productionOrderId: number; senderId: number | null;
        senderName: string; senderRole: string; message: string; createdAt: string;
      }>>;
    },
    enabled: !!productionOrder?.id,
    staleTime: 3_000,
    refetchInterval: productionOrder?.id ? 5_000 : false,
  });

  const sendMessage = useMutation({
    mutationFn: async (msg: string) => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/production/orders/${productionOrder!.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      setMessageText("");
      refetchMessages();
    },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  const handleSendMessage = () => {
    if (!messageText.trim() || sendMessage.isPending) return;
    sendMessage.mutate(messageText.trim());
  };

  // Auto-scroll + unread indicator
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!productionMessages) return;
    const container = chatContainerRef.current;
    const isAtBottom = container ? container.scrollHeight - container.scrollTop - container.clientHeight < 80 : true;
    if (isAtBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadCount(0);
    } else if (productionMessages.length > prevMsgCountRef.current) {
      setUnreadCount(c => c + (productionMessages.length - prevMsgCountRef.current));
    }
    prevMsgCountRef.current = productionMessages.length;
  }, [productionMessages]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadCount(0);
  };

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

  // Schedule follow-up dialog
  const [schedFuOpen, setSchedFuOpen] = useState(false);

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

  const mergedTimeline = useMemo(() => {
    const items: Array<{
      key: string; type: string; icon: string; bg: string; description: string;
      createdAt: string; userName: string | null; notes: string | null;
      activityId?: number; callStatus?: string | null; followUpDate?: string | null; isEdited?: boolean | null; dealStage?: string;
    }> = [];

    if (activities) {
      for (const act of activities) {
        const st = ACT_STYLE[act.type] || { bg: "#f3f4f6", icon: "•", fg: "#333" };
        items.push({
          key: `act-${act.id}`, type: act.type, icon: st.icon, bg: st.bg,
          description: act.type === "FollowUp" ? "Follow-up Scheduled" : `${act.type} Logged`,
          createdAt: act.createdAt, userName: act.user?.name || null,
          notes: act.notes || (act as any).notesDisplay || null,
          activityId: act.id, callStatus: act.callStatus, followUpDate: act.followUpDate, isEdited: act.isEdited,
        });
      }
    }
    if (timeline) {
      for (const ev of timeline) {
        if (["follow_up","call","whatsapp","email","note","activity"].includes(ev.type)) continue;
        const ts = TIMELINE_ICONS[ev.type] || { bg: "#f3f4f6", icon: "•" };
        items.push({
          key: `tl-${items.length}`, type: ev.type, icon: ts.icon, bg: ts.bg,
          description: ev.description, createdAt: ev.createdAt, userName: ev.user?.name || null,
          notes: ev.notes || null, dealStage: ev.dealStage,
        });
      }
    }
    // Filter by date range
    let filtered = items;
    if (actFromDate) filtered = filtered.filter(i => i.createdAt.slice(0, 10) >= actFromDate);
    if (actToDate) filtered = filtered.filter(i => i.createdAt.slice(0, 10) <= actToDate);
    // Sort newest first
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered;
  }, [activities, timeline, actFromDate, actToDate]);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!contact) return <div className="p-8">Contact not found.</div>;

  const owner = contact.salesOwner;
  const deal = deals && deals.length > 0 ? deals[0] : null;

  const handleCreateDeal = () => {
    if (!newDealStage) return;
    createDeal.mutate({ data: { contactId, stage: newDealStage as any, title: newDealTitle || null, salesOwnerId: contact.salesOwnerId, lostReason: newDealStage === "Lost" ? newDealLostReason || null : null } }, {
      onSuccess: () => {
        onDealChange(queryClient, undefined, contactId);
        toast({ title: "Deal created" });
        setDealDialogOpen(false); setNewDealTitle(""); setNewDealLostReason("");
      },
      onError: () => toast({ title: "Error creating deal", variant: "destructive" }),
    });
  };

  const handleCreateActivity = () => {
    if (!actDealId) { toast({ title: "Select a deal", variant: "destructive" }); return; }
    const payload = { dealId: Number(actDealId), contactId, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpTime: actFollowUpTime || null };
    createActivity.mutate({ data: payload }, {
      onSuccess: () => {
        onActivityChange(queryClient, Number(actDealId), contactId);
        toast({ title: "Activity logged" });
        setActDialogOpen(false); setActNotes(""); setActFollowUp(""); setActFollowUpTime("");
      },
      onError: () => {
        toast({ title: "Error logging activity", variant: "destructive" });
      },
    });
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

  const handleCompleteFollowUp = (activityId: number) => {
    fetch(`/api/activities/${activityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      body: JSON.stringify({ callStatus: "Completed" }),
    }).then(() => {
      onActivityChange(queryClient, undefined, contactId);
      toast({ title: "Follow-up completed" });
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
        <span>{value || "—"}</span>
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
            <Link href="/leads"><Button variant="ghost" size="sm" className="shrink-0 -ml-2"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {owner && <UserAvatar profilePhoto={owner.profilePhoto} name={owner.name} className="w-3 h-3 shrink-0" />}
                <h1 className="text-xl font-bold truncate">{contact.name}</h1>
                <CategoryBadge category={(contact as any).category} />
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
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditComment(contact.customerComments || ""); setCommentDialogOpen(true); }} title="Edit Comments">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {contact.customerComments ? (
                <div>
                  <p className="whitespace-pre-wrap text-sm">
                    {showFullComment || contact.customerComments.length <= 100
                      ? contact.customerComments
                      : `${contact.customerComments.slice(0, 100)}...`}
                  </p>
                  {contact.customerComments.length > 100 && (
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
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2.5 rounded-md">{upcomingFollowUp.notes}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => handleCompleteFollowUp(upcomingFollowUp.id)}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Mark Completed
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setActDealId(deal?.id?.toString() || ""); setSchedFuOpen(true); }}>
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
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setActDealId(deal?.id?.toString() || ""); setSchedFuOpen(true); }}>
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
                      <span className="font-medium">₹{Number(deal.totalValue).toLocaleString()}</span>
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
                  <Link href={`/deals/${deal.id}`}>
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-2">
                      <ExternalLink className="h-3 w-3 mr-1" /> Open Deal
                    </Button>
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">No deal exists for this contact.</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDealDialogOpen(true)}>
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
                    window.location.href = `/proforma-invoices?contactId=${contactId}`;
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
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => { setActDealId(deal?.id?.toString() || ""); setSchedFuOpen(true); }}>
                  <Calendar className="h-3.5 w-3.5 shrink-0" /> Schedule Follow-up
                </Button>
                {contact.category !== "My Client" && !contact.isMyClient && (
                  <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setShowMoveCategory(true)}>
                    <FolderTree className="h-3.5 w-3.5 shrink-0" /> Move Category
                  </Button>
                )}
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => setDealDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5 shrink-0" /> Create Deal
                </Button>
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => window.location.href = `/proforma-invoices?contactId=${contactId}`}>
                  <FileText className="h-3.5 w-3.5 shrink-0" /> Proforma Invoice
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
        </div>

        {/* ========== RIGHT CONTENT ========== */}
        <div className="lg:col-span-2 space-y-4">
          {/* Merged Activity Timeline (replaces Follow-up History + Activity Timeline + Activity Log) */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ListOrdered className="h-3.5 w-3.5" /> Activity Timeline
                </CardTitle>
                <Dialog open={actDialogOpen} onOpenChange={setActDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Log Activity</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div><Label>Deal</Label>
                        <Select value={actDealId} onValueChange={setActDealId}>
                          <SelectTrigger><SelectValue placeholder="Select deal" /></SelectTrigger>
                          <SelectContent>{deals?.map(d => <SelectItem key={d.id} value={d.id.toString()}>{d.title || `Deal #${d.id}`}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Type</Label>
                        <Select value={actType} onValueChange={setActType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{["WhatsApp","Call","Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label>Notes</Label><Textarea value={actNotes} onChange={e => setActNotes(e.target.value)} placeholder="Discussion notes..." /></div>
                      <div><Label>Follow-up Date</Label><Input type="date" value={actFollowUp} onChange={e => setActFollowUp(e.target.value)} /></div>
                      {actFollowUp && <div><Label>Follow-up Time</Label><Input type="time" value={actFollowUpTime} onChange={e => setActFollowUpTime(e.target.value)} /></div>}
                      <Button onClick={handleCreateActivity} disabled={createActivity.isPending} className="w-full">Log</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {/* Quick date filter */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {QUICK_BTNS.map(b => (
                  <button key={b.key} className={`date-quick-btn ${actQuick === b.key ? "active" : ""}`} onClick={() => applyQuick(b.key)}>
                    {b.label}
                  </button>
                ))}
                <span className="text-muted-foreground text-xs ml-1">|</span>
                <Input type="date" value={actFromDate} onChange={e => { setActFromDate(e.target.value); setActQuick("custom"); }} className="h-7 w-36 text-xs" />
                <span className="text-xs text-muted-foreground">–</span>
                <Input type="date" value={actToDate} onChange={e => { setActToDate(e.target.value); setActQuick("custom"); }} className="h-7 w-36 text-xs" />
                {actQuick !== "all" && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-1">
                    {mergedTimeline.length} shown
                  </span>
                )}
              </div>

              {mergedTimeline.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 border rounded-lg bg-card">
                  {actQuick !== "all" ? "No events in this period." : "No timeline events yet."}
                </p>
              ) : (
                <div className="relative pl-6 space-y-0">
                  {mergedTimeline.map((event, idx) => {
                    const isLast = idx === mergedTimeline.length - 1;
                    return (
                      <div key={event.key} className="relative pb-4">
                        {!isLast && <div className="absolute left-[11px] top-5 bottom-0 w-0.5 bg-border" />}
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs z-10 ring-2 ring-background" style={{ backgroundColor: event.bg }}>
                            {event.icon}
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium">{event.description}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(event.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {event.type === "FollowUp" && event.callStatus && (
                                <Badge variant="outline" className={`text-[10px] ${event.callStatus === "Completed" ? "border-green-300 text-green-700" : event.callStatus === "Cancelled" ? "border-red-300 text-red-700" : "border-orange-300 text-orange-700"}`}>
                                  {event.callStatus}
                                </Badge>
                              )}
                            </div>
                            {event.userName && <p className="text-[10px] text-muted-foreground">by {event.userName}</p>}
                            {event.notes && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap line-clamp-2">{event.notes}</p>}
                            {event.dealStage && <Badge variant="outline" className="text-[10px] mt-0.5">{event.dealStage}</Badge>}
                            {event.followUpDate && <p className="text-[10px] text-primary mt-0.5">Follow-up: {event.followUpDate}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: "#f3e8ff" }}>🏷️</div>
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
                        <SelectContent>{["New","CL Sent","Price Given","Samples Sent","Samples Received","PI Sent","Won","Lost"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {newDealStage === "Lost" && <div><Label>Lost Reason *</Label><Textarea value={newDealLostReason} onChange={e => setNewDealLostReason(e.target.value)} placeholder="Reason for losing this deal" /></div>}
                    <Button onClick={handleCreateDeal} disabled={createDeal.isPending} className="w-full">Create</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-2">
              {deals?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-card">No deals yet.</p>}
              {deals?.map(d => (
                <Link key={d.id} href={`/deals/${d.id}`}>
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{d.title || `Deal #${d.id}`}</p>
                      <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {d.totalValue && <span className="text-sm font-medium">₹{Number(d.totalValue).toLocaleString()}</span>}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_BADGE_COLORS[d.stage] || "bg-gray-100"}`}>{d.stage}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Production Updates */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Factory className="h-3.5 w-3.5" /> Production Updates
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!productionOrder ? (
                <p className="text-xs text-muted-foreground text-center py-4">No Production Order has been created yet.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Status</span>
                    <Badge className={`text-[10px] px-2 py-0.5 ${
                      productionOrder.status === "Completed" ? "bg-green-100 text-green-700 border-green-200" :
                      productionOrder.status === "Cancelled" ? "bg-red-100 text-red-700 border-red-200" :
                      productionOrder.status === "On Hold" ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
                      "bg-blue-100 text-blue-700 border-blue-200"
                    }`}>{productionOrder.status}</Badge>
                  </div>
                  {productionOrder.lastUpdatedBy && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Updated By</span>
                      <span className="text-xs font-medium">{productionOrder.lastUpdatedBy.name}</span>
                    </div>
                  )}
                  {productionOrder.updatedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Last Updated</span>
                      <span className="text-xs">{new Date(productionOrder.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  )}
                  {productionOrder.notes && productionOrder.notes.length > 0 && (
                    <div>
                      <span className="text-muted-foreground text-xs">Latest Production Note</span>
                      <div className="mt-1 p-2 rounded-md bg-muted/30 text-xs">
                        <p className="whitespace-pre-wrap line-clamp-3">{productionOrder.notes[0].note}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                          {productionOrder.notes[0].createdByName && <span>by {productionOrder.notes[0].createdByName}</span>}
                          <span>{new Date(productionOrder.notes[0].createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {productionOrder.timeline && productionOrder.timeline.length > 0 && (
                    <div>
                      <span className="text-muted-foreground text-xs">Production Timeline</span>
                      <div className="mt-1 space-y-1.5 max-h-40 overflow-y-auto">
                        {productionOrder.timeline.slice(0, 5).map((t) => (
                          <div key={t.id} className="flex items-start gap-2 text-xs">
                            <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium">{t.status}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(t.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                              {t.notes && <p className="text-muted-foreground text-[10px] line-clamp-1">{t.notes}</p>}
                              {t.createdByName && <p className="text-[10px] text-muted-foreground">by {t.createdByName}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Link href={`/production/orders/${productionOrder.id}`}>
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs mt-1">
                      <ExternalLink className="h-3 w-3 mr-1" /> View Production Order
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Conversation */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    💬 Order Conversation
                  </CardTitle>
                  {productionOrder && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Realtime
                    </span>
                  )}
                </div>
                {productionMessages && productionMessages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{productionMessages.length} message{productionMessages.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Communicate with the Production Team regarding this order.</p>
            </CardHeader>
            <CardContent>
              {!productionOrder ? (
                <p className="text-xs text-muted-foreground text-center py-4">No Production Order has been created yet.</p>
              ) : (
                <>
                  {/* Chat Container */}
                  <div
                    ref={chatContainerRef}
                    className="relative rounded-xl border bg-[#fafafa] overflow-hidden"
                    style={{ height: 300 }}
                  >
                    <div className="h-full overflow-y-auto px-3 py-3 space-y-3">
                      {!productionMessages || productionMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <MessageSquare className="h-5 w-5 text-muted-foreground/50" />
                          </div>
                          <p className="text-sm font-medium text-muted-foreground">No conversation yet.</p>
                          <p className="text-[11px] text-muted-foreground/70 mt-1">Start a conversation with the Production Team.</p>
                        </div>
                      ) : (
                        <>
                          {productionMessages.map((msg, idx) => {
                            const isMe = currentUser && msg.senderId === currentUser.id;
                            const showAvatar = idx === 0 || productionMessages[idx - 1].senderId !== msg.senderId;
                            const isLastInGroup = idx === productionMessages.length - 1 || productionMessages[idx + 1].senderId !== msg.senderId;
                            const timeStr = new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) === new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                              ? new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                              : new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " • " + new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                            return (
                              <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} animate-[fadeSlideIn_0.2s_ease-out]`}>
                                {showAvatar && !isMe && (
                                  <div className="flex items-center gap-1.5 mb-1 ml-1">
                                    <span className="text-[11px] font-semibold text-foreground">{msg.senderName}</span>
                                    <span className="text-[9px] font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-px leading-none">{msg.senderRole}</span>
                                  </div>
                                )}
                                {showAvatar && isMe && (
                                  <div className="flex items-center gap-1.5 mb-1 mr-1">
                                    <span className="text-[11px] font-semibold text-muted-foreground">You</span>
                                  </div>
                                )}
                                <div className={`max-w-[75%] px-3 py-2 text-[12.5px] leading-relaxed ${
                                  isMe
                                    ? "bg-violet-600 text-white rounded-2xl rounded-br-md shadow-sm"
                                    : "bg-white text-foreground border border-gray-200 rounded-2xl rounded-bl-md shadow-sm"
                                }`}>
                                  <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                                </div>
                                {isLastInGroup && (
                                  <span className={`text-[9px] text-muted-foreground/60 mt-1 ${isMe ? "mr-1" : "ml-1"}`}>
                                    {timeStr}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          <div ref={chatEndRef} />
                        </>
                      )}
                    </div>

                    {/* Unread indicator */}
                    {unreadCount > 0 && (
                      <button
                        onClick={scrollToBottom}
                        className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 bg-violet-600 text-white text-[11px] font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-violet-700 transition-colors cursor-pointer"
                      >
                        <span className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-white" />
                        {unreadCount} new message{unreadCount !== 1 ? "s" : ""}
                      </button>
                    )}
                  </div>

                  {/* Input Area */}
                  <div className="flex items-end gap-2 mt-2">
                    <div className="flex-1 relative">
                      <Textarea
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                        placeholder="Type your message..."
                        rows={1}
                        className="min-h-[40px] max-h-24 text-[13px] resize-none rounded-xl border-gray-200 bg-white pr-10 focus-visible:ring-violet-500 focus-visible:border-violet-400 placeholder:text-muted-foreground/50"
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                      />
                    </div>
                    <button
                      onClick={handleSendMessage}
                      disabled={!messageText.trim() || sendMessage.isPending}
                      className="shrink-0 w-10 h-10 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md active:scale-95"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

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
                      <p className="whitespace-pre-wrap">{h.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCommentDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              updateContact.mutate({ id: contactId, data: { customerComments: editComment || null } as any }, {
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
              <Input value={editValue} onChange={e => setEditValue(e.target.value)} />
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

      {/* Schedule Follow-up Dialog */}
      <ScheduleFollowUpDialog
        open={schedFuOpen}
        onOpenChange={setSchedFuOpen}
        contactId={contactId}
        dealId={deal?.id || (actDealId ? Number(actDealId) : null)}
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
    </div>
  );
}

function ProformaInvoiceList({ contactId }: { contactId: number }) {
  const { data: proformas, isLoading } = useListContactProformaInvoices(contactId, {
    query: { queryKey: getListContactProformaInvoicesQueryKey(contactId), enabled: !!contactId, staleTime: 10_000 },
  });

  const displayList = (proformas || []).slice(0, 5);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading...</p>;
  if (displayList.length === 0) return <p className="text-xs text-muted-foreground">No proforma invoices yet.</p>;

  return (
    <div className="space-y-1.5">
      {displayList.map((p) => (
        <Link key={p.id} href={`/proforma-invoices`} className="block">
          <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer text-xs">
            <div>
              <span className="font-medium">{p.invoiceNumber}</span>
              <span className="text-muted-foreground ml-2">{p.customerName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`text-[10px] px-1.5 py-0 ${(p.status === "Draft" ? "bg-gray-100 text-gray-700" : p.status === "Sent" ? "bg-blue-100 text-blue-700" : p.status === "Approved" ? "bg-green-100 text-green-700" : p.status === "Rejected" ? "bg-red-100 text-red-700" : "bg-purple-100 text-purple-700")}`}>
                {p.status}
              </Badge>
              <span className="text-muted-foreground">₹{Number(p.grandTotal || 0).toLocaleString()}</span>
            </div>
          </div>
        </Link>
      ))}
      {proformas && proformas.length > 5 && (
        <Link href="/proforma-invoices">
          <p className="text-xs text-blue-600 text-center mt-1 hover:underline cursor-pointer">View all proformas →</p>
        </Link>
      )}
    </div>
  );
}
