import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Clock, Package, Truck, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useListContacts, getListContactsQueryKey } from "@workspace/api-client-react";

const STATUS_OPTIONS = ["Draft", "Pending Verification", "Confirmed", "Production Pending", "Production Started", "Production Running", "Quality Check", "Ready for Dispatch", "Partially Dispatched", "Dispatched", "Delivered", "Completed", "Cancelled"];
const SOURCE_OPTIONS = ["New Lead", "Existing Customer", "Repeat Order", "Walk-In Customer", "Factory Visit", "Direct Call", "WhatsApp", "Email", "Referral", "Website", "Exhibition", "Sales Visit", "Support Follow-up"];
const CUSTOMER_TYPE_OPTIONS = ["New Customer", "Existing Customer", "Repeat Customer", "Dealer", "Distributor", "Export Customer", "Walk-In Customer"];

export default function OrderCreate() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: contacts } = useListContacts({}, { query: { staleTime: 60000, queryKey: getListContactsQueryKey({}) } });

  const [form, setForm] = useState({
    contactId: "",
    customerName: "",
    companyName: "",
    mobile: "",
    email: "",
    gstNumber: "",
    address: "",
    city: "",
    state: "",
    source: "New Lead",
    customerType: "New Customer",
    paymentTerms: "",
    deliveryTerms: "",
    expectedDeliveryDate: "",
    dispatchAddress: "",
    transportDetails: "",
    remarks: "",
  });

  const [items, setItems] = useState<any[]>([{ productName: "", productCode: "", quantity: "", rate: "", gstPercent: "0", bottleType: "", bottleWeight: "", capColour: "", colour: "", capacity: "" }]);

  const handleContactSelect = (contactId: string) => {
    const contact = contacts?.find((c: any) => c.id === Number(contactId));
    if (contact) {
      setForm(f => ({
        ...f,
        contactId: String(contact.id),
        customerName: contact.name,
        companyName: contact.companyName || "",
        mobile: contact.mobile || "",
        email: contact.email || "",
        address: contact.address || "",
        city: contact.city || "",
      }));
    }
  };

  const addItem = () => setItems([...items, { productName: "", productCode: "", quantity: "", rate: "", gstPercent: "0", bottleType: "", bottleWeight: "", capColour: "", colour: "", capacity: "" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: string) => {
    const newItems = [...items];
    newItems[i] = { ...newItems[i], [field]: value };
    setItems(newItems);
  };

  const totalAmount = items.reduce((sum, i) => sum + (Number(i.quantity || 0) * Number(i.rate || 0)), 0);
  const totalGst = items.reduce((sum, i) => { const amt = Number(i.quantity || 0) * Number(i.rate || 0); return sum + amt * Number(i.gstPercent || 0) / 100; }, 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({
          ...form,
          contactId: Number(form.contactId),
          items: items.filter(i => i.productName).map(i => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate), gstPercent: Number(i.gstPercent) })),
        }),
      });
      if (!res.ok) throw new Error("Failed to create order");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast({ title: "Order created", description: data.orderNumber });
      setLocation(`/orders/${data.id}`);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-2xl font-bold">Create Order</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Customer Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Select Existing Customer</Label>
              <Select onValueChange={handleContactSelect}>
                <SelectTrigger><SelectValue placeholder="Choose customer..." /></SelectTrigger>
                <SelectContent>
                  {contacts?.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.companyName || c.mobile})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Customer Name *</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} required /></div>
            <div><Label>Company Name</Label><Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>GST Number</Label><Input value={form.gstNumber} onChange={e => setForm(f => ({ ...f, gstNumber: e.target.value }))} /></div>
            <div>
              <Label>Source *</Label>
              <Select value={form.source} onValueChange={v => setForm(f => ({ ...f, source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>City</Label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
            <div><Label>State</Label><Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} /></div>
            <div>
              <Label>Customer Type</Label>
              <Select value={form.customerType} onValueChange={v => setForm(f => ({ ...f, customerType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CUSTOMER_TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Address</Label><Textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Order Items</CardTitle>
          <Button size="sm" variant="outline" onClick={addItem}>+ Add Item</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_100px_100px_80px_auto] gap-2 items-end">
              <div><Label className="text-xs">Product Name *</Label><Input value={item.productName} onChange={e => updateItem(i, "productName", e.target.value)} placeholder="e.g. Mahavir 1L" /></div>
              <div><Label className="text-xs">Quantity *</Label><Input type="number" value={item.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} /></div>
              <div><Label className="text-xs">Rate *</Label><Input type="number" value={item.rate} onChange={e => updateItem(i, "rate", e.target.value)} /></div>
              <div><Label className="text-xs">GST %</Label><Input type="number" value={item.gstPercent} onChange={e => updateItem(i, "gstPercent", e.target.value)} /></div>
              <div><Label className="text-xs">Bottle Type</Label><Input value={item.bottleType} onChange={e => updateItem(i, "bottleType", e.target.value)} /></div>
              <div className="pb-0.5">
                {items.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeItem(i)}>×</Button>}
              </div>
            </div>
          ))}
          <div className="text-right space-y-1 pt-3 border-t">
            <p className="text-sm">Total Amount: <span className="font-semibold">₹{totalAmount.toLocaleString("en-IN")}</span></p>
            <p className="text-sm">GST: <span className="font-semibold">₹{totalGst.toLocaleString("en-IN")}</span></p>
            <p className="text-base font-bold">Grand Total: ₹{(totalAmount + totalGst).toLocaleString("en-IN")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Delivery & Payment</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Payment Terms</Label><Textarea value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} rows={2} /></div>
            <div><Label>Delivery Terms</Label><Textarea value={form.deliveryTerms} onChange={e => setForm(f => ({ ...f, deliveryTerms: e.target.value }))} rows={2} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Expected Delivery Date</Label><Input type="date" value={form.expectedDeliveryDate} onChange={e => setForm(f => ({ ...f, expectedDeliveryDate: e.target.value }))} /></div>
            <div><Label>Transport Details</Label><Input value={form.transportDetails} onChange={e => setForm(f => ({ ...f, transportDetails: e.target.value }))} /></div>
          </div>
          <div><Label>Remarks</Label><Textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} rows={2} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => setLocation("/orders")}>Cancel</Button>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.customerName || items.every(i => !i.productName)}>
          <Save className="h-4 w-4 mr-2" />{createMutation.isPending ? "Creating..." : "Create Order"}
        </Button>
      </div>
    </div>
  );
}
