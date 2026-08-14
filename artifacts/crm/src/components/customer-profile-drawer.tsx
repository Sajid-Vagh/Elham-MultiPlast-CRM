import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Phone, Building, MapPin, Calendar, MessageSquare, ListOrdered, RotateCcw, Bell, Loader2 } from "lucide-react";
import { CategoryBadge } from "@/components/category-badge";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { parseNotesText } from "@/lib/parse-notes";

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

  const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
    queryKey: ["contact-drawer-timeline", contactId],
    queryFn: async () => {
      if (!contactId) return [];
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/contacts/${contactId}/timeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ type: string; description: string; notes?: string; createdAt: string; user?: { name: string } | null }>>;
    },
    enabled: !!contactId && open,
    staleTime: 10_000,
  });

  const customerComments = parseNotesText(contact?.customerComments);

  const sortedTimeline = useMemo(() => {
    return [...timeline]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 30);
  }, [timeline]);

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return d;
    }
  };

  const formatTime = (d: string) => {
    try {
      return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    } catch {
      return "";
    }
  };

  const timelineIcon = (type: string) => {
    const icons: Record<string, string> = {
      lead_created: "🆕", follow_up: "🔔", call: "📞", whatsapp: "💬",
      email: "✉️", note: "📝", category_change: "🏷️", deal_created: "🤝",
      deal_updated: "📊", comment_updated: "💬", document_uploaded: "📄",
      unit_change: "🏭",
    };
    return icons[type] || "•";
  };

  const timelineBg = (type: string) => {
    const bgs: Record<string, string> = {
      lead_created: "#dbeafe", follow_up: "#ffedd5", call: "#dcfce7",
      whatsapp: "#ccfbf1", email: "#dbeafe", note: "#fef9c3",
      category_change: "#f3e8ff", deal_created: "#d1fae5",
      deal_updated: "#e0e7ff", comment_updated: "#e0f2fe",
      document_uploaded: "#fef9c3", unit_change: "#fef3c7",
    };
    return bgs[type] || "#f3f4f6";
  };

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
                      {new Date(contact.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
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

            {/* Activity Timeline */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ListOrdered className="h-3.5 w-3.5" /> Recent Activity
                  <Badge variant="outline" className="text-[10px] font-normal ml-1">{sortedTimeline.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                {loadingTimeline ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Loading timeline...</p>
                ) : sortedTimeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No activity yet.</p>
                ) : (
                  <div className="space-y-0">
                    {sortedTimeline.map((ev, idx) => (
                      <div key={idx} className="flex items-start gap-2 py-1.5 hover:bg-muted/30 rounded px-1">
                        <div
                          className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ring-1 ring-background mt-0.5"
                          style={{ backgroundColor: timelineBg(ev.type) }}
                        >
                          {timelineIcon(ev.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-medium">{parseNotesText(ev.description)}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatDate(ev.createdAt)} • {formatTime(ev.createdAt)}
                            </span>
                          </div>
                          {ev.notes && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{parseNotesText(ev.notes)}</p>
                          )}
                          {ev.user?.name && (
                            <p className="text-[10px] text-muted-foreground">by {ev.user.name}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
