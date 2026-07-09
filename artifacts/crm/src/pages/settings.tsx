import { useState, useEffect, useRef } from "react";
import { useGetMe, useListUsers, useCreateUser, useUpdateUser, useDeleteUser, getListUsersQueryKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, SlidersHorizontal, Users, Camera, X as XIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { onUserChange } from "@/lib/query-invalidation";
import { UserAvatar } from "@/components/user-avatar";
import { UNITS } from "@/lib/units";

const COLOR_PALETTE = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#14b8a6","#f97316","#84cc16"];

type User = { id: number; name: string; username: string; role: string; colorCode: string; unit: string; profilePhoto?: string | null; canViewAllReports?: boolean; canAssignLeads?: boolean };

function UserForm({ initial, onSave, onCancel, loading, isEdit, me }: { initial?: Partial<User>; onSave: (d: any) => void; onCancel: () => void; loading: boolean; isEdit?: boolean; me?: User | null }) {
  const [form, setForm] = useState({
    name: initial?.name || "", username: initial?.username || "", password: "",
    role: initial?.role || "sales", colorCode: initial?.colorCode || COLOR_PALETTE[0], unit: initial?.unit || "All",
    canViewAllReports: initial?.canViewAllReports ?? false, canAssignLeads: initial?.canAssignLeads ?? false,
    profilePhoto: initial?.profilePhoto ?? null as string | null,
  });
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    setForm({
      name: initial?.name || "", username: initial?.username || "", password: "",
      role: initial?.role || "sales", colorCode: initial?.colorCode || COLOR_PALETTE[0], unit: initial?.unit || "All",
      canViewAllReports: initial?.canViewAllReports ?? false, canAssignLeads: initial?.canAssignLeads ?? false,
      profilePhoto: initial?.profilePhoto ?? null,
    });
  }, [initial]);

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

  const photoFileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4 pt-2">
      {/* Profile Photo */}
      {isEdit && canEditPhoto && (
        <div className="flex items-center gap-4 pb-2 border-b">
          <div className="relative">
            <UserAvatar profilePhoto={form.profilePhoto} name={form.name || "?"} className="w-16 h-16 border-2 border-border" />
          </div>
          <div className="space-y-1.5">
            <input ref={photoFileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            <Button variant="outline" size="sm" disabled={photoUploading} onClick={() => photoFileRef.current?.click()}>
              <Camera className="h-3.5 w-3.5 mr-1" />
              {photoUploading ? "Uploading..." : form.profilePhoto ? "Change Photo" : "Upload Photo"}
            </Button>
            {form.profilePhoto && (
              <Button variant="ghost" size="sm" className="text-destructive" disabled={photoUploading} onClick={handleRemovePhoto}>
                <XIcon className="h-3.5 w-3.5 mr-1" /> Remove
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Full Name *</Label><Input value={form.name} onChange={f("name")} placeholder="Name" /></div>
        <div><Label>Username *</Label><Input value={form.username} onChange={f("username")} data-no-cap="1" placeholder="username" /></div>
        <div>
          <Label>{isEdit ? "New Password (leave blank to keep)" : "Password *"}</Label>
          <Input type="password" value={form.password} onChange={f("password")} placeholder={isEdit ? "Leave blank to keep" : "Password"} />
        </div>
        <div><Label>Role</Label>
          <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin (CEO)</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="production_manager">Production Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Unit</Label>
          <Select value={form.unit} onValueChange={v => setForm(p => ({ ...p, unit: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["All","Himatnagar","Surat","Rajkot"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Colour Code</Label>
          <div className="flex gap-2 flex-wrap mt-1">
            {COLOR_PALETTE.map(c => (
              <button key={c} type="button" onClick={() => setForm(p => ({ ...p, colorCode: c }))}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${form.colorCode === c ? "border-foreground scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }} />
            ))}
            <Input value={form.colorCode} onChange={f("colorCode")} placeholder="#hex" className="w-24 h-7 text-xs" data-no-cap="1" />
          </div>
        </div>
      </div>
      {form.role === "sales" && (
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Sales Permissions</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">View all reports</p>
              <p className="text-xs text-muted-foreground">Allow this user to view reports for all sales owners</p>
            </div>
            <Switch checked={form.canViewAllReports} onCheckedChange={v => setForm(p => ({ ...p, canViewAllReports: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Assign leads to others</p>
              <p className="text-xs text-muted-foreground">Allow this user to assign leads to other sales owners</p>
            </div>
            <Switch checked={form.canAssignLeads} onCheckedChange={v => setForm(p => ({ ...p, canAssignLeads: v }))} />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={loading || !form.name || !form.username || (!isEdit && !form.password)}
          onClick={() => onSave({ ...form, password: form.password || undefined })}>
          {loading ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
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
      {/* Photo section */}
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

      {/* Read-only fields */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Full Name</Label>
          <p className="text-sm font-medium mt-1">{me.name}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Username</Label>
          <p className="text-sm font-mono mt-1">@{me.username}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Role</Label>
          <p className="text-sm capitalize mt-1">{me.role.replace("_", " ")}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Unit</Label>
          <p className="text-sm mt-1">{me.unit || "—"}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
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

  // Auto-capitalize preference (persisted in localStorage)
  const [autoCap, setAutoCap] = useState(() => localStorage.getItem("crm_autocap") !== "off");

  const handleAutoCapToggle = (val: boolean) => {
    setAutoCap(val);
    localStorage.setItem("crm_autocap", val ? "on" : "off");
    toast({ title: val ? "Auto-capitalize turned ON" : "Auto-capitalize turned OFF" });
  };

  // Show completed deals for 24 hours preference (persisted in localStorage)
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
          if (fieldMsgs) msg += ` — ${fieldMsgs}`;
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
      onSuccess: () => {
        onUserChange(queryClient);
        toast({ title: "Updated" });
        setEditUser(null);
      },
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

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your preferences{isAdmin ? " and team members" : ""}</p>
      </div>

      {/* ── My Profile (all users) ── */}
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
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Name</p>
                    <p className="text-sm font-semibold">{me.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Username</p>
                    <p className="text-sm font-mono">@{me.username}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Role</p>
                    <p className="text-sm capitalize">{me.role.replace("_", " ")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Unit</p>
                    <p className="text-sm">{me.unit || "—"}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setProfileEditOpen(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Profile
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={profileEditOpen} onOpenChange={o => !o && setProfileEditOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isAdmin ? "Edit Profile" : "My Profile"}</DialogTitle></DialogHeader>
          {me && (isAdmin ? (
            <UserForm
              initial={{
                id: me.id,
                name: me.name,
                username: me.username,
                role: me.role,
                unit: me.unit,
                colorCode: me.colorCode,
                profilePhoto: (me as any).profilePhoto,
                canViewAllReports: (me as any).canViewAllReports ?? false,
                canAssignLeads: (me as any).canAssignLeads ?? false,
              }}
              onSave={(data) => {
                const payload = { ...data };
                if (!payload.password) delete payload.password;
                updateUser.mutate({ id: me.id, data: payload }, {
                  onSuccess: () => {
                    onUserChange(queryClient);
                    toast({ title: "Profile updated" });
                    setProfileEditOpen(false);
                  },
                  onError: () => toast({ title: "Error", variant: "destructive" }),
                });
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

      {/* ── Preferences (all users) ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            CRM Preferences
          </CardTitle>
          <CardDescription>Personalise your experience — these settings are saved on this device only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2 border-b">
            <div>
              <p className="font-medium text-sm">Auto-capitalize text fields</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically capitalise the first letter of each word as you type in text fields.
                Does not apply to username, email, or password fields.
              </p>
            </div>
            <Switch checked={autoCap} onCheckedChange={handleAutoCapToggle} />
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <div>
              <p className="font-medium text-sm">Show Completed Deals in Pipeline for 24 Hours</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, Won and Lost deals remain visible in the pipeline for 24 hours after completion,
                then are automatically hidden. When disabled, completed deals are removed from the pipeline immediately.
                Reports and history are unaffected.
              </p>
            </div>
            <Switch checked={showCompletedFor24Hours} onCheckedChange={handleShowCompletedToggle} />
          </div>
        </CardContent>
      </Card>

      {/* ── Team Management (admin only) ── */}
      {isAdmin && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Team Members</h2>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Add Member</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
                <UserForm onSave={handleCreate} onCancel={() => setCreateOpen(false)} loading={createUser.isPending} me={me} />
              </DialogContent>
            </Dialog>
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
                    <TableCell><Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge></TableCell>
                    <TableCell>{u.unit}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar profilePhoto={u.profilePhoto} name={u.name} className="w-5 h-5 border shadow-sm" />
                        <span className="text-xs text-muted-foreground font-mono">{u.colorCode}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {u.role === "admin" ? <span className="text-muted-foreground">—</span> : (u.canViewAllReports ? <span className="text-green-600 font-medium">Yes</span> : <span className="text-red-500">No</span>)}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {u.role === "admin" ? <span className="text-muted-foreground">—</span> : (u.canAssignLeads ? <span className="text-green-600 font-medium">Yes</span> : <span className="text-red-500">No</span>)}
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

      <Dialog open={!!editUser} onOpenChange={o => !o && setEditUser(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Team Member</DialogTitle></DialogHeader>
          {editUser && <UserForm initial={editUser} onSave={handleUpdate} onCancel={() => setEditUser(null)} loading={updateUser.isPending} isEdit me={me} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
