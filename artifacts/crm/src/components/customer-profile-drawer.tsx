import { useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, MessageSquare, Loader2 } from "lucide-react";
import { CategoryBadge } from "@/components/category-badge";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { parseNotesText } from "@/lib/parse-notes";
import { SharedActivityTimeline } from "@/components/shared-activity-timeline";

interface CustomerProfileDrawerProps {
  contactId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CustomerProfileDrawer({ contactId, open, onOpenChange }: CustomerProfileDrawerProps) {
  const [showFullComment, setShowFullComment] = useState(false);

  const { data: contact, isLoading: loadingContact } = useQuery({
    queryKey: ["contact-drawer", contactId],
    queryFn: async () => {
      if (!contactId) return null;
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch contact");
      return res.json();
    },
    enabled: !!contactId && open,
    staleTime: 10_000,
  });

  const customerComments = parseNotesText(contact?.customerComments);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[600px] w-[90vw] overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-primary" />
            Customer Profile
          </SheetTitle>
        </SheetHeader>

        {loadingContact ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !contact ? (
          <p className="text-sm text-muted-foreground text-center py-10">Customer not found.</p>
        ) : (
          <div className="space-y-4 mt-4">
            {/* Customer Details Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" /> Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {contact.name && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Name</span>
                    <span className="font-medium text-sm text-right">{contact.name}</span>
                  </div>
                )}
                {contact.companyName && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Company</span>
                    <span className="text-sm text-right">{contact.companyName}</span>
                  </div>
                )}
                {contact.mobile && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Mobile</span>
                    <span className="text-sm text-right font-mono">{contact.mobile}</span>
                  </div>
                )}
                {contact.email && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Email</span>
                    <span className="text-sm text-right">{contact.email}</span>
                  </div>
                )}
                {contact.city && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">City</span>
                    <span className="text-sm text-right">{contact.city}</span>
                  </div>
                )}
                {contact.leadSource && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Lead Source</span>
                    <span className="text-sm text-right">{contact.leadSource}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">Unit</span>
                  <span className="text-sm text-right">{contact.unit || PENDING_UNIT_ASSIGNMENT}</span>
                </div>
                {(contact as any).category && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Category</span>
                    <CategoryBadge category={(contact as any).category} />
                  </div>
                )}
                {(contact as any).salesOwner?.name && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Sales Owner</span>
                    <span className="text-sm text-right">{(contact as any).salesOwner.name}</span>
                  </div>
                )}
                {contact.createdAt && (
                  <div className="flex items-center justify-between border-t pt-1.5 mt-1.5">
                    <span className="text-muted-foreground text-xs">Customer Since</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(contact.createdAt), "d MMM yyyy, h:mm a")}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer Comments */}
            {customerComments && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" /> Customer Comments
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="whitespace-pre-wrap text-sm">
                    {showFullComment || customerComments.length <= 100
                      ? customerComments
                      : `${customerComments.slice(0, 100)}...`}
                  </p>
                  {customerComments.length > 100 && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs mt-1" onClick={() => setShowFullComment(!showFullComment)}>
                      {showFullComment ? "View Less" : "View More"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Shared Activity Timeline */}
            <SharedActivityTimeline contactId={contactId} hideDealsManagement={true} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
