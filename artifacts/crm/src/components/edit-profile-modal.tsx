import { useState, useEffect, useRef, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { X, Camera, User, Shield, Palette, Eye, EyeOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { onUserChange } from "@/lib/query-invalidation";

const COLOR_PALETTE = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#84cc16"];

type MeData = {
  id: number;
  name: string;
  username: string;
  role: string;
  colorCode: string;
  unit: string;
  profilePhoto?: string | null;
  canViewAllReports?: boolean;
  canAssignLeads?: boolean;
  permissions?: Record<string, boolean>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: MeData;
  updateUser: { mutate: (vars: { id: number; data: any }, opts: any) => void; isPending: boolean };
};

type FormErrors = Record<string, string>;

function validateForm(form: Record<string, any>, isEdit: boolean): FormErrors {
  const errors: FormErrors = {};
  if (!form.name?.trim()) errors.name = "Full name is required";
  if (!form.username?.trim()) errors.username = "Username is required";
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = "Enter a valid email address";
  if (form.mobile && !/^[\d\s+\-()]{7,15}$/.test(form.mobile)) errors.mobile = "Enter a valid phone number";
  if (form.newPassword) {
    if (!form.currentPassword) errors.currentPassword = "Current password is required to set a new one";
    if (form.newPassword.length < 6) errors.newPassword = "Password must be at least 6 characters";
    if (form.newPassword !== form.confirmPassword) errors.confirmPassword = "Passwords do not match";
  }
  return errors;
}

export function EditProfileModal({ open, onOpenChange, me, updateUser }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = me.role === "admin";

  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    mobile: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    role: "",
    unit: "",
    colorCode: "",
    profilePhoto: null as string | null,
  });

  const [initialSnapshot, setInitialSnapshot] = useState("");

  useEffect(() => {
    if (open) {
      const f = {
        name: me.name || "",
        username: me.username || "",
        email: "",
        mobile: "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        role: me.role || "sales",
        unit: me.unit || "All",
        colorCode: me.colorCode || COLOR_PALETTE[0],
        profilePhoto: (me as any).profilePhoto ?? null,
      };
      setForm(f);
      setInitialSnapshot(JSON.stringify({ name: f.name, username: f.username, unit: f.unit, colorCode: f.colorCode, profilePhoto: f.profilePhoto }));
      setErrors({});
      setTouched({});
      setShowCurrentPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
    }
  }, [open, me]);

  const hasUnsavedChanges = open && (() => {
    const current = JSON.stringify({ name: form.name, username: form.username, unit: form.unit, colorCode: form.colorCode, profilePhoto: form.profilePhoto });
    return current !== initialSnapshot || form.currentPassword !== "" || form.newPassword !== "";
  })();

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && hasUnsavedChanges) {
      if (!confirm("You have unsaved changes. Are you sure you want to close?")) return;
    }
    onOpenChange(nextOpen);
  }, [hasUnsavedChanges, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleOpenChange(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleOpenChange]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(p => ({ ...p, [k]: e.target.value }));
    setTouched(p => ({ ...p, [k]: true }));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    const token = localStorage.getItem("crm_token");
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const res = await fetch(`/api/users/${me.id}/photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setForm(p => ({ ...p, profilePhoto: data.profilePhoto }));
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    setPhotoUploading(true);
    const token = localStorage.getItem("crm_token");
    try {
      const res = await fetch(`/api/users/${me.id}/photo`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Remove failed");
      setForm(p => ({ ...p, profilePhoto: null }));
    } catch {
      toast({ title: "Failed to remove photo", variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSave = () => {
    const validationErrors = validateForm(form, true);
    setErrors(validationErrors);
    setTouched({ name: true, username: true, email: true, mobile: true, currentPassword: true, newPassword: true, confirmPassword: true });
    if (Object.keys(validationErrors).length > 0) return;

    const payload: Record<string, any> = {
      name: form.name.trim(),
      username: form.username.trim(),
      unit: form.unit,
      colorCode: form.colorCode,
    };
    if (form.newPassword) payload.password = form.newPassword;

    updateUser.mutate(
      { id: me.id, data: payload },
      {
        onSuccess: () => {
          onUserChange(queryClient);
          toast({ title: "Profile updated successfully" });
          onOpenChange(false);
        },
        onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
      }
    );
  };

  const fieldError = (k: string) => touched[k] && errors[k] ? errors[k] : null;

  if (!open) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onPointerDownOutside={(e) => { e.preventDefault(); handleOpenChange(false); }}
          className={cn(
            "fixed left-1/2 top-1/2 z-[9999] w-full -translate-x-1/2 -translate-y-1/2",
            "bg-background rounded-2xl shadow-2xl border",
            "max-h-[90vh] flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:duration-200 data-[state=open]:duration-200",
            "outline-none",
            "w-[95%] sm:w-[90%] md:w-[720px] lg:w-[780px]"
          )}
        >
          {/* ── Header ── */}
          <div className="shrink-0 px-6 pt-6 pb-4 border-b">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold tracking-tight">Edit Profile</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Update your account information</p>
              </div>
              <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring">
                <X className="h-4.5 w-4.5" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* ── Scrollable Body ── */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── Personal Information ── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold">Personal Information</h3>
              </div>

              {/* Profile Photo */}
              <div className="flex items-center gap-4 mb-5 p-3 rounded-xl bg-muted/30 border border-dashed">
                <UserAvatar profilePhoto={form.profilePhoto} name={form.name || "?"} className="w-16 h-16 border-2 border-border shadow-sm shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">Profile Photo</p>
                  <p className="text-xs text-muted-foreground mb-2">JPG, PNG or GIF. Max 5MB.</p>
                  <div className="flex gap-2">
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                    <Button variant="outline" size="sm" disabled={photoUploading} onClick={() => fileRef.current?.click()} className="h-8 text-xs">
                      <Camera className="h-3.5 w-3.5 mr-1.5" />
                      {photoUploading ? "Uploading..." : form.profilePhoto ? "Change" : "Upload"}
                    </Button>
                    {form.profilePhoto && (
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" disabled={photoUploading} onClick={handleRemovePhoto}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">
                    Full Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={form.name}
                    onChange={set("name")}
                    placeholder="Enter full name"
                    className={cn("mt-1.5", fieldError("name") && "border-destructive focus-visible:ring-destructive")}
                  />
                  {fieldError("name") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.name}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">
                    Username <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={form.username}
                    onChange={set("username")}
                    placeholder="username"
                    data-no-cap="1"
                    className={cn("mt-1.5", fieldError("username") && "border-destructive focus-visible:ring-destructive")}
                  />
                  {fieldError("username") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.username}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="you@example.com"
                    className={cn("mt-1.5", fieldError("email") && "border-destructive focus-visible:ring-destructive")}
                  />
                  {fieldError("email") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.email}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">Mobile Number</Label>
                  <Input
                    type="tel"
                    value={form.mobile}
                    onChange={set("mobile")}
                    placeholder="+91 98765 43210"
                    className={cn("mt-1.5", fieldError("mobile") && "border-destructive focus-visible:ring-destructive")}
                  />
                  {fieldError("mobile") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.mobile}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <div className="border-t" />

            {/* ── Security ── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Security</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Keep password blank if you don't want to change it.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label className="text-sm font-medium">Current Password</Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showCurrentPw ? "text" : "password"}
                      value={form.currentPassword}
                      onChange={set("currentPassword")}
                      placeholder="Enter current password"
                      autoComplete="current-password"
                      className={cn("pr-10", fieldError("currentPassword") && "border-destructive focus-visible:ring-destructive")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPw(p => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                    >
                      {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldError("currentPassword") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.currentPassword}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">New Password</Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showNewPw ? "text" : "password"}
                      value={form.newPassword}
                      onChange={set("newPassword")}
                      placeholder="Enter new password"
                      autoComplete="new-password"
                      className={cn("pr-10", fieldError("newPassword") && "border-destructive focus-visible:ring-destructive")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw(p => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                    >
                      {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldError("newPassword") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.newPassword}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">Confirm Password</Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showConfirmPw ? "text" : "password"}
                      value={form.confirmPassword}
                      onChange={set("confirmPassword")}
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      className={cn("pr-10", fieldError("confirmPassword") && "border-destructive focus-visible:ring-destructive")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw(p => !p)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                    >
                      {showConfirmPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {fieldError("confirmPassword") && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {errors.confirmPassword}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <div className="border-t" />

            {/* ── Role & Access ── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold">Role & Access</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Role</Label>
                  {isAdmin ? (
                    <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v }))}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin (CEO)</SelectItem>
                        <SelectItem value="sales">Sales</SelectItem>
                        <SelectItem value="support">Support</SelectItem>
                        <SelectItem value="production_manager">Production Manager</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="mt-1.5 px-3 py-2.5 rounded-lg border bg-muted/50 text-sm capitalize">
                      {form.role.replace("_", " ")}
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium">Unit</Label>
                  <Select value={form.unit} onValueChange={v => setForm(p => ({ ...p, unit: v }))}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["All", "Himatnagar", "Surat", "Rajkot"].map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <div className="border-t" />

            {/* ── Appearance ── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Palette className="h-3.5 w-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold">Appearance</h3>
              </div>
              <Label className="text-sm font-medium">Theme Color</Label>
              <div className="flex gap-2.5 flex-wrap mt-2">
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, colorCode: c }))}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 transition-all duration-150",
                      form.colorCode === c
                        ? "border-foreground scale-110 ring-2 ring-foreground/20"
                        : "border-transparent hover:scale-105 hover:border-muted-foreground/30"
                    )}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <Input
                  value={form.colorCode}
                  onChange={set("colorCode")}
                  placeholder="#hex"
                  data-no-cap="1"
                  className="w-24 h-8 text-xs font-mono"
                />
              </div>
            </section>
          </div>

          {/* ── Sticky Footer ── */}
          <div className="shrink-0 border-t bg-background px-6 py-4 flex items-center justify-end gap-3 rounded-b-2xl">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={updateUser.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateUser.isPending || !form.name.trim() || !form.username.trim()}
              className="min-w-[120px]"
            >
              {updateUser.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
