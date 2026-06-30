import { useState, useMemo } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetContact, useListDeals, useListActivities, useCreateDeal, useCreateActivity,
  useUpdateContact, useDeleteContact, useListUsers,
  getListDealsQueryKey, getListActivitiesQueryKey, getGetContactQueryKey, getListContactsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Phone, Mail, MapPin, Tag, Plus, Trash2, FolderTree, RefreshCw, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CategoryBadge } from "@/components/category-badge";
import { MoveCategoryDialog } from "@/components/move-category-dialog";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";

const STAGE_COLORS: Record<string, string> = {
  "New": "bg-slate-100 text-slate-700", "CL Sent": "bg-blue-100 text-blue-700",
  "Price Given": "bg-yellow-100 text-yellow-700", "Samples Sent": "bg-orange-100 text-orange-700",
  "Samples Received": "bg-purple-100 text-purple-700", "PI Sent": "bg-indigo-100 text-indigo-700",
  "Won": "bg-green-100 text-green-700", "Lost": "bg-red-100 text-red-700",
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

  const createDeal = useCreateDeal();
  const createActivity = useCreateActivity();
  const deleteContact = useDeleteContact();
  const updateContact = useUpdateContact();

  const [newDealStage, setNewDealStage] = useState("New");
  const [newDealTitle, setNewDealTitle] = useState("");
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

  const filteredActivities = useMemo(() => {
    if (!activities) return [];
    let list = [...activities].reverse();
    if (actFromDate) list = list.filter(a => a.createdAt.slice(0, 10) >= actFromDate);
    if (actToDate)   list = list.filter(a => a.createdAt.slice(0, 10) <= actToDate);
    return list;
  }, [activities, actFromDate, actToDate]);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!contact) return <div className="p-8">Contact not found.</div>;

  const owner = contact.salesOwner;

  const handleCreateDeal = () => {
    if (!newDealStage) return;
    createDeal.mutate({ data: { contactId, stage: newDealStage as any, title: newDealTitle || null, salesOwnerId: contact.salesOwnerId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey({ contactId }) });
        toast({ title: "Deal created" });
        setDealDialogOpen(false); setNewDealTitle("");
      },
      onError: () => toast({ title: "Error creating deal", variant: "destructive" }),
    });
  };

  const handleCreateActivity = () => {
    if (!actDealId) { toast({ title: "Select a deal", variant: "destructive" }); return; }
    const payload = { dealId: Number(actDealId), contactId, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpTime: actFollowUpTime || null, followUpType: actFollowType || null };
    console.log("[DEBUG] lead-detail handleCreateActivity payload:", JSON.stringify(payload));
    createActivity.mutate({ data: payload }, {
      onSuccess: (result) => {
        console.log("[DEBUG] lead-detail handleCreateActivity success:", JSON.stringify({ id: result?.id, type: result?.type, followUpDate: result?.followUpDate, createdBy: result?.createdBy }));
        queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ contactId }) });
        queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
        toast({ title: "Activity logged" });
        setActDialogOpen(false); setActNotes(""); setActFollowUp(""); setActFollowUpTime("");
      },
      onError: (e) => {
        console.log("[DEBUG] lead-detail handleCreateActivity error:", e);
        toast({ title: "Error logging activity", variant: "destructive" });
      },
    });
  };

  const handleDelete = () => {
    deleteContact.mutate({ id: contactId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["category-counts"] });
        queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
        toast({ title: `"${contact.name}" deleted` });
        setLocation("/leads");
      },
      onError: () => toast({ title: "Failed to delete lead", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/leads"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {owner && <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: owner.colorCode }} />}
            <h1 className="text-2xl font-bold">{contact.name}</h1>
            {contact.tags && <Badge variant="outline">{contact.tags}</Badge>}
            <CategoryBadge category={contact.category} />
          </div>
          {contact.companyName && <p className="text-muted-foreground">{contact.companyName}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowMoveCategory(true)}>
          <FolderTree className="h-4 w-4 mr-1" /> Move
        </Button>
        <Link href={`/leads/${contactId}/edit`}><Button variant="outline" size="sm">Edit</Button></Link>
        <Button
          variant="outline" size="sm"
          className="text-destructive border-destructive/40 hover:bg-destructive/10"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact Info</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><span>{contact.mobile}</span></div>
              {contact.otherPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><span>{contact.otherPhone}</span></div>}
              {contact.email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><span>{contact.email}</span></div>}
              {contact.otherEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><span>{contact.otherEmail}</span></div>}
              {contact.city && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span>{contact.city}{contact.state ? `, ${contact.state}` : ""}</span></div>}
              {contact.address && <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5" /><span className="text-xs text-muted-foreground">{contact.address}</span></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Classification</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {owner && <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: owner.colorCode }} /><span>{owner.name}</span></div>}
              {contact.industry && <div className="flex items-center gap-2"><Tag className="h-4 w-4 text-muted-foreground" /><span>{contact.industry}</span></div>}
              {contact.unit && <div><span className="text-muted-foreground">Unit: </span>{contact.unit}</div>}
              {contact.leadSource && <div><span className="text-muted-foreground">Source: </span>{contact.leadSource}</div>}
              {contact.inquiryDate && <div><span className="text-muted-foreground">Inquiry: </span>{contact.inquiryDate}</div>}
              {contact.lastCallDate && <div><span className="text-muted-foreground">Last Call: </span>{contact.lastCallDate}</div>}
              {contact.nextCallDate && <div className="font-medium text-primary"><span>Next Call: </span>{contact.nextCallDate}</div>}
              {contact.category && contact.category !== "Regular Follow up" && contact.category !== "My Client" && (
                <div className="border-t pt-3 mt-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Re-activation</p>
                  <div className="flex flex-col gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="justify-start h-8 text-xs"
                      onClick={() => {
                        updateContact.mutate({ id: contactId, data: { category: "Regular Follow up" as any } }, {
                          onSuccess: () => {
                            queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
                            queryClient.invalidateQueries({ queryKey: ["category-counts"] });
                            queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
                            toast({ title: "Moved to Regular Follow up" });
                          },
                          onError: () => toast({ title: "Error updating category", variant: "destructive" }),
                        });
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      Move to Regular Follow up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="justify-start h-8 text-xs"
                      onClick={() => {
                        updateContact.mutate({ id: contactId, data: { category: "My Client" as any } }, {
                          onSuccess: () => {
                            queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
                            queryClient.invalidateQueries({ queryKey: ["category-counts"] });
                            queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
                            toast({ title: "Moved to My Client" });
                          },
                          onError: () => toast({ title: "Error updating category", variant: "destructive" }),
                        });
                      }}
                    >
                      <Star className="h-3.5 w-3.5 mr-1.5" />
                      Mark as My Client
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {/* Deals */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Deals</h2>
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
                    <Button onClick={handleCreateDeal} disabled={createDeal.isPending} className="w-full">Create</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-2">
              {deals?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg bg-card">No deals yet.</p>}
              {deals?.map(deal => (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{deal.title || `Deal #${deal.id}`}</p>
                      <p className="text-xs text-muted-foreground">{new Date(deal.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {deal.totalValue && <span className="text-sm font-medium">₹{Number(deal.totalValue).toLocaleString()}</span>}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>{deal.stage}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Activity Log */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Activity Log</h2>
                {actQuick !== "all" && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {filteredActivities.length} shown
                  </span>
                )}
              </div>
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
                        <SelectContent>{["Call","WhatsApp","Email","Note","FollowUp"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Notes</Label><Textarea value={actNotes} onChange={e => setActNotes(e.target.value)} placeholder="Discussion notes..." /></div>
                    <div><Label>Follow-up Date</Label><Input type="date" value={actFollowUp} onChange={e => setActFollowUp(e.target.value)} /></div>
                    {actFollowUp && <div><Label>Follow-up Time</Label><Input type="time" value={actFollowUpTime} onChange={e => setActFollowUpTime(e.target.value)} /></div>}
                    <div><Label>Follow-up Type</Label>
                      <Select value={actFollowType} onValueChange={setActFollowType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["Call","WhatsApp","Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleCreateActivity} disabled={createActivity.isPending} className="w-full">Log</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

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
            </div>

            <div className="space-y-2">
              {filteredActivities.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6 border rounded-lg bg-card">
                  {actQuick !== "all" ? "No activities in this period." : "No activities yet."}
                </p>
              )}
              {filteredActivities.map(act => {
                const style = ACT_STYLE[act.type] || { bg: "#f3f4f6", fg: "#374151", icon: "•" };
                return (
                  <div key={act.id} className="flex gap-3 p-3 border rounded-lg bg-card text-sm">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base" style={{ backgroundColor: style.bg }}>
                      {style.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.fg }}>{act.type}</span>
                        <span className="text-xs text-muted-foreground">{new Date(act.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </div>
                      {(act as any).notesDisplay && <p className="text-muted-foreground mt-1.5 whitespace-pre-wrap">{(act as any).notesDisplay}</p>}
                      {!(act as any).notesDisplay && act.notes && <p className="text-muted-foreground mt-1.5">{act.notes}</p>}
                      {act.followUpDate && <p className="text-xs text-primary mt-1">Follow-up: {act.followUpDate} via {act.followUpType}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

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
      <MoveCategoryDialog
        open={showMoveCategory}
        onOpenChange={setShowMoveCategory}
        contactIds={[contactId]}
        currentCategory={contact.category}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) })}
      />
    </div>
  );
}
