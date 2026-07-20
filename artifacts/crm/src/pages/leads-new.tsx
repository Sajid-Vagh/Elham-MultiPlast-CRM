import { useLocation } from "wouter";
import { useCreateContact, useListUsers, useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import LeadForm from "@/components/lead-form";
import type { LeadFormData } from "@/components/lead-form";
import { onContactChange } from "@/lib/query-invalidation";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";

export default function LeadsNew() {
  const [, setLocation] = useLocation();
  const createContact = useCreateContact();
  const { data: me } = useGetMe();
  const { data: users } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const onSubmit = (data: LeadFormData) => {
    const contactInput = {
      name: data.name,
      mobile: data.mobile,
      email: data.email || null,
      companyName: data.companyName || null,
      salesOwnerId: Number(data.salesOwnerId),
      leadSource: data.leadSource || null,
      city: data.city || null,
      address: data.address || null,
      unit: data.unit || null,
      industry: data.industry || null,
      tags: data.tags || null,
    };
    console.log("[DEBUG] leads-new onSubmit - unit being sent:", contactInput.unit);
    createContact.mutate({
      data: contactInput,
    }, {
      onSuccess: (contact) => {
        console.log("[DEBUG] leads-new onSuccess - contact.unit from response:", contact.unit);
        onContactChange(queryClient);
        toast({ title: "Lead created successfully" });
        setLocation(`/leads/${contact.id}`);
      },
      onError: (err: any) => {
        const isDuplicate = err?.status === 409 || err?.data?.error?.toLowerCase().includes("already exists");
        if (isDuplicate) {
          toast({ title: "Duplicate", description: "This mobile or email already exists in CRM", variant: "destructive" });
        } else {
          toast({ title: "Error", description: err?.data?.error || "Failed to create lead", variant: "destructive" });
        }
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

      <LeadForm
        isSubmitting={createContact.isPending}
        onSubmit={onSubmit}
        submitLabel="Create Lead"
        users={users}
        me={me}
        enableDuplicateDetection
      />
    </div>
  );
}
