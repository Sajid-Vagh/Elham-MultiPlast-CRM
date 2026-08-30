import { useState, useCallback, useEffect } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { onProductChange } from "@/lib/query-invalidation";
import { INDUSTRIES } from "@/lib/constants";
import { useActiveMachines } from "@/lib/use-machines";

type ProductVariant = { id: number; productId: number; weight?: string | null; defaultColor?: string | null; isActive: boolean };
type VariantRow = { weight: string };
type Product = { id: number; name: string; category?: string | null; industry?: string | null; machineType?: string | null; pricePerUnit?: number | null; productCode?: string | null; bottleWeight?: string | null; bottleColour?: string | null; bottleColourCode?: string | null; capColour?: string | null; materialType?: string | null; hsnCode?: string | null; defaultUnit?: string | null; defaultGst?: number | null; status?: string | null; variants?: ProductVariant[]; variantCount?: number };

const HSN_BY_MATERIAL: Record<string, string> = {
  PET: "39239090",
  HDPE: "39233090",
};

const HSN_OPTIONS = [
  { value: "", label: "None" },
  { value: "39239090", label: "PET → 39239090" },
  { value: "39233090", label: "HDPE → 39233090" },
];

const MATERIAL_OPTIONS = ["PET", "HDPE", "PP", "Other"];

const isP = (m: string) => m === "PET";
const needsMachine = (m: string) => m === "HDPE" || m === "PP";

const UNIT_OPTIONS = ["", "Pcs", "Kg", "Gms", "Ltr", "Mtr", "Box", "Pack", "Nos"];

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors";

function ProductForm({ initial, onSave, onCancel, loading }: { initial?: Partial<Product>; onSave: (d: any) => void; onCancel: () => void; loading: boolean }) {
  const { machines: machineNames, isLoading: machinesLoading } = useActiveMachines();
  const [form, setForm] = useState({
    name: initial?.name || "",
    productCode: initial?.productCode || "",
    industry: initial?.industry || "",
    machineType: initial?.machineType || "",
    materialType: initial?.materialType || "",
    hsnCode: initial?.hsnCode || "",
    defaultUnit: initial?.defaultUnit || "Pcs",
    capColour: initial?.capColour || "",
    status: initial?.status || "active",
  });
  const [variants, setVariants] = useState<VariantRow[]>(() => {
    const v = initial?.variants || [];
    if (v.length) {
      return v.filter(x => x.isActive !== false).map(x => ({ weight: x.weight || "" }));
    }
    if (initial?.bottleWeight) {
      return [{ weight: initial.bottleWeight || "" }];
    }
    return [];
  });
  const updateVariant = (i: number, patch: Partial<VariantRow>) => setVariants(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addVariant = () => setVariants(prev => [...prev, { weight: "" }]);
  const removeVariant = (i: number) => setVariants(prev => prev.filter((_, idx) => idx !== i));
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const handleMaterialChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const mat = e.target.value;
    const autoHsn = HSN_BY_MATERIAL[mat];
    setForm(p => ({
      ...p,
      materialType: mat,
      hsnCode: autoHsn || p.hsnCode,
      machineType: isP(mat) ? "Outsourced" : (isP(p.materialType) ? "" : p.machineType),
    }));
  };

  const isPet = isP(form.materialType);
  const machineRequired = needsMachine(form.materialType);
  const canSave = form.name && form.industry && form.materialType && form.defaultUnit && (isPet || (machineRequired ? form.machineType : true));

  const handleSubmit = () => {
    const rows = variants.filter(r => r.weight.trim());
    onSave({
      ...form,
      productCode: form.productCode || null,
      industry: form.industry || null,
      machineType: isP(form.materialType) ? "Outsourced" : (form.machineType || null),
      materialType: form.materialType || null,
      hsnCode: form.hsnCode || null,
      defaultUnit: form.defaultUnit || null,
      capColour: form.capColour || null,
      variants: rows.map(r => ({ weight: r.weight.trim() || null })),
    });
  };

  return (
    <>
      <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
        <DialogTitle>{initial ? "Edit Product" : "New Product"}</DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Product Name *</Label><Input value={form.name} onChange={f("name")} /></div>
          <div><Label>Product Code</Label><Input value={form.productCode} onChange={f("productCode")} placeholder="Optional" /></div>
          <div><Label>Industry *</Label>
            <select value={form.industry} onChange={f("industry")} className={SELECT_CLASS}>
              <option value="">Select Industry</option>
              {INDUSTRIES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div><Label>Material Type *</Label>
            <select value={form.materialType} onChange={handleMaterialChange} className={SELECT_CLASS}>
              <option value="">Select Material</option>
              {MATERIAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          {!isPet && (
            <div><Label>Machine Type {machineRequired ? "*" : ""}</Label>
              <select value={form.machineType} onChange={f("machineType")} className={SELECT_CLASS} disabled={(!machineRequired && !!form.materialType) || machinesLoading}>
                <option value="">{machinesLoading ? "Loading..." : (machineRequired ? "Select Machine" : "Select (Optional)")}</option>
                {machineNames.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          {isPet && (
            <div>
              <Label>Machine Type</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm">
                <span className="text-muted-foreground">Outsourced</span>
              </div>
              <p className="text-[11px] text-amber-700 font-medium mt-1">Not manufactured in-house</p>
            </div>
          )}
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
          <div className="sm:col-span-2"><Label>Variants (weights)</Label>
            <div className="space-y-2 mt-1">
              {variants.length === 0 && (
                <p className="text-xs text-muted-foreground">No variants. Add the available weight(s) for this product below.</p>
              )}
              {variants.map((v, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Input
                    value={v.weight}
                    onChange={(e) => updateVariant(i, { weight: e.target.value })}
                    placeholder="Weight (e.g. 80g)"
                    className="w-36 shrink-0"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => removeVariant(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addVariant}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Variant
              </Button>
            </div>
          </div>
          <div><Label>Cap Colour</Label><Input value={form.capColour} onChange={f("capColour")} /></div>
          <div><Label>Status *</Label>
            <select value={form.status} onChange={f("status")} className={SELECT_CLASS}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      <DialogFooter className="shrink-0 border-t px-6 py-4">
        <Button disabled={loading || !canSave} onClick={handleSubmit}>
          {loading ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </DialogFooter>
    </>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function Products() {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 300);
  const { data: products, isLoading } = useListProducts({ search: debouncedSearch || undefined });
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
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground mt-1">Global product catalog</p>
        </div>
        {canManage && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Add Product</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
              <ProductForm onSave={handleCreate} onCancel={() => setCreateOpen(false)} loading={createProduct.isPending} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search products..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9 max-w-sm"
        />
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
              <TableHead>Default Wt</TableHead>
              <TableHead>Variants (weights)</TableHead>
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
                  <TableCell>
                    {p.materialType === "PET" ? (
                      <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Outsourced</Badge>
                    ) : (
                      p.machineType || "-"
                    )}
                  </TableCell>
                  <TableCell>{p.materialType || "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{p.hsnCode || "-"}</TableCell>
                  <TableCell>{p.defaultUnit || "-"}</TableCell>
                  <TableCell>
                    {p.bottleWeight || "-"}
                  </TableCell>
                  <TableCell>
                    {p.variants && p.variants.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant="secondary" className="text-[10px] w-fit">{p.variants.length} variant{p.variants.length > 1 ? "s" : ""}</Badge>
                        <div className="flex flex-wrap gap-1">
                          {p.variants.map(v => (
                            <span key={v.id} className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 whitespace-nowrap">
                              {v.weight || "-"}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
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
        <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
          {editProduct && <ProductForm initial={editProduct} onSave={handleUpdate} onCancel={() => setEditProduct(null)} loading={updateProduct.isPending} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
