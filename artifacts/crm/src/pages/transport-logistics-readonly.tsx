import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, Package } from "lucide-react";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}` });

export default function TransportLogisticsLookup() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["transport-logistics-lookup", { search }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("limit", "100");
      const res = await fetch(`/api/transport-logistics?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transport Cost Lookup</h1>
        <p className="text-sm text-muted-foreground mt-1">Search by city or state to check bundle sizes and transport costs</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by product, state, or city..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> State</div>
                </TableHead>
                <TableHead>City</TableHead>
                <TableHead className="text-right">
                  <div className="flex items-center justify-end gap-1"><Package className="h-3.5 w-3.5" /> Bundle Size (pcs)</div>
                </TableHead>
                <TableHead className="text-right">Transport Cost / Bundle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {search ? "No routes found for this search" : "Start typing to search transport routes"}
                </TableCell></TableRow>
              ) : (
                data?.data?.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}</TableCell>
                    <TableCell><Badge variant="outline">{item.destinationState}</Badge></TableCell>
                    <TableCell>{item.destinationCity}</TableCell>
                    <TableCell className="text-right font-medium">{item.bundleSizeQty} pcs</TableCell>
                    <TableCell className="text-right font-bold text-green-700">₹{Number(item.transportCostPerBundle).toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
