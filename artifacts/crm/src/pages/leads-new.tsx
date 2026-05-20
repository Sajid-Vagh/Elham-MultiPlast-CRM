import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useCreateContact, useListUsers, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "Required"),
  mobile: z.string().min(10, "Enter valid mobile"),
  email: z.string().email().optional().or(z.literal("")),
  companyName: z.string().optional(),
  salesOwnerId: z.string().min(1, "Required"),
  otherPhone: z.string().optional(),
  otherEmail: z.string().optional(),
  leadSource: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  unit: z.string().optional(),
  industry: z.string().optional(),
  tags: z.string().optional(),
  inquiryDate: z.string().optional(),
  lastCallDate: z.string().optional(),
  nextCallDate: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function LeadsNew() {
  const [, setLocation] = useLocation();
  const createContact = useCreateContact();
  const { data: users } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", mobile: "", email: "", companyName: "", salesOwnerId: "",
      otherPhone: "", otherEmail: "", leadSource: "", city: "", address: "",
      unit: "", industry: "", tags: "", inquiryDate: "", lastCallDate: "", nextCallDate: "",
    },
  });

  const onSubmit = (data: FormData) => {
    createContact.mutate({
      data: {
        ...data,
        salesOwnerId: Number(data.salesOwnerId),
        email: data.email || null,
        companyName: data.companyName || null,
        otherPhone: data.otherPhone || null,
        otherEmail: data.otherEmail || null,
        leadSource: data.leadSource || null,
        city: data.city || null,
        address: data.address || null,
        unit: data.unit || null,
        industry: data.industry || null,
        tags: data.tags || null,
        inquiryDate: data.inquiryDate || null,
        lastCallDate: data.lastCallDate || null,
        nextCallDate: data.nextCallDate || null,
      },
    }, {
      onSuccess: (contact) => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Lead created successfully" });
        setLocation(`/leads/${contact.id}`);
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.data?.error || "Failed to create lead", variant: "destructive" });
      },
    });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/leads">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Lead</h1>
          <p className="text-sm text-muted-foreground">Add a new contact/lead to the CRM</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                  <FormControl><Input placeholder="Mobile number" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input placeholder="Email address" {...field} /></FormControl>
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
              <FormField control={form.control} name="salesOwnerId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sales Owner <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {users?.map(u => (
                        <SelectItem key={u.id} value={u.id.toString()}>
                          <span className="flex items-center gap-2">
                            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: u.colorCode }} />
                            {u.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
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
                      {["Himatnagar","Surat","Rajkot"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
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

          <Card>
            <CardHeader><CardTitle className="text-base">Contact Dates</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="inquiryDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Inquiry Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lastCallDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Call Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="nextCallDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Next Call Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Additional Contact</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="otherPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Other Phone</FormLabel>
                  <FormControl><Input placeholder="Other phone" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="otherEmail" render={({ field }) => (
                <FormItem>
                  <FormLabel>Other Email</FormLabel>
                  <FormControl><Input placeholder="Other email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" disabled={createContact.isPending}>
              {createContact.isPending ? "Saving..." : "Create Lead"}
            </Button>
            <Link href="/leads"><Button type="button" variant="outline">Cancel</Button></Link>
          </div>
        </form>
      </Form>
    </div>
  );
}
