import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpdateActivity } from "@workspace/api-client-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { onActivityChange } from "@/lib/query-invalidation";
import { STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { X, Pencil, Phone, PhoneOff, Calendar, MessageSquare, ExternalLink, Clock, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

const ACT_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  "Call":     { bg: "#dcfce7", fg: "#15803d", icon: "📞" },
  "WhatsApp": { bg: "#ccfbf1", fg: "#0f766e", icon: "💬" },
  "Email":    { bg: "#dbeafe", fg: "#1d4ed8", icon: "✉️" },
  "Note":     { bg: "#fef9c3", fg: "#a16207", icon: "📝" },
  "FollowUp": { bg: "#ffedd5", fg: "#c2410c", icon: "🔔" },
  "Meeting":  { bg: "#ede9fe", fg: "#6d28d9", icon: "🤝" },
};

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
  "deal_created":    { bg: "#dcfce7", icon: "🤝" },
  "deal_stage":      { bg: "#fef3c7", icon: "📊" },
  "pi_created":      { bg: "#ede9fe", icon: "📄" },
  "production":      { bg: "#fce7f3", icon: "🏭" },
  "order":           { bg: "#d1fae5", icon: "📦" },
  "unit_change":     { bg: "#e0e7ff", icon: "🏢" },
};

type ActivityData = {
  id: number; type: string; notes?: string | null;
  notesDisplay?: string | null;
  followUpDate?: string | null; followUpTime?: string | null;
  callStatus?: string | null; createdBy?: number | null;
  followUpType?: string | null; priority?: string | null;
  dealId: number; contactId?: number | null;
  createdAt?: string;
  user?: { id: number; name: string } | null;
  deal?: { id: number; stage?: string; contactId?: number;
    contact?: { id?: number; name?: string; mobile?: string; companyName?: string;
      unit?: string; category?: string; email?: string; city?: string; state?: string;
      salesOwnerId?: number | null; salesOwner?: { name: string } | null } | null;
  } | null;
  contact?: { id?: number; name?: string; mobile?: string; companyName?: string;
    unit?: string; category?: string; email?: string; city?: string; state?: string;
    salesOwnerId?: number | null; salesOwner?: { name: string } | null } | null;
};

interface ActivityDetailDrawerProps {
  activity: ActivityData | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (activity: ActivityData) => void;
}

export default function ActivityDetailDrawer({ activity, open, onClose, onEdit }: ActivityDetailDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const contactId = activity?.contact?.id || activity?.deal?.contact?.id;
  const dealStage = activity?.deal?.stage;

  const { data: timeline } = useQuery({
    queryKey: ["contact-timeline", contactId],
    queryFn: async () => {
      if (!contactId) return [];
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/timeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId && open,
    staleTime: 30_000,
  });

  const updateActivity = useUpdateActivity();

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editStatus, setEditStatus] = useState("Pending");

  const handleMarkComplete = () => {
    if (!activity) return;
    updateActivity.mutate(
      { id: activity.id, data: { callStatus: "Completed" } as any },
      {
        onSuccess: () => {
          toast({ title: "Activity marked as completed" });
          onActivityChange(queryClient);
          onClose();
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      },
    );
  };

  const handleReschedule = () => {
    if (!activity || !rescheduleDate) return;
    updateActivity.mutate(
      { id: activity.id, data: { followUpDate: rescheduleDate, followUpTime: rescheduleTime || null, callStatus: "Pending" } as any },
      {
        onSuccess: () => {
          toast({ title: "Activity rescheduled" });
          onActivityChange(queryClient);
          setRescheduleOpen(false);
          onClose();
        },
        onError: () => toast({ title: "Failed to reschedule", variant: "destructive" }),
      },
    );
  };

  const handleEditSave = () => {
    if (!activity) return;
    const data: Record<string, any> = {};
    if (editNotes.trim()) data.notes = editNotes.trim();
    if (editDate !== activity.followUpDate) data.followUpDate = editDate || null;
    if (editTime !== activity.followUpTime) data.followUpTime = editTime || null;
    if (editStatus !== (activity.callStatus || "Pending")) data.callStatus = editStatus;
    if (Object.keys(data).length === 0) { setEditOpen(false); return; }

    updateActivity.mutate(
      { id: activity.id, data: data as any },
      {
        onSuccess: () => {
          toast({ title: "Activity updated" });
          onActivityChange(queryClient);
          setEditOpen(false);
          onClose();
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      },
    );
  };

  const openReschedule = () => {
    setRescheduleDate(activity?.followUpDate || "");
    setRescheduleTime(activity?.followUpTime || "");
    setRescheduleOpen(true);
  };

  const openEdit = () => {
    setEditNotes("");
    setEditDate(activity?.followUpDate || "");
    setEditTime(activity?.followUpTime || "");
    setEditStatus(activity?.callStatus || "Pending");
    setEditOpen(true);
  };

  if (!open || !activity) return null;

  const contact = activity.contact || activity.deal?.contact;
  const salesPerson = activity.user?.name || contact?.salesOwner?.name || "-";
  const isCompleted = activity.callStatus === "Completed";
  const mobile = contact?.mobile || "";

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="sm:max-w-xl w-full p-0 overflow-y-auto">
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold truncate">{contact?.name || "Activity"}</h2>
                {contact?.companyName && <p className="text-sm text-muted-foreground truncate">{contact.companyName}</p>}
              </div>
              <button onClick={onClose} className="ml-4 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Activity Type + Status Badge */}
              <div className="flex items-center gap-3 flex-wrap">
                {(() => {
                  const style = ACT_STYLE[activity.type] || { bg: "#f3f4f6", fg: "#374151", icon: "•" };
                  return (
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ backgroundColor: style.bg, color: style.fg }}>
                      {style.icon} {activity.type}
                    </span>
                  );
                })()}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  isCompleted ? "bg-green-100 text-green-700" :
                  activity.callStatus === "Cancelled" ? "bg-red-100 text-red-700" :
                  activity.callStatus === "No Response" ? "bg-gray-100 text-gray-600" :
                  "bg-blue-100 text-blue-700"
                }`}>
                  {activity.callStatus || "Pending"}
                </span>
                {activity.priority && activity.priority !== "Medium" && (
                  <span className={`text-xs font-medium ${
                    activity.priority === "High" ? "text-red-600" : "text-green-600"
                  }`}>{activity.priority} Priority</span>
                )}
              </div>

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit ? onEdit(activity) : openEdit()}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Activity
                </Button>
                {!isCompleted && (
                  <Button size="sm" variant="outline" onClick={openReschedule}>
                    <Calendar className="h-3.5 w-3.5 mr-1" /> Reschedule
                  </Button>
                )}
                {!isCompleted && (
                  <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" onClick={handleMarkComplete} disabled={updateActivity.isPending}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Complete
                  </Button>
                )}
                {mobile && (
                  <Button size="sm" variant="outline" onClick={() => window.open(`tel:${mobile}`, "_self")}>
                    <Phone className="h-3.5 w-3.5 mr-1" /> Call
                  </Button>
                )}
                {mobile && (
                  <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/${mobile.replace(/\D/g, "")}`, "_blank")}>
                    <MessageSquare className="h-3.5 w-3.5 mr-1" /> WhatsApp
                  </Button>
                )}
                {contact?.id && (
                  <Link href={`/leads/${contact.id}`}>
                    <Button size="sm" variant="outline">
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> View Lead
                    </Button>
                  </Link>
                )}
              </div>

              {/* Customer Info */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Customer</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {contact?.name && <div><span className="text-muted-foreground">Name</span><p className="font-medium">{contact.name}</p></div>}
                  {contact?.companyName && <div><span className="text-muted-foreground">Company</span><p className="font-medium">{contact.companyName}</p></div>}
                  {contact?.mobile && <div><span className="text-muted-foreground">Mobile</span><p className="font-medium">{contact.mobile}</p></div>}
                  {contact?.email && <div><span className="text-muted-foreground">Email</span><p className="font-medium truncate">{contact.email}</p></div>}
                  {contact?.city && <div><span className="text-muted-foreground">City</span><p className="font-medium">{contact.city}</p></div>}
                  {contact?.state && <div><span className="text-muted-foreground">State</span><p className="font-medium">{contact.state}</p></div>}
                </div>
              </div>

              {/* Activity Details */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Activity Details</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span className="text-muted-foreground">Type</span><p className="font-medium">{activity.followUpType || activity.type}</p></div>
                  {activity.contact?.category && <div><span className="text-muted-foreground">Category</span><p className="font-medium">{activity.contact.category}</p></div>}
                  <div><span className="text-muted-foreground">Status</span><p className="font-medium">{activity.callStatus || "Pending"}</p></div>
                  {activity.priority && <div><span className="text-muted-foreground">Priority</span><p className="font-medium">{activity.priority}</p></div>}
                  {activity.followUpDate && <div><span className="text-muted-foreground">Date</span><p className="font-medium">{new Date(activity.followUpDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p></div>}
                  {activity.followUpTime && <div><span className="text-muted-foreground">Time</span><p className="font-medium">{activity.followUpTime}</p></div>}
                  <div><span className="text-muted-foreground">Sales Person</span><p className="font-medium">{salesPerson}</p></div>
                  <div><span className="text-muted-foreground">Assigned Unit</span><p className="font-medium">{contact?.unit || PENDING_UNIT_ASSIGNMENT}</p></div>
                </div>
              </div>

              {/* Notes */}
              {(activity.notes || activity.notesDisplay) && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Notes</h3>
                  <div className="text-sm bg-muted/30 p-3 rounded-lg whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {activity.notesDisplay || activity.notes}
                  </div>
                </div>
              )}

              {/* Follow-up */}
              {activity.followUpDate && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Follow-up</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div><span className="text-muted-foreground">Next Follow-up Date</span><p className="font-medium">{new Date(activity.followUpDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p></div>
                    {activity.followUpTime && <div><span className="text-muted-foreground">Next Follow-up Time</span><p className="font-medium">{activity.followUpTime}</p></div>}
                  </div>
                </div>
              )}

              {/* Lead Information */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Lead Information</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {activity.contact?.category && <div><span className="text-muted-foreground">Current Category</span><p className="font-medium">{activity.contact.category}</p></div>}
                  {dealStage && (
                    <div>
                      <span className="text-muted-foreground">Current Deal Stage</span>
                      <p><span className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_BADGE_COLORS[dealStage] || "bg-gray-100"}`}>{dealStage}</span></p>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Timeline */}
              {timeline && timeline.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Recent Timeline</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {timeline.slice(0, 15).map((event: any, idx: number) => {
                      const icon = TIMELINE_ICONS[event.type] || TIMELINE_ICONS["activity"];
                      return (
                        <div key={idx} className="flex gap-2 p-2 rounded-lg bg-card border text-sm">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0" style={{ backgroundColor: icon.bg }}>
                            {icon.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">{event.description}</p>
                            {event.user && <p className="text-xs text-muted-foreground">by {event.user.name}</p>}
                            {event.createdAt && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {new Date(event.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Reschedule Dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reschedule Activity</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>New Date <span className="text-destructive">*</span></Label><Input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} /></div>
            <div><Label>Time</Label><Input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancel</Button>
            <Button onClick={handleReschedule} disabled={!rescheduleDate || updateActivity.isPending}>Reschedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Activity Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Activity</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                  <SelectItem value="No Response">No Response</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>New Notes (appended to history)</Label><Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Add notes..." rows={4} /></div>
            <div><Label>Follow-up Date</Label><Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} /></div>
            {editDate && <div><Label>Follow-up Time</Label><Input type="time" value={editTime} onChange={e => setEditTime(e.target.value)} /></div>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updateActivity.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
