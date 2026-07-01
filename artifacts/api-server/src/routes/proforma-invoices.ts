import { Router, type IRouter } from "express";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, proformaInvoiceHistoryTable, usersTable, contactsTable, dealsTable, customerMasterTable, INVOICE_STATUSES } from "@workspace/db";
import { eq, desc, and, SQL, sql, like, gte, lte, inArray, isNull } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { amountToWords } from "../lib/amount-to-words";
import { getGstProvider, clearGstCache } from "../lib/gst-provider";
import * as XLSX from "xlsx";

const router: IRouter = Router();

const COMPANY_DEFAULTS = {
  name: "ELHAM MULTIPLAST LLP",
  gstin: "24AAJFE2064P1Z6",
  address: "PLOT NO. 1429-1430, NR. FORTUNE PETROL PUMP, OPP. KHIJADIYA TALAV, ILOL, HIMATNAGAR, SABARKANTHA, GUJARAT - 383220",
  email: "elhammultiplast@gmail.com",
  bankName: "ICICI BANK, HIMATNAGAR",
  accountNo: "045205014806",
  ifsc: "ICIC0000452",
  pan: "",
  phone: "",
  website: "",
  defaultTerms: ["Freight Charges Additional", "100% Advance Payment"],
  disclaimer: "Products supplied are generic industrial packaging developed independently by Elham Multiplast LLP for functional applications. Any branding, labeling, or market usage by the buyer shall be at the buyer's sole responsibility.",
};

async function getNextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PI-${year}-`;
  const [last] = await db
    .select({ num: proformaInvoicesTable.invoiceNumber })
    .from(proformaInvoicesTable)
    .where(like(proformaInvoicesTable.invoiceNumber, `${prefix}%`))
    .orderBy(desc(proformaInvoicesTable.invoiceNumber))
    .limit(1);
  let nextSeq = 1;
  if (last) {
    const parts = last.num.split("-");
    const seq = parseInt(parts[2] || "0", 10);
    if (!isNaN(seq)) nextSeq = seq + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

function renderInvoiceHtml(invoice: any, items: any[]): string {
  const taxableAmount = Number(invoice.taxableAmount || 0);
  const freight = Number(invoice.freight || 0);
  const baseAmount = taxableAmount + freight;
  const cgstPct = Number(invoice.cgstPercent || 0);
  const sgstPct = Number(invoice.sgstPercent || 0);
  const igstPct = Number(invoice.igstPercent || 0);
  const cgstAmount = Number(invoice.cgst || 0);
  const sgstAmount = Number(invoice.sgst || 0);
  const igstAmount = Number(invoice.igst || 0);
  const grandTotal = Number(invoice.grandTotal || 0);

  const isInterstate = igstPct > 0;

  const partyAddressLines: string[] = [];
  if (invoice.addressLine1) partyAddressLines.push(invoice.addressLine1);
  if (invoice.addressLine2) partyAddressLines.push(invoice.addressLine2);
  if (invoice.addressLine3) partyAddressLines.push(invoice.addressLine3);
  const cityStatePincode = [invoice.city, invoice.state, invoice.pincode].filter(Boolean).join(" ");

  const productRows = items
    .map(
      (item: any, i: number) => `
    <tr>
      <td class="cell-center">${i + 1}</td>
      <td>${item.productName}${item.bottleType ? ` (${item.bottleType})` : ""}${item.capacity ? ` ${item.capacity}` : ""}${item.weight ? ` ${item.weight}` : ""}</td>
      <td class="cell-center">${item.hsnCode || "-"}</td>
      <td class="cell-center">${item.quantity}</td>
      <td class="cell-center">${item.unit}</td>
      <td class="cell-right">${Number(item.rate).toFixed(2)}</td>
      <td class="cell-right">${Number(item.amount).toFixed(2)}</td>
    </tr>`
    )
    .join("\n");

  const dateStr = new Date(invoice.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const gstRows = [];
  if (freight > 0) {
    gstRows.push(`<tr class="summary-row"><td colspan="5">Freight Charges</td><td class="cell-right">${freight.toFixed(2)}</td></tr>`);
  }
  if (cgstPct > 0) {
    gstRows.push(`<tr class="summary-row"><td colspan="5">CGST @ ${cgstPct}%</td><td class="cell-right">${cgstAmount.toFixed(2)}</td></tr>`);
  }
  if (sgstPct > 0) {
    gstRows.push(`<tr class="summary-row"><td colspan="5">SGST @ ${sgstPct}%</td><td class="cell-right">${sgstAmount.toFixed(2)}</td></tr>`);
  }
  if (igstPct > 0) {
    gstRows.push(`<tr class="summary-row"><td colspan="5">IGST @ ${igstPct}%</td><td class="cell-right">${igstAmount.toFixed(2)}</td></tr>`);
  }

  const totalTax = cgstAmount + sgstAmount + igstAmount;

  const terms = (invoice.terms || COMPANY_DEFAULTS.defaultTerms).map((t: string) => `<li>${t}</li>`).join("\n");
  const bankDetails = invoice.bankDetails || COMPANY_DEFAULTS;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Proforma Invoice - ${invoice.invoiceNumber}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4 portrait;margin:10mm 14mm;}
*{margin:0;padding:0;box-sizing:border-box;}
html{font-size:13px;}
body{font-family:'Inter','Source Sans 3','IBM Plex Sans','Noto Sans',Arial,sans-serif;font-size:9pt;color:#1a1a1a;line-height:1.45;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}

.invoice{width:100%;min-height:267mm;position:relative;}
.invoice-inner{padding:0;}

/* ---- Header ---- */
.header{text-align:center;padding:14pt 0 10pt 0;border-bottom:1.5pt solid #1a1a1a;margin-bottom:12pt;}
.gstin-top{text-align:left;font-size:7.5pt;color:#555;margin-bottom:4pt;letter-spacing:0.3pt;}
.company-name{font-size:18pt;font-weight:700;letter-spacing:0.8pt;text-transform:uppercase;margin:4pt 0;color:#1a1a1a;}
.company-address{font-size:7.5pt;line-height:1.6;color:#444;max-width:70%;margin:0 auto;}
.company-email{font-size:7.5pt;color:#444;margin-top:2pt;}
.invoice-title{font-size:16pt;font-weight:700;margin:8pt 0 2pt 0;letter-spacing:2pt;text-transform:uppercase;color:#1a1a1a;}
.invoice-divider{width:60px;height:2pt;background:#1a1a1a;margin:4pt auto 0 auto;}

/* ---- Party Section ---- */
.party-section{display:flex;gap:0;margin-bottom:10pt;}
.party-left{width:60%;padding:6pt 10pt 6pt 0;}
.party-right{width:40%;padding:6pt 0 6pt 10pt;text-align:right;border-left:1pt solid #ddd;}
.party-label{font-size:7.5pt;font-weight:600;text-transform:uppercase;letter-spacing:0.5pt;color:#666;margin-bottom:4pt;}
.party-name{font-size:11pt;font-weight:700;margin-bottom:3pt;color:#1a1a1a;}
.party-address{font-size:8.5pt;line-height:1.55;color:#333;}
.party-meta{font-size:8.5pt;margin-top:4pt;color:#444;}
.party-right .party-meta{text-align:right;}
.party-right .party-meta strong{font-weight:600;}

/* ---- Order Text ---- */
.order-text{font-size:8.5pt;font-style:italic;text-align:center;padding:6pt 0;margin-bottom:8pt;border-top:1pt solid #ddd;border-bottom:1pt solid #ddd;color:#444;}

/* ---- Items Table ---- */
table.items{width:100%;border-collapse:collapse;margin-bottom:10pt;font-size:8.5pt;}
table.items thead{background:#f2f2f2;}
table.items th{border:1pt solid #ccc;padding:5pt 6pt;text-align:center;font-weight:600;font-size:8pt;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.3pt;}
table.items td{border:1pt solid #ccc;padding:4pt 6pt;vertical-align:middle;}
table.items tbody tr:nth-child(even){background:#fafafa;}
.cell-center{text-align:center;}
.cell-right{text-align:right;font-variant-numeric:tabular-nums;}
table.items .cell-right{font-family:'Inter','Source Sans 3','IBM Plex Sans','Noto Sans',Arial,sans-serif;font-weight:500;}

/* ---- Summary Table ---- */
.summary-table{width:100%;border-collapse:collapse;margin-bottom:0;}
.summary-table td{border:0;padding:3pt 6pt;font-size:8.5pt;}
.summary-row td{text-align:right;padding:3pt 6pt;}
.summary-table .total-row td{border-top:1.5pt solid #1a1a1a;font-weight:700;font-size:10pt;padding:5pt 6pt;}

/* ---- Tax Summary ---- */
.tax-summary{width:100%;border-collapse:collapse;margin-top:8pt;font-size:8pt;}
.tax-summary thead{background:#f2f2f2;}
.tax-summary th{border:1pt solid #ccc;padding:4pt 5pt;text-align:center;font-weight:600;font-size:7.5pt;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.3pt;}
.tax-summary td{border:1pt solid #ccc;padding:3pt 5pt;text-align:center;}

/* ---- Amount in Words ---- */
.amount-words{margin:10pt 0 8pt 0;padding:8pt 10pt;background:#f9f9f9;border-left:3pt solid #1a1a1a;font-size:9pt;line-height:1.5;}
.amount-words strong{font-weight:700;}

/* ---- Footer Section ---- */
.footer-section{width:100%;margin:8pt 0 6pt 0;}
.footer-section table{width:100%;border-collapse:collapse;}
.footer-section td{vertical-align:top;padding:4pt 6pt;width:50%;}
.bank-details{font-size:8pt;line-height:1.7;color:#333;}
.bank-details strong{font-weight:600;font-size:8.5pt;}
.terms{font-size:8pt;line-height:1.6;color:#333;}
.terms strong{font-weight:600;font-size:8.5pt;}
.terms ul{margin:2pt 0 0 14pt;padding:0;}
.terms li{margin-bottom:1pt;}

/* ---- Disclaimer ---- */
.disclaimer{border-top:1pt solid #ddd;padding:6pt 0;margin-top:6pt;font-size:7pt;text-align:justify;line-height:1.5;color:#555;}
.disclaimer strong{font-weight:600;color:#333;}

/* ---- Signature ---- */
.signature-section{display:flex;margin:14pt 0 4pt 0;padding-top:8pt;border-top:1pt solid #ddd;}
.sign-left{width:50%;}
.sign-right{width:50%;text-align:right;font-weight:600;}

/* ---- hr ---- */
hr{border:none;border-top:1pt solid #ccc;margin:4pt 0;}

@media print{
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.invoice{page-break-after:avoid;}
}
</style>
</head>
<body>
<div class="invoice">
<div class="invoice-inner">

<div class="header">
<div class="gstin-top">GSTIN : ${invoice.companyGstin || COMPANY_DEFAULTS.gstin}</div>
<div class="company-name">${invoice.companyName || COMPANY_DEFAULTS.name}</div>
<div class="company-address">${(invoice.companyAddress || COMPANY_DEFAULTS.address).replace(/\n/g, "<br>")}</div>
<div class="company-email">${invoice.companyEmail || COMPANY_DEFAULTS.email}</div>
<div class="invoice-title">PROFORMA INVOICE</div>
<div class="invoice-divider"></div>
</div>

<div class="party-section">
<div class="party-left">
<div class="party-label">Bill To</div>
<div class="party-name">${invoice.customerName}</div>
<div class="party-address">
${partyAddressLines.length > 0 ? partyAddressLines.join("<br>") + "<br>" : ""}
${cityStatePincode ? cityStatePincode + "<br>" : ""}
${invoice.address ? invoice.address + "<br>" : ""}
</div>
${invoice.customerType === "Unregistered"
  ? `<div class="party-meta">ID Proof : ${invoice.idProofType || ""} - ${invoice.idProofNumber || ""}</div>`
  : `<div class="party-meta">GSTIN / UIN : ${invoice.gstNumber || ""}</div>`
}
</div>
<div class="party-right">
<div class="party-label">Invoice Details</div>
<div class="party-meta"><strong>Invoice No.</strong><br>${invoice.invoiceNumber}</div>
<div class="party-meta" style="margin-top:6pt;"><strong>Date</strong><br>${dateStr}</div>
</div>
</div>

<div class="order-text">We are pleased to receive the order for the following items</div>

<table class="items">
<thead>
<tr>
<th style="width:5%">Sr.</th>
<th style="width:34%">Description of Goods</th>
<th style="width:10%">HSN Code</th>
<th style="width:7%">Qty</th>
<th style="width:7%">Unit</th>
<th style="width:11%">Rate (₹)</th>
<th style="width:13%">Amount (₹)</th>
</tr>
</thead>
<tbody>
${productRows}
</tbody>
</table>

<table class="summary-table">
${gstRows.join("\n")}
<tr class="total-row"><td colspan="5" style="text-align:right;padding:4pt 6pt;">Grand Total</td><td style="text-align:right;padding:4pt 6pt;">${grandTotal.toFixed(2)}</td></tr>
</table>

<table class="tax-summary">
<thead>
<tr>
<th>Tax Rate</th>
<th>Taxable Amount</th>
<th>CGST</th>
<th>SGST</th>
<th>Total Tax</th>
</tr>
</thead>
<tbody>
${isInterstate
  ? `<tr><td>IGST @ ${igstPct}%</td><td>₹${baseAmount.toFixed(2)}</td><td>0.00</td><td>0.00</td><td>₹${igstAmount.toFixed(2)}</td></tr>`
  : `<tr><td>CGST @ ${cgstPct}% + SGST @ ${sgstPct}%</td><td>₹${baseAmount.toFixed(2)}</td><td>₹${cgstAmount.toFixed(2)}</td><td>₹${sgstAmount.toFixed(2)}</td><td>₹${totalTax.toFixed(2)}</td></tr>`
}
</tbody>
</table>

<div class="amount-words">
<strong>Amount in Words :</strong> ${invoice.amountInWords || ""}
</div>

<div class="footer-section">
<table>
<tr>
<td>
<div class="bank-details">
<strong>Bank Details</strong><br>
${bankDetails.bankName || "ICICI BANK, HIMATNAGAR"}<br>
A/C NO: ${bankDetails.accountNo || "045205014806"}<br>
IFSC: ${bankDetails.ifsc || "ICIC0000452"}
</div>
</td>
<td>
<div class="terms">
<strong>Terms &amp; Conditions</strong>
<ul>
${terms}
</ul>
</div>
</td>
</tr>
</table>
</div>

<div class="disclaimer">
<strong>DISCLAIMER : </strong>${invoice.disclaimer || COMPANY_DEFAULTS.disclaimer}
</div>

<div class="signature-section">
<div class="sign-left">
<div style="font-size:7.5pt;color:#666;">Receiver's Signature</div>
<div style="margin-top:16pt;border-top:1pt solid #999;width:130px;font-size:7pt;text-align:center;padding-top:2pt;color:#666;">Receiver Signature</div>
</div>
<div class="sign-right">
<div style="margin-bottom:28pt;color:#1a1a1a;">For ${invoice.companyName || COMPANY_DEFAULTS.name}</div>
<div style="border-top:1pt solid #999;width:130px;margin-left:auto;padding-top:2pt;font-size:7pt;color:#666;">Authorised Signatory</div>
</div>
</div>

</div>
</div>
</body>
</html>`;
}

async function enrichInvoice(invoice: typeof proformaInvoicesTable.$inferSelect) {
  const items = await db
    .select()
    .from(proformaInvoiceItemsTable)
    .where(eq(proformaInvoiceItemsTable.invoiceId, invoice.id));

  let createdByUser = null;
  if (invoice.createdBy) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, invoice.createdBy));
    if (u) {
      const { passwordHash: _, ...safe } = u;
      createdByUser = safe;
    }
  }

  let contact = null;
  if (invoice.contactId) {
    const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, invoice.contactId));
    if (c) contact = c;
  }

  let deal = null;
  if (invoice.dealId) {
    const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, invoice.dealId));
    if (d) deal = d;
  }

  return {
    ...invoice,
    taxableAmount: Number(invoice.taxableAmount),
    freight: Number(invoice.freight),
    cgst: Number(invoice.cgst),
    sgst: Number(invoice.sgst),
    igst: Number(invoice.igst),
    cgstPercent: Number(invoice.cgstPercent || 0),
    sgstPercent: Number(invoice.sgstPercent || 0),
    igstPercent: Number(invoice.igstPercent || 0),
    grandTotal: Number(invoice.grandTotal),
    items: items.map((i) => ({
      ...i,
      quantity: Number(i.quantity),
      rate: Number(i.rate),
      discount: Number(i.discount || 0),
      discountPercent: Number(i.discountPercent || 0),
      gstPercent: Number(i.gstPercent || 0),
      amount: Number(i.amount),
    })),
    createdByUser,
    contact,
    deal,
  };
}

router.get("/proforma-invoices", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, dateFrom, dateTo, ownerId, customer, page, limit } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(proformaInvoicesTable.isDeleted, false)];

    if (user.role === "sales") {
      conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    }

    if (status && status !== "all") conditions.push(eq(proformaInvoicesTable.status, status));
    if (ownerId) conditions.push(eq(proformaInvoicesTable.salesOwnerId, Number(ownerId)));
    if (customer) conditions.push(sql`LOWER(${proformaInvoicesTable.customerName}) LIKE ${`%${customer.toLowerCase()}%`}`);
    if (search) {
      conditions.push(sql`(
        ${proformaInvoicesTable.invoiceNumber} ILIKE ${`%${search}%`} OR
        ${proformaInvoicesTable.customerName} ILIKE ${`%${search}%`} OR
        ${proformaInvoicesTable.companyName} ILIKE ${`%${search}%`} OR
        ${proformaInvoicesTable.mobile} ILIKE ${`%${search}%`}
      )`);
    }
    if (dateFrom) conditions.push(gte(proformaInvoicesTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(proformaInvoicesTable.createdAt, new Date(dateTo + "T23:59:59")));

    const pageNum = Math.max(1, parseInt(page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit || "15", 10) || 15));
    const offset = (pageNum - 1) * pageSize;

    const [{ count }] = await db
      .select({ count: sql`count(*)::int` })
      .from(proformaInvoicesTable)
      .where(and(...conditions));

    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(...conditions))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(pageSize)
      .offset(offset);

    const enriched = await Promise.all(invoices.map(enrichInvoice));
    res.json({ data: enriched, total: count, page: pageNum, totalPages: Math.ceil(count / pageSize) });
  } catch (err) {
    req.log.error({ err }, "List proforma invoices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/all", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, dateFrom, dateTo, ownerId, customer } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(proformaInvoicesTable.isDeleted, false)];

    if (user.role === "sales") {
      conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    }

    if (status && status !== "all") conditions.push(eq(proformaInvoicesTable.status, status));
    if (ownerId) conditions.push(eq(proformaInvoicesTable.salesOwnerId, Number(ownerId)));
    if (customer) conditions.push(sql`LOWER(${proformaInvoicesTable.customerName}) LIKE ${`%${customer.toLowerCase()}%`}`);
    if (search) {
      conditions.push(sql`(
        ${proformaInvoicesTable.invoiceNumber} ILIKE ${`%${search}%`} OR
        ${proformaInvoicesTable.customerName} ILIKE ${`%${search}%`} OR
        ${proformaInvoicesTable.companyName} ILIKE ${`%${search}%`} OR
        ${proformaInvoicesTable.mobile} ILIKE ${`%${search}%`}
      )`);
    }
    if (dateFrom) conditions.push(gte(proformaInvoicesTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(proformaInvoicesTable.createdAt, new Date(dateTo + "T23:59:59")));

    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(...conditions))
      .orderBy(desc(proformaInvoicesTable.createdAt));

    const enriched = await Promise.all(invoices.map(enrichInvoice));
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "List all proforma invoices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/proforma-invoices", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { customerName, companyName, tradeName, contactId, dealId, address, addressLine1, addressLine2, addressLine3, city, district, state, pincode, gstNumber, gstStatus, mobile, taxableAmount, freight, cgst, sgst, igst, cgstPercent, sgstPercent, igstPercent, grandTotal, amountInWords, status, notes, items, customerType, idProofType, idProofNumber, invoiceNumber, terms, companyGstin, companyAddress, companyEmail, bankDetails, disclaimer, customerMasterId } = req.body;

    if (!customerName || !items?.length) {
      res.status(400).json({ error: "Customer name and at least one item required" });
      return;
    }

    let finalInvoiceNumber = invoiceNumber;
    if (finalInvoiceNumber) {
      const [existing] = await db.select({ id: proformaInvoicesTable.id }).from(proformaInvoicesTable).where(eq(proformaInvoicesTable.invoiceNumber, finalInvoiceNumber));
      if (existing) {
        res.status(409).json({ error: "Invoice number already exists" });
        return;
      }
    } else {
      finalInvoiceNumber = await getNextInvoiceNumber();
    }

    const words = amountInWords || amountToWords(Number(grandTotal) || 0);

    let resolvedContactId = contactId || null;
    let resolvedSalesOwnerId = null;
    if (resolvedContactId) {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, resolvedContactId));
      if (contact) resolvedSalesOwnerId = contact.salesOwnerId;
    }

    const [invoice] = await db
      .insert(proformaInvoicesTable)
      .values({
        invoiceNumber: finalInvoiceNumber,
        customerName,
        companyName: companyName || null,
        tradeName: tradeName || null,
        contactId: resolvedContactId,
        dealId: dealId || null,
        salesOwnerId: resolvedSalesOwnerId,
        customerMasterId: customerMasterId || null,
        address: address || null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        addressLine3: addressLine3 || null,
        city: city || null,
        district: district || null,
        state: state || null,
        pincode: pincode || null,
        customerType: customerType || "GST",
        gstNumber: gstNumber || null,
        gstStatus: gstStatus || null,
        idProofType: idProofType || null,
        idProofNumber: idProofNumber || null,
        mobile: mobile || null,
        taxableAmount: String(taxableAmount || 0),
        freight: String(freight || 0),
        cgst: String(cgst || 0),
        sgst: String(sgst || 0),
        igst: String(igst || 0),
        cgstPercent: String(cgstPercent || 0),
        sgstPercent: String(sgstPercent || 0),
        igstPercent: String(igstPercent || 0),
        grandTotal: String(grandTotal || 0),
        amountInWords: words,
        status: status || "Draft",
        notes: notes || null,
        createdBy: user.id,
      })
      .returning();

    for (const item of items) {
      await db.insert(proformaInvoiceItemsTable).values({
        invoiceId: invoice!.id,
        productName: item.productName,
        hsnCode: item.hsnCode || null,
        bottleType: item.bottleType || null,
        capacity: item.capacity || null,
        weight: item.weight || null,
        quantity: String(item.quantity),
        unit: item.unit || "Pcs",
        rate: String(item.rate),
        discountPercent: String(item.discountPercent || 0),
        discount: String(item.discount || 0),
        gstPercent: String(item.gstPercent || 0),
        amount: String(item.amount),
      });
    }

    if ((status || "Draft") !== "Draft") {
      await db.insert(proformaInvoiceHistoryTable).values({
        invoiceId: invoice!.id,
        statusFrom: null,
        statusTo: status || "Draft",
        changedBy: user.id,
      });
    }

    res.status(201).json(await enrichInvoice(invoice!));
  } catch (err) {
    req.log.error({ err }, "Create proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

router.post("/proforma-invoices/gst-lookup", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { gstNumber } = req.body;
    if (!gstNumber || typeof gstNumber !== "string") {
      res.status(400).json({ error: "GST number is required" });
      return;
    }

    const gstin = gstNumber.toUpperCase().trim();
    if (!GSTIN_REGEX.test(gstin)) {
      res.status(400).json({ error: "Invalid GSTIN format. Must be 15 alphanumeric characters (e.g. 24AAJFE2064P1Z6)." });
      return;
    }

    const provider = getGstProvider();
    const details = await provider.lookup(gstin);
    res.json(details);
  } catch (err: any) {
    if (err.message?.includes("not configured")) {
      res.status(503).json({ error: err.message });
    } else if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
    } else {
      req.log.error({ err }, "GST lookup error");
      res.status(502).json({ error: err.message || "GST lookup failed" });
    }
  }
});

router.post("/proforma-invoices/gst-clear-cache", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
    clearGstCache();
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "GST cache clear error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Report endpoints (must be before :id to avoid capture as param) ---

router.get("/proforma-invoices/report/summary", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { dateFrom, dateTo, ownerId, status } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(proformaInvoicesTable.isDeleted, false)];

    if (user.role === "sales") conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    if (status) conditions.push(eq(proformaInvoicesTable.status, status));
    if (ownerId) conditions.push(eq(proformaInvoicesTable.salesOwnerId, Number(ownerId)));
    if (dateFrom) conditions.push(gte(proformaInvoicesTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(proformaInvoicesTable.createdAt, new Date(dateTo + "T23:59:59")));

    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(...conditions));

    const totalInvoices = invoices.length;
    const totalAmount = invoices.reduce((s, inv) => s + Number(inv.grandTotal || 0), 0);
    const statusCounts = INVOICE_STATUSES.map(st => ({
      status: st,
      count: invoices.filter(inv => inv.status === st).length,
      amount: invoices.filter(inv => inv.status === st).reduce((s, inv) => s + Number(inv.grandTotal || 0), 0),
    }));

    const byCustomer: Record<string, { count: number; amount: number }> = {};
    for (const inv of invoices) {
      const key = inv.customerName;
      if (!byCustomer[key]) byCustomer[key] = { count: 0, amount: 0 };
      byCustomer[key].count++;
      byCustomer[key].amount += Number(inv.grandTotal || 0);
    }
    const customerStats = Object.entries(byCustomer)
      .map(([customer, stats]) => ({ customer, ...stats }))
      .sort((a, b) => b.amount - a.amount);

    const byOwner: Record<string, { count: number; amount: number }> = {};
    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u.name]));
    for (const inv of invoices) {
      const owner = inv.salesOwnerId ? userMap.get(inv.salesOwnerId) || "Unknown" : "Unassigned";
      if (!byOwner[owner]) byOwner[owner] = { count: 0, amount: 0 };
      byOwner[owner].count++;
      byOwner[owner].amount += Number(inv.grandTotal || 0);
    }
    const ownerStats = Object.entries(byOwner)
      .map(([owner, stats]) => ({ owner, ...stats }))
      .sort((a, b) => b.amount - a.amount);

    const byMonth: Record<string, { count: number; amount: number }> = {};
    for (const inv of invoices) {
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = { count: 0, amount: 0 };
      byMonth[key].count++;
      byMonth[key].amount += Number(inv.grandTotal || 0);
    }
    const monthlyStats = Object.entries(byMonth)
      .map(([month, stats]) => ({ month, ...stats }))
      .sort((a, b) => a.month.localeCompare(b.month));

    res.json({
      totalInvoices,
      totalAmount,
      statusCounts,
      byCustomer: customerStats.slice(0, 20),
      byOwner: ownerStats,
      byMonth: monthlyStats,
    });
  } catch (err) {
    req.log.error({ err }, "Proforma report summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/report/export", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { dateFrom, dateTo, ownerId, status } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(proformaInvoicesTable.isDeleted, false)];

    if (user.role === "sales") conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    if (status) conditions.push(eq(proformaInvoicesTable.status, status));
    if (ownerId) conditions.push(eq(proformaInvoicesTable.salesOwnerId, Number(ownerId)));
    if (dateFrom) conditions.push(gte(proformaInvoicesTable.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(proformaInvoicesTable.createdAt, new Date(dateTo + "T23:59:59")));

    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(...conditions))
      .orderBy(desc(proformaInvoicesTable.createdAt));

    const fmt = (req.query.format as string) || "xlsx";

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const finalRows = invoices.map(inv => ({
      "Invoice #": inv.invoiceNumber,
      "Date": inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("en-IN") : "",
      "Customer": inv.customerName,
      "Company": inv.companyName || "",
      "Mobile": inv.mobile || "",
      "GSTIN": inv.gstNumber || "",
      "Taxable": Number(inv.taxableAmount || 0).toFixed(2),
      "CGST": Number(inv.cgst || 0).toFixed(2),
      "SGST": Number(inv.sgst || 0).toFixed(2),
      "IGST": Number(inv.igst || 0).toFixed(2),
      "Freight": Number(inv.freight || 0).toFixed(2),
      "Grand Total": Number(inv.grandTotal || 0).toFixed(2),
      "Status": inv.status || "Draft",
      "Created By": userMap.get(inv.createdBy) || "",
    }));

    if (fmt === "csv") {
      const headers = Object.keys(finalRows[0] || {});
      const csv = [
        headers.join(","),
        ...finalRows.map(row =>
          headers.map(h => {
            const val = (row as any)[h];
            const str = val == null ? "" : String(val);
            return str.includes(",") || str.includes('"') || str.includes("\n")
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          }).join(",")
        ),
      ].join("\n");
      res.setHeader("Content-Type", "text/csv;charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=proforma-report.csv");
      res.send(csv);
    } else {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(finalRows);
      XLSX.utils.book_append_sheet(wb, ws, "Proformas");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=proforma-report.xlsx");
      res.send(buf);
    }
  } catch (err) {
    req.log.error({ err }, "Proforma report export error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.isDeleted, false)));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

    if (user.role === "sales" && invoice.createdBy !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(await enrichInvoice(invoice));
  } catch (err) {
    req.log.error({ err }, "Get proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function updateInvoiceHandler(req: any, res: any) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.isDeleted, false)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (user.role === "sales") {
      if (existing.createdBy !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      if (existing.status !== "Draft") {
        res.status(403).json({ error: "Only draft invoices can be edited" });
        return;
      }
    }

    const { customerName, companyName, tradeName, contactId, dealId, address, addressLine1, addressLine2, addressLine3, city, district, state, pincode, gstNumber, gstStatus, mobile, taxableAmount, freight, cgst, sgst, igst, cgstPercent, sgstPercent, igstPercent, grandTotal, amountInWords, notes, items, customerType, idProofType, idProofNumber, invoiceNumber, terms, companyGstin, companyAddress, companyEmail, bankDetails, disclaimer, customerMasterId } = req.body;

    const updateData: any = {};
    if (customerName !== undefined) updateData.customerName = customerName;
    if (companyName !== undefined) updateData.companyName = companyName;
    if (tradeName !== undefined) updateData.tradeName = tradeName;
    if (contactId !== undefined) updateData.contactId = contactId;
    if (dealId !== undefined) updateData.dealId = dealId;
    if (customerMasterId !== undefined) updateData.customerMasterId = customerMasterId;
    if (address !== undefined) updateData.address = address;
    if (addressLine1 !== undefined) updateData.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2;
    if (addressLine3 !== undefined) updateData.addressLine3 = addressLine3;
    if (city !== undefined) updateData.city = city;
    if (district !== undefined) updateData.district = district;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (gstNumber !== undefined) updateData.gstNumber = gstNumber;
    if (gstStatus !== undefined) updateData.gstStatus = gstStatus;
    if (customerType !== undefined) updateData.customerType = customerType;
    if (idProofType !== undefined) updateData.idProofType = idProofType;
    if (idProofNumber !== undefined) updateData.idProofNumber = idProofNumber;
    if (mobile !== undefined) updateData.mobile = mobile;
    if (invoiceNumber !== undefined) {
      const [dup] = await db.select({ id: proformaInvoicesTable.id }).from(proformaInvoicesTable).where(eq(proformaInvoicesTable.invoiceNumber, invoiceNumber));
      if (dup && dup.id !== id) {
        res.status(409).json({ error: "Invoice number already exists" });
        return;
      }
      updateData.invoiceNumber = invoiceNumber;
    }
    if (taxableAmount !== undefined) updateData.taxableAmount = String(taxableAmount);
    if (freight !== undefined) updateData.freight = String(freight);
    if (cgst !== undefined) updateData.cgst = String(cgst);
    if (sgst !== undefined) updateData.sgst = String(sgst);
    if (igst !== undefined) updateData.igst = String(igst);
    if (cgstPercent !== undefined) updateData.cgstPercent = String(cgstPercent);
    if (sgstPercent !== undefined) updateData.sgstPercent = String(sgstPercent);
    if (igstPercent !== undefined) updateData.igstPercent = String(igstPercent);
    if (grandTotal !== undefined) updateData.grandTotal = String(grandTotal);
    if (amountInWords !== undefined) updateData.amountInWords = amountInWords;
    if (notes !== undefined) updateData.notes = notes;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(proformaInvoicesTable)
        .set(updateData)
        .where(eq(proformaInvoicesTable.id, id));
    }

    if (items) {
      await db.delete(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.invoiceId, id));
      for (const item of items) {
        await db.insert(proformaInvoiceItemsTable).values({
          invoiceId: id,
          productName: item.productName,
          hsnCode: item.hsnCode || null,
          bottleType: item.bottleType || null,
          capacity: item.capacity || null,
          weight: item.weight || null,
          quantity: String(item.quantity),
          unit: item.unit || "Pcs",
          rate: String(item.rate),
          discountPercent: String(item.discountPercent || 0),
          discount: String(item.discount || 0),
          gstPercent: String(item.gstPercent || 0),
          amount: String(item.amount),
        });
      }
    }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, id));

    if (contactId && !existing.contactId) {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
      if (contact && !updateData.salesOwnerId) {
        await db.update(proformaInvoicesTable).set({ salesOwnerId: contact.salesOwnerId }).where(eq(proformaInvoicesTable.id, id));
      }
    }

    res.json(await enrichInvoice(invoice!));
  } catch (err) {
    req.log.error({ err }, "Update proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
}

router.patch("/proforma-invoices/:id", updateInvoiceHandler);
router.put("/proforma-invoices/:id", updateInvoiceHandler);

router.post("/proforma-invoices/:id/status", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { status, notes } = req.body;
    if (!INVOICE_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.isDeleted, false)));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

    if (user.role === "sales" && invoice.createdBy !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const prevStatus = invoice.status;
    await db
      .update(proformaInvoicesTable)
      .set({ status })
      .where(eq(proformaInvoicesTable.id, id));

    await db.insert(proformaInvoiceHistoryTable).values({
      invoiceId: id,
      statusFrom: prevStatus,
      statusTo: status,
      changedBy: user.id,
      notes: notes || null,
    });

    const [updated] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, id));

    res.json(await enrichInvoice(updated!));
  } catch (err) {
    req.log.error({ err }, "Update proforma invoice status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/proforma-invoices/:id/duplicate", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [source] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.isDeleted, false)));

    if (!source) { res.status(404).json({ error: "Not found" }); return; }

    if (user.role === "sales" && source.createdBy !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const sourceItems = await db
      .select()
      .from(proformaInvoiceItemsTable)
      .where(eq(proformaInvoiceItemsTable.invoiceId, id));

    const newInvoiceNumber = await getNextInvoiceNumber();
    const [invoice] = await db
      .insert(proformaInvoicesTable)
      .values({
        invoiceNumber: newInvoiceNumber,
        customerName: source.customerName,
        companyName: source.companyName,
        contactId: source.contactId,
        dealId: source.dealId,
        salesOwnerId: source.salesOwnerId,
        address: source.address,
        addressLine1: source.addressLine1,
        addressLine2: source.addressLine2,
        addressLine3: source.addressLine3,
        city: source.city,
        state: source.state,
        pincode: source.pincode,
        customerType: source.customerType,
        gstNumber: source.gstNumber,
        idProofType: source.idProofType,
        idProofNumber: source.idProofNumber,
        mobile: source.mobile,
        taxableAmount: source.taxableAmount,
        freight: source.freight,
        cgst: source.cgst,
        sgst: source.sgst,
        igst: source.igst,
        cgstPercent: source.cgstPercent,
        sgstPercent: source.sgstPercent,
        igstPercent: source.igstPercent,
        grandTotal: source.grandTotal,
        amountInWords: source.amountInWords,
        status: "Draft",
        notes: source.notes,
        createdBy: user.id,
      })
      .returning();

    for (const item of sourceItems) {
      await db.insert(proformaInvoiceItemsTable).values({
        invoiceId: invoice!.id,
        productName: item.productName,
        hsnCode: item.hsnCode,
        bottleType: item.bottleType,
        capacity: item.capacity,
        weight: item.weight,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        discountPercent: item.discountPercent,
        discount: item.discount,
        gstPercent: item.gstPercent,
        amount: item.amount,
      });
    }

    res.status(201).json(await enrichInvoice(invoice!));
  } catch (err) {
    req.log.error({ err }, "Duplicate proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/proforma-invoices/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    if (user.role !== "admin") {
      res.status(403).json({ error: "Only admins can delete invoices" });
      return;
    }

    await db
      .update(proformaInvoicesTable)
      .set({ isDeleted: true })
      .where(eq(proformaInvoicesTable.id, id));

    res.status(200).json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/:id/html", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, id));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db
      .select()
      .from(proformaInvoiceItemsTable)
      .where(eq(proformaInvoiceItemsTable.invoiceId, id));

    const html = renderInvoiceHtml(invoice, items);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "Get proforma invoice HTML error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/:id/pdf", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, id));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db
      .select()
      .from(proformaInvoiceItemsTable)
      .where(eq(proformaInvoiceItemsTable.invoiceId, id));

    const html = renderInvoiceHtml(invoice, items);

    try {
      const { launch } = await import("puppeteer");
      const browser = await launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1240, height: 1754 });
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
      });
      await browser.close();

      const filename = `Proforma_${invoice.invoiceNumber}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (puppeteerErr: any) {
      req.log.error({ err: puppeteerErr }, "PDF generation failed, returning HTML instead");
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    }
  } catch (err) {
    req.log.error({ err }, "Get proforma invoice PDF error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
