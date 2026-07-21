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
import { DuplicateWarningDialog, type DuplicateLeadInfo } from "@/components/duplicate-warning-dialog";

const schema = z.object({
  name: z.string().min(1, "Required"),
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
  users?: { id: number; name: string; colorCode: string; profilePhoto?: string | null }[];
  me?: { id: number; name: string; role: string; colorCode: string; profilePhoto?: string | null } | null;
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, email }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.duplicate) {
          setDuplicateData(data);
          setDuplicateOpen(true);
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
    if (trimmed.length >= 6) {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
      blurTimerRef.current = setTimeout(() => checkDuplicate(trimmed, undefined), 300);
    }
  }, [enableDuplicateDetection, checkDuplicate]);

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
    }
  }, [me, canAssign, form, initialData]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const handleSubmit = (data: LeadFormData) => {
    const transformed = { ...data, unit: data.unit === PENDING_UNIT_ASSIGNMENT ? "" : data.unit };
    onSubmit(transformed);
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
                  <FormLabel>Name <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input placeholder="Client name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mobile" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mobile <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Mobile number"
                      {...field}
                      data-no-cap="1"
                      onBlur={(e) => {
                        field.onBlur();
                        handleMobileBlur(e.target.value);
                      }}
                    />
                  </FormControl>
                  {checkingDuplicate && (
                    <p className="text-xs text-muted-foreground">Checking for duplicates...</p>
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
                  <FormLabel>Industry</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["Liquid Detergent","Lubricant","Agro Chemical & Pesticide","Edible Oil","Veterinary","Other"].map(i => (
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
            <Button type="submit" disabled={isSubmitting}>
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
      />
    </>
  );
}
