import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetContact, useListDeals, useListActivities, useCreateDeal, useCreateActivity,
  useUpdateContact, useListUsers, getListDealsQueryKey, getListActivitiesQueryKey,
  getGetContactQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Phone, Mail, Building, MapPin, Tag, Plus, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const STAGE_COLORS: Record<string, string> = {
  "New": "bg-slate-100 text-slate-700",
  "CL Sent": "bg-blue-100 text-blue-700",
  "Price Given": "bg-yellow-100 text-yellow-700",
  "Samples Sent": "bg-orange-100 text-orange-700",
  "Samples Received": "bg-purple-100 text-purple-700",
  "PI Sent": "bg-indigo-100 text-indigo-700",
  "Won": "bg-green-100 text-green-700",
  "Lost": "bg-red-100 text-red-700",
};

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const contactId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contact, isLoading } = useGetContact(contactId, { query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId) } });
  const { data: deals } = useListDeals({ contactId: contactId });
  const { data: activities } = useListActivities({ contactId: contactId });
  const { data: users } = useListUsers();

  const createDeal = useCreateDeal();
  const createActivity = useCreateActivity();

  const [newDealStage, setNewDealStage] = useState("New");
  const [newDealTitle, setNewDealTitle] = useState("");
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const [actType, setActType] = useState("Call");
  const [actNotes, setActNotes] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [actFollowType, setActFollowType] = useState("Call");
  const [actDealId, setActDealId] = useState("");
  const [actDialogOpen, setActDialogOpen] = useState(false);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!contact) return <div className="p-8">Contact not found.</div>;

  const owner = contact.salesOwner;

  const handleCreateDeal = () => {
    if (!newDealStage) return;
    createDeal.mutate({ data: { contactId, stage: newDealStage as any, title: newDealTitle || null, salesOwnerId: contact.salesOwnerId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey({ contactId }) });
        toast({ title: "Deal created" });
        setDealDialogOpen(false);
        setNewDealTitle("");
      },
      onError: () => toast({ title: "Error creating deal", variant: "destructive" }),
    });
  };

  const handleCreateActivity = () => {
    if (!actDealId) { toast({ title: "Select a deal", variant: "destructive" }); return; }
    createActivity.mutate({ data: { dealId: Number(actDealId), contactId, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpType: actFollowType || null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ contactId }) });
        toast({ title: "Activity logged" });
        setActDialogOpen(false);
        setActNotes(""); setActFollowUp("");
      },
      onError: () => toast({ title: "Error logging activity", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/leads"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {owner && <div className="w-4 h-4 rounded-full" style={{ backgroundColor: owner.colorCode }} />}
            <h1 className="text-2xl font-bold">{contact.name}</h1>
            {contact.tags && <Badge variant="outline">{contact.tags}</Badge>}
          </div>
          {contact.companyName && <p className="text-muted-foreground">{contact.companyName}</p>}
        </div>
        <Link href={`/leads/${contactId}/edit`}><Button variant="outline" size="sm">Edit</Button></Link>
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
              {contact.city && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /><span>{contact.city}</span></div>}
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
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
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
              {deals?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded-md bg-card">No deals yet.</p>}
              {deals?.map(deal => (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <div className="flex items-center justify-between p-3 border rounded-md bg-card hover:bg-accent transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-sm">{deal.title || `Deal #${deal.id}`}</p>
                      <p className="text-xs text-muted-foreground">{new Date(deal.createdAt).toLocaleDateString()}</p>
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

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Activity Log</h2>
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
            <div className="space-y-2">
              {activities?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded-md bg-card">No activities yet.</p>}
              {activities?.slice().reverse().map(act => (
                <div key={act.id} className="flex gap-3 p-3 border rounded-md bg-card text-sm">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{act.type}</span>
                      <span className="text-xs text-muted-foreground">{new Date(act.createdAt).toLocaleDateString()}</span>
                    </div>
                    {act.notes && <p className="text-muted-foreground mt-1">{act.notes}</p>}
                    {act.followUpDate && <p className="text-xs text-primary mt-1">Follow-up: {act.followUpDate} via {act.followUpType}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
