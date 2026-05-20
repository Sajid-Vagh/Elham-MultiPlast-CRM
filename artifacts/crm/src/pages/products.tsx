import { useState } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Product = { id: number; name: string; category?: string | null; pricePerUnit?: number | null; productCode: string; bottleWeight?: string | null; bottleColour?: string | null; capColour?: string | null };

function ProductForm({ initial, onSave, onCancel, loading }: { initial?: Partial<Product>; onSave: (d: any) => void; onCancel: () => void; loading: boolean }) {
  const [form, setForm] = useState({ name: initial?.name || "", category: initial?.category || "", pricePerUnit: initial?.pricePerUnit?.toString() || "", productCode: initial?.productCode || "", bottleWeight: initial?.bottleWeight || "", bottleColour: initial?.bottleColour || "", capColour: initial?.capColour || "" });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <div><Label>Name *</Label><Input value={form.name} onChange={f("name")} /></div>
      <div><Label>Product Code *</Label><Input value={form.productCode} onChange={f("productCode")} /></div>
      <div><Label>Category</Label><Input value={form.category} onChange={f("category")} /></div>
      <div><Label>Price/Unit (₹)</Label><Input type="number" value={form.pricePerUnit} onChange={f("pricePerUnit")} /></div>
      <div><Label>Bottle Weight</Label><Input value={form.bottleWeight} onChange={f("bottleWeight")} /></div>
      <div><Label>Bottle Colour</Label><Input value={form.bottleColour} onChange={f("bottleColour")} /></div>
      <div><Label>Cap Colour</Label><Input value={form.capColour} onChange={f("capColour")} /></div>
      <div className="col-span-2 flex gap-2 pt-2">
        <Button disabled={loading || !form.name || !form.productCode} onClick={() => onSave({ ...form, pricePerUnit: form.pricePerUnit ? Number(form.pricePerUnit) : null, category: form.category || null, bottleWeight: form.bottleWeight || null, bottleColour: form.bottleColour || null, capColour: form.capColour || null })}>
          {loading ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function Products() {
  const { data: products, isLoading } = useListProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

  const handleCreate = (data: any) => {
    createProduct.mutate({ data }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); toast({ title: "Product created" }); setCreateOpen(false); },
      onError: (e: any) => toast({ title: e?.data?.error || "Error", variant: "destructive" }),
    });
  };

  const handleUpdate = (data: any) => {
    if (!editProduct) return;
    updateProduct.mutate({ id: editProduct.id, data }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); toast({ title: "Updated" }); setEditProduct(null); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this product?")) return;
    deleteProduct.mutate({ id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); toast({ title: "Deleted" }); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1">Manage product catalog</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Add Product</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
            <ProductForm onSave={handleCreate} onCancel={() => setCreateOpen(false)} loading={createProduct.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border rounded-md shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Price/Unit</TableHead>
              <TableHead>Bottle</TableHead>
              <TableHead>Cap</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : products?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No products yet.</TableCell></TableRow>
            ) : (
              products?.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">{p.productCode}</TableCell>
                  <TableCell>{p.category || "-"}</TableCell>
                  <TableCell>{p.pricePerUnit ? `₹${Number(p.pricePerUnit).toLocaleString()}` : "-"}</TableCell>
                  <TableCell>{[p.bottleWeight, p.bottleColour].filter(Boolean).join(" · ") || "-"}</TableCell>
                  <TableCell>{p.capColour || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditProduct(p as Product)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editProduct} onOpenChange={(o) => !o && setEditProduct(null)}>
        <DialogContent><DialogHeader><DialogTitle>Edit Product</DialogTitle></DialogHeader>
          {editProduct && <ProductForm initial={editProduct} onSave={handleUpdate} onCancel={() => setEditProduct(null)} loading={updateProduct.isPending} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
