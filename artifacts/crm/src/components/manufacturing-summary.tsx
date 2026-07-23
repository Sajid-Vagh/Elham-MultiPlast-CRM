import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Package, X, AlertTriangle } from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Production On Going": "bg-orange-100 text-orange-700 border-orange-300",
  "Packaging": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready To Dispatch": "bg-green-100 text-green-700 border-green-300",
};

function formatWeight(w: string | null | undefined): string {
  if (!w || w === "-" || w === "N/A") return "N/A";
  if (/gram|gm|g$/i.test(w.trim())) return w.trim();
  return `${w.trim()} Gram`;
}

type SummaryGroup = {
  productName: string;
  weight: string;
  colour: string;
  colourCode: string | null;
  totalQuantity: number;
  orderCount: number;
  orderIds: number[];
};

type DetailItem = {
  orderId: number;
  customerName: string;
  companyName: string;
  piNumber: string;
  salesPerson: string;
  quantity: number;
  unit: string;
  status: string;
  productionUnit: string;
  createdByRole: string | null;
  isDelayed: boolean;
  createdAt: string;
  expectedDispatchDate: string | null;
  priority: string;
};

interface ManufacturingSummaryProps {
  unitFilter?: string;
  originFilter?: string;
}

export function ManufacturingSummary({ unitFilter, originFilter }: ManufacturingSummaryProps) {
  const [, setLocation] = useLocation();
  const [drawerGroup, setDrawerGroup] = useState<SummaryGroup | null>(null);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["manufacturing-summary", unitFilter, originFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (unitFilter && unitFilter !== "All") params.set("unit", unitFilter);
      if (originFilter && originFilter !== "all") params.set("origin", originFilter);
      return customFetch<any>(`/production/manufacturing-summary?${params.toString()}`);
    },
    refetchInterval: 30_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["manufacturing-summary-detail", drawerGroup?.productName, drawerGroup?.weight, drawerGroup?.colour],
    queryFn: () => {
      if (!drawerGroup) return { items: [] };
      const params = new URLSearchParams({
        productName: drawerGroup.productName,
        weight: drawerGroup.weight,
        colour: drawerGroup.colour,
      });
      return customFetch<any>(`/production/manufacturing-summary/detail?${params.toString()}`);
    },
    enabled: !!drawerGroup,
  });

  const groups: SummaryGroup[] = summary?.groups || [];
  const totalProducts = summary?.totalGroups ?? 0;
  const totalPieces = summary?.totalPieces ?? 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Manufacturing Summary</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const detailItems: DetailItem[] = detail?.items || [];
  const detailTotalQty = detailItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" />
              Manufacturing Summary
            </CardTitle>
            {groups.length > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-foreground">{totalProducts} Products</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-semibold text-foreground">{totalPieces.toLocaleString()} PCS Pending</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No pending manufacturing orders.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groups.map((g, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-4 bg-card hover:shadow-md hover:border-primary/50 cursor-pointer transition-all duration-200"
                  onClick={() => setDrawerGroup(g)}
                >
                  <p className="font-semibold text-sm leading-tight">{g.productName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Weight: <span className="font-semibold text-foreground">{formatWeight(g.weight)}</span></p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                    Color:
                    <span
                      className="w-2.5 h-2.5 rounded-full border shrink-0"
                      style={{ backgroundColor: g.colourCode || (g.colour !== "N/A" ? g.colour.toLowerCase() : "#d1d5db"), borderColor: g.colour === "White" ? "#d1d5db" : undefined }}
                    />
                    <span className="font-semibold text-foreground">{g.colour}</span>
                  </div>
                  <div className="border-t mt-3 pt-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total Pending</p>
                      <p className="text-base font-bold">{g.totalQuantity.toLocaleString()} PCS</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Orders</p>
                      <p className="text-base font-bold">{g.orderCount}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breakdown Drawer */}
      <Sheet open={!!drawerGroup} onOpenChange={(o) => { if (!o) setDrawerGroup(null); }}>
        <SheetContent className="sm:max-w-xl w-full p-0 overflow-y-auto">
          {drawerGroup && (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="sticky top-0 z-10 bg-background border-b px-6 py-4 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold truncate">{drawerGroup.productName}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">Bottle Weight: <span className="font-semibold text-foreground">{formatWeight(drawerGroup.weight)}</span></p>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                    Bottle Color:
                    <span
                      className="w-2.5 h-2.5 rounded-full border shrink-0"
                      style={{ backgroundColor: drawerGroup.colourCode || (drawerGroup.colour !== "N/A" ? drawerGroup.colour.toLowerCase() : "#d1d5db"), borderColor: drawerGroup.colour === "White" ? "#d1d5db" : undefined }}
                    />
                    <span className="font-semibold text-foreground">{drawerGroup.colour}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                    <span className="font-semibold text-foreground">Total Pending : {drawerGroup.totalQuantity.toLocaleString()} PCS</span>
                    <span>·</span>
                    <span className="font-semibold text-foreground">{drawerGroup.orderCount} Orders</span>
                  </div>
                </div>
                <button onClick={() => setDrawerGroup(null)} className="ml-4 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {detailLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full" />)}
                  </div>
                ) : detailItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No production orders found for this product.</p>
                ) : (
                  detailItems.map((item) => (
                    <div
                      key={item.orderId}
                      className="border rounded-lg p-4 bg-card hover:bg-accent transition-colors cursor-pointer"
                      onClick={() => { setDrawerGroup(null); setLocation(`/production/orders/${item.orderId}`); }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-sm">{item.customerName}</p>
                          {item.companyName && item.companyName !== item.customerName && (
                            <p className="text-xs text-muted-foreground">{item.companyName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.isDelayed && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[item.status] || "bg-gray-100"} border`}>
                            {item.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                        <div>
                          <p className="text-muted-foreground">Sales</p>
                          <p className="font-medium">{item.salesPerson}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">PI</p>
                          <p className="font-medium">{item.piNumber}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Qty</p>
                          <p className="font-bold">{item.quantity.toLocaleString()} {item.unit}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Unit</p>
                          <p className="font-medium">{item.productionUnit}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Order</p>
                          <p className="font-medium">
                            {item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-"}
                          </p>
                        </div>
                        {item.expectedDispatchDate && (
                          <div>
                            <p className="text-muted-foreground">Dispatch</p>
                            <p className="font-medium">
                              {new Date(item.expectedDispatchDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer Totals */}
              {detailItems.length > 0 && (
                <div className="sticky bottom-0 bg-background border-t px-6 py-3 flex items-center justify-between text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Orders : </span>
                    <span className="font-semibold">{detailItems.length}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Quantity : </span>
                    <span className="font-semibold">{detailTotalQty.toLocaleString()} PCS</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
