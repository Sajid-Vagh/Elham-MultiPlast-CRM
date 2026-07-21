import { useParams } from "wouter";
import { useLocation } from "wouter";
import { useGetContact, useUpdateContact, useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import LeadForm from "@/components/lead-form";
import type { LeadFormData } from "@/components/lead-form";
import { onContactChange } from "@/lib/query-invalidation";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";

export default function LeadsEdit() {
  const { id } = useParams<{ id: string }>();
  const contactId = Number(id);
  const [, setLocation] = useLocation();
  const { data: contact, isLoading } = useGetContact(contactId);
  const updateContact = useUpdateContact();
  const { data: me } = useGetMe();
  const { data: users } = useCustomerFacingUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!contact) return <div className="p-8">Contact not found</div>;

  const onSubmit = (data: LeadFormData) => {
    updateContact.mutate({
      id: contactId,
      data: {
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
      },
    }, {
      onSuccess: () => {
        onContactChange(queryClient, contactId);
        toast({ title: "Lead updated successfully" });
        setLocation(`/leads/${contactId}`);
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err?.data?.error || "Failed to update lead", variant: "destructive" });
      },
    });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/leads/${contactId}`}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Edit Lead</h1>
          <p className="text-sm text-muted-foreground">Update lead/contact information</p>
        </div>
      </div>

      <LeadForm
        initialData={{
          name: contact.name,
          mobile: contact.mobile,
          email: contact.email || "",
          companyName: contact.companyName || "",
          salesOwnerId: String(contact.salesOwnerId),
          leadSource: contact.leadSource || "",
          city: contact.city || "",
          unit: contact.unit || PENDING_UNIT_ASSIGNMENT,
          industry: contact.industry || "",
          tags: contact.tags || "",
          address: contact.address || "",
        }}
        isSubmitting={updateContact.isPending}
        onSubmit={onSubmit}
        onCancel={() => setLocation(`/leads/${contactId}`)}
        submitLabel="Save Changes"
        users={users}
        me={me}
      />
    </div>
  );
}
