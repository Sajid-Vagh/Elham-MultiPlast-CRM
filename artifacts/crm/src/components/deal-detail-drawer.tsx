import { useState } from "react";
import type { Deal } from "@workspace/api-client-react";
import {
  useGetDeal, useListActivities, useUpdateDeal, useListDealProducts,
  getGetDealQueryKey, getListActivitiesQueryKey, getListDealProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { STAGE_PROBS, STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { onDealChange } from "@/lib/query-invalidation";
import { Pencil, ExternalLink, X } from "lucide-react";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { parseNotesText } from "@/lib/parse-notes";
import { Link } from "wouter";

const PI_STATUS_COLORS: Record<string, string> = {
  "No PI": "bg-gray-100 text-gray-500",
  "Draft": "bg-slate-100 text-slate-600",
  "Sent": "bg-blue-100 text-blue-600",
  "Viewed": "bg-cyan-100 text-cyan-600",
  "Approved": "bg-green-100 text-green-600",
  "Rejected": "bg-red-100 text-red-600",
  "Expired": "bg-yellow-100 text-yellow-600",
  "Converted to Order": "bg-purple-100 text-purple-600",
  "Converted to Production": "bg-purple-100 text-purple-600",
};

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

  // Sub-dialogs
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const invalidateAllDeal = () => onDealChange(queryClient, dealId!, deal?.contact?.id);

  const openEdit = () => {
    setEditTitle(deal?.title || "");
    setEditValue(deal?.totalValue ? String(deal.totalValue) : "");
    setEditNotes(parseNotesText(deal?.notes) || "");
    setEditOpen(true);
  };

  const handleEditSave = () => {
    updateDeal.mutate(
      { id: dealId!, data: { title: editTitle || null, totalValue: editValue ? Number(editValue) : null, notes: editNotes || null } },
      { onSuccess: () => { toast({ title: "Deal updated" }); setEditOpen(false); invalidateAllDeal(); }, onError: () => toast({ title: "Error updating deal", variant: "destructive" }) },
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
                  <Badge variant="outline" className="font-mono text-xs">Deal #{deal.id}</Badge>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${stageColor}`}>{deal.stage}</span>
                  <span className="text-xs text-muted-foreground">Probability: {STAGE_PROBS[deal.stage] ?? deal.probability}%</span>
                  <Badge variant="outline" className={`text-xs ${PI_STATUS_COLORS[(deal as any).activeProformaInvoice?.status || "No PI"] || PI_STATUS_COLORS["No PI"]}`}>
                    PI: {(deal as any).activeProformaInvoice?.status || "No PI"}
                    {(deal as any).activeProformaInvoice?.version > 1 ? ` v${(deal as any).activeProformaInvoice.version}` : ""}
                  </Badge>
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={openEdit}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit Deal</Button>
                  {contact && <Link href={`/leads/${contact.id}`}><Button size="sm" variant="default" className="bg-primary text-white hover:bg-primary/90"><ExternalLink className="h-3.5 w-3.5 mr-1" /> View Full Lead</Button></Link>}
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
                    <div><span className="text-muted-foreground">Unit</span><p className="font-medium">{contact?.unit || PENDING_UNIT_ASSIGNMENT}</p></div>
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
                    {deal.notes && <div className="col-span-2"><span className="text-muted-foreground">Notes</span><p className="font-medium whitespace-pre-wrap">{parseNotesText(deal.notes)}</p></div>}
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
                              {act.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{parseNotesText(act.notes)}</p>}
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
                            {act.notes && <p className="text-xs text-muted-foreground truncate">{parseNotesText(act.notes)}</p>}
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
          <DialogHeader>
            <DialogTitle>Edit Deal</DialogTitle>
            <DialogDescription>Update the deal details below.</DialogDescription>
          </DialogHeader>
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
    </>
  );
}
