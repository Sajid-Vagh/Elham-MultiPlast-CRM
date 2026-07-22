import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Phone, Mail, MapPin, Building, Calendar, Package, ShoppingCart, AlertTriangle } from "lucide-react";

export default function CustomerProfile() {
  const [, params] = useRoute("/customers/:id");
  const [, setLocation] = useLocation();
  const contactId = Number(params?.id);
  const invalidId = !contactId || isNaN(contactId);

  const { data: contact, isLoading: loadingContact } = useQuery({
    queryKey: ["contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      if (!res.ok) throw new Error("Failed to fetch customer");
      return res.json();
    },
    enabled: !invalidId,
  });

  const { data: comms = [] } = useQuery({
    queryKey: ["communications", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/communications`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !invalidId,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ["order-timeline", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/timeline`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !invalidId,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["contact-invoices", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/proforma-invoices`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !invalidId,
  });

  if (invalidId) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Invalid customer ID.</p>
        <Button variant="link" onClick={() => setLocation("/leads")}>
          Back to Leads
        </Button>
      </div>
    );
  }

  if (loadingContact) return <div className="p-6 text-center">Loading...</div>;
  if (!contact) return <div className="p-6 text-center">Customer not found</div>;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold">{contact.name}</h1>
          <p className="text-sm text-muted-foreground">{contact.companyName || "No company"}</p>
        </div>
        <Badge className="ml-auto">{contact.category}</Badge>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Phone className="h-3 w-3" />Mobile</div>
          <p className="font-medium">{contact.mobile}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Mail className="h-3 w-3" />Email</div>
          <p className="font-medium">{contact.email || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Building className="h-3 w-3" />Company</div>
          <p className="font-medium">{contact.companyName || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><MapPin className="h-3 w-3" />City</div>
          <p className="font-medium">{contact.city || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Calendar className="h-3 w-3" />Since</div>
          <p className="font-medium">{contact.customerSince || new Date(contact.createdAt).toLocaleDateString("en-IN")}</p>
        </Card>
      </div>

      {/* Business Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">{contact.totalOrders || 0}</p>
          <p className="text-xs text-muted-foreground">Total Orders</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">₹{Number(contact.totalRevenue || 0).toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted-foreground">Total Revenue</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">{invoices.length}</p>
          <p className="text-xs text-muted-foreground">Proforma Invoices</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">{comms.length}</p>
          <p className="text-xs text-muted-foreground">Communications</p>
        </Card>
      </div>

      {/* Ownership */}
      <Card>
        <CardHeader><CardTitle className="text-base">Assigned Team</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground">Sales Owner:</span> <span className="font-medium">{contact.salesOwner?.name || "-"}</span></div>
          <div><span className="text-muted-foreground">Support Owner:</span> <span className="font-medium">{contact.supportOwner?.name || "-"}</span></div>
          <div><span className="text-muted-foreground">Production Manager:</span> <span className="font-medium">{contact.productionManager?.name || "-"}</span></div>
        </CardContent>
      </Card>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="communication">Communication ({comms.length})</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card><CardContent className="text-center py-8 text-muted-foreground">
            <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Orders will appear here</p>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card><CardContent className="p-0">
            {invoices.length === 0 ? <p className="text-center py-8 text-muted-foreground">No invoices</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                <TableBody>
                  {invoices.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>₹{Number(inv.grandTotal).toLocaleString("en-IN")}</TableCell>
                      <TableCell><Badge>{inv.status}</Badge></TableCell>
                      <TableCell>{new Date(inv.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="communication">
          <Card><CardContent className="space-y-3 py-4">
            {comms.length === 0 ? <p className="text-center text-muted-foreground py-4">No communications logged</p> : comms.map((c: any) => (
              <div key={c.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{c.type}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-IN")}</span>
                </div>
                <p className="text-sm mt-1">{c.notes}</p>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card><CardContent className="space-y-3 py-4">
            {timeline.length === 0 ? <p className="text-center text-muted-foreground py-4">No timeline events</p> : timeline.slice(0, 20).map((event: any, i: number) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">{event.description}</p>
                  <p className="text-xs text-muted-foreground">{event.user?.name || "System"} - {new Date(event.createdAt).toLocaleString("en-IN")}</p>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
