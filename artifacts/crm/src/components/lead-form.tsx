import { useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useActiveUnits } from "@/lib/use-active-units";
import { UserAvatar } from "@/components/user-avatar";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { INDUSTRIES } from "@/lib/constants";
import { DuplicateWarningDialog, type DuplicateLeadInfo } from "@/components/duplicate-warning-dialog";
import { AlertTriangle, ExternalLink } from "lucide-react";

const schema = z.object({
  name: z.string().optional(),
  mobile: z.string().min(10, "Enter valid mobile"),
  otherPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  companyName: z.string().optional(),
  salesOwnerId: z.string().min(1, "Required"),
  leadSource: z.string().optional(),
  city: z.string().optional(),
  unit: z.string().optional(),
  industry: z.string().optional(),
  tags: z.string().optional(),
  address: z.string().optional(),
});

export type LeadFormData = z.infer<typeof schema>;

export { schema as leadFormSchema };

interface LeadFormProps {
  initialData?: Partial<LeadFormData>;
  isSubmitting: boolean;
  onSubmit: (data: LeadFormData) => void;
  onCancel?: () => void;
  submitLabel?: string;
  users?: { id: number; name: string; unit?: string; colorCode: string; profilePhoto?: string | null }[];
  me?: { id: number; name: string; role: string; unit?: string; colorCode: string; profilePhoto?: string | null } | null;
  /** For create mode, enable duplicate detection on mobile/email blur */
  enableDuplicateDetection?: boolean;
}

export default function LeadForm({
  initialData,
  isSubmitting,
  onSubmit,
  onCancel,
  submitLabel = "Create Lead",
  users,
  me,
  enableDuplicateDetection = false,
}: LeadFormProps) {
  const queryClient = useQueryClient();
  const canAssign = me?.role === "admin";
  const { units: activeUnits } = useActiveUnits();

  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateData, setDuplicateData] = useState<DuplicateLeadInfo | null>(null);
  const [duplicateFound, setDuplicateFound] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<{ ownerName: string; leadId: number; viewUrl: string } | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef("");

  const checkDuplicate = useCallback(async (mobile?: string, email?: string) => {
    const key = `${mobile || ""}|${email || ""}`;
    if (!mobile && !email) return;
    if (key === lastCheckedRef.current) return;
    lastCheckedRef.current = key;

    setCheckingDuplicate(true);
    try {
      const res = await fetch("/api/contacts/check-duplicate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("crm_token")}`,
        },
        body: JSON.stringify({ mobile, email }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.duplicate) {
          setDuplicateData(data);
          setDuplicateOpen(true);
          setDuplicateFound(true);
          setDuplicateInfo({
            ownerName: data.ownerName,
            leadId: data.leadId,
            viewUrl: data.viewUrl || `/leads/${data.leadId}`,
          });
        } else {
          setDuplicateFound(false);
          setDuplicateInfo(null);
        }
      }
    } catch {
      // Silently fail — duplicate check is a convenience, not a hard block
    } finally {
      setCheckingDuplicate(false);
    }
  }, []);

  const handleMobileBlur = useCallback((val: string) => {
    if (!enableDuplicateDetection) return;
    const trimmed = val.trim();
    if (trimmed.length >= 10) {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => checkDuplicate(trimmed, undefined), 300);
    }
  }, [enableDuplicateDetection, checkDuplicate]);

  const handleMobileChange = useCallback((val: string, onChange: (...event: any[]) => void) => {
    onChange(val);
    // Clear duplicate state when mobile number changes
    if (duplicateFound) {
      setDuplicateFound(false);
      setDuplicateInfo(null);
    }
  }, [duplicateFound]);

  const handleEmailBlur = useCallback((val: string) => {
    if (!enableDuplicateDetection) return;
    const trimmed = val.trim();
    if (trimmed.includes("@") && trimmed.includes(".")) {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => checkDuplicate(undefined, trimmed), 300);
    }
  }, [enableDuplicateDetection, checkDuplicate]);

  const form = useForm<LeadFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", mobile: "", otherPhone: "", email: "", companyName: "", salesOwnerId: "",
      leadSource: "", city: "", unit: PENDING_UNIT_ASSIGNMENT, industry: "", tags: "", address: "",
      ...initialData,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: "", mobile: "", otherPhone: "", email: "", companyName: "", salesOwnerId: "",
        leadSource: "", city: "", unit: PENDING_UNIT_ASSIGNMENT, industry: "", tags: "", address: "",
        ...initialData,
      });
    }
  }, [initialData, form]);

  useEffect(() => {
    if (!canAssign && me?.id && !initialData?.salesOwnerId) {
      form.setValue("salesOwnerId", String(me.id));
      // Auto-fill unit from sales user's unit on create
      if (me.unit && me.unit !== "All" && !initialData?.unit) {
        form.setValue("unit", me.unit);
      }
    }
  }, [me, canAssign, form, initialData]);

  // Auto-fill unit from selected sales owner's unit (admin only)
  const watchedOwnerId = form.watch("salesOwnerId");
  const watchedUnit = form.watch("unit");
  useEffect(() => {
    if (!canAssign || !watchedOwnerId || !users) return;
    // Only auto-fill if unit is still "To Be Assigned" (not manually set)
    if (watchedUnit && watchedUnit !== PENDING_UNIT_ASSIGNMENT) return;
    const selectedUser = users.find(u => u.id === Number(watchedOwnerId));
    if (selectedUser?.unit && selectedUser.unit !== "All") {
      form.setValue("unit", selectedUser.unit);
    }
  }, [watchedOwnerId, canAssign, users, form, watchedUnit]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const handleSubmit = (data: LeadFormData) => {
    const { unit: rawUnit, ...rest } = data;
    const unit = rawUnit === PENDING_UNIT_ASSIGNMENT || rawUnit === "" ? undefined : rawUnit || undefined;
    onSubmit({ ...rest, unit });
  };

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Basic Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="Client name (optional)" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mobile" render={({ field }) => (
                <FormItem className={enableDuplicateDetection ? "border-2 border-primary/20 rounded-lg p-4 bg-primary/5" : ""}>
                  <FormLabel className={enableDuplicateDetection ? "text-base font-semibold" : ""}>
                    Mobile <span className="text-destructive">*</span>
                    {enableDuplicateDetection && <span className="text-xs text-muted-foreground font-normal ml-2">(enter 10-digit mobile to check for existing contact)</span>}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="10-digit mobile number"
                      {...field}
                      data-no-cap="1"
                      className={enableDuplicateDetection ? "border-primary/40 focus-visible:ring-primary" : ""}
                      onChange={(e) => {
                        handleMobileChange(e.target.value, field.onChange);
                      }}
                      onBlur={(e) => {
                        field.onBlur();
                        handleMobileBlur(e.target.value);
                      }}
                    />
                  </FormControl>
                  {checkingDuplicate && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <span className="inline-block w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                      Checking for duplicates...
                    </p>
                  )}
                  {duplicateFound && duplicateInfo && (
                    <div className="flex items-start gap-2 p-3 mt-2 bg-amber-50 border border-amber-300 rounded-lg text-sm">
                      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium text-amber-800">This contact already exists</p>
                        <p className="text-amber-700 text-xs mt-0.5">
                          Assigned to: <span className="font-semibold">{duplicateInfo.ownerName}</span>
                        </p>
                        <div className="flex gap-2 mt-1.5">
                          <a
                            href={duplicateInfo.viewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-amber-700 underline hover:text-amber-900 font-medium inline-flex items-center gap-1"
                          >
                            View existing lead <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <p className="text-xs text-amber-600 mt-1">Change the mobile number to continue creating a new lead.</p>
                      </div>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="otherPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Alternate Mobile</FormLabel>
                  <FormControl><Input placeholder="Alternate mobile (optional)" {...field} data-no-cap="1" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Email address"
                      {...field}
                      data-no-cap="1"
                      onBlur={(e) => {
                        field.onBlur();
                        handleEmailBlur(e.target.value);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="companyName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl><Input placeholder="Company" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {canAssign ? (
                <FormField control={form.control} name="salesOwnerId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sales Owner <span className="text-destructive">*</span></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {users?.map(u => (
                          <SelectItem key={u.id} value={u.id.toString()}>
                            <span className="flex items-center gap-2">
                              <UserAvatar profilePhoto={u.profilePhoto} name={u.name} className="w-3 h-3" />
                              {u.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              ) : me ? (
                <div>
                  <p className="text-sm font-medium mb-1">Sales Owner</p>
                  <p className="text-sm text-muted-foreground">
                    <UserAvatar profilePhoto={me.profilePhoto} name={me.name} className="w-3 h-3 inline-block mr-1.5 align-middle" />
                    {me.name} (you)
                  </p>
                </div>
              ) : null}
              <FormField control={form.control} name="leadSource" render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead Source</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["IndiaMart","TradeIndia","Social Media","Organic","Email","Other"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Location & Classification</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl><Input placeholder="City" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="unit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Production Unit</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={PENDING_UNIT_ASSIGNMENT}>{PENDING_UNIT_ASSIGNMENT}</SelectItem>
                      {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Unit will be finalized when the deal is won.
                  </p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select Industry (Optional)" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {INDUSTRIES.map(i => (
                        <SelectItem key={i} value={i}>{i}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="tags" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tag</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select tag" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["Interested","Category B","Category C"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Full Address</FormLabel>
                  <FormControl><Input placeholder="Full address" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" disabled={isSubmitting || (enableDuplicateDetection && duplicateFound)}>
              {isSubmitting ? "Saving..." : submitLabel}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Form>

      <DuplicateWarningDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        data={duplicateData}
        userRole={me?.role}
        currentUserId={me?.id}
      />
    </>
  );
}
