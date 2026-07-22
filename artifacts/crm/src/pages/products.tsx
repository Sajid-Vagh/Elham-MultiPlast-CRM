import { useState, useCallback, useRef, useEffect } from "react";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey } from "@workspace/api-client-react";
import { useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { onProductChange } from "@/lib/query-invalidation";

type Product = { id: number; name: string; category?: string | null; industry?: string | null; machineType?: string | null; pricePerUnit?: number | null; productCode?: string | null; bottleWeight?: string | null; bottleColour?: string | null; bottleColourCode?: string | null; capColour?: string | null; materialType?: string | null; hsnCode?: string | null; defaultUnit?: string | null; defaultGst?: number | null; status?: string | null };

const COLOUR_PRESETS: { name: string; hex: string }[] = [
  { name: "Purple", hex: "#800080" },
  { name: "Blue", hex: "#0000FF" },
  { name: "Sky Blue", hex: "#87CEEB" },
  { name: "Dark Blue", hex: "#00008B" },
  { name: "Light Blue", hex: "#ADD8E6" },
  { name: "Green", hex: "#008000" },
  { name: "Dark Green", hex: "#006400" },
  { name: "Light Green", hex: "#90EE90" },
  { name: "Red", hex: "#FF0000" },
  { name: "Maroon", hex: "#800000" },
  { name: "Yellow", hex: "#FFD700" },
  { name: "Orange", hex: "#FF8C00" },
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Transparent", hex: "#E5E7EB" },
  { name: "Natural", hex: "#C2B280" },
  { name: "Grey", hex: "#808080" },
  { name: "Silver", hex: "#C0C0C0" },
  { name: "Pink", hex: "#FFC0CB" },
  { name: "Peach", hex: "#FFDAB9" },
  { name: "Brown", hex: "#A52A2A" },
  { name: "Violet", hex: "#EE82EE" },
  { name: "Golden", hex: "#FFD700" },
  { name: "Cream", hex: "#FFFDD0" },
  { name: "Ivory", hex: "#FFFFF0" },
  { name: "Teal", hex: "#008080" },
  { name: "Navy", hex: "#000080" },
  { name: "Beige", hex: "#F5F5DC" },
  { name: "Magenta", hex: "#FF00FF" },
  { name: "Cyan", hex: "#00FFFF" },
  { name: "Olive", hex: "#808000" },
  { name: "Coral", hex: "#FF7F50" },
  { name: "Turquoise", hex: "#40E0D0" },
  { name: "Indigo", hex: "#4B0082" },
  { name: "Burgundy", hex: "#800020" },
  { name: "Rust", hex: "#B7410E" },
  { name: "Copper", hex: "#B87333" },
  { name: "Bronze", hex: "#CD7F32" },
  { name: "Charcoal", hex: "#36454F" },
  { name: "Lime", hex: "#00FF00" },
  { name: "Salmon", hex: "#FA8072" },
  { name: "Plum", hex: "#8E4585" },
  { name: "Lavender", hex: "#E6E6FA" },
  { name: "Mint", hex: "#98FF98" },
  { name: "Chocolate", hex: "#D2691E" },
  { name: "Tan", hex: "#D2B48C" },
  { name: "Rose", hex: "#FF007F" },
  { name: "Mauve", hex: "#E0B0FF" },
];

const COLOUR_MAP = new Map(COLOUR_PRESETS.map(c => [c.name.toLowerCase(), c.hex]));

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

const HSN_BY_MATERIAL: Record<string, string> = {
  PET: "39239090",
  HDPE: "39233090",
};

const HSN_OPTIONS = [
  { value: "", label: "None" },
  { value: "39239090", label: "PET → 39239090" },
  { value: "39233090", label: "HDPE → 39233090" },
];

const MACHINE_TYPE_OPTIONS = [
  "250ml Machine",
  "1L Machine",
  "5L Machine",
];

const MATERIAL_OPTIONS = ["PET", "HDPE", "PP", "Other"];

const isP = (m: string) => m === "PET";
const needsMachine = (m: string) => m === "HDPE" || m === "PP";

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
    bottleColourCode: initial?.bottleColourCode || "",
    capColour: initial?.capColour || "",
    status: initial?.status || "active",
  });
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

  const [colourQuery, setColourQuery] = useState(initial?.bottleColour || "");
  const [showColourDropdown, setShowColourDropdown] = useState(false);
  const [activeColourIdx, setActiveColourIdx] = useState(-1);
  const colourInputRef = useRef<HTMLInputElement>(null);
  const colourDropdownRef = useRef<HTMLDivElement>(null);

  const filteredColours = colourQuery.trim()
    ? COLOUR_PRESETS.filter(c => c.name.toLowerCase().includes(colourQuery.toLowerCase()))
    : COLOUR_PRESETS;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colourDropdownRef.current && !colourDropdownRef.current.contains(e.target as Node) &&
          colourInputRef.current && !colourInputRef.current.contains(e.target as Node)) {
        setShowColourDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectColour = (name: string, hex: string) => {
    setColourQuery(name);
    setForm(p => ({ ...p, bottleColour: name, bottleColourCode: hex }));
    setShowColourDropdown(false);
    setActiveColourIdx(-1);
  };

  const handleColourKeyDown = (e: React.KeyboardEvent) => {
    if (!showColourDropdown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setShowColourDropdown(true);
        setActiveColourIdx(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveColourIdx(i => (i + 1) % filteredColours.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveColourIdx(i => (i - 1 + filteredColours.length) % filteredColours.length);
    } else if (e.key === "Enter" && activeColourIdx >= 0) {
      e.preventDefault();
      const c = filteredColours[activeColourIdx];
      if (c) selectColour(c.name, c.hex);
    } else if (e.key === "Escape") {
      setShowColourDropdown(false);
      setActiveColourIdx(-1);
    }
  };

  const handleColourInputChange = (val: string) => {
    setColourQuery(val);
    const matched = COLOUR_MAP.get(val.toLowerCase());
    if (matched) {
      setForm(p => ({ ...p, bottleColour: val, bottleColourCode: matched }));
    } else {
      setForm(p => ({ ...p, bottleColour: val, bottleColourCode: "" }));
    }
    setShowColourDropdown(true);
    setActiveColourIdx(-1);
  };

  const resolvedColourCode = COLOUR_MAP.get(colourQuery.toLowerCase()) || form.bottleColourCode || null;

  const handleSubmit = () => onSave({
    ...form,
    productCode: form.productCode || null,
    industry: form.industry || null,
    machineType: isP(form.materialType) ? "Outsourced" : (form.machineType || null),
    materialType: form.materialType || null,
    hsnCode: form.hsnCode || null,
    defaultUnit: form.defaultUnit || null,
    defaultGst: form.defaultGst ? Number(form.defaultGst) : null,
    bottleWeight: form.bottleWeight || null,
    bottleColour: form.bottleColour || null,
    bottleColourCode: form.bottleColourCode || null,
    capColour: form.capColour || null,
  });

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
              {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
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
              <select value={form.machineType} onChange={f("machineType")} className={SELECT_CLASS} disabled={!machineRequired && !!form.materialType}>
                <option value="">{machineRequired ? "Select Machine" : "Select (Optional)"}</option>
                {MACHINE_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          {isPet && (
            <div><Label>Machine Type</Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm">
                <span className="text-muted-foreground">Outsourced</span>
                <Badge className="ml-2 bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Not manufactured in-house</Badge>
              </div>
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
          <div><Label>Default GST %</Label><Input type="number" value={form.defaultGst} onChange={f("defaultGst")} min={0} max={100} /></div>
          <div><Label>Bottle Weight</Label><Input value={form.bottleWeight} onChange={f("bottleWeight")} /></div>
          <div className="sm:col-span-2"><Label>Bottle Colour</Label>
            <div className="relative mt-1">
              <div className="flex items-center gap-2">
                {resolvedColourCode && (
                  <span
                    className="w-5 h-5 rounded border shrink-0 mt-0.5"
                    style={{
                      backgroundColor: resolvedColourCode === "transparent" ? "#f3f4f6" : resolvedColourCode,
                      borderColor: resolvedColourCode === "transparent" ? "#d1d5db" : resolvedColourCode === "#FFFFFF" ? "#d1d5db" : resolvedColourCode,
                    }}
                  />
                )}
                <input
                  ref={colourInputRef}
                  type="text"
                  value={colourQuery}
                  onChange={(e) => handleColourInputChange(e.target.value)}
                  onFocus={() => { setShowColourDropdown(true); setActiveColourIdx(-1); }}
                  onKeyDown={handleColourKeyDown}
                  placeholder="Type a colour name..."
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground"
                />
              </div>
              {showColourDropdown && filteredColours.length > 0 && (
                <div ref={colourDropdownRef} className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
                  {filteredColours.map((c, i) => (
                    <button
                      key={c.name}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectColour(c.name, c.hex); }}
                      onMouseEnter={() => setActiveColourIdx(i)}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left ${
                        i === activeColourIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border shrink-0"
                        style={{
                          backgroundColor: c.hex === "transparent" ? "#f3f4f6" : c.hex,
                          borderColor: c.hex === "transparent" ? "#d1d5db" : c.hex === "#FFFFFF" ? "#d1d5db" : c.hex,
                        }}
                      />
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
                <input
                  type="color"
                  value={form.bottleColourCode || "#800080"}
                  onChange={(e) => {
                    setForm(p => ({ ...p, bottleColourCode: e.target.value }));
                    setColourQuery("");
                  }}
                  className="h-6 w-6 rounded border border-input cursor-pointer p-0"
                />
                Custom hex (optional)
              </label>
              {form.bottleColourCode && form.bottleColour && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {form.bottleColour} = {form.bottleColourCode}
                </Badge>
              )}
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
            <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
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
                  <TableCell>{p.defaultGst != null ? `${p.defaultGst}%` : "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {(p as any).bottleColourCode && (
                        <span
                          className="w-2.5 h-2.5 rounded-full border shrink-0"
                          style={{ backgroundColor: (p as any).bottleColourCode === "#FFFFFF" ? "#f3f4f6" : (p as any).bottleColourCode, borderColor: (p as any).bottleColourCode === "#FFFFFF" ? "#d1d5db" : (p as any).bottleColourCode }}
                        />
                      )}
                      <span>{[p.bottleWeight, p.bottleColour].filter(Boolean).join(" · ") || "-"}</span>
                    </div>
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
