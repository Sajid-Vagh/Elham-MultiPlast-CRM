import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateActivity, getListActivitiesQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { onActivityChange } from "@/lib/query-invalidation";
import { Calendar as CalendarIcon, Clock, Phone, MessageSquare, Video, Users, Bell, AlertTriangle, Mail, MapPin } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";

interface ScheduleFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: number;
  dealId?: number | null;
}

const FOLLOW_UP_TYPES = [
  { value: "Phone Call", label: "Phone Call", icon: Phone },
  { value: "WhatsApp", label: "WhatsApp", icon: MessageSquare },
  { value: "Meeting", label: "Meeting", icon: Users },
  { value: "Email", label: "Email", icon: Mail },
  { value: "Video Call", label: "Video Call", icon: Video },
  { value: "Site Visit", label: "Site Visit", icon: MapPin },
];

const PRIORITIES = [
  { value: "High", label: "High", color: "text-red-600 bg-red-50" },
  { value: "Medium", label: "Medium", color: "text-amber-600 bg-amber-50" },
  { value: "Low", label: "Low", color: "text-green-600 bg-green-50" },
];

const REMINDERS = [
  { value: "15min", label: "15 minutes before" },
  { value: "30min", label: "30 minutes before" },
  { value: "1hour", label: "1 hour before" },
  { value: "1day", label: "1 day before" },
];

export function ScheduleFollowUpDialog({ open, onOpenChange, contactId, dealId }: ScheduleFollowUpDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createActivity = useCreateActivity();

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [followUpType, setFollowUpType] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [reminder, setReminder] = useState("");
  const [notes, setNotes] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const nowTime = useMemo(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, []);

  const { data: users } = useQuery({
    queryKey: ["users-for-assign"],
    queryFn: async () => {
      const token = localStorage.getItem("crm_token");
      const res = await fetch("/api/users", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ id: number; name: string; role: string; unit: string; colorCode: string }>>;
    },
    staleTime: 60_000,
  });

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!date) errs.date = "Follow-up date is required";
    else if (date < today) errs.date = "Cannot schedule in the past";

    if (!time) errs.time = "Follow-up time is required";
    else if (date === today && time < nowTime) errs.time = "Cannot schedule in the past";

    if (!followUpType) errs.followUpType = "Follow-up type is required";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    if (!dealId) {
      toast({ title: "Create a deal first", variant: "destructive" });
      return;
    }

    createActivity.mutate({
      data: {
        dealId: Number(dealId),
        contactId,
        type: "FollowUp",
        notes: notes || null,
        followUpDate: date || null,
        followUpTime: time || null,
        followUpType: followUpType,
        callStatus: "Pending",
        priority: priority,
        reminder: reminder || null,
        assignedTo: assignedTo ? Number(assignedTo) : null,
      },
    }, {
      onSuccess: () => {
        onActivityChange(queryClient, undefined, contactId);
        toast({ title: "Follow-up scheduled successfully" });
        resetForm();
        onOpenChange(false);
      },
      onError: () => toast({ title: "Error scheduling follow-up", variant: "destructive" }),
    });
  };

  const resetForm = () => {
    setDate("");
    setTime("");
    setFollowUpType("");
    setPriority("Medium");
    setAssignedTo("");
    setReminder("");
    setNotes("");
    setErrors({});
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Schedule Follow-up
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Fill in the details below to schedule a follow-up activity.
          </p>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Date & Time row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                Follow-up Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={date}
                onChange={e => { setDate(e.target.value); setErrors(prev => ({ ...prev, date: "" })); }}
                className={errors.date ? "border-destructive" : ""}
                min={today}
              />
              {errors.date && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertTriangle className="h-3 w-3" />{errors.date}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Follow-up Time <span className="text-destructive">*</span>
              </Label>
              <Input
                type="time"
                value={time}
                onChange={e => { setTime(e.target.value); setErrors(prev => ({ ...prev, time: "" })); }}
                className={errors.time ? "border-destructive" : ""}
              />
              {errors.time && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertTriangle className="h-3 w-3" />{errors.time}</p>}
            </div>
          </div>

          {/* Follow-up Type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Phone className="h-4 w-4 text-muted-foreground" />
              Follow-up Type <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FOLLOW_UP_TYPES.map(ft => {
                const Icon = ft.icon;
                const isSelected = followUpType === ft.value;
                return (
                  <button
                    key={ft.value}
                    type="button"
                    onClick={() => { setFollowUpType(ft.value); setErrors(prev => ({ ...prev, followUpType: "" })); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 text-primary font-medium ring-1 ring-primary/20"
                        : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{ft.label}</span>
                  </button>
                );
              })}
            </div>
            {errors.followUpType && <p className="text-xs text-destructive flex items-center gap-1 mt-1"><AlertTriangle className="h-3 w-3" />{errors.followUpType}</p>}
          </div>

          {/* Priority & Reminder row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                Priority
              </Label>
              <div className="flex gap-1.5">
                {PRIORITIES.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-all ${
                      priority === p.value
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
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Bell className="h-4 w-4 text-muted-foreground" />
                Reminder
              </Label>
              <Select value={reminder} onValueChange={setReminder}>
                <SelectTrigger>
                  <SelectValue placeholder="No reminder" />
                </SelectTrigger>
                <SelectContent>
                  {REMINDERS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assigned Sales Person */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              Assigned Sales Person
            </Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder="Select sales person (optional)" />
              </SelectTrigger>
              <SelectContent>
                {users?.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    <div className="flex items-center gap-2">
                      <UserAvatar profilePhoto={u.profilePhoto} name={u.name} className="w-2 h-2" />
                      {u.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Notes
            </Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Enter follow-up notes, agenda, or talking points..."
              rows={4}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="h-10 px-5">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createActivity.isPending} className="h-10 px-5 gap-2">
            {createActivity.isPending ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                Scheduling...
              </>
            ) : (
              <>
                <CalendarIcon className="h-4 w-4" />
                Schedule Follow-up
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
