import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useListContacts, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { useActiveUnits } from "@/lib/use-active-units";
import { UserAvatar } from "@/components/user-avatar";

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

  const [reEnquiryOpen, setReEnquiryOpen] = useState(false);
  const [blurCheck, setBlurCheck] = useState("");
  const [popupContact, setPopupContact] = useState<any>(null);

  const { data: blurContacts } = useListContacts(
    { search: blurCheck },
    { query: { enabled: !!blurCheck && enableDuplicateDetection, queryKey: getListContactsQueryKey({ search: blurCheck }) } }
  );

  const prevBlurCheck = useRef("");
  useEffect(() => {
    if (!blurCheck || !blurContacts || blurCheck === prevBlurCheck.current) return;
    const exact = blurContacts.find(c => c.mobile === blurCheck || c.email === blurCheck);
    if (exact) {
      prevBlurCheck.current = blurCheck;
      setPopupContact(exact);
      setReEnquiryOpen(true);
    }
  }, [blurContacts, blurCheck]);

  const form = useForm<LeadFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", mobile: "", otherPhone: "", email: "", companyName: "", salesOwnerId: "",
      leadSource: "", city: "", unit: "", industry: "", tags: "", address: "",
      ...initialData,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: "", mobile: "", otherPhone: "", email: "", companyName: "", salesOwnerId: "",
        leadSource: "", city: "", unit: "", industry: "", tags: "", address: "",
        ...initialData,
      });
    }
  }, [initialData, form]);

  useEffect(() => {
    if (!canAssign && me?.id && !initialData?.salesOwnerId) {
      form.setValue("salesOwnerId", String(me.id));
    }
  }, [me, canAssign, form, initialData]);

  const handleSubmit = (data: LeadFormData) => {
    onSubmit(data);
  };

  const handleClosePopup = () => {
    setReEnquiryOpen(false);
    setBlurCheck("");
    prevBlurCheck.current = "";
    setPopupContact(null);
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
                        if (!enableDuplicateDetection) return;
                        const val = e.target.value.trim();
                        if (val.length >= 6) setBlurCheck(val);
                      }}
                    />
                  </FormControl>
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
                        if (!enableDuplicateDetection) return;
                        const val = e.target.value.trim();
                        if (val.includes("@") && val.includes(".")) setBlurCheck(val);
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
                  <FormLabel>Unit</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {activeUnits.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
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

      <Dialog open={reEnquiryOpen} onOpenChange={(open) => { if (!open) handleClosePopup(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              Already in CRM
            </DialogTitle>
            <DialogDescription>
              This {popupContact?.email === blurCheck ? "email" : "mobile number"} is already assigned to an existing lead in the CRM.
            </DialogDescription>
          </DialogHeader>
          {popupContact ? (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4 space-y-3">
              <div className="flex items-center gap-3">
                {popupContact.salesOwner && (
                  <UserAvatar profilePhoto={popupContact.salesOwner.profilePhoto} name={popupContact.salesOwner.name} className="w-10 h-10 shrink-0" />
                )}
                <div>
                  <p className="font-semibold text-base">{popupContact.name}</p>
                  {popupContact.companyName && <p className="text-sm text-muted-foreground">{popupContact.companyName}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm pt-1">
                <div><span className="text-muted-foreground">Mobile: </span><span className="font-medium">{popupContact.mobile}</span></div>
                {popupContact.email && <div><span className="text-muted-foreground">Email: </span><span className="font-medium">{popupContact.email}</span></div>}
                {popupContact.city && <div><span className="text-muted-foreground">City: </span>{popupContact.city}</div>}
                {popupContact.salesOwner && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Assigned to: </span>
                    <UserAvatar profilePhoto={popupContact.salesOwner.profilePhoto} name={popupContact.salesOwner.name} className="w-2.5 h-2.5" />
                    <span className="font-medium text-primary">{popupContact.salesOwner.name}</span>
                  </div>
                )}
                {popupContact.industry && <div><span className="text-muted-foreground">Industry: </span>{popupContact.industry}</div>}
              </div>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-700">
              <strong>{blurCheck}</strong> already exists in the CRM.
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleClosePopup}>
              Use Different Number
            </Button>
            {popupContact && (
              <Link href={`/leads/${popupContact.id}`}>
                <Button className="gap-2" onClick={handleClosePopup}>
                  <ExternalLink className="h-4 w-4" /> Open Existing Lead
                </Button>
              </Link>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
