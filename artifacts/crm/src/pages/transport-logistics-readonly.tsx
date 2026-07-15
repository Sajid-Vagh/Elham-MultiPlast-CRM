import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, MapPin, Package } from "lucide-react";
import { useActiveUnits } from "@/lib/use-active-units";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}` });

export default function TransportLogisticsLookup() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("destinations");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const { units: activeUnits } = useActiveUnits();

  const { data: destData, isLoading: destLoading } = useQuery({
    queryKey: ["transport-destinations-lookup", { search, unit: unitFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (unitFilter && unitFilter !== "all") params.set("unit", unitFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/transport-masters/destinations?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: bundleData, isLoading: bundleLoading } = useQuery({
    queryKey: ["product-bundles-lookup", { search, unit: unitFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (unitFilter && unitFilter !== "all") params.set("unit", unitFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/transport-masters/bundles?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transport Cost Lookup</h1>
        <p className="text-sm text-muted-foreground mt-1">Search destinations and product bundle sizes</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by state, city, or product name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-3">
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Units" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="destinations">
            <MapPin className="h-3.5 w-3.5 mr-1.5" />
            Destinations
          </TabsTrigger>
          <TabsTrigger value="bundles">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Product Bundles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="destinations">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Transport Destinations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>State</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Transport Type</TableHead>
                    <TableHead className="text-right">Charge (₹)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {destLoading ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : destData?.data?.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      {search ? "No destinations found" : "Search to view transport costs"}
                    </TableCell></TableRow>
                  ) : (
                    destData?.data?.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell><Badge variant="outline">{item.state}</Badge></TableCell>
                        <TableCell className="font-medium">{item.city}</TableCell>
                        <TableCell><Badge variant="outline">{item.productionUnit || "All Units"}</Badge></TableCell>
                        <TableCell>{item.transportType}</TableCell>
                        <TableCell className="text-right font-bold text-green-700">₹{Number(item.transportCharge).toLocaleString("en-IN")}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bundles">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Product Bundle Sizes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Bundle Size (pcs)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundleLoading ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : bundleData?.data?.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      {search ? "No bundles found" : "Search to view product bundles"}
                    </TableCell></TableRow>
                  ) : (
                    bundleData?.data?.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell><Badge variant="outline">{item.productionUnit || "All Units"}</Badge></TableCell>
                        <TableCell className="text-right font-bold">{item.bundleSize} pcs</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
