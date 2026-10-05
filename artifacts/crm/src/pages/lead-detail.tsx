import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetContact, useListDeals, useListActivities, useCreateDeal,
  useUpdateContact, useDeleteContact, useListUsers, useListContactProformaInvoices, getListContactProformaInvoicesQueryKey,
  getGetContactQueryKey, useUpdateDeal, useUpdateActivity
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Phone, Plus, Trash2, FolderTree, MessageSquare, Pencil, Calendar, ChevronRight, Bell, Paperclip, Copy, ExternalLink, CheckCircle, XCircle, RotateCcw, User, Users, Building, FileText, Search, Tag, Eye, Clock } from "lucide-react";
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
import { parseNotesText, parseNotesDisplay, parseNotesEntries, formatDealNotes, dedupeById, parseDetailedNotes, type DetailedNote } from "@/lib/parse-notes";
import { formatCurrency } from "@/lib/currency";
import { deriveFollowUpStatus } from "@/lib/follow-up-status";
import { SharedActivityTimeline } from "@/components/shared-activity-timeline";

function formatCustomerSince(val: string | null | undefined): string {
  if (!val) return "-";
  try {
    const dt = new Date(val);
    if (isNaN(dt.getTime())) return val;
    return format(dt, "yyyy-MM-dd, h:mm a");
  } catch {
    return val;
  }
}

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

  const deleteDealMutation = useMutation({
    mutationFn: async (id: number) => {
      const token = localStorage.getItem("crm_token") || "";
      const res = await fetch(`/api/deals/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to delete deal" }));
        throw new Error(err.error || "Failed to delete deal");
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      onDealChange(queryClient, deleteDealId || undefined, contactId);
      onActivityChange(queryClient, deleteDealId || undefined, contactId);
      onContactChange(queryClient, contactId);
      toast({ title: "Deal deleted successfully" });
      setDeleteDealOpen(false);
      setDeleteDealId(null);
      setDeleteDealTitle("");
    },
    onError: (err: any) => {
      toast({
        title: "Could not delete deal",
        description: err?.message || "Failed to delete deal",
        variant: "destructive",
      });
    },
  });

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

  const [deleteDealOpen, setDeleteDealOpen] = useState(false);
  const [deleteDealId, setDeleteDealId] = useState<number | null>(null);
  const [deleteDealTitle, setDeleteDealTitle] = useState("");
  const [showMoveCategory, setShowMoveCategory] = useState(false);
  const [uploadDocOpen, setUploadDocOpen] = useState(false);

  // Customer Comments
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [editComment, setEditComment] = useState("");
  const [showFullComment, setShowFullComment] = useState(false);
  const [deleteCommentId, setDeleteCommentId] = useState<number | null>(null);

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

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: number) => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/comments/${commentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete comment");
      }
      return res.json().catch(() => ({ success: true }));
    },
    onSuccess: () => {
      onContactChange(queryClient, contactId);
      toast({ title: "Comment deleted" });
      setDeleteCommentId(null);
    },
    onError: (err: any) => {
      toast({ title: err.message || "Failed to delete comment", variant: "destructive" });
      setDeleteCommentId(null);
    },
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




  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!contact) return <div className="p-8">Contact not found.</div>;

  const owner = contact.salesOwner;
  const deal = deals && deals.length > 0 ? deals[0] : null;
  const commentsText = parseNotesText(contact.customerComments) || "";


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

  const confirmDeleteDeal = () => {
    if (deleteDealId) {
      deleteDealMutation.mutate(deleteDealId);
    }
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
      <Card className="sticky top-0 z-20 shadow-xs border-b bg-card">
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
                    title={`Customer since ${formatCustomerSince((contact as any).customerSince)}`}
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
                {(contact as any).customerSince && <span>Customer since {formatCustomerSince((contact as any).customerSince)}</span>}
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
              {infield("Customer Since", "customerSince", (contact as any).customerSince ? formatCustomerSince((contact as any).customerSince) : "-")}
              {infield("Customer Status", "customerStatus", (contact as any).customerStatus)}
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Created: {contact.createdAt ? format(new Date(contact.createdAt), "d MMM yyyy, h:mm a") : "—"}</span>
                  {contact.commentUpdatedAt && <span>Updated: {format(new Date(contact.commentUpdatedAt), "d MMM yyyy, h:mm a")}</span>}
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
                      <span className="font-medium">{formatCurrency(deal.totalValue)}</span>
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
                <Button size="sm" variant="outline" className="w-full py-1.5 text-xs justify-center items-center gap-1.5 px-3" onClick={() => { setActDealId(deal?.id?.toString() || ""); setCompletingActivity(null); setActivityModalOpen(true); }}>
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
          <SharedActivityTimeline contactId={contactId} />

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
                          {h.reason && (
                            <span className="text-xs text-muted-foreground font-normal">
                              — <span className="text-foreground font-medium">{h.reason}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          <span>by {h.changedByName || `User #${h.changedBy}`}</span>
                          <span>{h.createdAt ? format(new Date(h.createdAt), "d MMM yyyy, h:mm a") : ""}</span>
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
              {deals?.map(d => {
                const dealActs = (activities || [])
                  .filter((a) => Number(a.dealId) === Number(d.id))
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id);
                const latestDealAct = dealActs[0] || null;
                const schedAct =
                  (latestDealAct && (latestDealAct.callStatus || "Pending") === "Pending")
                    ? latestDealAct
                    : (dealActs.find((a) => (a.callStatus || "Pending") === "Pending") || null);
                const isDealScheduled = !!schedAct;

                return (
                  <div key={d.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent/40 transition-colors">
                    <Link href={`/leads/${contactId}`} className="min-w-0 flex-1">
                      <div>
                        <p className="font-medium text-sm hover:underline">{d.title || `Deal #${d.id}`}</p>
                        <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {d.totalValue && <span className="text-sm font-medium">{formatCurrency(d.totalValue)}</span>}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_BADGE_COLORS[d.stage] || "bg-gray-100"}`}>{d.stage}</span>
                      {isDealScheduled ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-6 text-[11px] px-2 py-0 bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1 shadow-xs border-0"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCallConfirmActivity({ activity: schedAct, dealId: d.id });
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
                            setActDealId(String(d.id));
                            setCompletingActivity(null);
                            setActivityModalOpen(true);
                          }}
                          title="Add Activity for this deal"
                        >
                          <Plus className="h-3 w-3" /> Activity
                        </Button>
                      )}
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
                      {d.stage !== "Won" && d.stage !== "Lost" && (
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors"
                          title="Delete deal"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeleteDealId(d.id);
                            setDeleteDealTitle(d.title || `Deal #${d.id}`);
                            setDeleteDealOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words mt-1">{n.message}</p>
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
                    <div key={h.id} className="text-xs border-b border-muted pb-2 last:border-0 group/comment">
                      <div className="flex items-center justify-between gap-2 text-muted-foreground mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{h.updatedByName || `User #${h.updatedBy}`}</span>
                          <span>{new Date(h.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeleteCommentId(h.id)}
                          className="h-5 w-5 rounded hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-600 transition-colors"
                          title="Delete comment"
                          disabled={deleteCommentMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
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

      {/* Delete Comment Confirmation Dialog */}
      <AlertDialog open={deleteCommentId !== null} onOpenChange={(open) => { if (!open) setDeleteCommentId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this comment from history? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteCommentId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteCommentId) {
                  deleteCommentMutation.mutate(deleteCommentId);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        onOpenChange={(open) => {
          if (!open) {
            setActivityModalOpen(false);
            setCompletingActivity(null);
            setActDealId("");
          }
        }}
        contactId={contactId}
        dealId={completingActivity?.dealId || (actDealId ? Number(actDealId) : deal?.id) || null}
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
        defaultScheduleNext={!!completingActivity}
      />

      <MoveCategoryDialog
        open={showMoveCategory}
        onOpenChange={setShowMoveCategory}
        contactIds={[contactId]}
        currentCategory={(contact as any).category}
        onSuccess={() => {
          onContactChange(queryClient, contactId);
          onDealChange(queryClient, undefined, contactId);
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

      {/* Delete Deal Confirmation */}
      <AlertDialog open={deleteDealOpen} onOpenChange={setDeleteDealOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteDealTitle ? `"${deleteDealTitle}"` : "this deal"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this deal? This will permanently delete the deal and its associated activity records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDealOpen(false)} disabled={deleteDealMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteDeal}
              disabled={deleteDealMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDealMutation.isPending ? "Deleting..." : "Delete Deal"}
            </AlertDialogAction>
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
              <span className="text-muted-foreground font-medium">{formatCurrency(p.grandTotal || 0)}</span>
              <span className="text-muted-foreground text-[10px]">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
