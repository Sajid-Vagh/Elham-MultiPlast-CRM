import { useState, useEffect, useRef } from "react";
import { useGetMe, useListUsers, useCreateUser, useUpdateUser, useDeleteUser } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, SlidersHorizontal, Users, Camera, X as XIcon, CheckCircle2, ArrowLeft, Settings2, Truck, AlertTriangle, BarChart3, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { onUserChange } from "@/lib/query-invalidation";
import { UserAvatar } from "@/components/user-avatar";

const COLOR_PALETTE = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#14b8a6","#f97316","#84cc16"];

type User = { id: number; name: string; username: string; role: string; colorCode: string; unit: string; profilePhoto?: string | null; canViewAllReports?: boolean; canAssignLeads?: boolean; permissions?: Record<string, boolean> };

type PermissionDef = { key: string; label: string; desc: string };

type PermissionCategory = {
  id: string;
  label: string;
  icon: React.ReactNode;
  permissions: PermissionDef[];
};

const SUPPORT_PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "customer", label: "Customer Management",
    icon: <Users className="h-4 w-4" />,
    permissions: [
      { key: "manageExistingCustomers", label: "Manage Existing Customers", desc: "View and edit existing customer profiles and details" },
      { key: "viewCustomerTimeline", label: "View Customer Timeline", desc: "View the full activity timeline for customers" },
      { key: "updateCustomerCommunication", label: "Update Customer Communication", desc: "Log and update customer communication records" },
      { key: "createFollowups", label: "Create Follow-ups", desc: "Schedule and manage follow-up activities" },
    ],
  },
  {
    id: "production", label: "Production",
    icon: <Settings2 className="h-4 w-4" />,
    permissions: [
      { key: "viewProductionStatus", label: "View Production Status", desc: "View production batch status and progress" },
      { key: "coordinateProduction", label: "Coordinate Production", desc: "Communicate with production team on order requirements" },
      { key: "viewProductAvailability", label: "View Product Availability", desc: "Check current product stock and availability" },
    ],
  },
  {
    id: "dispatch", label: "Dispatch",
    icon: <Truck className="h-4 w-4" />,
    permissions: [
      { key: "manageDispatch", label: "Manage Dispatch", desc: "Create and manage dispatch entries" },
      { key: "editDispatchDetails", label: "Edit Dispatch Details", desc: "Modify dispatch information and status" },
    ],
  },
  {
    id: "complaints", label: "Complaints",
    icon: <AlertTriangle className="h-4 w-4" />,
    permissions: [
      { key: "handleCustomerComplaints", label: "Handle Customer Complaints", desc: "Create, update, and resolve customer complaints" },
    ],
  },
  {
    id: "reports", label: "Reports",
    icon: <BarChart3 className="h-4 w-4" />,
    permissions: [
      { key: "viewReports", label: "View Reports", desc: "Access CRM reports and analytics" },
    ],
  },
  {
    id: "general", label: "General",
    icon: <Shield className="h-4 w-4" />,
    permissions: [
      { key: "viewSalesOrders", label: "View Sales Orders", desc: "View all sales orders in the system" },
      { key: "receiveNotifications", label: "Receive Notifications", desc: "Get notified about order and complaint updates" },
      { key: "createQuickNotes", label: "Create Quick Notes", desc: "Add internal notes to customer records" },
    ],
  },
];

const PRODUCTION_PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: "production", label: "Production",
    icon: <Settings2 className="h-4 w-4" />,
    permissions: [
      { key: "updateBatchStatus", label: "Update Batch Status", desc: "Update production batch status and progress" },
      { key: "submitQcReports", label: "Submit QC Reports", desc: "Submit quality control reports for batches" },
      { key: "viewProductAvailability", label: "View Product Availability", desc: "Check current product stock and availability" },
    ],
  },
  {
    id: "general", label: "General",
    icon: <Shield className="h-4 w-4" />,
    permissions: [
      { key: "receiveNotifications", label: "Receive Notifications", desc: "Get notified about order and production updates" },
      { key: "createQuickNotes", label: "Create Quick Notes", desc: "Add internal notes to production orders" },
    ],
  },
];

const SALES_PERMISSIONS: PermissionDef[] = [
  { key: "canViewAllReports", label: "View all reports", desc: "Allow this user to view reports for all sales owners" },
  { key: "canAssignLeads", label: "Assign leads to others", desc: "Allow this user to assign leads to other sales owners" },
];

const ROLE_SUMMARIES: Record<string, { label: string; color: string; icon: React.ReactNode; bullets: string[] }> = {
  admin: { label: "Admin (CEO)", color: "bg-primary/10 text-primary border-primary/20", icon: <Shield className="h-4 w-4" />, bullets: ["Full system access", "Manage team & settings", "All reports & analytics"] },
  sales: { label: "Sales", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800", icon: <Users className="h-4 w-4" />, bullets: ["Existing Customers", "Follow-ups & Deals", "Reports & Pipeline"] },
  support: { label: "Support", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800", icon: <Users className="h-4 w-4" />, bullets: ["Existing Customers", "Repeat Orders", "Dispatch & Complaints", "Production Coordination"] },
  production_manager: { label: "Production Manager", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800", icon: <Settings2 className="h-4 w-4" />, bullets: ["Batch Management", "Quality Control", "Production Scheduling"] },
};

function getDefaultPermissions(role: string): Record<string, boolean> {
  const all: Record<string, boolean> = {};
  const cats = role === "production_manager" ? PRODUCTION_PERMISSION_CATEGORIES : SUPPORT_PERMISSION_CATEGORIES;
  for (const cat of cats) for (const p of cat.permissions) all[p.key] = true;
  return all;
}

function getAllPermissionKeys(role: string): string[] {
  const keys: string[] = [];
  const cats = role === "production_manager" ? PRODUCTION_PERMISSION_CATEGORIES : SUPPORT_PERMISSION_CATEGORIES;
  for (const cat of cats) for (const p of cat.permissions) keys.push(p.key);
  return keys;
}

function CategoryCard({ cat, permStates, onToggle }: { cat: PermissionCategory; permStates: Record<string, boolean>; onToggle: (key: string, v: boolean) => void }) {
  const enabledCount = cat.permissions.filter(p => permStates[p.key]).length;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground">{cat.icon}</span>
          <h4 className="text-sm font-bold">{cat.label}</h4>
        </div>
        <Badge variant={enabledCount === cat.permissions.length ? "default" : enabledCount > 0 ? "secondary" : "outline"} className="text-[11px] font-medium tabular-nums px-2 py-0.5">
          {enabledCount}/{cat.permissions.length}
        </Badge>
      </div>
      <div className="divide-y divide-border/50">
        {cat.permissions.map(p => {
          const checked = !!permStates[p.key];
          return (
            <div
              key={p.key}
              className="flex items-center justify-between gap-4 px-5 min-h-[50px] py-2.5 transition-colors hover:bg-muted/30 cursor-pointer select-none"
              onClick={() => onToggle(p.key, !checked)}
            >
              <div className="min-w-0 flex-1 py-0.5">
                <p className={`text-[13.5px] font-medium leading-snug ${checked ? "text-foreground" : "text-muted-foreground"}`}>{p.label}</p>
                <p className="text-[12.5px] text-muted-foreground/70 mt-0.5 leading-snug line-clamp-1">{p.desc}</p>
              </div>
              <Switch checked={checked} onCheckedChange={v => onToggle(p.key, v)} className="shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UserForm({ initial, onSave, onCancel, loading, isEdit, me }: { initial?: Partial<User>; onSave: (d: any) => void; onCancel: () => void; loading: boolean; isEdit?: boolean; me?: User | null }) {
  const [form, setForm] = useState({
    name: initial?.name || "", username: initial?.username || "", password: "",
    role: initial?.role || "sales", colorCode: initial?.colorCode || COLOR_PALETTE[0], unit: initial?.unit || "All",
    canViewAllReports: initial?.canViewAllReports ?? false, canAssignLeads: initial?.canAssignLeads ?? false,
    permissions: initial?.permissions ?? {} as Record<string, boolean>,
    profilePhoto: initial?.profilePhoto ?? null as string | null,
  });
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    setForm({
      name: initial?.name || "", username: initial?.username || "", password: "",
      role: initial?.role || "sales", colorCode: initial?.colorCode || COLOR_PALETTE[0], unit: initial?.unit || "All",
      canViewAllReports: initial?.canViewAllReports ?? false, canAssignLeads: initial?.canAssignLeads ?? false,
      permissions: initial?.permissions ?? {} as Record<string, boolean>,
      profilePhoto: initial?.profilePhoto ?? null,
    });
  }, [initial]);

  const handleRoleChange = (newRole: string) => {
    setForm(p => {
      if (newRole === "support" || newRole === "production_manager") {
        return { ...p, role: newRole, permissions: getDefaultPermissions(newRole) };
      }
      return { ...p, role: newRole, permissions: {} };
    });
  };

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const isAdmin = me?.role === "admin";
  const userId = initial?.id;
  const canEditPhoto = userId && (isAdmin || me?.id === userId);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setPhotoUploading(true);
    const token = localStorage.getItem("crm_token");
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const res = await fetch(`/api/users/${userId}/photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setForm(p => ({ ...p, profilePhoto: data.profilePhoto }));
      onSave({ ...form, profilePhoto: data.profilePhoto });
    } catch (err) {
      console.error("Photo upload error", err);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!userId) return;
    setPhotoUploading(true);
    const token = localStorage.getItem("crm_token");
    try {
      const res = await fetch(`/api/users/${userId}/photo`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Remove failed");
      setForm(p => ({ ...p, profilePhoto: null }));
      onSave({ ...form, profilePhoto: null });
    } catch (err) {
      console.error("Photo remove error", err);
    } finally {
      setPhotoUploading(false);
    }
  };

  const togglePermission = (key: string, value: boolean) => {
    setForm(p => ({ ...p, permissions: { ...p.permissions, [key]: value } }));
  };

  const selectAll = () => setForm(p => ({ ...p, permissions: getDefaultPermissions(p.role) }));
  const clearAll = () => setForm(p => ({ ...p, permissions: {} }));
  const resetToDefault = () => setForm(p => ({ ...p, permissions: getDefaultPermissions(p.role) }));

  const photoFileRef = useRef<HTMLInputElement>(null);

  const hasPermissions = form.role === "support" || form.role === "production_manager";
  const hasSalesPerms = form.role === "sales";
  const categories = form.role === "production_manager" ? PRODUCTION_PERMISSION_CATEGORIES : SUPPORT_PERMISSION_CATEGORIES;
  const roleSummary = ROLE_SUMMARIES[form.role];
  const totalPerms = getAllPermissionKeys(form.role).length;
  const enabledPerms = getAllPermissionKeys(form.role).filter(k => form.permissions[k]).length;

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky Header ── */}
      <div className="shrink-0 border-b bg-background px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-bold">{isEdit ? "Edit Team Member" : "Add Team Member"}</h2>
            <p className="text-xs text-muted-foreground">{isEdit ? "Update user information and permissions" : "Create a new team member and configure permissions"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={loading || !form.name || !form.username || (!isEdit && !form.password)}
            onClick={() => onSave({ ...form, password: form.password || undefined })}>
            {loading ? "Saving..." : isEdit ? "Update Member" : "Create Member"}
          </Button>
        </div>
      </div>

      {/* ── Two-Column Body ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">

        {/* ── LEFT PANEL: User Info (35%) ── */}
        <div className="w-full md:w-[35%] md:max-w-[380px] shrink-0 border-b md:border-b-0 md:border-r bg-muted/20 overflow-y-auto">
          <div className="p-6 space-y-5">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">User Information</h3>
              <div className="space-y-3.5">
                <div><Label className="text-sm">Full Name *</Label><Input value={form.name} onChange={f("name")} placeholder="Enter full name" className="mt-1.5" /></div>
                <div><Label className="text-sm">Username *</Label><Input value={form.username} onChange={f("username")} data-no-cap="1" placeholder="username" className="mt-1.5" /></div>
                <div><Label className="text-sm">{isEdit ? "New Password (leave blank to keep)" : "Password *"}</Label><Input type="password" value={form.password} onChange={f("password")} placeholder={isEdit ? "Leave blank to keep" : "Enter password"} className="mt-1.5" /></div>
              </div>
            </div>

            <div className="border-t pt-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Role & Access</h3>
              <div className="space-y-3.5">
                <div><Label className="text-sm">Role</Label>
                  <Select value={form.role} onValueChange={handleRoleChange}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin (CEO)</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="support">Support</SelectItem>
                      <SelectItem value="production_manager">Production Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-sm">Unit</Label>
                  <Select value={form.unit} onValueChange={v => setForm(p => ({ ...p, unit: v }))}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>{["All","Himatnagar","Surat","Rajkot"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="border-t pt-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Appearance</h3>
              <div><Label className="text-sm">Colour Code</Label>
                <div className="flex gap-2 flex-wrap mt-2">
                  {COLOR_PALETTE.map(c => (
                    <button key={c} type="button" onClick={() => setForm(p => ({ ...p, colorCode: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all duration-100 ${form.colorCode === c ? "border-foreground scale-110 ring-2 ring-foreground/20" : "border-transparent hover:scale-105"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <Input value={form.colorCode} onChange={f("colorCode")} placeholder="#hex" className="w-20 h-7 text-xs" data-no-cap="1" />
                </div>
              </div>
            </div>

            {/* Role Summary Card */}
            {roleSummary && (
              <div className="border-t pt-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Role Overview</h3>
                <div className={`rounded-xl border px-4 py-3.5 ${roleSummary.color}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {roleSummary.icon}
                    <span className="font-bold text-sm">{roleSummary.label}</span>
                  </div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1.5">Responsible for</p>
                  <div className="flex flex-col gap-1">
                    {roleSummary.bullets.map(b => (
                      <span key={b} className="text-xs font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 shrink-0 opacity-70" />{b}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Profile Photo (edit only) */}
            {isEdit && canEditPhoto && (
              <div className="border-t pt-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Profile Photo</h3>
                <div className="flex items-center gap-4">
                  <UserAvatar profilePhoto={form.profilePhoto} name={form.name || "?"} className="w-14 h-14 border-2 border-border shrink-0" />
                  <div className="space-y-1.5">
                    <input ref={photoFileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                    <Button variant="outline" size="sm" disabled={photoUploading} onClick={() => photoFileRef.current?.click()} className="w-full">
                      <Camera className="h-3.5 w-3.5 mr-1" />
                      {photoUploading ? "Uploading..." : form.profilePhoto ? "Change Photo" : "Upload Photo"}
                    </Button>
                    {form.profilePhoto && (
                      <Button variant="ghost" size="sm" className="text-destructive w-full" disabled={photoUploading} onClick={handleRemovePhoto}>
                        <XIcon className="h-3.5 w-3.5 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL: Permissions (65%) ── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Sticky Permission Toolbar */}
          {hasPermissions && (
            <div className="shrink-0 border-b bg-background px-6 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">Permissions</h3>
                <p className="text-xs text-muted-foreground">{enabledPerms} of {totalPerms} permissions enabled</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={selectAll}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Select All
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={clearAll}>
                  <XIcon className="h-3.5 w-3.5 mr-1.5" /> Clear All
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={resetToDefault}>
                  Reset Default
                </Button>
              </div>
            </div>
          )}

          {/* Scrollable Permission Content */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {hasPermissions && (
              <div className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {categories.map(cat => (
                    <CategoryCard
                      key={cat.id}
                      cat={cat}
                      permStates={form.permissions}
                      onToggle={togglePermission}
                    />
                  ))}
                </div>
              </div>
            )}

            {hasSalesPerms && (
              <div className="p-6">
                <div className="rounded-xl border bg-card shadow-sm overflow-hidden max-w-xl">
                  <div className="flex items-center gap-2.5 px-5 py-3.5 border-b bg-muted/30">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-bold">Sales Permissions</h4>
                  </div>
                  <div className="divide-y divide-border/50">
                    {SALES_PERMISSIONS.map(p => (
                      <div key={p.key} className="flex items-center justify-between gap-4 px-5 min-h-[50px] py-2.5">
                        <div>
                          <p className="text-[13.5px] font-medium">{p.label}</p>
                          <p className="text-[12.5px] text-muted-foreground/70 mt-0.5">{p.desc}</p>
                        </div>
                        <Switch checked={p.key === "canViewAllReports" ? form.canViewAllReports : form.canAssignLeads}
                          onCheckedChange={v => setForm(prev => ({ ...prev, [p.key]: v }))} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {form.role === "admin" && (
              <div className="p-6">
                <div className="rounded-xl border bg-card shadow-sm p-8 text-center max-w-xl mx-auto">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <h4 className="text-base font-bold mb-1">Full Access</h4>
                  <p className="text-sm text-muted-foreground">Admin has unrestricted access to all modules. No permission configuration required.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SalesProfileView({ me, onClose }: { me: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [photo, setPhoto] = useState<string | null | undefined>((me as any).profilePhoto);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
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
      setPhoto(data.profilePhoto);
      onUserChange(queryClient);
      toast({ title: "Profile photo updated" });
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    const token = localStorage.getItem("crm_token");
    try {
      const res = await fetch(`/api/users/${me.id}/photo`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Remove failed");
      setPhoto(null);
      onUserChange(queryClient);
      toast({ title: "Profile photo removed" });
    } catch {
      toast({ title: "Failed to remove photo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-col items-center gap-3 pb-4 border-b">
        <UserAvatar profilePhoto={photo} name={me.name} className="w-24 h-24 border-2 border-border shadow-sm" />
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Camera className="h-3.5 w-3.5 mr-1" />
            {uploading ? "Uploading..." : photo ? "Change Photo" : "Upload Photo"}
          </Button>
          {photo && (
            <Button variant="ghost" size="sm" className="text-destructive" disabled={uploading} onClick={handleRemove}>
              <XIcon className="h-3.5 w-3.5 mr-1" /> Remove
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label className="text-xs text-muted-foreground">Full Name</Label><p className="text-sm font-medium mt-1">{me.name}</p></div>
        <div><Label className="text-xs text-muted-foreground">Username</Label><p className="text-sm font-mono mt-1">@{me.username}</p></div>
        <div><Label className="text-xs text-muted-foreground">Role</Label><p className="text-sm capitalize mt-1">{me.role.replace("_", " ")}</p></div>
        <div><Label className="text-xs text-muted-foreground">Unit</Label><p className="text-sm mt-1">{me.unit || "\u2014"}</p></div>
      </div>
      <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </div>
  );
}

export default function Settings() {
  const { data: me } = useGetMe();
  const { data: users, isLoading } = useListUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  const [autoCap, setAutoCap] = useState(() => localStorage.getItem("crm_autocap") !== "off");
  const handleAutoCapToggle = (val: boolean) => {
    setAutoCap(val);
    localStorage.setItem("crm_autocap", val ? "on" : "off");
    toast({ title: val ? "Auto-capitalize turned ON" : "Auto-capitalize turned OFF" });
  };

  const [showCompletedFor24Hours, setShowCompletedFor24Hours] = useState(() => localStorage.getItem("crm_showCompletedFor24Hours") === "on");
  const handleShowCompletedToggle = (val: boolean) => {
    setShowCompletedFor24Hours(val);
    localStorage.setItem("crm_showCompletedFor24Hours", val ? "on" : "off");
    toast({ title: val ? "Show completed deals for 24 hours turned ON" : "Show completed deals for 24 hours turned OFF" });
  };

  const handleCreate = (data: any) => {
    createUser.mutate({ data }, {
      onSuccess: () => { onUserChange(queryClient); toast({ title: "Team member added" }); setCreateOpen(false); },
      onError: (e: any) => {
        const d = e?.data;
        const details = d?.details;
        let msg = d?.error || "Error";
        if (details?.fieldErrors) {
          const fieldMsgs = Object.entries(details.fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ");
          if (fieldMsgs) msg += ` \u2014 ${fieldMsgs}`;
        }
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  const handleUpdate = (data: any) => {
    if (!editUser) return;
    const payload = { ...data };
    if (!payload.password) delete payload.password;
    updateUser.mutate({ id: editUser.id, data: payload }, {
      onSuccess: () => { onUserChange(queryClient); toast({ title: "Updated" }); setEditUser(null); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Remove this team member?")) return;
    deleteUser.mutate({ id }, {
      onSuccess: () => { onUserChange(queryClient); toast({ title: "Removed" }); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const isAdmin = me?.role === "admin";
  const [profileEditOpen, setProfileEditOpen] = useState(false);

  // ── Full-page overlay for Add/Edit ──
  if (createOpen || editUser) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <UserForm
          initial={editUser ?? undefined}
          onSave={createOpen ? handleCreate : handleUpdate}
          onCancel={() => { setCreateOpen(false); setEditUser(null); }}
          loading={createUser.isPending || updateUser.isPending}
          isEdit={!!editUser}
          me={me}
        />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your preferences{isAdmin ? " and team members" : ""}</p>
      </div>

      {/* My Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            My Profile
          </CardTitle>
          <CardDescription>Your personal information and account settings.</CardDescription>
        </CardHeader>
        <CardContent>
          {me ? (
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex flex-col items-center gap-2">
                <UserAvatar profilePhoto={(me as any).profilePhoto} name={me.name} className="w-20 h-20 border-2 border-border shadow-sm" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground font-medium">Name</p><p className="text-sm font-semibold">{me.name}</p></div>
                  <div><p className="text-xs text-muted-foreground font-medium">Username</p><p className="text-sm font-mono">@{me.username}</p></div>
                  <div><p className="text-xs text-muted-foreground font-medium">Role</p><p className="text-sm capitalize">{me.role.replace("_", " ")}</p></div>
                  <div><p className="text-xs text-muted-foreground font-medium">Unit</p><p className="text-sm">{me.unit || "\u2014"}</p></div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setProfileEditOpen(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Profile
                </Button>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Loading...</p>}
        </CardContent>
      </Card>

      <Dialog open={profileEditOpen} onOpenChange={o => !o && setProfileEditOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isAdmin ? "Edit Profile" : "My Profile"}</DialogTitle></DialogHeader>
          {me && (isAdmin ? (
            <UserForm
              initial={{ id: me.id, name: me.name, username: me.username, role: me.role, unit: me.unit, colorCode: me.colorCode, profilePhoto: (me as any).profilePhoto, canViewAllReports: (me as any).canViewAllReports ?? false, canAssignLeads: (me as any).canAssignLeads ?? false, permissions: (me as any).permissions ?? {} }}
              onSave={(data) => {
                const payload = { ...data };
                if (!payload.password) delete payload.password;
                updateUser.mutate({ id: me.id, data: payload }, { onSuccess: () => { onUserChange(queryClient); toast({ title: "Profile updated" }); setProfileEditOpen(false); }, onError: () => toast({ title: "Error", variant: "destructive" }) });
              }}
              onCancel={() => setProfileEditOpen(false)}
              loading={updateUser.isPending}
              isEdit
              me={me}
            />
          ) : (
            <SalesProfileView me={me} onClose={() => setProfileEditOpen(false)} />
          ))}
        </DialogContent>
      </Dialog>

      {/* Preferences */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            CRM Preferences
          </CardTitle>
          <CardDescription>Personalise your experience \u2014 these settings are saved on this device only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2 border-b">
            <div>
              <p className="font-medium text-sm">Auto-capitalize text fields</p>
              <p className="text-xs text-muted-foreground mt-0.5">Automatically capitalise the first letter of each word as you type in text fields.</p>
            </div>
            <Switch checked={autoCap} onCheckedChange={handleAutoCapToggle} />
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <div>
              <p className="font-medium text-sm">Show Completed Deals in Pipeline for 24 Hours</p>
              <p className="text-xs text-muted-foreground mt-0.5">When enabled, Won and Lost deals remain visible for 24 hours after completion.</p>
            </div>
            <Switch checked={showCompletedFor24Hours} onCheckedChange={handleShowCompletedToggle} />
          </div>
        </CardContent>
      </Card>

      {/* Team Management */}
      {isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Team Members</h2>
            </div>
            <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Member</Button>
          </div>

          <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead>Reports</TableHead>
                  <TableHead>Assign</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
                ) : users?.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">@{u.username}</TableCell>
                    <TableCell><Badge variant={u.role === "admin" ? "default" : u.role === "support" ? "outline" : "secondary"}>{u.role === "production_manager" ? "Production Mgr" : u.role === "support" ? "Support" : u.role}</Badge></TableCell>
                    <TableCell>{u.unit}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar profilePhoto={u.profilePhoto} name={u.name} className="w-5 h-5 border shadow-sm" />
                        <span className="text-xs text-muted-foreground font-mono">{u.colorCode}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {u.role === "admin" || u.role === "support" || u.role === "production_manager" ? <span className="text-muted-foreground">\u2014</span> : (u.canViewAllReports ? <span className="text-green-600 font-medium">Yes</span> : <span className="text-red-500">No</span>)}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {u.role === "admin" || u.role === "support" || u.role === "production_manager" ? <span className="text-muted-foreground">\u2014</span> : (u.canAssignLeads ? <span className="text-green-600 font-medium">Yes</span> : <span className="text-red-500">No</span>)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditUser(u as User)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(u.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
