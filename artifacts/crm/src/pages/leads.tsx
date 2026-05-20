import { useState } from "react";
import { Link } from "wouter";
import { useListContacts, useListUsers, useDeleteContact, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function Leads() {
  const [search, setSearch] = useState("");
  const [salesOwnerId, setSalesOwnerId] = useState<number | undefined>();
  const [city, setCity] = useState<string | undefined>();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteName, setDeleteName] = useState<string>("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteContact = useDeleteContact();

  const { data: contacts, isLoading } = useListContacts({
    search: search || undefined,
    salesOwnerId,
    city: city || undefined,
  });

  const { data: users } = useListUsers();

  const handleDeleteConfirm = () => {
    if (!deleteId) return;
    deleteContact.mutate({ id: deleteId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: `"${deleteName}" deleted` });
        setDeleteId(null);
      },
      onError: () => {
        toast({ title: "Failed to delete lead", variant: "destructive" });
        setDeleteId(null);
      },
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground mt-1">Manage and track your contacts.</p>
        </div>
        <Link href="/leads/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Lead
          </Button>
        </Link>
      </div>

      <div className="flex gap-4 items-center bg-card p-4 border rounded-md shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={salesOwnerId?.toString() || "all"} onValueChange={(v) => setSalesOwnerId(v === "all" ? undefined : Number(v))}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {users?.map(u => (
              <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border rounded-md shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : contacts?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No leads found.</TableCell></TableRow>
            ) : (
              contacts?.map((contact) => (
                <TableRow key={contact.id} className="group">
                  <TableCell className="font-medium">
                    <Link href={`/leads/${contact.id}`} className="hover:underline text-primary">
                      {contact.name}
                    </Link>
                  </TableCell>
                  <TableCell>{contact.companyName || "-"}</TableCell>
                  <TableCell>{contact.mobile}</TableCell>
                  <TableCell>{contact.city || "-"}</TableCell>
                  <TableCell>
                    {contact.salesOwner && (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: contact.salesOwner.colorCode || '#ccc' }}
                        />
                        <span className="text-sm">{contact.salesOwner.name}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {contact.industry ? (
                      <Badge variant="outline">{contact.industry}</Badge>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteId(contact.id);
                        setDeleteName(contact.name);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the lead and all their deals and activity history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
