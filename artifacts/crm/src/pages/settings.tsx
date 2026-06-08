import { useState, useEffect } from "react";
import { useGetMe, useListUsers, useCreateUser, useUpdateUser, useDeleteUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, SlidersHorizontal, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const COLOR_PALETTE = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#14b8a6","#f97316","#84cc16"];

type User = { id: number; name: string; username: string; role: string; colorCode: string; unit: string };

function UserForm({ initial, onSave, onCancel, loading, isEdit }: { initial?: Partial<User>; onSave: (d: any) => void; onCancel: () => void; loading: boolean; isEdit?: boolean }) {
  const [form, setForm] = useState({
    name: initial?.name || "", username: initial?.username || "", password: "",
    role: initial?.role || "sales", colorCode: initial?.colorCode || COLOR_PALETTE[0], unit: initial?.unit || "All"
  });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4 pt-2">
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

  const handleCreate = (data: any) => {
    createUser.mutate({ data }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "Team member added" }); setCreateOpen(false); },
      onError: (e: any) => toast({ title: e?.data?.error || "Error", variant: "destructive" }),
    });
  };

  const handleUpdate = (data: any) => {
    if (!editUser) return;
    const payload = { ...data };
    if (!payload.password) delete payload.password;
    updateUser.mutate({ id: editUser.id, data: payload }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "Updated" }); setEditUser(null); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Remove this team member?")) return;
    deleteUser.mutate({ id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "Removed" }); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const isAdmin = me?.role === "admin";

  return (
    <div className="p-8 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your preferences{isAdmin ? " and team members" : ""}</p>
      </div>

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
                <UserForm onSave={handleCreate} onCancel={() => setCreateOpen(false)} loading={createUser.isPending} />
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
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
                ) : users?.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">@{u.username}</TableCell>
                    <TableCell><Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge></TableCell>
                    <TableCell>{u.unit}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full border shadow-sm" style={{ backgroundColor: u.colorCode }} />
                        <span className="text-xs text-muted-foreground font-mono">{u.colorCode}</span>
                      </div>
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
          {editUser && <UserForm initial={editUser} onSave={handleUpdate} onCancel={() => setEditUser(null)} loading={updateUser.isPending} isEdit />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
