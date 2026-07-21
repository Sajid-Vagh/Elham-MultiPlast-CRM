import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateContact, useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import LeadForm from "@/components/lead-form";
import type { LeadFormData } from "@/components/lead-form";
import { onContactChange } from "@/lib/query-invalidation";
import { DuplicateWarningDialog, type DuplicateLeadInfo } from "@/components/duplicate-warning-dialog";
import { useCustomerFacingUsers } from "@/lib/use-customer-facing-users";

export default function LeadsNew() {
  const [, setLocation] = useLocation();
  const createContact = useCreateContact();
  const { data: me } = useGetMe();
  const { data: users } = useCustomerFacingUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [duplicateData, setDuplicateData] = useState<DuplicateLeadInfo | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

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
    createContact.mutate({
      data: contactInput,
    }, {
      onSuccess: (contact) => {
        onContactChange(queryClient);
        toast({ title: "Lead created successfully" });
        setLocation(`/leads/${contact.id}`);
      },
      onError: (err: any) => {
        const isDuplicate = err?.status === 409 && err?.data?.duplicate;
        if (isDuplicate && err?.data?.leadId) {
          setDuplicateData({
            duplicate: true,
            leadId: err.data.leadId,
            customerName: err.data.customerName || "Unknown",
            companyName: err.data.companyName || null,
            mobile: err.data.mobile || data.mobile,
            email: err.data.email || null,
            ownerId: err.data.ownerId || 0,
            ownerName: err.data.ownerName || "Unknown",
            ownerRole: err.data.ownerRole || "sales",
            ownerProfilePhoto: err.data.ownerProfilePhoto || null,
            unit: err.data.unit || null,
            category: err.data.category || "Regular Follow up",
            dealStage: err.data.dealStage || null,
            status: err.data.status || "Active",
            lastFollowUp: err.data.lastFollowUp || null,
            createdAt: err.data.createdAt || null,
            viewUrl: err.data.viewUrl || null,
          });
          setDuplicateOpen(true);
        } else {
          toast({
            title: "Duplicate",
            description: err?.data?.error || "This mobile or email already exists in CRM",
            variant: "destructive",
          });
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

      <DuplicateWarningDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        data={duplicateData}
        userRole={me?.role}
      />
    </div>
  );
}
