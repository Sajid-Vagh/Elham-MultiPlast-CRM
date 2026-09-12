import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListUsers } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRightLeft,
  Users,
  Briefcase,
  ShoppingBag,
  UserCheck,
  Building,
  Calendar,
  AlertCircle,
  Loader2,
  CheckCheck,
} from "lucide-react";

export interface DataReassignmentUser {
  id: number;
  name: string;
  username: string;
  role: string;
  unit?: string;
  colorCode?: string;
}

interface DataReassignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceUser: DataReassignmentUser | null;
  onSuccess?: () => void;
}

type TabType = "contacts" | "customers" | "deals" | "orders";

export function DataReassignmentModal({
  isOpen,
  onClose,
  sourceUser,
  onSuccess,
}: DataReassignmentModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [targetUserId, setTargetUserId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabType>("contacts");

  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [selectedCustomers, setSelectedCustomers] = useState<Set<number>>(new Set());
  const [selectedDeals, setSelectedDeals] = useState<Set<number>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());

  // Reset states when sourceUser or modal open state changes
  useEffect(() => {
    if (isOpen) {
      setTargetUserId("");
      setSelectedContacts(new Set());
      setSelectedCustomers(new Set());
      setSelectedDeals(new Set());
      setSelectedOrders(new Set());
      setActiveTab("contacts");
    }
  }, [isOpen, sourceUser?.id]);

  // Fetch all users to select the target assignee
  const { data: usersList = [] } = useListUsers();
  const targetCandidates = usersList.filter(
    (u) => u.id !== sourceUser?.id && (u as any).isActive !== false
  );

  // Fetch all records owned by the source user
  const {
    data: recordsData,
    isLoading: isRecordsLoading,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ["admin-user-records", sourceUser?.id],
    queryFn: async () => {
      if (!sourceUser?.id) return null;
      const res = await fetch(`/api/admin/user-records/${sourceUser.id}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("crm_token")}`,
        },
      });
      if (!res.ok) {
        throw new Error("Failed to fetch user records");
      }
      return res.json();
    },
    enabled: isOpen && !!sourceUser?.id,
  });

  const contactsList = recordsData?.contacts || [];
  const customersList = recordsData?.customers || [];
  const dealsList = recordsData?.deals || [];
  const ordersList = recordsData?.orders || [];

  // Toggle selection helpers
  const toggleContact = (id: number) => {
    setSelectedContacts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCustomer = (id: number) => {
    setSelectedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDeal = (id: number) => {
    setSelectedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleOrder = (id: number) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select all / deselect all helpers for current tab
  const isAllContactsSelected = contactsList.length > 0 && selectedContacts.size === contactsList.length;
  const isAllCustomersSelected = customersList.length > 0 && selectedCustomers.size === customersList.length;
  const isAllDealsSelected = dealsList.length > 0 && selectedDeals.size === dealsList.length;
  const isAllOrdersSelected = ordersList.length > 0 && selectedOrders.size === ordersList.length;

  const toggleSelectAllTab = (tab: TabType) => {
    if (tab === "contacts") {
      if (isAllContactsSelected) setSelectedContacts(new Set());
      else setSelectedContacts(new Set(contactsList.map((c: any) => c.id)));
    } else if (tab === "customers") {
      if (isAllCustomersSelected) setSelectedCustomers(new Set());
      else setSelectedCustomers(new Set(customersList.map((c: any) => c.id)));
    } else if (tab === "deals") {
      if (isAllDealsSelected) setSelectedDeals(new Set());
      else setSelectedDeals(new Set(dealsList.map((d: any) => d.id)));
    } else if (tab === "orders") {
      if (isAllOrdersSelected) setSelectedOrders(new Set());
      else setSelectedOrders(new Set(ordersList.map((o: any) => o.id)));
    }
  };

  const selectAllAcrossAllTabs = () => {
    setSelectedContacts(new Set(contactsList.map((c: any) => c.id)));
    setSelectedCustomers(new Set(customersList.map((c: any) => c.id)));
    setSelectedDeals(new Set(dealsList.map((d: any) => d.id)));
    setSelectedOrders(new Set(ordersList.map((o: any) => o.id)));
  };

  const clearAllAcrossAllTabs = () => {
    setSelectedContacts(new Set());
    setSelectedCustomers(new Set());
    setSelectedDeals(new Set());
    setSelectedOrders(new Set());
  };

  const totalSelected =
    selectedContacts.size +
    selectedCustomers.size +
    selectedDeals.size +
    selectedOrders.size;

  const totalAvailable =
    contactsList.length +
    customersList.length +
    dealsList.length +
    ordersList.length;

  // Reassignment Mutation
  const reassignMutation = useMutation({
    mutationFn: async () => {
      if (!sourceUser?.id || !targetUserId) {
        throw new Error("Source and target user are required");
      }
      const payload = {
        sourceUserId: sourceUser.id,
        targetUserId: Number(targetUserId),
        selectedIds: {
          contacts: Array.from(selectedContacts),
          customers: Array.from(selectedCustomers),
          deals: Array.from(selectedDeals),
          orders: Array.from(selectedOrders),
        },
      };

      const res = await fetch("/api/admin/reassign-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("crm_token")}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to reassign records");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Data Reassigned Successfully",
        description: data.message || `Reassigned ${totalSelected} records.`,
      });

      // Invalidate relevant global queries to reflect reassignment immediately
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["existing-customers"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-records"] });

      onSuccess?.();
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Reassignment Failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const formatDate = (dateVal: string | null | undefined) => {
    if (!dateVal) return "-";
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return String(dateVal);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-5 pb-4 border-b bg-muted/20">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
            <ArrowRightLeft className="h-4 w-4" />
            <span>Admin Data Reassignment</span>
          </div>
          <DialogTitle className="text-xl font-bold mt-1">
            Reassign Records from {sourceUser?.name || "User"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Transfer ownership of selected Leads, Customers, Deals, and Orders to another active team member.
          </DialogDescription>

          {/* Target User Selector Bar */}
          <div className="mt-4 pt-3 border-t grid grid-cols-1 sm:grid-cols-2 gap-3 items-center bg-card p-3 rounded-lg border">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Source Owner (Current)
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-semibold text-sm">{sourceUser?.name}</span>
                <Badge variant="outline" className="text-xs">
                  {sourceUser?.role}
                </Badge>
                {sourceUser?.unit && (
                  <span className="text-xs text-muted-foreground">({sourceUser.unit})</span>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground uppercase">
                Transfer To (Target Assignee) *
              </Label>
              <Select value={targetUserId} onValueChange={setTargetUserId}>
                <SelectTrigger className="mt-1 h-9 bg-background">
                  <SelectValue placeholder="Select target team member..." />
                </SelectTrigger>
                <SelectContent>
                  {targetCandidates.map((user) => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      <span className="font-medium">{user.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        ({user.role} - {user.unit || "All"})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {isRecordsLoading ? (
            <div className="space-y-3 py-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : totalAvailable === 0 ? (
            <div className="text-center py-12 px-4 border border-dashed rounded-lg bg-muted/10">
              <UserCheck className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
              <h3 className="font-semibold text-base">No Owned Records</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {sourceUser?.name} currently does not own any active leads, customers, deals, or orders.
              </p>
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabType)}
              className="w-full flex flex-col"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap pb-2">
                <TabsList className="grid grid-cols-4 w-full sm:w-auto">
                  <TabsTrigger value="contacts" className="text-xs gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    <span>Leads</span>
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                      {selectedContacts.size}/{contactsList.length}
                    </Badge>
                  </TabsTrigger>

                  <TabsTrigger value="customers" className="text-xs gap-1.5">
                    <Building className="h-3.5 w-3.5" />
                    <span>Customers</span>
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                      {selectedCustomers.size}/{customersList.length}
                    </Badge>
                  </TabsTrigger>

                  <TabsTrigger value="deals" className="text-xs gap-1.5">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span>Deals</span>
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                      {selectedDeals.size}/{dealsList.length}
                    </Badge>
                  </TabsTrigger>

                  <TabsTrigger value="orders" className="text-xs gap-1.5">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    <span>Orders</span>
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                      {selectedOrders.size}/{ordersList.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>

                {/* Batch Action Buttons */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={selectAllAcrossAllTabs}
                  >
                    <CheckCheck className="h-3.5 w-3.5 mr-1 text-primary" />
                    Select All ({totalAvailable})
                  </Button>
                  {totalSelected > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={clearAllAcrossAllTabs}
                    >
                      Clear Selection
                    </Button>
                  )}
                </div>
              </div>

              {/* ── TAB 1: Leads / Contacts ── */}
              <TabsContent value="contacts" className="m-0 border rounded-lg overflow-hidden bg-card">
                {contactsList.length === 0 ? (
                  <p className="p-8 text-center text-xs text-muted-foreground italic">
                    No leads assigned to this user.
                  </p>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-muted/40 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-10 text-center">
                            <Checkbox
                              checked={isAllContactsSelected}
                              onCheckedChange={() => toggleSelectAllTab("contacts")}
                            />
                          </TableHead>
                          <TableHead className="text-xs">Lead Name</TableHead>
                          <TableHead className="text-xs">Company</TableHead>
                          <TableHead className="text-xs">Mobile</TableHead>
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs">Unit</TableHead>
                          <TableHead className="text-xs text-right">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contactsList.map((contact: any) => {
                          const isChecked = selectedContacts.has(contact.id);
                          return (
                            <TableRow
                              key={contact.id}
                              className={`cursor-pointer transition-colors ${
                                isChecked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                              }`}
                              onClick={() => toggleContact(contact.id)}
                            >
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggleContact(contact.id)}
                                />
                              </TableCell>
                              <TableCell className="font-medium text-xs">{contact.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{contact.companyName || "-"}</TableCell>
                              <TableCell className="text-xs font-mono">{contact.mobile}</TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  {contact.category || "Regular"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{contact.unit || "-"}</TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">
                                {formatDate(contact.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* ── TAB 2: Existing Customers ── */}
              <TabsContent value="customers" className="m-0 border rounded-lg overflow-hidden bg-card">
                {customersList.length === 0 ? (
                  <p className="p-8 text-center text-xs text-muted-foreground italic">
                    No customers assigned to this user.
                  </p>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-muted/40 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-10 text-center">
                            <Checkbox
                              checked={isAllCustomersSelected}
                              onCheckedChange={() => toggleSelectAllTab("customers")}
                            />
                          </TableHead>
                          <TableHead className="text-xs">Customer Name</TableHead>
                          <TableHead className="text-xs">Company</TableHead>
                          <TableHead className="text-xs">Mobile</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Role Assigned</TableHead>
                          <TableHead className="text-xs text-right">Customer Since</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customersList.map((customer: any) => {
                          const isChecked = selectedCustomers.has(customer.id);
                          const isSalesOwner = customer.salesOwnerId === sourceUser?.id;
                          const isSupportOwner = customer.supportOwnerId === sourceUser?.id;
                          return (
                            <TableRow
                              key={customer.id}
                              className={`cursor-pointer transition-colors ${
                                isChecked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                              }`}
                              onClick={() => toggleCustomer(customer.id)}
                            >
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggleCustomer(customer.id)}
                                />
                              </TableCell>
                              <TableCell className="font-medium text-xs">
                                {customer.customerName || `Customer #${customer.id}`}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{customer.companyName || "-"}</TableCell>
                              <TableCell className="text-xs font-mono">{customer.mobile || "-"}</TableCell>
                              <TableCell className="text-xs">
                                <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">
                                  {customer.status || "Active"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                {isSalesOwner && isSupportOwner ? (
                                  <Badge variant="outline" className="text-[10px]">Sales & Support</Badge>
                                ) : isSalesOwner ? (
                                  <Badge variant="outline" className="text-[10px]">Sales Owner</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">Support Owner</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">
                                {formatDate(customer.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* ── TAB 3: Deals / Pipeline ── */}
              <TabsContent value="deals" className="m-0 border rounded-lg overflow-hidden bg-card">
                {dealsList.length === 0 ? (
                  <p className="p-8 text-center text-xs text-muted-foreground italic">
                    No deals assigned to this user.
                  </p>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-muted/40 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-10 text-center">
                            <Checkbox
                              checked={isAllDealsSelected}
                              onCheckedChange={() => toggleSelectAllTab("deals")}
                            />
                          </TableHead>
                          <TableHead className="text-xs">Deal Title</TableHead>
                          <TableHead className="text-xs">Customer</TableHead>
                          <TableHead className="text-xs">Stage</TableHead>
                          <TableHead className="text-xs text-right">Value</TableHead>
                          <TableHead className="text-xs text-right">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dealsList.map((deal: any) => {
                          const isChecked = selectedDeals.has(deal.id);
                          return (
                            <TableRow
                              key={deal.id}
                              className={`cursor-pointer transition-colors ${
                                isChecked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                              }`}
                              onClick={() => toggleDeal(deal.id)}
                            >
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggleDeal(deal.id)}
                                />
                              </TableCell>
                              <TableCell className="font-medium text-xs">{deal.title || `Deal #${deal.id}`}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {deal.customerName || deal.companyName || "-"}
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-[10px]">
                                  {deal.stage || "New"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-right font-medium">
                                ₹{Number(deal.totalValue || deal.wonAmount || 0).toLocaleString("en-IN")}
                              </TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">
                                {formatDate(deal.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* ── TAB 4: Orders ── */}
              <TabsContent value="orders" className="m-0 border rounded-lg overflow-hidden bg-card">
                {ordersList.length === 0 ? (
                  <p className="p-8 text-center text-xs text-muted-foreground italic">
                    No orders assigned to this user.
                  </p>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-muted/40 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-10 text-center">
                            <Checkbox
                              checked={isAllOrdersSelected}
                              onCheckedChange={() => toggleSelectAllTab("orders")}
                            />
                          </TableHead>
                          <TableHead className="text-xs">Order No</TableHead>
                          <TableHead className="text-xs">Customer</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs text-right">Grand Total</TableHead>
                          <TableHead className="text-xs text-right">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ordersList.map((order: any) => {
                          const isChecked = selectedOrders.has(order.id);
                          return (
                            <TableRow
                              key={order.id}
                              className={`cursor-pointer transition-colors ${
                                isChecked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                              }`}
                              onClick={() => toggleOrder(order.id)}
                            >
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggleOrder(order.id)}
                                />
                              </TableCell>
                              <TableCell className="font-medium text-xs font-mono">{order.orderNumber || `#${order.id}`}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {order.customerName || order.companyName || "-"}
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-[10px]">
                                  {order.status || "Draft"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-right font-medium">
                                ₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}
                              </TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">
                                {formatDate(order.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 border-t bg-muted/20 flex items-center justify-between gap-3 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {totalSelected > 0 ? (
              <span className="font-medium text-foreground">
                {totalSelected} {totalSelected === 1 ? "record" : "records"} selected (
                {[
                  selectedContacts.size > 0 && `${selectedContacts.size} Leads`,
                  selectedCustomers.size > 0 && `${selectedCustomers.size} Customers`,
                  selectedDeals.size > 0 && `${selectedDeals.size} Deals`,
                  selectedOrders.size > 0 && `${selectedOrders.size} Orders`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                )
              </span>
            ) : (
              <span>Select the records you want to reassign.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={reassignMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => reassignMutation.mutate()}
              disabled={
                !targetUserId ||
                totalSelected === 0 ||
                reassignMutation.isPending
              }
              className="gap-1.5"
            >
              {reassignMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Transferring...</span>
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4" />
                  <span>Transfer {totalSelected > 0 ? `${totalSelected} Records` : ""}</span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
