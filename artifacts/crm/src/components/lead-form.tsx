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
import { Textarea } from "@/components/ui/textarea";
import { INDUSTRIES, INDIAN_STATES, CITIES_BY_STATE } from "@/lib/constants";
import { DuplicateWarningDialog, type DuplicateLeadInfo } from "@/components/duplicate-warning-dialog";
import { AlertTriangle, ExternalLink } from "lucide-react";

const schema = z.object({
  name: z.string().optional(),
  mobile: z.string().min(10, "Enter valid mobile"),
  email: z.string().email().optional().or(z.literal("")),
  companyName: z.string().optional(),
  salesOwnerId: z.string().min(1, "Required"),
  leadSource: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  unit: z.string().optional(),
  industry: z.string().optional(),
  address: z.string().optional(),
  requirement: z.string().optional(),
});

export type LeadFormData = z.infer<typeof schema>;

export { schema as leadFormSchema };

interface LeadFormProps {
  initialData?: Partial<LeadFormData>;
  isSubmitting: boolean;
  onSubmit: (data: LeadFormData) => void;
  onCancel?: () => void;
  submitLabel?: string;
  users?: { id: number; name: string; unit?: string; colorCode: string; profilePhoto?: string | null; role?: string }[];
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

  const [stateInputValue, setStateInputValue] = useState("");
  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  const stateInputRef = useRef<HTMLInputElement>(null);
  const stateDropdownRef = useRef<HTMLDivElement>(null);

  const filteredStates = INDIAN_STATES.filter(s =>
    s.toLowerCase().includes((stateInputValue || "").toLowerCase())
  );

  const [cityInputValue, setCityInputValue] = useState("");
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const cityDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialData?.state) {
      setStateInputValue(initialData.state);
    } else {
      setStateInputValue("");
    }
  }, [initialData]);

  useEffect(() => {
    if (initialData?.city) {
      setCityInputValue(initialData.city);
    } else {
      setCityInputValue("");
    }
  }, [initialData]);

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
      name: "", mobile: "", email: "", companyName: "", salesOwnerId: "",
      leadSource: "", city: "", state: "", unit: PENDING_UNIT_ASSIGNMENT, industry: "", address: "",
      requirement: "",
      ...initialData,
    },
  });

  const watchedState = form.watch("state");
  const citiesForState = watchedState ? (CITIES_BY_STATE[watchedState] || []) : [];
  const allCities = [...new Set(Object.values(CITIES_BY_STATE).flat())];
  const cityPool = watchedState ? citiesForState : allCities;
  const filteredCities = cityPool.filter(c =>
    c.toLowerCase().includes((cityInputValue || "").toLowerCase())
  );

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: "", mobile: "", email: "", companyName: "", salesOwnerId: "",
        leadSource: "", city: "", state: "", unit: PENDING_UNIT_ASSIGNMENT, industry: "", address: "",
        requirement: "",
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

  // Default Sales Owner to the Admin user on create (admin users only)
  useEffect(() => {
    if (initialData || !canAssign || !users?.length) return;
    if (form.getValues("salesOwnerId")) return;
    const adminUser =
      (me?.role === "admin" && users.find(u => u.id === me.id)) ||
      users.find(u => u.role === "admin") ||
      users.find(u => /^admin$/i.test(u.name || ""));
    if (adminUser) {
      form.setValue("salesOwnerId", String(adminUser.id));
    }
  }, [initialData, canAssign, users, me, form]);

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

  useEffect(() => {
    function handleStateOutsideClick(e: MouseEvent) {
      if (
        stateDropdownRef.current &&
        !stateDropdownRef.current.contains(e.target as Node) &&
        stateInputRef.current &&
        !stateInputRef.current.contains(e.target as Node)
      ) {
        setStateDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleStateOutsideClick);
    return () => document.removeEventListener("mousedown", handleStateOutsideClick);
  }, []);

  useEffect(() => {
    function handleCityOutsideClick(e: MouseEvent) {
      if (
        cityDropdownRef.current &&
        !cityDropdownRef.current.contains(e.target as Node) &&
        cityInputRef.current &&
        !cityInputRef.current.contains(e.target as Node)
      ) {
        setCityDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleCityOutsideClick);
    return () => document.removeEventListener("mousedown", handleCityOutsideClick);
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
                  <FormControl><Input placeholder="Client name (optional)" {...field} autoComplete="crm-no-autofill" /></FormControl>
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
                      autoComplete="crm-no-autofill"
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
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Email address"
                      {...field}
                      autoComplete="crm-no-autofill"
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
                  <FormControl><Input placeholder="Company" {...field} autoComplete="crm-no-autofill" /></FormControl>
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
              <FormField control={form.control} name="requirement" render={({ field }) => (
                <FormItem className="col-span-1 md:col-span-2">
                  <FormLabel>Requirement</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Product requirement, specs…"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Location & Classification</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem className="relative">
                  <FormLabel>City</FormLabel>
                  <FormControl>
                    <input
                      ref={cityInputRef}
                      type="text"
                      placeholder="Type or select a city..."
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={cityInputValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCityInputValue(val);
                        field.onChange(val);
                        setCityDropdownOpen(true);
                      }}
                      onFocus={() => setCityDropdownOpen(true)}
                      onBlur={() => {
                        const val = cityInputRef.current?.value?.trim() || "";
                        setCityInputValue(val);
                        field.onChange(val);
                        setTimeout(() => setCityDropdownOpen(false), 150);
                      }}
                    />
                  </FormControl>
                  {cityDropdownOpen && filteredCities.length > 0 && (
                    <div
                      ref={cityDropdownRef}
                      className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-[9999]"
                    >
                      {filteredCities.map(c => (
                        <li
                          key={c}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 list-none"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setCityInputValue(c);
                            field.onChange(c);
                            setCityDropdownOpen(false);
                          }}
                        >
                          {c}
                        </li>
                      ))}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem className="relative">
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <input
                      ref={stateInputRef}
                      type="text"
                      placeholder="Type or select a state..."
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={stateInputValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStateInputValue(val);
                        field.onChange(val);
                        setStateDropdownOpen(true);
                      }}
                      onFocus={() => setStateDropdownOpen(true)}
                      onBlur={() => {
                        const val = stateInputRef.current?.value?.trim() || "";
                        setStateInputValue(val);
                        field.onChange(val);
                        setTimeout(() => setStateDropdownOpen(false), 150);
                      }}
                    />
                  </FormControl>
                  {stateDropdownOpen && filteredStates.length > 0 && (
                    <div
                      ref={stateDropdownRef}
                      className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-lg z-[9999]"
                    >
                      {filteredStates.map(s => (
                        <li
                          key={s}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 list-none"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setStateInputValue(s);
                            field.onChange(s);
                            setStateDropdownOpen(false);
                          }}
                        >
                          {s}
                        </li>
                      ))}
                    </div>
                  )}
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
