import { useState, useRef } from "react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import {
  useGetDeal, useListActivities, useCreateActivity, useUpdateDeal, useListDealProducts,
  getGetDealQueryKey, getListActivitiesQueryKey, getListDealProductsQueryKey, getListDealsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DEAL_STAGES, STAGE_PROBS, STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { onDealChange, onActivityChange } from "@/lib/query-invalidation";
import { Pencil, Phone, Calendar, ExternalLink, Clock, CheckCircle2, X, MessageSquare } from "lucide-react";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { Link } from "wouter";

const ACT_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  "Call":     { bg: "#dcfce7", fg: "#15803d", icon: "📞" },
  "WhatsApp": { bg: "#ccfbf1", fg: "#0f766e", icon: "💬" },
  "Email":    { bg: "#dbeafe", fg: "#1d4ed8", icon: "✉️" },
  "Note":     { bg: "#fef9c3", fg: "#a16207", icon: "📝" },
  "FollowUp": { bg: "#ffedd5", fg: "#c2410c", icon: "🔔" },
  "Meeting":  { bg: "#ede9fe", fg: "#6d28d9", icon: "🤝" },
};

interface DealDetailDrawerProps {
  dealId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function DealDetailDrawer({ dealId, open, onClose }: DealDetailDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const enabled = !!dealId;

  const { data: deal, isLoading } = useGetDeal(dealId!, { query: { enabled, queryKey: getGetDealQueryKey(dealId!) } });
  const { data: activities } = useListActivities({ dealId: dealId! }, { query: { enabled, queryKey: getListActivitiesQueryKey({ dealId: dealId! }) } });
  const { data: dealProducts } = useListDealProducts(dealId!, { query: { enabled, queryKey: getListDealProductsQueryKey(dealId!) } });

  const updateDeal = useUpdateDeal();
  const createActivity = useCreateActivity();

  // Sub-dialogs
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [activityOpen, setActivityOpen] = useState(false);
  const [actType, setActType] = useState("Call");
  const [actNotes, setActNotes] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [actFollowUpTime, setActFollowUpTime] = useState("");

  const [stageOpen, setStageOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState("");

  const [wonConfirmOpen, setWonConfirmOpen] = useState(false);
  const [wonOpen, setWonOpen] = useState(false);
  const [wonAmount, setWonAmount] = useState("");
  const [wonSubmitting, setWonSubmitting] = useState(false);

  const [lostOpen, setLostOpen] = useState(false);
  const [lostSubmitting, setLostSubmitting] = useState(false);

  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [fuNotes, setFuNotes] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuTime, setFuTime] = useState("");
  const [fuType, setFuType] = useState("Call");

  const invalidateAllDeal = () => onDealChange(queryClient, dealId!, deal?.contact?.id);
  const invalidateAllActivity = () => onActivityChange(queryClient, dealId!, deal?.contact?.id);

  const openEdit = () => {
    setEditTitle(deal?.title || "");
    setEditValue(deal?.totalValue ? String(deal.totalValue) : "");
    setEditNotes(deal?.notes || "");
    setEditOpen(true);
  };

  const handleEditSave = () => {
    updateDeal.mutate(
      { id: dealId!, data: { title: editTitle || null, totalValue: editValue ? Number(editValue) : null, notes: editNotes || null } },
      { onSuccess: () => { toast({ title: "Deal updated" }); setEditOpen(false); invalidateAllDeal(); }, onError: () => toast({ title: "Error updating deal", variant: "destructive" }) },
    );
  };

  const handleLogActivity = () => {
    createActivity.mutate(
      { data: { dealId: dealId!, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpTime: actFollowUpTime || null } },
      { onSuccess: () => { toast({ title: "Activity logged" }); setActivityOpen(false); setActNotes(""); setActFollowUp(""); setActFollowUpTime(""); invalidateAllActivity(); }, onError: () => toast({ title: "Error logging activity", variant: "destructive" }) },
    );
  };

  const handleStageChange = () => {
    if (!selectedStage || selectedStage === deal?.stage) { setStageOpen(false); return; }
    if (selectedStage === "Won") { setStageOpen(false); setWonAmount(""); setWonOpen(true); return; }
    if (selectedStage === "Lost") { setStageOpen(false); setLostOpen(true); return; }
    updateDeal.mutate(
      { id: dealId!, data: { stage: selectedStage as DealStage } },
      { onSuccess: () => { toast({ title: `Deal moved to ${selectedStage}` }); setStageOpen(false); invalidateAllDeal(); }, onError: () => toast({ title: "Error changing stage", variant: "destructive" }) },
    );
  };

  const handleWonSave = () => {
    const amount = Number(wonAmount);
    if (!wonAmount || isNaN(amount) || amount <= 0) {
      toast({ title: "Validation Error", description: "Amount must be greater than 0", variant: "destructive" });
      return;
    }
    setWonSubmitting(true);
    updateDeal.mutate(
      { id: dealId!, data: { stage: "Won" as DealStage, wonAmount: amount } },
      { onSuccess: () => { setWonSubmitting(false); setWonOpen(false); toast({ title: "Deal marked as Won" }); invalidateAllDeal(); }, onError: (err: any) => { setWonSubmitting(false); toast({ title: "Error", description: err?.data?.error || err?.message || "Failed", variant: "destructive" }); } },
    );
  };

  const handleLostSave = (data: { lostReason: string; otherReason: string; lostNotes: string }) => {
    setLostSubmitting(true);
    updateDeal.mutate(
      { id: dealId!, data: { stage: "Lost" as DealStage, lostReason: data.lostReason, otherReason: data.otherReason, lostNotes: data.lostNotes } as any },
      { onSuccess: () => { setLostSubmitting(false); setLostOpen(false); toast({ title: "Deal marked as Lost" }); invalidateAllDeal(); }, onError: (err: any) => { setLostSubmitting(false); toast({ title: "Error", description: err?.data?.error || err?.message || "Failed", variant: "destructive" }); } },
    );
  };

  const handleFollowUpSave = () => {
    if (!fuNotes.trim()) { toast({ title: "Validation Error", description: "Follow-up notes are required", variant: "destructive" }); return; }
    if (!fuDate) { toast({ title: "Validation Error", description: "Follow-up date is required", variant: "destructive" }); return; }
    createActivity.mutate(
      { data: { dealId: dealId!, type: "FollowUp" as any, notes: fuNotes.trim(), followUpDate: fuDate, followUpTime: fuTime || null, followUpType: fuType } },
      { onSuccess: () => { toast({ title: "Follow-up scheduled" }); setFollowUpOpen(false); setFuNotes(""); setFuDate(""); setFuTime(""); setFuType("Call"); invalidateAllActivity(); }, onError: () => toast({ title: "Error scheduling follow-up", variant: "destructive" }) },
    );
  };

  if (!open) return null;

  const contact = deal?.contact;
  const owner = deal?.salesOwner;
  const sortedActivities = activities ? [...activities].reverse() : [];
  const followUps = sortedActivities.filter(a => a.followUpDate);
  const stageColor = STAGE_BADGE_COLORS[deal?.stage || ""] || "bg-gray-100";

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="sm:max-w-xl w-full p-0 overflow-y-auto">
          {isLoading || !deal ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold truncate">{contact?.name || deal.title || `Deal #${deal.id}`}</h2>
                  {contact?.companyName && <p className="text-sm text-muted-foreground truncate">{contact.companyName}</p>}
                </div>
                <button onClick={onClose} className="ml-4 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                {/* Stage Badge + Probability */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${stageColor}`}>{deal.stage}</span>
                  <span className="text-xs text-muted-foreground">Probability: {STAGE_PROBS[deal.stage] ?? deal.probability}%</span>
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={openEdit}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit Deal</Button>
                  <Button size="sm" variant="outline" onClick={() => { setActType("Call"); setActivityOpen(true); }}><Phone className="h-3.5 w-3.5 mr-1" /> Log Activity</Button>
                  <Button size="sm" variant="outline" onClick={() => { setActType("FollowUp"); setActivityOpen(true); }}><Calendar className="h-3.5 w-3.5 mr-1" /> Schedule</Button>
                  <Button size="sm" variant="outline" onClick={() => { setSelectedStage(deal.stage); setStageOpen(true); }}><Clock className="h-3.5 w-3.5 mr-1" /> Stage</Button>
                  {deal.stage !== "Won" && <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" onClick={() => { setWonAmount(""); setWonConfirmOpen(true); }}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Won</Button>}
                  {deal.stage !== "Lost" && <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50" onClick={() => setLostOpen(true)}><X className="h-3.5 w-3.5 mr-1" /> Lost</Button>}
                  <Button size="sm" variant="outline" onClick={() => { setFuNotes(""); setFuDate(""); setFuTime(""); setFuType("Call"); setFollowUpOpen(true); }}><Calendar className="h-3.5 w-3.5 mr-1" /> Follow-up</Button>
                  {contact && <Link href={`/leads/${contact.id}`}><Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5 mr-1" /> View Lead</Button></Link>}
                </div>

                {/* Contact Info */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Contact</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {contact?.name && <div><span className="text-muted-foreground">Name</span><p className="font-medium">{contact.name}</p></div>}
                    {contact?.companyName && <div><span className="text-muted-foreground">Company</span><p className="font-medium">{contact.companyName}</p></div>}
                    {contact?.mobile && <div><span className="text-muted-foreground">Mobile</span><p className="font-medium">{contact.mobile}</p></div>}
                    {contact?.email && <div><span className="text-muted-foreground">Email</span><p className="font-medium truncate">{contact.email}</p></div>}
                    {contact?.city && <div><span className="text-muted-foreground">City</span><p className="font-medium">{contact.city}</p></div>}
                    {contact?.unit && <div><span className="text-muted-foreground">Unit</span><p className="font-medium">{contact.unit}</p></div>}
                  </div>
                </div>

                {/* Deal Info */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Deal</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {owner && <div><span className="text-muted-foreground">Sales Person</span><p className="font-medium">{owner.name}</p></div>}
                    {deal.totalValue != null && <div><span className="text-muted-foreground">Amount</span><p className="font-medium">₹{Number(deal.totalValue).toLocaleString()}</p></div>}
                    {deal.wonAmount != null && <div><span className="text-muted-foreground">Won Amount</span><p className="font-medium text-green-700">₹{Number(deal.wonAmount).toLocaleString()}</p></div>}
                    {deal.lostReason && <div className="col-span-2"><span className="text-muted-foreground">Lost Reason</span><p className="font-medium text-red-700">{deal.lostReason}</p></div>}
                    {deal.notes && <div className="col-span-2"><span className="text-muted-foreground">Notes</span><p className="font-medium whitespace-pre-wrap">{deal.notes}</p></div>}
                    <div><span className="text-muted-foreground">Created</span><p className="font-medium">{new Date(deal.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p></div>
                    {deal.updatedAt && <div><span className="text-muted-foreground">Updated</span><p className="font-medium">{new Date(deal.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p></div>}
                  </div>
                </div>

                {/* Products */}
                {dealProducts && dealProducts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Products</h3>
                    <div className="space-y-2">
                      {dealProducts.map(dp => (
                        <div key={dp.id} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded-lg">
                          <span className="font-medium">{dp.product?.name || `Product #${dp.productId}`}</span>
                          <span className="text-muted-foreground">Qty: {dp.quantity}{dp.unitPrice ? ` · ₹${Number(dp.unitPrice).toLocaleString()}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activity Timeline */}
                <div>
                  <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Activity Timeline</h3>
                  {sortedActivities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activities yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {sortedActivities.slice(0, 20).map(act => {
                        const style = ACT_STYLE[act.type] || { bg: "#f3f4f6", fg: "#374151", icon: "•" };
                        const isCompleted = act.callStatus === "Completed";
                        return (
                          <div key={act.id} className="flex gap-2 p-2 rounded-lg bg-card border text-sm">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0" style={{ backgroundColor: style.bg }}>{style.icon}</div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.fg }}>{act.type}</span>
                                {isCompleted && <span className="text-xs text-green-700">✓ Completed</span>}
                                <span className="text-xs text-muted-foreground ml-auto">{new Date(act.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                              </div>
                              {act.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{act.notes}</p>}
                              {act.followUpDate && <p className="text-xs text-primary mt-0.5">Follow-up: {act.followUpDate}{act.followUpTime ? ` ${act.followUpTime}` : ""}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Follow-up History */}
                {followUps.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Follow-up History</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {followUps.slice(0, 10).map(act => (
                        <div key={act.id} className="flex items-center gap-2 p-2 rounded-lg bg-card border text-sm">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${act.callStatus === "Completed" ? "bg-green-500" : "bg-amber-500"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">{act.followUpDate}{act.followUpTime ? ` ${act.followUpTime}` : ""} via {act.followUpType || act.type}</p>
                            {act.notes && <p className="text-xs text-muted-foreground truncate">{act.notes}</p>}
                          </div>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${act.callStatus === "Completed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                            {act.callStatus || "Pending"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Edit Deal Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Deal</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Title</Label><Input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Deal title" /></div>
            <div><Label>Total Value (₹)</Label><Input type="number" value={editValue} onChange={e => setEditValue(e.target.value)} placeholder="0" /></div>
            <div><Label>Notes</Label><Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updateDeal.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Activity Dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Type</Label>
              <Select value={actType} onValueChange={setActType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Call","WhatsApp","Email","Note","FollowUp","Meeting"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={actNotes} onChange={e => setActNotes(e.target.value)} placeholder="Notes from this interaction..." /></div>
            <div><Label>Follow-up Date</Label><Input type="date" value={actFollowUp} onChange={e => setActFollowUp(e.target.value)} /></div>
            {actFollowUp && <div><Label>Follow-up Time</Label><Input type="time" value={actFollowUpTime} onChange={e => setActFollowUpTime(e.target.value)} /></div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivityOpen(false)}>Cancel</Button>
            <Button onClick={handleLogActivity} disabled={createActivity.isPending}>Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Stage Dialog */}
      <Dialog open={stageOpen} onOpenChange={setStageOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change Stage</DialogTitle></DialogHeader>
          <div className="py-4">
            <Label>New Stage</Label>
            <Select value={selectedStage} onValueChange={setSelectedStage}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s} value={s}>{s} ({STAGE_PROBS[s]}%)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageOpen(false)}>Cancel</Button>
            <Button onClick={handleStageChange} disabled={!selectedStage || selectedStage === deal?.stage}>Change</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Won Dialog */}
      <Dialog open={wonConfirmOpen} onOpenChange={setWonConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deal Won</DialogTitle>
            <DialogDescription>Are you sure you want to convert this deal into a client?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWonConfirmOpen(false)}>No</Button>
            <Button onClick={() => { setWonConfirmOpen(false); setWonOpen(true); }}>Yes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Won Dialog */}
      <Dialog open={wonOpen} onOpenChange={setWonOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark as Won</DialogTitle><DialogDescription>Enter the won amount to proceed.</DialogDescription></DialogHeader>
          <div className="py-4">
            <Label>Won Amount (₹) *</Label>
            <Input type="number" min="0" step="0.01" value={wonAmount} onChange={e => setWonAmount(e.target.value)} placeholder="Enter amount" className="mt-1" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWonOpen(false)} disabled={wonSubmitting}>Cancel</Button>
            <Button onClick={handleWonSave} disabled={wonSubmitting || !wonAmount || Number(wonAmount) <= 0}>{wonSubmitting ? "Saving..." : "Confirm Won"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarkLostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        onSave={handleLostSave}
        saving={lostSubmitting}
      />

      {/* Regular Follow-up Dialog */}
      <Dialog open={followUpOpen} onOpenChange={setFollowUpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Regular Follow-up</DialogTitle><DialogDescription>Schedule a follow-up for this deal.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Follow-up Notes <span className="text-destructive">*</span></Label>
              <Textarea className="mt-1" placeholder="e.g. Waiting for client reply, Client asked to call next week..." value={fuNotes} onChange={e => setFuNotes(e.target.value)} />
            </div>
            <div>
              <Label>Next Follow-up Date <span className="text-destructive">*</span></Label>
              <Input type="date" className="mt-1" value={fuDate} onChange={e => setFuDate(e.target.value)} />
            </div>
            <div>
              <Label>Follow-up Time</Label>
              <Input type="time" className="mt-1" value={fuTime} onChange={e => setFuTime(e.target.value)} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={fuType} onValueChange={setFuType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["Call", "WhatsApp", "Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpOpen(false)} disabled={createActivity.isPending}>Cancel</Button>
            <Button onClick={handleFollowUpSave} disabled={createActivity.isPending || !fuNotes.trim() || !fuDate}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
