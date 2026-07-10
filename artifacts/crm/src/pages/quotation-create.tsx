import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useListContacts, getListContactsQueryKey } from "@workspace/api-client-react";

export default function QuotationCreate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: contacts } = useListContacts({}, { query: { staleTime: 60000, queryKey: getListContactsQueryKey({}) } });

  const [form, setForm] = useState({ contactId: 0, customerName: "", companyName: "", mobile: "", email: "", gstNumber: "", address: "", city: "", state: "", paymentTerms: "", deliveryTerms: "", validityDays: "15", freight: "0", remarks: "" });
  const [items, setItems] = useState<any[]>([{ productName: "", quantity: "", rate: "", gstPercent: "0", bottleType: "" }]);

  const handleContactSelect = (contactId: string) => {
    const contact = contacts?.find((c: any) => c.id === Number(contactId));
    if (contact) setForm(f => ({ ...f, contactId: contact.id, customerName: contact.name, companyName: contact.companyName || "", mobile: contact.mobile || "", email: contact.email || "", address: contact.address || "", city: contact.city || "", state: contact.state || "" }));
  };

  const addItem = () => setItems([...items, { productName: "", quantity: "", rate: "", gstPercent: "0", bottleType: "" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: string) => { const n = [...items]; n[i] = { ...n[i], [field]: value }; setItems(n); };

  const totalAmount = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.rate || 0), 0);
  const totalGst = items.reduce((s, i) => { const a = Number(i.quantity || 0) * Number(i.rate || 0); return s + a * Number(i.gstPercent || 0) / 100; }, 0);
  const grandTotal = totalAmount + totalGst + Number(form.freight || 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ ...form, validityDays: Number(form.validityDays), freight: Number(form.freight), items: items.filter(i => i.productName).map(i => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate), gstPercent: Number(i.gstPercent) })) }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Quotation created", description: data.quotationNumber }); setLocation("/quotations"); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/quotations")}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-2xl font-bold">Create Quotation</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Customer Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><Label>Select Customer</Label><Select onValueChange={handleContactSelect}><SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger><SelectContent>{contacts?.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Customer Name *</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} /></div>
            <div><Label>Company</Label><Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>GST</Label><Input value={form.gstNumber} onChange={e => setForm(f => ({ ...f, gstNumber: e.target.value }))} /></div>
            <div><Label>Validity (Days)</Label><Input type="number" value={form.validityDays} onChange={e => setForm(f => ({ ...f, validityDays: e.target.value }))} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row justify-between items-center"><CardTitle>Items</CardTitle><Button size="sm" variant="outline" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button></CardHeader>
        <CardContent className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_100px_80px_auto] gap-2 items-end">
              <div><Label className="text-xs">Product *</Label><Input value={item.productName} onChange={e => updateItem(i, "productName", e.target.value)} /></div>
              <div><Label className="text-xs">Qty *</Label><Input type="number" value={item.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} /></div>
              <div><Label className="text-xs">Rate *</Label><Input type="number" value={item.rate} onChange={e => updateItem(i, "rate", e.target.value)} /></div>
              <div><Label className="text-xs">GST %</Label><Input type="number" value={item.gstPercent} onChange={e => updateItem(i, "gstPercent", e.target.value)} /></div>
              <div className="pb-0.5">{items.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeItem(i)}>×</Button>}</div>
            </div>
          ))}
          <div className="text-right space-y-1 pt-3 border-t">
            <div className="flex justify-end gap-4"><Label className="text-sm w-20">Freight:</Label><Input type="number" className="w-32" value={form.freight} onChange={e => setForm(f => ({ ...f, freight: e.target.value }))} /></div>
            <p className="text-sm">Total: ₹{totalAmount.toLocaleString("en-IN")} + GST ₹{totalGst.toLocaleString("en-IN")} + Freight ₹{Number(form.freight || 0).toLocaleString("en-IN")}</p>
            <p className="text-lg font-bold">Grand Total: ₹{grandTotal.toLocaleString("en-IN")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-4">
          <div><Label>Payment Terms</Label><Textarea value={form.paymentTerms} onChange={e => setForm(f => ({ ...f, paymentTerms: e.target.value }))} rows={2} /></div>
          <div><Label>Delivery Terms</Label><Textarea value={form.deliveryTerms} onChange={e => setForm(f => ({ ...f, deliveryTerms: e.target.value }))} rows={2} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => setLocation("/quotations")}>Cancel</Button>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.customerName}><Save className="h-4 w-4 mr-2" />Create Quotation</Button>
      </div>
    </div>
  );
}
