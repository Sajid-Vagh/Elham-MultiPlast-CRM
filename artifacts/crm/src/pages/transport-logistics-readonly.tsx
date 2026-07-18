import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, MapPin, Package, Truck, Star } from "lucide-react";
import { useActiveUnits } from "@/lib/use-active-units";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("crm_token")}` });

export default function TransportLogisticsLookup() {
  const [search, setSearch] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [activeTab, setActiveTab] = useState("lookup");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const { units: activeUnits } = useActiveUnits();

  // PIN-first lookup
  const { data: lookupData, isLoading: lookupLoading } = useQuery({
    queryKey: ["transport-lookup", { pinCode, city, state, unit: unitFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (pinCode) params.set("pinCode", pinCode);
      if (city) params.set("city", city);
      if (state) params.set("state", state);
      if (unitFilter !== "all") params.set("productionUnit", unitFilter);
      const res = await fetch(`/api/transport-masters/destinations/lookup?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!(pinCode || city || state),
  });

  // Bundle data for packing tab
  const { data: bundleData, isLoading: bundleLoading } = useQuery({
    queryKey: ["product-bundles-lookup", { search, unit: unitFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (unitFilter !== "all") params.set("unit", unitFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/transport-masters/bundles?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: activeTab === "packing",
  });

  const handleSearch = useCallback(() => {
    // Trigger lookup based on whichever field has data
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Freight & Packing Lookup</h1>
        <p className="text-sm text-muted-foreground mt-1">Search transport rates by PIN code or destination, and view packing quantities</p>
      </div>

      <div className="flex items-center gap-3">
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All Units" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            {activeUnits.filter(u => u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="lookup">
            <Truck className="h-3.5 w-3.5 mr-1.5" />
            Transport Rates
          </TabsTrigger>
          <TabsTrigger value="packing">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Packing Quantities
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lookup" className="space-y-4">
          {/* PIN-first search */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Search by PIN Code (Priority) or Destination</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">PIN Code (Highest Priority)</label>
                  <Input
                    placeholder="6-digit PIN"
                    value={pinCode}
                    onChange={e => setPinCode(e.target.value)}
                    maxLength={6}
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">City (Fallback)</label>
                  <Input placeholder="e.g. Pune" value={city} onChange={e => setCity(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">State (Last Resort)</label>
                  <Input placeholder="e.g. Maharashtra" value={state} onChange={e => setState(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Badge variant="outline" className="text-xs h-9 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {lookupData?.matchedBy ? `Matched by ${lookupData.matchedBy}` : "Enter PIN or city"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead>PIN</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Transport Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Freight (₹)</TableHead>
                    <TableHead className="text-right">Transit Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookupLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8">Searching...</TableCell></TableRow>
                  ) : !lookupData?.data?.length ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {pinCode || city || state ? "No transport routes found for this destination" : "Enter a PIN code or city to search"}
                    </TableCell></TableRow>
                  ) : (
                    lookupData.data.map((item: any, idx: number) => (
                      <TableRow key={item.id} className={idx === 0 ? "bg-green-50" : ""}>
                        <TableCell><Badge variant="outline">{item.productionUnit || "All"}</Badge></TableCell>
                        <TableCell className="font-mono text-sm">{item.pinCode || "—"}</TableCell>
                        <TableCell className="font-medium">{item.city}</TableCell>
                        <TableCell>{item.state}</TableCell>
                        <TableCell className="font-medium">
                          {item.transportCompany || "—"}
                          {idx === 0 && <Star className="h-3 w-3 text-amber-500 ml-1 inline" />}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{item.transportType}</Badge></TableCell>
                        <TableCell className="text-right font-bold text-green-700">₹{Number(item.transportCharge).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">{item.transitDays ? `${item.transitDays} days` : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packing" className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by product name..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Liner Qty</TableHead>
                    <TableHead className="text-right">TCI Bora</TableHead>
                    <TableHead className="text-right">Normal Bora</TableHead>
                    <TableHead className="text-right">Bundle Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundleLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : bundleData?.data?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {search ? "No products found" : "Search to view packing quantities"}
                    </TableCell></TableRow>
                  ) : (
                    bundleData?.data?.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell><Badge variant="outline">{item.productionUnit || "All"}</Badge></TableCell>
                        <TableCell className="text-right">{item.linerPackingQty}</TableCell>
                        <TableCell className="text-right">{item.tciBoraQty}</TableCell>
                        <TableCell className="text-right">{item.normalBoraQty}</TableCell>
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
