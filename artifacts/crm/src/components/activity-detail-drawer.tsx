import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateActivity, useUpdateActivity } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { onActivityChange } from "@/lib/query-invalidation";
import { Calendar, Clock, Phone, MessageSquare, Video, Users, MapPin, Mail, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { FlexibleTimeInput } from "@/components/flexible-time-input";

interface ActivityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: number;
  dealId?: number | null;
  contactName?: string;
  contactCompany?: string;
  contactMobile?: string;
  activity?: {
    id: number;
    type: string;
    notesDisplay?: string | null;
    notes?: string | null;
    callStatus?: string | null;
    followUpType?: string | null;
  } | null;
}

const ACTIVITY_TYPES = [
  { value: "Call", label: "Call", icon: Phone },
  { value: "WhatsApp", label: "WhatsApp", icon: MessageSquare },
  { value: "Meeting", label: "Meeting", icon: Users },
  { value: "Email", label: "Email", icon: Mail },
  { value: "Video Call", label: "Video Call", icon: Video },
  { value: "Site Visit", label: "Site Visit", icon: MapPin },
  { value: "FollowUp", label: "Follow-up", icon: Calendar },
];

const PRIORITIES = [
  { value: "High", label: "High", color: "text-red-600 bg-red-50" },
  { value: "Medium", label: "Medium", color: "text-amber-600 bg-amber-50" },
  { value: "Low", label: "Low", color: "text-green-600 bg-green-50" },
];

const NEXT_ACTIVITY_TYPES = [
  { value: "Call", label: "Call", icon: Phone },
  { value: "WhatsApp", label: "WhatsApp", icon: MessageSquare },
  { value: "Meeting", label: "Meeting", icon: Users },
  { value: "Email", label: "Email", icon: Mail },
  { value: "Video Call", label: "Video Call", icon: Video },
  { value: "Site Visit", label: "Site Visit", icon: MapPin },
  { value: "FollowUp", label: "Follow-up", icon: Calendar },
];

export default function ActivityDetailDrawer({ open, onOpenChange, contactId, dealId, contactName, contactCompany, contactMobile, activity }: ActivityModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const { data: contactActivities } = useQuery({
    queryKey: ["contact-activities-summary", contactId],
    queryFn: async () => {
      if (!contactId) return [];
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/activities?contactId=${contactId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId && open,
    staleTime: 30_000,
  });

  const lastCallActivity = useMemo(() => {
    if (!contactActivities) return null;
    return (contactActivities as any[]).find(
      (a: any) => a.callStatus === "Completed" && (a.notesDisplay || a.notes)
    );
  }, [contactActivities]);

  const nextFollowUpActivity = useMemo(() => {
    if (!contactActivities) return null;
    return (contactActivities as any[]).find(
      (a: any) => a.callStatus === "Pending" && a.type === "FollowUp" && (a.notesDisplay || a.notes)
    );
  }, [contactActivities]);

  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();

  const [actType, setActType] = useState("Call");
  const [discussionNotes, setDiscussionNotes] = useState("");
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [nextPriority, setNextPriority] = useState("Medium");
  const [nextType, setNextType] = useState("Call");
  const [nextNotes, setNextNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [prevNotesExpanded, setPrevNotesExpanded] = useState(false);
  const [currentNotesExpanded, setCurrentNotesExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  const isPendingActivity = activity?.callStatus === "Pending";

  const resetForm = () => {
    setActType("Call");
    setDiscussionNotes("");
    setScheduleNext(false);
    setNextDate("");
    setNextTime("");
    setNextPriority("Medium");
    setNextType("Call");
    setNextNotes("");
    setErrors({});
    setPrevNotesExpanded(false);
    setCurrentNotesExpanded(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (scheduleNext) {
      if (!nextDate) errs.nextDate = "Next activity date is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!dealId) {
      toast({ title: "Create a deal first", variant: "destructive" });
      return;
    }
    setSaving(true);

    try {
      // Step 1: Complete current activity if it's pending
      if (isPendingActivity && activity) {
        await updateActivity.mutateAsync({
          id: activity.id,
          data: {
            callStatus: "Completed",
            notes: discussionNotes || activity.notes || null,
          } as any,
        });
      }

      // Step 2: Create today's activity log ONLY when the drawer was opened to log a NEW activity
      // (no existing activity passed). When an existing activity is present (completing or viewing),
      // only the PATCH above may run — never a duplicate POST.
      if (!activity) {
        await createActivity.mutateAsync({
          data: {
            dealId: Number(dealId),
            contactId,
            type: actType as any,
            notes: discussionNotes || null,
            followUpDate: today,
            callStatus: "Completed",
          },
        });
      }

      // Step 3: Schedule next activity if checked
      if (scheduleNext) {
        await createActivity.mutateAsync({
          data: {
            dealId: Number(dealId),
            contactId,
            type: "FollowUp",
            notes: nextNotes || null,
            followUpDate: nextDate,
            followUpTime: nextTime || null,
            followUpType: nextType,
            callStatus: "Pending",
            priority: nextPriority,
          } as any,
        });
      }

      onActivityChange(queryClient, Number(dealId), contactId);
      toast({ title: "Activity saved successfully" });
      resetForm();
      onOpenChange(false);
    } catch {
      toast({ title: "Error saving activity", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const currentNotes = activity?.notesDisplay || activity?.notes;
  const prevNotes = lastCallActivity?.notesDisplay || lastCallActivity?.notes;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-3xl w-full max-h-[90vh] overflow-y-auto overflow-x-hidden pb-8">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Activity
          </DialogTitle>
          {(contactName || contactCompany) && (
            <p className="text-sm text-muted-foreground mt-1">
              {contactName}{contactName && contactCompany ? " — " : ""}{contactCompany}
              {contactMobile && <span className="ml-2 font-mono">{contactMobile}</span>}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-5 py-4 w-full min-w-0 overflow-x-hidden">
          {/* Previous Call Notes */}
          {prevNotes && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <button
                type="button"
                onClick={() => setPrevNotesExpanded(!prevNotesExpanded)}
                className="flex items-center justify-between w-full text-left"
              >
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Previous Call Notes</span>
                {prevNotesExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {prevNotesExpanded && (
                <p className="text-sm mt-2 whitespace-pre-wrap break-words overflow-hidden w-full">{prevNotes}</p>
              )}
              {!prevNotesExpanded && (
                <p className="text-sm mt-1 text-muted-foreground truncate">{prevNotes.substring(0, 100)}{prevNotes.length > 100 ? "..." : ""}</p>
              )}
            </div>
          )}

          {/* Current Follow-up Notes */}
          {isPendingActivity && currentNotes && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <button
                type="button"
                onClick={() => setCurrentNotesExpanded(!currentNotesExpanded)}
                className="flex items-center justify-between w-full text-left"
              >
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Current Follow-up Notes</span>
                {currentNotesExpanded ? <ChevronUp className="h-3.5 w-3.5 text-blue-500" /> : <ChevronDown className="h-3.5 w-3.5 text-blue-500" />}
              </button>
              {currentNotesExpanded && (
                <p className="text-sm mt-2 text-blue-900 whitespace-pre-wrap break-words overflow-hidden w-full">{currentNotes}</p>
              )}
              {!currentNotesExpanded && (
                <p className="text-sm mt-1 text-blue-700 truncate">{currentNotes.substring(0, 100)}{currentNotes.length > 100 ? "..." : ""}</p>
              )}
            </div>
          )}

          {/* Log Today's Activity */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              Log Today's Activity
            </h3>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Activity Type</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ACTIVITY_TYPES.map(at => {
                  const Icon = at.icon;
                  const isSelected = actType === at.value;
                  return (
                    <button
                      key={at.value}
                      type="button"
                      onClick={() => setActType(at.value)}
                      className={`flex items-center gap-2 px-3 py-2 min-w-0 flex-wrap rounded-lg border text-sm transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 text-primary font-medium ring-1 ring-primary/20"
                          : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 break-words">{at.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Discussion Notes</Label>
              <Textarea
                value={discussionNotes}
                onChange={e => setDiscussionNotes(e.target.value)}
                placeholder="Enter notes from today's discussion..."
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          {/* Schedule Next Activity */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Checkbox
                id="schedule-next"
                checked={scheduleNext}
                onCheckedChange={(checked) => setScheduleNext(checked === true)}
              />
              <Label htmlFor="schedule-next" className="text-sm font-medium cursor-pointer">
                Schedule Next Activity
              </Label>
            </div>

            {scheduleNext && (
              <div className="space-y-4 pl-6 border-l-2 border-primary/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      Next Activity Date <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={nextDate}
                      onChange={e => { setNextDate(e.target.value); setErrors(prev => ({ ...prev, nextDate: "" })); }}
                      className={errors.nextDate ? "border-destructive" : ""}
                      min={today}
                    />
                    {errors.nextDate && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertTriangle className="h-3 w-3" />{errors.nextDate}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      Time
                    </Label>
                    <FlexibleTimeInput
                      value={nextTime}
                      onChange={v => { setNextTime(v); setErrors(prev => ({ ...prev, nextTime: "" })); }}
                      error={!!errors.nextTime}
                    />
                    {errors.nextTime && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertTriangle className="h-3 w-3" />{errors.nextTime}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Activity Type</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {NEXT_ACTIVITY_TYPES.map(at => {
                      const Icon = at.icon;
                      const isSelected = nextType === at.value;
                      return (
                        <button
                          key={at.value}
                          type="button"
                          onClick={() => setNextType(at.value)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                            isSelected
                              ? "border-primary bg-primary/5 text-primary font-medium ring-1 ring-primary/20"
                              : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 break-words">{at.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Priority</Label>
                  <div className="flex gap-1.5">
                    {PRIORITIES.map(p => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setNextPriority(p.value)}
                        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-all ${
                          nextPriority === p.value
                            ? `${p.color} border-current ring-1 ring-current`
                            : "text-muted-foreground border-border hover:bg-muted/30"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Next Follow-up Notes</Label>
                  <Textarea
                    value={nextNotes}
                    onChange={e => setNextNotes(e.target.value)}
                    placeholder="Enter notes for the next activity..."
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="h-10 px-5">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-10 px-5 gap-2">
            {saving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                Saving...
              </>
            ) : (
              "Save Activity"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
