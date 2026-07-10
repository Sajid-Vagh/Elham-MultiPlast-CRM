import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Users, ShoppingCart, Package, AlertTriangle } from "lucide-react";

export default function GlobalSearch() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["global-search", query],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
    enabled: query.length >= 2,
  });

  const Section = ({ icon: Icon, title, items, onNavigate }: { icon: any; title: string; items: any[]; onNavigate: (item: any) => void }) => (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Icon className="h-4 w-4" />{title} ({items.length})</CardTitle></CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No results</p> : (
          <div className="divide-y">
            {items.map((item: any) => (
              <div key={item.id} className="px-4 py-3 hover:bg-muted/30 cursor-pointer" onClick={() => onNavigate(item)}>
                <p className="text-sm font-medium">{item.name || item.orderNumber || item.complaintNumber || item.productName}</p>
                <p className="text-xs text-muted-foreground">{[item.companyName, item.mobile, item.status, item.category].filter(Boolean).join(" - ")}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold">Global Search</h1>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input placeholder="Search customers, orders, products, complaints..." value={query} onChange={e => setQuery(e.target.value)} className="pl-10 text-lg h-12" autoFocus />
      </div>

      {isLoading && <p className="text-center text-muted-foreground py-8">Searching...</p>}

      {data && (
        <div className="grid grid-cols-2 gap-4">
          <Section icon={Users} title="Customers" items={data.contacts || []} onNavigate={item => setLocation(`/leads/${item.id}`)} />
          <Section icon={ShoppingCart} title="Orders" items={data.orders || []} onNavigate={item => setLocation(`/orders/${item.id}`)} />
          <Section icon={Package} title="Products" items={data.products || []} onNavigate={item => setLocation("/products")} />
          <Section icon={AlertTriangle} title="Complaints" items={data.complaints || []} onNavigate={item => setLocation("/complaints")} />
        </div>
      )}

      {!data && query.length < 2 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">Type at least 2 characters to search</p>
          <p className="text-sm mt-1">Search across all customers, orders, products, and complaints</p>
        </CardContent></Card>
      )}
    </div>
  );
}
