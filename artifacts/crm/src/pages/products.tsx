import { useState, useCallback } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { onProductChange } from "@/lib/query-invalidation";

type Product = { id: number; name: string; category?: string | null; industry?: string | null; machineType?: string | null; pricePerUnit?: number | null; productCode?: string | null; bottleWeight?: string | null; bottleColour?: string | null; capColour?: string | null; materialType?: string | null; hsnCode?: string | null; defaultUnit?: string | null; defaultGst?: number | null; status?: string | null };

const INDUSTRY_OPTIONS = [
  "Liquid Detergents",
  "Lubricants",
  "Agro Chemicals and Pesticides",
  "Veterinary Products",
  "Edible Oil",
  "Chemicals",
  "Cosmetics",
  "Other",
];

const MACHINE_TYPE_OPTIONS = [
  "250ml Machine",
  "1L Machine",
  "5L Machine",
];

const MATERIAL_OPTIONS = ["PET", "HDPE", "PP", "Other"];

const HSN_BY_MATERIAL: Record<string, string> = {
  PET: "39239090",
  HDPE: "39233090",
};

const HSN_OPTIONS = [
  { value: "", label: "None" },
  { value: "39239090", label: "PET → 39239090" },
  { value: "39233090", label: "HDPE → 39233090" },
];

const UNIT_OPTIONS = ["", "Pcs", "Kg", "Gms", "Ltr", "Mtr", "Box", "Pack", "Nos"];

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors";

function ProductForm({ initial, onSave, onCancel, loading }: { initial?: Partial<Product>; onSave: (d: any) => void; onCancel: () => void; loading: boolean }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    productCode: initial?.productCode || "",
    industry: initial?.industry || "",
    machineType: initial?.machineType || "",
    materialType: initial?.materialType || "",
    hsnCode: initial?.hsnCode || "",
    defaultUnit: initial?.defaultUnit || "",
    defaultGst: initial?.defaultGst?.toString() || "",
    bottleWeight: initial?.bottleWeight || "",
    bottleColour: initial?.bottleColour || "",
    capColour: initial?.capColour || "",
    status: initial?.status || "active",
  });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const handleMaterialChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const mat = e.target.value;
    const autoHsn = HSN_BY_MATERIAL[mat];
    setForm(p => ({ ...p, materialType: mat, hsnCode: autoHsn || p.hsnCode }));
  };

  const canSave = form.name && form.industry && form.machineType && form.materialType && form.defaultUnit;

  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      <div><Label>Product Name *</Label><Input value={form.name} onChange={f("name")} /></div>
      <div><Label>Product Code</Label><Input value={form.productCode} onChange={f("productCode")} placeholder="Optional" /></div>
      <div><Label>Industry *</Label>
        <select value={form.industry} onChange={f("industry")} className={SELECT_CLASS}>
          <option value="">Select Industry</option>
          {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div><Label>Machine Type *</Label>
        <select value={form.machineType} onChange={f("machineType")} className={SELECT_CLASS}>
          <option value="">Select Machine</option>
          {MACHINE_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div><Label>Material Type *</Label>
        <select value={form.materialType} onChange={handleMaterialChange} className={SELECT_CLASS}>
          <option value="">Select Material</option>
          {MATERIAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div><Label>HSN Code</Label>
        <select value={form.hsnCode} onChange={f("hsnCode")} className={SELECT_CLASS}>
          {HSN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div><Label>Default Unit *</Label>
        <select value={form.defaultUnit} onChange={f("defaultUnit")} className={SELECT_CLASS}>
          <option value="">Select Unit</option>
          {UNIT_OPTIONS.filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div><Label>Default GST %</Label><Input type="number" value={form.defaultGst} onChange={f("defaultGst")} min={0} max={100} /></div>
      <div><Label>Bottle Weight</Label><Input value={form.bottleWeight} onChange={f("bottleWeight")} /></div>
      <div><Label>Bottle Colour</Label><Input value={form.bottleColour} onChange={f("bottleColour")} /></div>
      <div><Label>Cap Colour</Label><Input value={form.capColour} onChange={f("capColour")} /></div>
      <div><Label>Status *</Label>
        <select value={form.status} onChange={f("status")} className={SELECT_CLASS}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div className="col-span-2 flex gap-2 pt-2">
        <Button disabled={loading || !canSave} onClick={() => onSave({
          ...form,
          productCode: form.productCode || null,
          industry: form.industry || null,
          machineType: form.machineType || null,
          materialType: form.materialType || null,
          hsnCode: form.hsnCode || null,
          defaultUnit: form.defaultUnit || null,
          defaultGst: form.defaultGst ? Number(form.defaultGst) : null,
          bottleWeight: form.bottleWeight || null,
          bottleColour: form.bottleColour || null,
          capColour: form.capColour || null,
        })}>
          {loading ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function Products() {
  const { data: products, isLoading } = useListProducts();
  const { data: currentUser } = useGetMe();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canManage = currentUser?.role === "admin" || currentUser?.role === "production_and_support";

  const [createOpen, setCreateOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

  const handleCreate = useCallback((data: any) => {
    if (data.productCode && products?.some(p => p.productCode === data.productCode)) {
      toast({ title: "Product Code already exists", variant: "destructive" });
      return;
    }
    createProduct.mutate({ data }, {
      onSuccess: () => { onProductChange(queryClient); toast({ title: "Product created" }); setCreateOpen(false); },
      onError: (e: any) => toast({ title: e?.data?.error || "Error", variant: "destructive" }),
    });
  }, [products, createProduct, queryClient, toast]);

  const handleUpdate = useCallback((data: any) => {
    if (!editProduct) return;
    if (data.productCode && products?.some(p => p.productCode === data.productCode && p.id !== editProduct.id)) {
      toast({ title: "Product Code already exists", variant: "destructive" });
      return;
    }
    updateProduct.mutate({ id: editProduct.id, data }, {
      onSuccess: () => { onProductChange(queryClient); toast({ title: "Updated" }); setEditProduct(null); },
      onError: (e: any) => toast({ title: e?.data?.error || "Error", variant: "destructive" }),
    });
  }, [editProduct, products, updateProduct, queryClient, toast]);

  const handleDelete = (id: number) => {
    if (!confirm("Delete this product?")) return;
    deleteProduct.mutate({ id }, {
      onSuccess: () => { onProductChange(queryClient); toast({ title: "Deleted" }); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1">Global product catalog</p>
        </div>
        {canManage && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Add Product</Button></DialogTrigger>
            <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
              <ProductForm onSave={handleCreate} onCancel={() => setCreateOpen(false)} loading={createProduct.isPending} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="bg-card border rounded-md shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>GST%</TableHead>
              <TableHead>Bottle</TableHead>
              <TableHead>Cap</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="w-20" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={canManage ? 12 : 11} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : products?.length === 0 ? (
              <TableRow><TableCell colSpan={canManage ? 12 : 11} className="text-center py-8 text-muted-foreground">No products yet.</TableCell></TableRow>
            ) : (
              products?.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">{p.productCode || "-"}</TableCell>
                  <TableCell>{p.industry || p.category || "-"}</TableCell>
                  <TableCell>{p.machineType || "-"}</TableCell>
                  <TableCell>{p.materialType || "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.hsnCode || "-"}</TableCell>
                  <TableCell>{p.defaultUnit || "-"}</TableCell>
                  <TableCell>{p.defaultGst != null ? `${p.defaultGst}%` : "-"}</TableCell>
                  <TableCell>{[p.bottleWeight, p.bottleColour].filter(Boolean).join(" · ") || "-"}</TableCell>
                  <TableCell>{p.capColour || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${p.status === "inactive" ? "text-red-600 border-red-300" : "text-green-600 border-green-300"}`}>
                      {p.status === "inactive" ? "Inactive" : "Active"}
                    </Badge>
                  </TableCell>
                  {canManage && (
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
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editProduct} onOpenChange={(o) => !o && setEditProduct(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Edit Product</DialogTitle></DialogHeader>
          {editProduct && <ProductForm initial={editProduct} onSave={handleUpdate} onCancel={() => setEditProduct(null)} loading={updateProduct.isPending} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
