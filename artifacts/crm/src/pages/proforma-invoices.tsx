import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Plus, Download, Printer, Share2, Mail, Eye, FileText, Save, ArrowLeft, Trash2, Search,
  ChevronLeft, ChevronRight, Send, Loader2, CheckCircle2, RefreshCw, Building2, Calendar, Clock,
  Shield, Store, MapPin, Verified,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-700",
  "Sent": "bg-blue-100 text-blue-700",
  "Viewed": "bg-cyan-100 text-cyan-700",
  "Approved": "bg-green-100 text-green-700",
  "Rejected": "bg-red-100 text-red-700",
  "Expired": "bg-yellow-100 text-yellow-700",
  "Converted to Order": "bg-purple-100 text-purple-700",
};

const INVOICE_STATUSES = ["Draft", "Sent", "Viewed", "Approved", "Rejected", "Expired", "Converted to Order"];

function numberToWords(num: number): string {
  if (num === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const conv = (n: number): string => {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
    return ones[Math.floor(n / 100)] + " Hundred " + conv(n % 100);
  };
  const lakhs = (n: number): string => {
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = Math.floor(n % 1000);
    let r = "";
    if (crore) r += conv(crore) + "Crore ";
    if (lakh) r += conv(lakh) + "Lakh ";
    if (thousand) r += conv(thousand) + "Thousand ";
    if (hundred) r += conv(hundred);
    return r.trim();
  };
  const rupees = Math.floor(num);
  return "Rupees " + (rupees ? lakhs(rupees) : "Zero") + " Only";
}

interface InvoiceItem {
  productName: string;
  hsnCode: string;
  bottleType: string;
  capacity: string;
  weight: string;
  quantity: number;
  unit: string;
  rate: number;
  discountPercent: number;
  discount: number;
  gstPercent: number;
  amount: number;
}

export default function ProformaInvoicesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const token = localStorage.getItem("crm_token");

  const [tab, setTab] = useState("all");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 15;

  const [mode, setMode] = useState<"list" | "create" | "detail">("list");
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);

  const [customerName, setCustomerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [addressLine3, setAddressLine3] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [address, setAddress] = useState("");
  const [customerType, setCustomerType] = useState<"GST" | "Unregistered">("GST");
  const [gstNumber, setGstNumber] = useState("");
  const [idProofType, setIdProofType] = useState("");
  const [idProofNumber, setIdProofNumber] = useState("");
  const [mobile, setMobile] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [freight, setFreight] = useState(0);
  const [cgstPct, setCgstPct] = useState(0);
  const [sgstPct, setSgstPct] = useState(0);
  const [igstPct, setIgstPct] = useState(0);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([
    { productName: "", hsnCode: "", bottleType: "", capacity: "", weight: "", quantity: 1, unit: "Pcs", rate: 0, discountPercent: 0, discount: 0, gstPercent: 0, amount: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfHtml, setPdfHtml] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState("");
  const [contactSearchResults, setContactSearchResults] = useState<any[]>([]);
  const [showContactSearch, setShowContactSearch] = useState(false);
  const [district, setDistrict] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [gstStatus, setGstStatus] = useState("");
  const [customerMasterId, setCustomerMasterId] = useState<number | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [existingCustomer, setExistingCustomer] = useState<any>(null);
  const [gstinNotFound, setGstinNotFound] = useState(false);
  const [gstLoading, setGstLoading] = useState(false);
  const [gstError, setGstError] = useState("");
  const [gstVerifying, setGstVerifying] = useState(false);
  const [gstVerified, setGstVerified] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState("");
  const [gstVerificationResult, setGstVerificationResult] = useState<any>(null);
  const [showBusinessDetails, setShowBusinessDetails] = useState(false);
  const [gstCached, setGstCached] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<any[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [activeProductIdx, setActiveProductIdx] = useState(-1);

  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; invoice: any }>({ open: false, invoice: null });
  const [statusDialog, setStatusDialog] = useState<{ open: boolean; invoice: any }>({ open: false, invoice: null });
  const [newStatus, setNewStatus] = useState("");
  const [statusNotes, setStatusNotes] = useState("");

  const ensureArray = (json: any): any[] => {
    if (Array.isArray(json)) return json;
    if (json && typeof json === "object") {
      if (Array.isArray(json.data)) return json.data;
      if (Array.isArray(json.items)) return json.items;
      if (Array.isArray(json.invoices)) return json.invoices;
      if (Array.isArray(json.records)) return json.records;
    }
    if (process.env.NODE_ENV === "development") {
      console.warn("[proforma-invoices] Expected array but got:", json);
    }
    return [];
  };

  const fetchInvoices = async () => {
    try {
      const url = statusFilter !== "all" ? `/api/proforma-invoices?status=${statusFilter}` : "/api/proforma-invoices";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setInvoices(ensureArray(json));
      } else {
        setInvoices([]);
      }
    } catch (err) {
      console.error(err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "list") fetchInvoices();
  }, [mode, statusFilter]);

  const filteredInvoices = useMemo(() => {
    const list = Array.isArray(invoices) ? invoices : [];
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(
      (inv) =>
        inv.customerName?.toLowerCase().includes(s) ||
        inv.invoiceNumber?.toLowerCase().includes(s) ||
        inv.companyName?.toLowerCase().includes(s) ||
        inv.mobile?.includes(s)
    );
  }, [invoices, search]);

  const totalPages = Math.max(1, Math.ceil((filteredInvoices?.length || 0) / perPage));
  const paginatedInvoices = Array.isArray(filteredInvoices)
    ? filteredInvoices.slice((page - 1) * perPage, page * perPage)
    : [];

  const calcAmount = (item: InvoiceItem) => {
    const gross = item.quantity * item.rate;
    const disc = item.discountPercent > 0 ? gross * item.discountPercent / 100 : (item.discount || 0);
    return gross - disc;
  };
  const taxableAmount = items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
  const baseAmount = taxableAmount + freight;
  const cgstAmount = baseAmount * cgstPct / 100;
  const sgstAmount = baseAmount * sgstPct / 100;
  const igstAmount = baseAmount * igstPct / 100;
  const grandTotal = baseAmount + cgstAmount + sgstAmount + igstAmount;
  const amountInWords = numberToWords(grandTotal);

  const recalcItem = (item: InvoiceItem) => {
    const gross = item.quantity * item.rate;
    const discAmt = item.discountPercent > 0 ? gross * item.discountPercent / 100 : (item.discount || 0);
    return { ...item, discount: discAmt, amount: gross - discAmt };
  };

  const updateItem = (idx: number, field: keyof InvoiceItem, value: any) => {
    const updated = items.map((item, i) => {
      if (i !== idx) return item;
      const newItem = { ...item, [field]: value };
      return recalcItem(newItem);
    });
    setItems(updated);
  };

  const addItem = () => {
    setItems([...items, { productName: "", hsnCode: "", bottleType: "", capacity: "", weight: "", quantity: 1, unit: "Pcs", rate: 0, discountPercent: 0, discount: 0, gstPercent: 0, amount: 0 }]);
  };

  const duplicateItem = (idx: number) => {
    const newItems = [...items];
    newItems.splice(idx + 1, 0, { ...items[idx] });
    setItems(newItems);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const resetForm = () => {
    setCustomerName("");
    setCompanyName("");
    setTradeName("");
    setAddressLine1("");
    setAddressLine2("");
    setAddressLine3("");
    setCity("");
    setDistrict("");
    setState("");
    setPincode("");
    setAddress("");
    setCustomerType("GST");
    setGstNumber("");
    setGstStatus("");
    setIdProofType("");
    setIdProofNumber("");
    setMobile("");
    setInvoiceNumber("");
    setFreight(0);
    setCgstPct(0);
    setSgstPct(0);
    setIgstPct(0);
    setNotes("");
    setItems([{ productName: "", hsnCode: "", bottleType: "", capacity: "", weight: "", quantity: 1, unit: "Pcs", rate: 0, discountPercent: 0, discount: 0, gstPercent: 0, amount: 0 }]);
    setEditMode(false);
    setCustomerMasterId(null);
    setExistingCustomer(null);
    setGstinNotFound(false);
    setGstVerified(false);
    setGstVerifying(false);
    setLastVerifiedAt("");
    setGstVerificationResult(null);
    setShowBusinessDetails(false);
    setGstCached(false);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setShowProductSearch(false);
    setActiveProductIdx(-1);
  };

  useEffect(() => {
    if (!contactSearchQuery || contactSearchQuery.length < 2) {
      setContactSearchResults([]);
      setShowContactSearch(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?search=${encodeURIComponent(contactSearchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setContactSearchResults(ensureArray(json).slice(0, 10));
          setShowContactSearch(true);
        }
      } catch { }
    }, 300);
    return () => clearTimeout(timer);
  }, [contactSearchQuery, token]);

  // Product search autocomplete
  useEffect(() => {
    if (!productSearchQuery || productSearchQuery.length < 1) {
      setProductSearchResults([]);
      setShowProductSearch(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(productSearchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setProductSearchResults(Array.isArray(json) ? json.slice(0, 10) : []);
          setShowProductSearch(true);
        }
      } catch { }
    }, 200);
    return () => clearTimeout(timer);
  }, [productSearchQuery, token]);

  const selectProduct = (idx: number, product: any) => {
    updateItem(idx, "productName", product.name);
    if (product.pricePerUnit) updateItem(idx, "rate", Number(product.pricePerUnit));
    setShowProductSearch(false);
    setProductSearchQuery("");
    setActiveProductIdx(-1);
  };

  const selectContact = (contact: any) => {
    setCustomerName(contact.name);
    setCompanyName(contact.companyName || "");
    setMobile(contact.mobile || "");
    setGstNumber(contact.gstNumber || "");
    setCity(contact.city || "");
    setAddress(contact.address || "");
    setShowContactSearch(false);
    setContactSearchQuery("");
  };

  const parseAddressString = (addr: string) => {
    const parts = addr.split(",").map((s: string) => s.trim()).filter(Boolean);
    const result: { addressLine1: string; addressLine2: string; addressLine3: string; city: string; district: string; state: string; pincode: string } = {
      addressLine1: "", addressLine2: "", addressLine3: "",
      city: "", district: "", state: "", pincode: "",
    };
    if (parts.length === 0) return result;

    let remaining = [...parts];

    const pincodeMatch = remaining[remaining.length - 1]?.match(/\b(\d{6})\b/);
    if (pincodeMatch) {
      result.pincode = pincodeMatch[1];
      remaining[remaining.length - 1] = remaining[remaining.length - 1].replace(/\s*-?\s*\d{6}\s*$/, "").trim();
      if (!remaining[remaining.length - 1]) remaining.pop();
    }

    const stateKeywords = [
      "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat",
      "haryana", "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh",
      "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland", "odisha", "punjab",
      "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura", "uttar pradesh",
      "uttarakhand", "west bengal", "delhi", "chandigarh", "puducherry",
    ];
    const lastPart = remaining[remaining.length - 1]?.toLowerCase() || "";
    const matchedState = stateKeywords.find((s) => lastPart.includes(s));
    if (matchedState) {
      result.state = remaining.pop() || "";
    }

    if (remaining.length >= 2) {
      result.city = remaining[remaining.length - 1] || "";
      result.district = remaining[remaining.length - 2] || "";
      remaining = remaining.slice(0, -2);
    } else if (remaining.length === 1) {
      result.city = remaining[0];
      remaining = [];
    }

    result.addressLine1 = remaining[0] || "";
    result.addressLine2 = remaining.length > 1 ? remaining.slice(1).join(", ") : "";
    result.addressLine3 = "";

    return result;
  };

  const applyGstDetails = (data: any) => {
    console.log("[GST Apply] Data:", JSON.stringify(data, null, 2));

    setCustomerName("");
    setCompanyName("");
    setTradeName("");
    setAddressLine1("");
    setAddressLine2("");
    setAddressLine3("");
    setCity("");
    setDistrict("");
    setState("");
    setPincode("");
    setGstNumber("");
    setGstStatus("");

    const name = data.legalName || data.tradeName || data.companyName || "";
    setCustomerName(name);
    setCompanyName(name);
    setTradeName(data.tradeName || name);

    if (data.addressLine1 || data.addressLine2 || data.addressLine3) {
      setAddressLine1(data.addressLine1 || "");
      setAddressLine2(data.addressLine2 || "");
      setAddressLine3(data.addressLine3 || "");
      setCity(data.city || "");
      setDistrict(data.district || "");
      setState(data.state || "");
      setPincode(data.pincode || "");
    } else if (data.address) {
      const parsed = parseAddressString(data.address);
      setAddressLine1(parsed.addressLine1);
      setAddressLine2(parsed.addressLine2);
      setAddressLine3(parsed.addressLine3);
      setCity(parsed.city);
      setDistrict(parsed.district);
      setState(parsed.state);
      setPincode(parsed.pincode);
    }

    if (!data.city && !data.district && !data.state && !data.pincode && !data.address) {
    } else if ((!data.addressLine1 && !data.addressLine2 && !data.addressLine3) && !data.address) {
    }

    if (data.city && !data.addressLine1 && !data.addressLine2 && !data.addressLine3) {
      setCity(data.city);
      if (data.district) setDistrict(data.district);
      if (data.state) setState(data.state);
      if (data.pincode) setPincode(data.pincode);
    }

    setGstNumber(data.gstin || "");
    setCustomerType(data.businessConstitution === "Unregistered" ? "Unregistered" : "GST");
    setGstStatus(data.registrationStatus || data.status || "");
  };

  const checkExistingCustomer = async (gstin: string) => {
    if (!gstin || gstin.length < 15) return;
    try {
      const res = await fetch("/api/customer-master/lookup-by-gstin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gstin }),
      });
      const data = await res.json();
      if (data.found) {
        setExistingCustomer(data);
        applyExistingCustomer(data);
        setGstinNotFound(false);
        setGstError("");
        return;
      }
    } catch {
      // fall through to live lookup
    }

    // Not in Customer Master → auto-fetch live from GST API
    setExistingCustomer(null);
    setGstinNotFound(true);
    setGstLoading(true);
    try {
      const liveRes = await fetch("/api/proforma-invoices/gst-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gstin }),
      });
      const liveData = await liveRes.json();
      if (liveData.success) {
        applyGstDetails(liveData);
        setGstError("");
      } else {
        setGstError(liveData.error || "Could not fetch GST details");
      }
    } catch {
      setGstError("GST lookup failed. Please enter details manually.");
    } finally {
      setGstLoading(false);
    }
  };

  const applyExistingCustomer = (customer: any) => {
    if (customer.companyName) setCustomerName(customer.companyName);
    if (customer.tradeName) setTradeName(customer.tradeName);
    if (customer.addressLine1) setAddressLine1(customer.addressLine1);
    if (customer.addressLine2) setAddressLine2(customer.addressLine2);
    if (customer.addressLine3) setAddressLine3(customer.addressLine3);
    if (customer.city) setCity(customer.city);
    if (customer.district) setDistrict(customer.district);
    if (customer.state) setState(customer.state);
    if (customer.pincode) setPincode(customer.pincode);
    if (customer.mobile) setMobile(customer.mobile);
    if (customer.gstin) setGstNumber(customer.gstin);
    if (customer.customerType) setCustomerType(customer.customerType === "Unregistered" ? "Unregistered" : "GST");
    if (customer.gstStatus) setGstStatus(customer.gstStatus);
    setCustomerMasterId(customer.id);
  };

  const verifyGst = async (gstin: string) => {
    const cleaned = gstin.toUpperCase().trim();
    if (cleaned.length !== 15) {
      toast({ title: "Invalid GSTIN", description: "GSTIN must be exactly 15 characters", variant: "destructive" });
      return;
    }
    setGstVerifying(true);
    setGstError("");
    try {
      const res = await fetch("/api/gst/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gstin: cleaned }),
      });
      const data = await res.json();
      if (data.success) {
        setGstVerified(true);
        setLastVerifiedAt(data.verifiedAt);
        setGstVerificationResult(data);
        setGstCached(!!data.cached);
        setShowBusinessDetails(true);
        applyGstDetails(data);
        toast({
          title: data.cached ? "✓ GST Details Loaded (Cached)" : "✓ GST Verified Successfully",
          description: `${data.legalName || data.tradeName || cleaned}`,
        });
      } else {
        setGstVerified(false);
        setGstError(data.error || "GST verification failed");
        toast({ title: "Verification Failed", description: data.error || "Could not verify GSTIN", variant: "destructive" });
      }
    } catch {
      setGstError("Network error. Please try again.");
      toast({ title: "Network Error", description: "Could not reach server. Please try again.", variant: "destructive" });
    } finally {
      setGstVerifying(false);
    }
  };

  const refreshGst = async () => {
    const gstin = gstNumber.toUpperCase().trim();
    if (gstin.length !== 15) return;
    setGstVerifying(true);
    setGstError("");
    try {
      const res = await fetch("/api/gst/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gstin }),
      });
      const data = await res.json();
      if (data.success) {
        setGstVerified(true);
        setLastVerifiedAt(data.verifiedAt);
        setGstVerificationResult(data);
        setGstCached(false);
        setShowBusinessDetails(true);
        applyGstDetails(data);
        toast({ title: "✓ GST Refreshed", description: `${data.legalName || data.tradeName || gstin}` });
      } else {
        setGstError(data.error || "GST refresh failed");
        toast({ title: "Refresh Failed", description: data.error || "Could not refresh GST details", variant: "destructive" });
      }
    } catch {
      setGstError("Network error. Please try again.");
      toast({ title: "Network Error", description: "Could not reach server.", variant: "destructive" });
    } finally {
      setGstVerifying(false);
    }
  };

  const handleSaveCustomer = async () => {
    const gstin = gstNumber.toUpperCase().trim();
    if (!gstin || !companyName) {
      toast({ title: "Error", description: "Company name and GSTIN are required to save customer", variant: "destructive" });
      return;
    }
    setSavingCustomer(true);
    try {
      const res = await fetch("/api/customer-master", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyName: customerName,
          tradeName: tradeName || null,
          gstin,
          addressLine1: addressLine1 || null,
          addressLine2: addressLine2 || null,
          addressLine3: addressLine3 || null,
          city: city || null,
          district: district || null,
          state: state || null,
          pincode: pincode || null,
          mobile: mobile || null,
          customerType,
          gstStatus: gstStatus || "Active",
        }),
      });
      if (res.status === 409) {
        const err = await res.json();
        toast({ title: "Customer Already Exists", description: "This GSTIN is already saved in Customer Master", variant: "default" });
        setExistingCustomer(err.existing);
        setCustomerMasterId(err.existing.id);
        applyExistingCustomer(err.existing);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save customer");
      }
      const customer = await res.json();
      setCustomerMasterId(customer.id);
      setExistingCustomer(customer);
      setGstinNotFound(false);
      toast({ title: "✓ Customer Saved Successfully", description: `${customer.companyName} saved to Customer Master` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save customer", variant: "destructive" });
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleUseExistingCustomer = () => {
    if (existingCustomer) {
      applyExistingCustomer(existingCustomer);
    }
  };

  const handleUpdateExistingCustomer = async () => {
    if (!existingCustomer) return;
    setSavingCustomer(true);
    try {
      const res = await fetch(`/api/customer-master/${existingCustomer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyName: customerName,
          tradeName: tradeName || null,
          addressLine1: addressLine1 || null,
          addressLine2: addressLine2 || null,
          addressLine3: addressLine3 || null,
          city: city || null,
          district: district || null,
          state: state || null,
          pincode: pincode || null,
          mobile: mobile || null,
          customerType,
          gstStatus: gstStatus || "Active",
        }),
      });
      if (res.ok) {
        toast({ title: "✓ Customer Updated", description: "Customer Master record updated" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to update customer", variant: "destructive" });
    } finally {
      setSavingCustomer(false);
    }
  };

  const gstVerifyingRef = useRef(gstVerifying);
  gstVerifyingRef.current = gstVerifying;

  // Auto-fetch GST details when GSTIN changes (like cleartax)
  useEffect(() => {
    if (gstNumber.length >= 15) {
      setGstError("");
      const timer = setTimeout(() => {
        if (!gstVerifyingRef.current) {
          checkExistingCustomer(gstNumber.toUpperCase().trim());
        }
      }, 500);
      return () => clearTimeout(timer);
    }
    setExistingCustomer(null);
    setGstinNotFound(false);
    setGstError("");
    if (gstNumber.length === 0) {
      setGstVerified(false);
      setLastVerifiedAt("");
      setGstVerificationResult(null);
      setShowBusinessDetails(false);
      setGstCached(false);
    }
    return;
  }, [gstNumber]);

  const handleSave = async (status: string) => {
    if (!customerName) {
      toast({ title: "Error", description: "Customer name is required", variant: "destructive" });
      return;
    }
    if (items.some((i) => !i.productName)) {
      toast({ title: "Error", description: "All items must have a product name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        customerName,
        companyName: companyName || null,
        tradeName: tradeName || null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        addressLine3: addressLine3 || null,
        city: city || null,
        district: district || null,
        state: state || null,
        pincode: pincode || null,
        address: address || null,
        customerType,
        gstNumber: gstNumber || null,
        gstStatus: gstStatus || null,
        idProofType: customerType === "Unregistered" ? (idProofType || null) : null,
        idProofNumber: customerType === "Unregistered" ? (idProofNumber || null) : null,
        mobile: mobile || null,
        taxableAmount,
        freight,
        cgst: cgstAmount,
        sgst: sgstAmount,
        igst: igstAmount,
        cgstPercent: cgstPct,
        sgstPercent: sgstPct,
        igstPercent: igstPct,
        grandTotal,
        amountInWords,
        status,
        notes: notes || null,
        items: items.map((i) => {
          const gross = i.quantity * i.rate;
          const discAmt = i.discountPercent > 0 ? gross * i.discountPercent / 100 : (i.discount || 0);
          return {
            productName: i.productName,
            hsnCode: i.hsnCode || null,
            bottleType: i.bottleType || null,
            capacity: i.capacity || null,
            weight: i.weight || null,
            quantity: i.quantity,
            unit: i.unit,
            rate: i.rate,
            discountPercent: i.discountPercent,
            discount: discAmt,
            gstPercent: i.gstPercent,
            amount: gross - discAmt,
          };
        }),
      };
      if (customerMasterId) body.customerMasterId = customerMasterId;
      if (invoiceNumber) body.invoiceNumber = invoiceNumber;

      let res: Response;
      if (editMode && selectedInvoice?.id) {
        res = await fetch(`/api/proforma-invoices/${selectedInvoice.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/proforma-invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save invoice");
      }

      const invoice = await res.json();
      toast({ title: editMode ? "Invoice Updated" : "Invoice Created", description: `${invoice.invoiceNumber} saved as ${status}` });

      // Auto-save customer to Customer Master if new GSTIN and not already saved
      const gstin = gstNumber.toUpperCase().trim();
      if (!editMode && !customerMasterId && !existingCustomer && gstin && companyName && gstin.length === 15) {
        try {
          await fetch("/api/customer-master", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              companyName: customerName,
              tradeName: tradeName || null,
              gstin,
              addressLine1: addressLine1 || null,
              addressLine2: addressLine2 || null,
              addressLine3: addressLine3 || null,
              city: city || null,
              district: district || null,
              state: state || null,
              pincode: pincode || null,
              mobile: mobile || null,
              customerType,
              gstStatus: gstStatus || "Active",
            }),
          });
        } catch { /* silent fail - auto-save is best-effort */ }
      }

      resetForm();
      setSelectedInvoice(invoice);
      setMode("detail");
      fetchInvoices();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save invoice", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleViewInvoice = async (invoice: any) => {
    setSelectedInvoice(invoice);
    setMode("detail");
  };

  const handlePreviewPdf = async (invoice: any) => {
    try {
      const res = await fetch(`/api/proforma-invoices/${invoice.id}/html`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const html = await res.text();
        setPdfHtml(html);
        setShowPdfPreview(true);
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to load preview", variant: "destructive" });
    }
  };

  const handleDownloadPdf = async (invoice: any) => {
    try {
      const res = await fetch(`/api/proforma-invoices/${invoice.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) {
          const html = await res.text();
          await generateClientPdf(invoice, html);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Proforma_${invoice.invoiceNumber}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast({ title: "Error", description: "PDF generation failed", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to download PDF", variant: "destructive" });
    }
  };

  const generateClientPdf = async (invoice: any, htmlContent?: string) => {
    try {
      const html = htmlContent || pdfHtml;
      if (!html) {
        toast({ title: "Error", description: "No content to generate PDF", variant: "destructive" });
        return;
      }
      toast({ title: "Opening Print Dialog", description: "Use Save as PDF in the print dialog for a high-quality vector PDF" });
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.title = `Proforma_${invoice.invoiceNumber}`;
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 500);
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to open print dialog", variant: "destructive" });
    }
  };

  const handlePrint = (invoice: any) => {
    handlePreviewPdf(invoice);
  };

  const handleShareWhatsApp = (invoice: any) => {
    const phone = invoice.mobile || "";
    const msg = encodeURIComponent(`Dear ${invoice.customerName},\n\nPlease find attached Proforma Invoice ${invoice.invoiceNumber} dated ${new Date(invoice.createdAt).toLocaleDateString("en-IN")}.\n\nTotal Amount: ₹${Number(invoice.grandTotal).toFixed(2)}\n\nRegards,\nElham Multiplast LLP`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
  };

  const handleDuplicate = async (invoice: any) => {
    try {
      const res = await fetch(`/api/proforma-invoices/${invoice.id}/duplicate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const newInv = await res.json();
        toast({ title: "Duplicated", description: `New invoice ${newInv.invoiceNumber} created` });
        fetchInvoices();
        setSelectedInvoice(newInv);
        setMode("detail");
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to duplicate", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to duplicate invoice", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    const invoice = deleteDialog.invoice;
    if (!invoice) return;
    try {
      const res = await fetch(`/api/proforma-invoices/${invoice.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast({ title: "Deleted", description: "Proforma Invoice deleted successfully." });
        setDeleteDialog({ open: false, invoice: null });
        setMode("list");
        setShowPdfPreview(false);
        fetchInvoices();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Error", description: err.error || "Failed to delete", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to delete invoice", variant: "destructive" });
    }
  };

  const openDeleteDialog = (invoice: any) => {
    setDeleteDialog({ open: true, invoice });
  };

  const handleSendEmail = (invoice: any) => {
    const subject = encodeURIComponent(`Proforma Invoice ${invoice.invoiceNumber}`);
    const body = encodeURIComponent(`Dear ${invoice.customerName},\n\nPlease find attached Proforma Invoice ${invoice.invoiceNumber}.\n\nTotal Amount: ₹${Number(invoice.grandTotal).toFixed(2)}\n\nRegards,\nElham Multiplast LLP`);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  const handleStatusUpdate = async () => {
    if (!newStatus || !statusDialog.invoice) return;
    try {
      const res = await fetch(`/api/proforma-invoices/${statusDialog.invoice.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus, notes: statusNotes || null }),
      });
      if (res.ok) {
        toast({ title: "Status Updated", description: `Invoice moved to ${newStatus}` });
        setStatusDialog({ open: false, invoice: null });
        setNewStatus("");
        setStatusNotes("");
        fetchInvoices();
        if (mode === "detail") {
          const updated = await res.json();
          setSelectedInvoice(updated);
        }
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
    }
  };

  const renderInvoicePreviewHtml = (inv: any) => {
    const cgstPct = Number(inv.cgstPercent || 0);
    const sgstPct = Number(inv.sgstPercent || 0);
    const igstPct = Number(inv.igstPercent || 0);
    const cgstAmt = Number(inv.cgst || 0);
    const sgstAmt = Number(inv.sgst || 0);
    const igstAmt = Number(inv.igst || 0);
    const taxable = Number(inv.taxableAmount || 0);
    const freight = Number(inv.freight || 0);
    const baseAmt = taxable + freight;
    const grandTotal = Number(inv.grandTotal || 0);
    const totalTax = cgstAmt + sgstAmt + igstAmt;
    const isInterstate = igstPct > 0;

    const partyAddr: string[] = [];
    if (inv.addressLine1) partyAddr.push(inv.addressLine1);
    if (inv.addressLine2) partyAddr.push(inv.addressLine2);
    if (inv.addressLine3) partyAddr.push(inv.addressLine3);
    const cityStatePin = [inv.city, inv.state, inv.pincode].filter(Boolean).join(" ");

    const dateStr = new Date(inv.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Proforma Invoice - ${inv.invoiceNumber}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:10mm 14mm;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Source Sans 3',Arial,sans-serif;font-size:9pt;color:#000;line-height:1.3;}
.invoice{width:190mm;min-height:267mm;margin:0 auto;border:1.5px solid #000;padding:0;position:relative;}
.header{text-align:center;padding:8pt 10pt 4pt 10pt;border-bottom:1.5px solid #000;}
.gstin-top{text-align:left;font-size:8pt;margin-bottom:2pt;}
.company-name{font-size:18pt;font-weight:bold;letter-spacing:0.5pt;margin:2pt 0;}
.company-address{font-size:8pt;line-height:1.5;color:#222;}
.company-email{font-size:8pt;margin-top:2pt;}
.invoice-title{font-size:14pt;font-weight:bold;margin:4pt 0;text-decoration:underline;}
.party-section{display:flex;border-bottom:1px solid #000;}
.party-left{width:58%;padding:6pt 8pt;border-right:1px solid #000;}
.party-right{width:42%;padding:6pt 8pt;text-align:right;}
.party-label{font-weight:bold;font-size:9pt;margin-bottom:4pt;}
.party-name{font-weight:bold;font-size:10pt;}
.party-address{font-size:8.5pt;line-height:1.5;margin-top:2pt;}
.order-text{font-size:8.5pt;font-style:italic;margin:4pt 0;padding:3pt 0;border-bottom:1px solid #000;text-align:center;}
table.items{width:100%;border-collapse:collapse;font-size:8.5pt;}
table.items th{background:#f0f0f0;border:1px solid #000;padding:4pt 5pt;text-align:center;font-weight:bold;font-size:8pt;}
table.items td{border:1px solid #000;padding:3pt 5pt;}
.summary-table{width:100%;border-collapse:collapse;margin-top:0;border-top:1px solid #000;}
.summary-table td{border:0;padding:2pt 6pt;}
.summary-table .total-row{border-top:1.5px solid #000;font-weight:bold;font-size:10pt;}
.tax-summary{margin-top:6pt;width:100%;border-collapse:collapse;font-size:8pt;}
.tax-summary th{background:#f0f0f0;border:1px solid #000;padding:3pt 4pt;text-align:center;font-weight:bold;font-size:7.5pt;}
.tax-summary td{border:1px solid #000;padding:2pt 4pt;text-align:center;}
.amount-words{margin:6pt 8pt;font-size:8.5pt;}
.amount-words strong{font-size:9pt;}
.footer-section{width:100%;margin:4pt 0;padding:0 8pt;}
.footer-section table{width:100%;border-collapse:collapse;}
.footer-section td{vertical-align:top;padding:3pt 6pt;width:50%;border:0;}
.disclaimer{border-top:1px solid #000;padding:4pt 8pt;font-size:7.5pt;text-align:justify;line-height:1.4;}
.disclaimer strong{font-size:8pt;}
.bank-details{font-size:8pt;line-height:1.6;}
.bank-details strong{font-size:8.5pt;}
.terms{font-size:8pt;line-height:1.5;}
.terms strong{font-size:8.5pt;}
.terms ul{margin:2pt 0 0 14pt;padding:0;}
.terms li{margin-bottom:1pt;}
.signature-section{display:flex;margin:8pt 8pt 4pt 8pt;font-size:8.5pt;}
.sign-left{width:50%;}
.sign-right{width:50%;text-align:right;font-weight:bold;}
hr{border:none;border-top:1px solid #000;margin:2pt 0;}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.invoice{page-break-after:avoid;}}
</style></head><body>
<div class="invoice">
<div class="header">
<div class="gstin-top">GSTIN : 24AAJFE2064P1Z6</div>
<div class="company-name">ELHAM MULTIPLAST LLP</div>
<div class="company-address">PLOT NO. 1429-1430, NR. FORTUNE PETROL PUMP,<br>OPP. KHIJADIYA TALAV, ILOL, HIMATNAGAR,<br>SABARKANTHA, GUJARAT - 383220</div>
<div class="company-email">elhammultiplast@gmail.com</div>
<div class="invoice-title">PROFORMA INVOICE</div>
</div>
<div class="party-section">
<div class="party-left">
<div class="party-label">Party Details :</div>
<div class="party-name">${inv.customerName}</div>
<div class="party-address">${partyAddr.length > 0 ? partyAddr.join("<br>") + "<br>" : ""}${cityStatePin ? cityStatePin + "<br>" : ""}${inv.address ? inv.address + "<br>" : ""}</div>
${inv.customerType === "Unregistered"
  ? `<div style="font-size:8.5pt;margin-top:2pt;">ID Proof : ${inv.idProofType || ""} - ${inv.idProofNumber || ""}</div>`
  : `<div style="font-size:8.5pt;margin-top:2pt;">GSTIN / UIN : ${inv.gstNumber || ""}</div>`
}
</div>
<div class="party-right">
<div style="font-weight:bold;font-size:9pt;">Order No : ${inv.invoiceNumber}</div>
<div style="margin-top:4pt;font-size:8.5pt;">Date : ${dateStr}</div>
</div>
</div>
<div class="order-text">We are pleased to receive the order for the following items</div>
<table class="items">
<thead><tr><th style="width:5%">S.N.</th><th style="width:32%">Description of Goods</th><th style="width:11%">HSN Code</th><th style="width:8%">Qty</th><th style="width:8%">Unit</th><th style="width:10%">Price</th><th style="width:12%">Amount</th></tr></thead>
<tbody>${(inv.items || []).map((item: any, i: number) => `<tr><td style="text-align:center">${i+1}</td><td>${item.productName}${item.bottleType ? ` (${item.bottleType})` : ""}${item.capacity ? ` ${item.capacity}` : ""}${item.weight ? ` ${item.weight}` : ""}</td><td style="text-align:center">${item.hsnCode || "-"}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:center">${item.unit}</td><td style="text-align:right">${Number(item.rate).toFixed(2)}</td><td style="text-align:right">${Number(item.amount).toFixed(2)}</td></tr>`).join("\n")}</tbody>
</table>
<table class="summary-table">
${freight > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">Freight Charges</td><td style="text-align:right;padding:3pt 6pt">${freight.toFixed(2)}</td></tr>` : ""}
${cgstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">CGST @ ${cgstPct}%</td><td style="text-align:right;padding:3pt 6pt">${cgstAmt.toFixed(2)}</td></tr>` : ""}
${sgstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">SGST @ ${sgstPct}%</td><td style="text-align:right;padding:3pt 6pt">${sgstAmt.toFixed(2)}</td></tr>` : ""}
${igstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">IGST @ ${igstPct}%</td><td style="text-align:right;padding:3pt 6pt">${igstAmt.toFixed(2)}</td></tr>` : ""}
<tr class="total-row"><td colspan="5" style="text-align:right;padding:3pt 6pt">Grand Total</td><td style="text-align:right;padding:3pt 6pt">${grandTotal.toFixed(2)}</td></tr>
</table>
<table class="tax-summary">
<thead><tr><th>Tax Rate</th><th>Taxable Amount</th><th>CGST Amount</th><th>SGST Amount</th><th>Total Tax</th></tr></thead>
<tbody>${isInterstate ? `<tr><td>IGST @ ${igstPct}%</td><td>${baseAmt.toFixed(2)}</td><td>0.00</td><td>0.00</td><td>${igstAmt.toFixed(2)}</td></tr>` : `<tr><td>CGST @ ${cgstPct}% + SGST @ ${sgstPct}%</td><td>${baseAmt.toFixed(2)}</td><td>${cgstAmt.toFixed(2)}</td><td>${sgstAmt.toFixed(2)}</td><td>${totalTax.toFixed(2)}</td></tr>`}</tbody>
</table>
<div class="amount-words"><strong>Amount in Words :</strong> ${inv.amountInWords || ""}</div>
<div class="footer-section"><table><tr>
<td style="width:50%;border:0;padding:3pt 6pt;"><div class="bank-details"><strong>Bank Details</strong><br>ICICI BANK, HIMATNAGAR<br>A/C NO: 045205014806<br>IFSC: ICIC0000452</div></td>
<td style="width:50%;border:0;padding:3pt 6pt;"><div class="terms"><strong>Terms &amp; Conditions</strong><ul><li>Freight Charges Additional</li><li>100% Advance Payment</li></ul></div></td>
</tr></table></div>
<div class="disclaimer"><strong>DISCLAIMER : </strong>Products supplied are generic industrial packaging developed independently by Elham Multiplast LLP for functional applications. Any branding, labeling, or market usage by the buyer shall be at the buyer's sole responsibility.</div>
<div class="signature-section"><div class="sign-left">Receiver's Signature</div><div class="sign-right">For ELHAM MULTIPLAST LLP</div></div>
</div></body></html>`;
  };

  const deleteDialogEl = (
    <AlertDialog open={deleteDialog.open} onOpenChange={(o) => setDeleteDialog({ ...deleteDialog, open: o })}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Proforma Invoice?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <div className="text-sm text-muted-foreground">
              <div><strong>Invoice No:</strong> {deleteDialog.invoice?.invoiceNumber}</div>
              <div><strong>Customer Name:</strong> {deleteDialog.invoice?.customerName}</div>
              <div><strong>Date:</strong> {deleteDialog.invoice?.createdAt ? new Date(deleteDialog.invoice.createdAt).toLocaleDateString("en-IN") : ""}</div>
            </div>
            <p className="pt-2">Are you sure you want to delete this Proforma Invoice?</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDeleteDialog({ open: false, invoice: null })}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (loading && mode === "list") return <div className="p-6">Loading...</div>;

  if (mode === "create") {
    return (
      <>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => { setMode("list"); resetForm(); }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold">{editMode ? `Edit Invoice - ${selectedInvoice?.invoiceNumber || ""}` : "New Proforma Invoice"}</h1>
        </div>

        <Card>
          <CardHeader><CardTitle>Party Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Party Name *</Label>
              <div className="relative">
                <Input value={customerName} onChange={(e) => { setCustomerName(e.target.value); setContactSearchQuery(e.target.value); }} placeholder="Enter party name (type to search contacts)" onFocus={() => { if (contactSearchResults.length > 0) setShowContactSearch(true); }} onBlur={() => setTimeout(() => setShowContactSearch(false), 200)} />
                {showContactSearch && contactSearchResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {contactSearchResults.map((c: any) => (
                      <div key={c.id} className="px-3 py-2 hover:bg-muted cursor-pointer text-sm" onMouseDown={() => selectContact(c)}>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.companyName || ""}{c.companyName && c.mobile ? " · " : ""}{c.mobile || ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Invoice Number (leave empty for auto-generated)</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="PI-2026-XXXX" />
            </div>
            <div className="sm:col-span-2">
              <Label>Trade Name</Label>
              <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} placeholder="Trade Name / Brand Name" />
            </div>
            <div className="sm:col-span-2">
              <Label>Address Line 1</Label>
              <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Building / Floor / Flat Number" />
            </div>
            <div className="sm:col-span-2">
              <Label>Address Line 2</Label>
              <Input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Road / Street / Landmark" />
            </div>
            <div className="sm:col-span-2">
              <Label>Address Line 3</Label>
              <Input value={addressLine3} onChange={(e) => setAddressLine3(e.target.value)} placeholder="Locality / Sub Locality" />
            </div>
            <div>
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
            </div>
            <div>
              <Label>District</Label>
              <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="District" />
            </div>
            <div>
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
            </div>
            <div>
              <Label>Pincode</Label>
              <Input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="Pincode" />
            </div>
            <div>
              <Label>Customer Type</Label>
              <Select value={customerType} onValueChange={(v: "GST" | "Unregistered") => setCustomerType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GST">GST Registered</SelectItem>
                  <SelectItem value="Unregistered">Unregistered</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>GST Status</Label>
              <Input value={gstStatus} onChange={(e) => setGstStatus(e.target.value)} placeholder="Active / Cancelled / Suspended" />
            </div>
            {customerType === "GST" ? (
              <div className="sm:col-span-2">
                <Label>GST Number *</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    {gstLoading || gstVerifying ? (
                      <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
                    ) : gstVerified ? (
                      <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-600" />
                    ) : (
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    )}
                    <Input
                      value={gstNumber}
                      onChange={(e) => { setGstNumber(e.target.value); setGstVerified(false); setGstVerificationResult(null); setShowBusinessDetails(false); }}
                      placeholder="Enter GSTIN (e.g. 24AAJFE2064P1Z6)"
                      className="pl-9"
                      disabled={gstVerifying}
                    />
                  </div>
                  <Button
                    onClick={() => verifyGst(gstNumber)}
                    disabled={gstVerifying || gstNumber.trim().length !== 15}
                    className="bg-orange-600 hover:bg-orange-700 text-white gap-2 shrink-0"
                  >
                    {gstVerifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="h-4 w-4" />
                    )}
                    {gstVerifying ? "Verifying..." : "Verify GST"}
                  </Button>
                </div>

                {gstVerified && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                      <Verified className="h-4 w-4 text-green-600" />
                      <span className="font-medium">GST Verified</span>
                      {gstCached && (
                        <span className="text-xs text-green-500 ml-1">(Cached)</span>
                      )}
                      <span className="text-xs text-green-500 ml-auto">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {new Date(lastVerifiedAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                      {gstVerificationResult?.legalName && (
                        <div><span className="text-muted-foreground">Legal Name:</span> <span className="font-medium">{gstVerificationResult.legalName}</span></div>
                      )}
                      {gstVerificationResult?.tradeName && (
                        <div><span className="text-muted-foreground">Trade Name:</span> <span>{gstVerificationResult.tradeName}</span></div>
                      )}
                      {gstVerificationResult?.status && (
                        <div><span className="text-muted-foreground">GST Status:</span> <span>{gstVerificationResult.status}</span></div>
                      )}
                      {gstVerificationResult?.taxpayerType && (
                        <div><span className="text-muted-foreground">Taxpayer Type:</span> <span>{gstVerificationResult.taxpayerType}</span></div>
                      )}
                      {gstVerificationResult?.constitution && (
                        <div><span className="text-muted-foreground">Constitution:</span> <span>{gstVerificationResult.constitution}</span></div>
                      )}
                      {gstVerificationResult?.registrationDate && (
                        <div><span className="text-muted-foreground">Registration Date:</span> <span>{new Date(gstVerificationResult.registrationDate).toLocaleDateString("en-IN")}</span></div>
                      )}
                      {gstVerificationResult?.lastUpdated && (
                        <div><span className="text-muted-foreground">Last Updated:</span> <span>{new Date(gstVerificationResult.lastUpdated).toLocaleDateString("en-IN")}</span></div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={refreshGst} disabled={gstVerifying} className="gap-1 text-xs">
                        <RefreshCw className={`h-3 w-3 ${gstVerifying ? "animate-spin" : ""}`} />
                        Refresh GST
                      </Button>
                    </div>
                  </div>
                )}

                {gstError && !gstVerified && (
                  <div className="mt-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    {gstError}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div>
                  <Label>ID Proof Type</Label>
                  <Select value={idProofType} onValueChange={setIdProofType}>
                    <SelectTrigger><SelectValue placeholder="Select proof type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Aadhar">Aadhar</SelectItem>
                      <SelectItem value="PAN">PAN</SelectItem>
                      <SelectItem value="Voter ID">Voter ID</SelectItem>
                      <SelectItem value="Driving License">Driving License</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>ID Proof Number</Label>
                  <Input value={idProofNumber} onChange={(e) => setIdProofNumber(e.target.value)} placeholder="ID proof number" />
                </div>
              </>
            )}
            <div>
              <Label>Mobile Number</Label>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile number" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
            </div>

            {/* Customer Master actions */}
            {!customerMasterId && !existingCustomer && gstNumber.trim().length >= 15 && companyName.trim() && (
              <div className="sm:col-span-2">
                <Button onClick={handleSaveCustomer} disabled={savingCustomer} className="w-full gap-2">
                  {savingCustomer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingCustomer ? "Saving..." : "Save Customer"}
                </Button>
              </div>
            )}

            {existingCustomer && !customerMasterId && (
              <div className="sm:col-span-2">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-sm font-medium text-amber-800 mb-2">Customer already exists with this GSTIN</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleUseExistingCustomer}>
                      Use Existing
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleUpdateExistingCustomer} disabled={savingCustomer}>
                      {savingCustomer ? "Updating..." : "Update Existing"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {customerMasterId && existingCustomer && (
              <div className="sm:col-span-2">
                <div className="p-2 bg-green-50 border border-green-200 rounded-md flex items-center gap-2 text-sm text-green-800">
                  <span>✓ Customer Master: {existingCustomer.companyName}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {showBusinessDetails && gstVerificationResult && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-orange-600" />
                Business Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Shield className="h-3 w-3" />
                    GST Status
                  </div>
                  <div className="font-medium text-sm">{gstVerificationResult.status || "N/A"}</div>
                </div>
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Store className="h-3 w-3" />
                    Taxpayer Type
                  </div>
                  <div className="font-medium text-sm">{gstVerificationResult.taxpayerType || gstVerificationResult.businessConstitution || "N/A"}</div>
                </div>
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Building2 className="h-3 w-3" />
                    Constitution
                  </div>
                  <div className="font-medium text-sm">{gstVerificationResult.constitution || gstVerificationResult.businessConstitution || "N/A"}</div>
                </div>
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Calendar className="h-3 w-3" />
                    Registration Date
                  </div>
                  <div className="font-medium text-sm">
                    {gstVerificationResult.registrationDate
                      ? (() => {
                          const d = new Date(gstVerificationResult.registrationDate);
                          return isNaN(d.getTime()) ? gstVerificationResult.registrationDate : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                        })()
                      : "N/A"}
                  </div>
                </div>
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Store className="h-3 w-3" />
                    Nature of Business
                  </div>
                  <div className="font-medium text-sm">{gstVerificationResult.natureOfBusiness || "N/A"}</div>
                </div>
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <MapPin className="h-3 w-3" />
                    Principal Place of Business
                  </div>
                  <div className="font-medium text-sm leading-tight">
                    {[gstVerificationResult.addressLine1, gstVerificationResult.addressLine2, gstVerificationResult.addressLine3, gstVerificationResult.city, gstVerificationResult.state, gstVerificationResult.pincode].filter(Boolean).join(", ") || gstVerificationResult.principalPlaceOfBusiness || gstVerificationResult.address || "N/A"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Products / Items</CardTitle>
            <Button size="sm" variant="outline" onClick={addItem}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead>Bottle Type</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead className="w-16">Qty</TableHead>
                    <TableHead className="w-16">Unit</TableHead>
                    <TableHead className="w-20">Rate (₹)</TableHead>
                    <TableHead className="w-16">Disc %</TableHead>
                    <TableHead className="w-16">GST %</TableHead>
                    <TableHead className="w-20">Amount (₹)</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="relative">
                          <Input value={item.productName} onChange={(e) => { updateItem(idx, "productName", e.target.value); setProductSearchQuery(e.target.value); setActiveProductIdx(idx); }} placeholder="Type product name" className="h-8 min-w-28" onFocus={() => setActiveProductIdx(idx)} onBlur={() => setTimeout(() => setShowProductSearch(false), 200)} />
                          {showProductSearch && activeProductIdx === idx && productSearchResults.length > 0 && (
                            <div className="absolute z-50 top-full left-0 right-0 bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                              {productSearchResults.map((p: any) => (
                                <div key={p.id} className="px-3 py-2 hover:bg-muted cursor-pointer text-sm" onMouseDown={() => selectProduct(idx, p)}>
                                  <div className="font-medium">{p.name}</div>
                                  <div className="text-xs text-muted-foreground">{p.productCode}{p.pricePerUnit ? ` · ₹${Number(p.pricePerUnit).toFixed(2)}` : ""}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      <TableCell>
                        <Input value={item.hsnCode} onChange={(e) => updateItem(idx, "hsnCode", e.target.value)} placeholder="HSN" className="h-8 w-20" />
                      </TableCell>
                      <TableCell>
                        <Input value={item.bottleType} onChange={(e) => updateItem(idx, "bottleType", e.target.value)} placeholder="Type" className="h-8 w-20" />
                      </TableCell>
                      <TableCell>
                        <Input value={item.capacity} onChange={(e) => updateItem(idx, "capacity", e.target.value)} placeholder="Capacity" className="h-8 w-20" />
                      </TableCell>
                      <TableCell>
                        <Input value={item.weight} onChange={(e) => updateItem(idx, "weight", e.target.value)} placeholder="Weight" className="h-8 w-20" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} min={0} className="h-8 text-center w-16" />
                      </TableCell>
                      <TableCell>
                        <Select value={item.unit} onValueChange={(v) => updateItem(idx, "unit", v)}>
                          <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["Pcs", "Kg", "Gms", "Ltr", "Mtr", "Box", "Pack", "Nos"].map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={item.rate} onChange={(e) => updateItem(idx, "rate", Number(e.target.value))} min={0} className="h-8 text-right w-20" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={item.discountPercent} onChange={(e) => updateItem(idx, "discountPercent", Number(e.target.value))} min={0} max={100} className="h-8 text-center w-16" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={item.gstPercent} onChange={(e) => updateItem(idx, "gstPercent", Number(e.target.value))} min={0} max={100} className="h-8 text-center w-16" />
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {calcAmount(item).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateItem(idx)} title="Duplicate row">
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(idx)} title="Remove row">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tax & Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label>Freight Charges (₹)</Label>
                <Input type="number" value={freight} onChange={(e) => setFreight(Number(e.target.value))} min={0} />
              </div>
              <div>
                <Label>CGST (%)</Label>
                <Input type="number" value={cgstPct} onChange={(e) => setCgstPct(Number(e.target.value))} min={0} max={100} step={0.01} />
              </div>
              <div>
                <Label>SGST (%)</Label>
                <Input type="number" value={sgstPct} onChange={(e) => setSgstPct(Number(e.target.value))} min={0} max={100} step={0.01} />
              </div>
              <div>
                <Label>IGST (%)</Label>
                <Input type="number" value={igstPct} onChange={(e) => setIgstPct(Number(e.target.value))} min={0} max={100} step={0.01} />
              </div>
            </div>
            <div className="mt-4 p-4 bg-muted/30 rounded-lg space-y-1 text-sm">
              <div className="flex justify-between"><span>Taxable Amount:</span><span className="font-medium">₹{taxableAmount.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Freight:</span><span>₹{freight.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Base Amount:</span><span className="font-medium">₹{baseAmount.toFixed(2)}</span></div>
              {cgstPct > 0 && <div className="flex justify-between"><span>CGST ({cgstPct}%):</span><span>₹{cgstAmount.toFixed(2)}</span></div>}
              {sgstPct > 0 && <div className="flex justify-between"><span>SGST ({sgstPct}%):</span><span>₹{sgstAmount.toFixed(2)}</span></div>}
              {igstPct > 0 && <div className="flex justify-between"><span>IGST ({igstPct}%):</span><span>₹{igstAmount.toFixed(2)}</span></div>}
              <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Grand Total:</span><span>₹{grandTotal.toFixed(2)}</span></div>
              <div className="text-xs text-muted-foreground italic mt-1">{amountInWords}</div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => { if (editMode) { setEditMode(false); setMode("detail"); } else { setMode("list"); resetForm(); } }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button variant="outline" onClick={() => handleSave("Draft")} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {editMode ? "Update Draft" : "Save Draft"}
          </Button>
          <Button onClick={() => handleSave("Sent")} disabled={saving}>
            <Send className="h-4 w-4 mr-1" /> {saving ? "Saving..." : editMode ? "Update & Send" : "Generate & Send"}
          </Button>
        </div>
      </div>
      {deleteDialogEl}
    </>
    );
  }

  if (mode === "detail" && selectedInvoice) {
    const inv = selectedInvoice;
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setMode("list")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{inv.invoiceNumber}</h1>
            <p className="text-sm text-muted-foreground">{inv.customerName}</p>
          </div>
          <Badge className={`text-xs px-3 py-1 ${STATUS_COLORS[inv.status] || ""}`}>{inv.status}</Badge>
          <Button variant="outline" size="sm" onClick={() => {
            setSelectedInvoice(inv);
            setCustomerName(inv.customerName || "");
            setCompanyName(inv.companyName || "");
            setAddressLine1(inv.addressLine1 || "");
            setAddressLine2(inv.addressLine2 || "");
            setAddressLine3(inv.addressLine3 || "");
            setCity(inv.city || "");
            setState(inv.state || "");
            setPincode(inv.pincode || "");
            setAddress(inv.address || "");
            setCustomerType(inv.customerType || "GST");
            setGstNumber(inv.gstNumber || "");
            setIdProofType(inv.idProofType || "");
            setIdProofNumber(inv.idProofNumber || "");
            setMobile(inv.mobile || "");
            setInvoiceNumber(inv.invoiceNumber || "");
            setFreight(Number(inv.freight || 0));
            setCgstPct(Number(inv.cgstPercent || 0));
            setSgstPct(Number(inv.sgstPercent || 0));
            setIgstPct(Number(inv.igstPercent || 0));
            setNotes(inv.notes || "");
            setItems((inv.items || []).map((i: any) => ({
              productName: i.productName,
              hsnCode: i.hsnCode || "",
              bottleType: i.bottleType || "",
              capacity: i.capacity || "",
              weight: i.weight || "",
              quantity: Number(i.quantity),
              unit: i.unit || "Pcs",
              rate: Number(i.rate),
              discountPercent: Number(i.discountPercent || 0),
              discount: Number(i.discount || 0),
              gstPercent: Number(i.gstPercent || 0),
              amount: Number(i.amount),
            })));
            setEditMode(true);
            setMode("create");
          }}>
            <FileText className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStatusDialog({ open: true, invoice: inv })}>
            Update Status
          </Button>
        </div>
        {editMode && (
          <div className="w-full text-sm text-muted-foreground bg-blue-50 border border-blue-200 rounded-md px-4 py-2">
            Showing invoice in read-only view. Click <strong>Edit</strong> to modify.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Party Details</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Name:</span> {inv.customerName}</p>
              {inv.companyName && <p><span className="text-muted-foreground">Company:</span> {inv.companyName}</p>}
              {inv.tradeName && <p><span className="text-muted-foreground">Trade Name:</span> {inv.tradeName}</p>}
              {inv.addressLine1 && <p><span className="text-muted-foreground">Addr 1:</span> {inv.addressLine1}</p>}
              {inv.addressLine2 && <p><span className="text-muted-foreground">Addr 2:</span> {inv.addressLine2}</p>}
              {inv.addressLine3 && <p><span className="text-muted-foreground">Addr 3:</span> {inv.addressLine3}</p>}
              {inv.city && <p><span className="text-muted-foreground">City:</span> {inv.city}</p>}
              {inv.district && <p><span className="text-muted-foreground">District:</span> {inv.district}</p>}
              {inv.state && <p><span className="text-muted-foreground">State:</span> {inv.state}</p>}
              {inv.pincode && <p><span className="text-muted-foreground">Pincode:</span> {inv.pincode}</p>}
              <p><span className="text-muted-foreground">Type:</span> {inv.customerType || "GST"}</p>
              {inv.gstStatus && <p><span className="text-muted-foreground">GST Status:</span> {inv.gstStatus}</p>}
              {inv.customerType === "Unregistered" ? (
                <><p><span className="text-muted-foreground">ID Proof:</span> {inv.idProofType || ""} - {inv.idProofNumber || ""}</p></>
              ) : (
                inv.gstNumber && <p><span className="text-muted-foreground">GSTIN/UIN:</span> {inv.gstNumber}</p>
              )}
              {inv.mobile && <p><span className="text-muted-foreground">Mobile:</span> {inv.mobile}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Invoice Summary</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Date:</span> {new Date(inv.createdAt).toLocaleDateString("en-IN")}</p>
              <p><span className="text-muted-foreground">Taxable:</span> ₹{Number(inv.taxableAmount).toFixed(2)}</p>
              <p><span className="text-muted-foreground">Freight:</span> ₹{Number(inv.freight).toFixed(2)}</p>
              <p><span className="text-muted-foreground">CGST ({Number(inv.cgstPercent || 0)}%):</span> ₹{Number(inv.cgst).toFixed(2)}</p>
              <p><span className="text-muted-foreground">SGST ({Number(inv.sgstPercent || 0)}%):</span> ₹{Number(inv.sgst).toFixed(2)}</p>
              <p><span className="text-muted-foreground">IGST ({Number(inv.igstPercent || 0)}%):</span> ₹{Number(inv.igst).toFixed(2)}</p>
              <p className="text-lg font-bold">Grand Total: ₹{Number(inv.grandTotal).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground italic">{inv.amountInWords}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Items</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead>Type / Capacity / Weight</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Disc %</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.items?.map((item: any, idx: number) => (
                    <TableRow key={item.id || idx}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell>{item.hsnCode || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[item.bottleType, item.capacity, item.weight].filter(Boolean).join(" / ") || "-"}
                      </TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell>₹{Number(item.rate).toFixed(2)}</TableCell>
                      <TableCell>{item.discountPercent ? `${item.discountPercent}%` : "-"}</TableCell>
                      <TableCell className="font-medium">₹{Number(item.amount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex gap-3 flex-wrap">
          <Button onClick={() => handlePreviewPdf(inv)} variant="outline">
            <Eye className="h-4 w-4 mr-1" /> Preview
          </Button>
          <Button onClick={() => handleDownloadPdf(inv)} variant="outline">
            <Download className="h-4 w-4 mr-1" /> Download PDF
          </Button>
          <Button onClick={() => handlePrint(inv)} variant="outline">
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
          <Button onClick={() => handleShareWhatsApp(inv)} variant="outline" className="text-green-600 border-green-200">
            <Share2 className="h-4 w-4 mr-1" /> WhatsApp
          </Button>
          <Button onClick={() => handleSendEmail(inv)} variant="outline">
            <Mail className="h-4 w-4 mr-1" /> Email
          </Button>
          <Button onClick={() => handleDuplicate(inv)} variant="outline">
            <FileText className="h-4 w-4 mr-1" /> Duplicate
          </Button>
          <Button onClick={() => openDeleteDialog(inv)} variant="outline" className="text-red-600 border-red-200">
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>

        <Dialog open={showPdfPreview} onOpenChange={setShowPdfPreview}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>Invoice Preview - {inv.invoiceNumber}</DialogTitle>
            </DialogHeader>
            <div className="overflow-auto max-h-[70vh] border rounded-lg p-2 bg-white">
              <iframe srcDoc={pdfHtml} className="w-full" style={{ height: "70vh" }} title="Invoice Preview" />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => {
                const w = window.open("", "_blank");
                if (w) { w.document.write(pdfHtml); w.print(); }
              }}>
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
              <Button variant="outline" onClick={() => handleDownloadPdf(inv)}>
                <Download className="h-4 w-4 mr-1" /> Download PDF
              </Button>
              <Button variant="outline" className="text-red-600 border-red-200" onClick={() => { setShowPdfPreview(false); openDeleteDialog(inv); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {deleteDialogEl}

        <Dialog open={statusDialog.open} onOpenChange={(o) => setStatusDialog({ ...statusDialog, open: o })}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Update Status</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>New Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    {INVOICE_STATUSES.filter((s) => s !== statusDialog.invoice?.status).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Textarea value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder="Reason for status change" rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStatusDialog({ open: false, invoice: null })}>Cancel</Button>
              <Button onClick={handleStatusUpdate} disabled={!newStatus}>Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proforma Invoices</h1>
          <p className="text-sm text-muted-foreground">Create and manage proforma invoices</p>
        </div>
        <Button onClick={() => { resetForm(); setMode("create"); }}>
          <Plus className="h-4 w-4 mr-1" /> New Invoice
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search invoices..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedInvoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No invoices found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedInvoices.map((inv: any) => (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleViewInvoice(inv)}>
                    <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell>{inv.customerName}</TableCell>
                    <TableCell>{inv.companyName || "-"}</TableCell>
                    <TableCell className="font-medium">₹{Number(inv.grandTotal).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs ${STATUS_COLORS[inv.status] || ""}`}>{inv.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(inv.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadPdf(inv)} title="Download PDF">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleShareWhatsApp(inv)} title="Share WhatsApp">
                          <Share2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => openDeleteDialog(inv)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
    {deleteDialogEl}
    </>
  );
}
