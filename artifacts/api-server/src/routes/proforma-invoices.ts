import { Router, type IRouter } from "express";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, proformaInvoiceHistoryTable, productionOrdersTable, productionTimelineTable, productionNotesTable, usersTable, contactsTable, dealsTable, customerMasterTable, activitiesTable, INVOICE_STATUSES } from "@workspace/db";
import { eq, desc, and, or, SQL, sql, like, gte, lte, isNull } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { amountToWords } from "../lib/amount-to-words";
import { getGstProvider } from "../lib/gst-provider";
import axios from "axios";
import * as XLSX from "xlsx";
import { getActivePiForDeal, deactivateActivePis, getNextPiVersion } from "../lib/proforma-service";
import { notifyProductionUsers } from "../lib/notification-service";
import { logPiActivity, logActivity, formatTimestamp } from "../lib/activity-logger";
import { canModifyInvoice } from "../lib/permission-service";
import { getAccessibleUnits } from "../lib/unit-filter";
import { PENDING_UNIT_ASSIGNMENT } from "../lib/unit-constants";

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
  defaultTerms: ["FREIGHT CHARGES WILL BE ADDITIONAL", "PAYMENT TERMS:", "100% UPFRONT AT TIME OF CONFIRMATION"],
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

  const totalQty = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
  const qtyUnits = [...new Set(items.map((item: any) => item.unit).filter(Boolean))];
  const qtyDisplay = qtyUnits.length === 1 ? `${totalQty.toFixed(3)} ${qtyUnits[0]}` : "";

  const dateStr = new Date(invoice.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const totalTax = cgstAmount + sgstAmount + igstAmount;

  const terms = (invoice.terms || COMPANY_DEFAULTS.defaultTerms).join("<br>");
  const bankDetails = invoice.bankDetails || COMPANY_DEFAULTS;

  const HEADER_PT = 215;
  const ROW_PT = 21;
  const FOOTER_PT = 315;
  const PAGE_PT = 790;

  const perPageNoFooter = Math.floor((PAGE_PT - HEADER_PT) / ROW_PT);
  const perPageWithFooter = Math.max(1, Math.floor((PAGE_PT - HEADER_PT - FOOTER_PT) / ROW_PT));

  const pageBoundaries: { start: number; end: number; last: boolean }[] = [];
  let cursor = 0;
  while (cursor < items.length) {
    const remaining = items.length - cursor;
    const canFitWithFooter = remaining <= perPageWithFooter;
    const take = canFitWithFooter ? remaining : perPageNoFooter;
    pageBoundaries.push({ start: cursor, end: cursor + take, last: canFitWithFooter });
    cursor += take;
  }

  function headerHtml(): string {
    return `
    <div class="header">
      <div class="gstin-top"><strong>GSTIN :</strong> ${COMPANY_DEFAULTS.gstin}</div>
      <div class="invoice-title">PROFORMA INVOICE</div>
      <div class="company-name">${COMPANY_DEFAULTS.name}</div>
      <div class="header-address">${COMPANY_DEFAULTS.address.replace(/\n/g, "<br>")}</div>
      <div class="header-email">${COMPANY_DEFAULTS.email}</div>
    </div>
    <div class="party-section">
      <div class="party-left">
        <div class="party-label">Party Details :</div>
        ${(() => {
          const firstLine = invoice.tradeName || invoice.companyName;
          const secondLine = invoice.customerName;
          if (firstLine && firstLine !== secondLine) {
            return `<div class="party-name">${firstLine}</div><div class="party-name">${secondLine}</div>`;
          }
          return `<div class="party-name">${secondLine}</div>`;
        })()}
        <div class="party-address">
          ${partyAddressLines.length > 0 ? partyAddressLines.join("<br>") + "<br>" : ""}
          ${cityStatePincode ? cityStatePincode + "<br>" : ""}
          ${invoice.address ? invoice.address.replace(/\n/g, "<br>") + "<br>" : ""}
        </div>
        ${invoice.customerType === "Unregistered"
          ? `<div class="party-gstin">ID Proof : ${invoice.idProofType || ""} - ${invoice.idProofNumber || ""}</div>`
          : invoice.gstNumber
            ? `<div class="party-gstin">GSTIN / UIN : ${invoice.gstNumber}</div>`
            : ""
        }
      </div>
      <div class="party-right">
        <div class="order-label">Order No :</div>
        <div class="order-value">${invoice.invoiceNumber}</div>
        <div class="order-label">Date :</div>
        <div class="date-value">${dateStr}</div>
      </div>
    </div>
    <div class="order-text">We are pleased to receive the order for the following items</div>`;
  }

  function tableHeaderHtml(): string {
    return `<table class="items">
      <thead>
        <tr>
          <th style="width:5%">S.N.</th>
          <th style="width:30%">Description of Goods</th>
          <th style="width:12%">HSN/SAC Code</th>
          <th style="width:9%">Qty</th>
          <th style="width:8%">Unit</th>
          <th style="width:10%">Price</th>
          <th style="width:12%">Amount</th>
        </tr>
      </thead>
      <tbody>`;
  }

  function footerHtml(): string {
    return `</tbody></table>
    <table class="summary-table">
      ${`<tr><td colspan="5" style="text-align:right;padding:3pt 8pt">Product Total</td><td style="text-align:right;padding:3pt 8pt">${taxableAmount.toFixed(2)}</td></tr>`}
      ${freight > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 8pt">Freight Charges</td><td style="text-align:right;padding:3pt 8pt">${freight.toFixed(2)}</td></tr>` : ""}
      ${cgstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 8pt">CGST @ ${cgstPct}%</td><td style="text-align:right;padding:3pt 8pt">${cgstAmount.toFixed(2)}</td></tr>` : ""}
      ${sgstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 8pt">SGST @ ${sgstPct}%</td><td style="text-align:right;padding:3pt 8pt">${sgstAmount.toFixed(2)}</td></tr>` : ""}
      ${igstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 8pt">IGST @ ${igstPct}%</td><td style="text-align:right;padding:3pt 8pt">${igstAmount.toFixed(2)}</td></tr>` : ""}
      <tr class="total-row"><td colspan="4" style="text-align:right;padding:3pt 8pt">Grand Total</td><td style="text-align:right;padding:3pt 8pt">${qtyDisplay}</td><td style="text-align:right;padding:3pt 8pt">${grandTotal.toFixed(2)}</td></tr>
    </table>
    <table class="tax-summary">
      <thead>
        <tr>
          <th>Tax Rate</th>
          <th>Taxable Amount</th>
          <th>CGST Amount</th>
          <th>SGST Amount</th>
          <th>Total Tax</th>
        </tr>
      </thead>
      <tbody>
        ${isInterstate
          ? `<tr><td>IGST @ ${igstPct}%</td><td>${baseAmount.toFixed(2)}</td><td>0.00</td><td>0.00</td><td>${igstAmount.toFixed(2)}</td></tr>`
          : `<tr><td>CGST @ ${cgstPct}% + SGST @ ${sgstPct}%</td><td>${baseAmount.toFixed(2)}</td><td>${cgstAmount.toFixed(2)}</td><td>${sgstAmount.toFixed(2)}</td><td>${totalTax.toFixed(2)}</td></tr>`
        }
      </tbody>
    </table>
    <div class="amount-words">
      <strong>Amount in Words :</strong> ${invoice.amountInWords || ""}
    </div>
    <div class="footer-section">
      <table>
        <tr>
          <td style="border-right:1.5px solid #000;">
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
              <div>${terms}</div>
            </div>
          </td>
        </tr>
      </table>
    </div>
    <div class="disclaimer">
      <strong>DISCLAIMER : </strong>${invoice.disclaimer || COMPANY_DEFAULTS.disclaimer}
    </div>
    <div class="signature-section">
      <div class="sign-left">Receiver Signature</div>
      <div class="sign-right">
        <div class="for-company">for ${COMPANY_DEFAULTS.name}</div>
        <div class="authorised">Authorised Signatory</div>
      </div>
    </div>`;
  }

  // Pre-compute per-page totals for Carry Forward / Brought Forward
  const pageTotals = pageBoundaries.map((b) => {
    const pageItems = items.slice(b.start, b.end);
    const qty = pageItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
    const amt = pageItems.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
    const pageUnits = [...new Set(pageItems.map((item: any) => item.unit).filter(Boolean))];
    const unit = pageUnits.length === 1 ? pageUnits[0] : "";
    return { qty, amt, unit };
  });

  const pagesHtml = pageBoundaries.map((b, pi) => {
    const pageItems = items.slice(b.start, b.end);

    // Brought Forward row on pages after the first
    const prevPt = pi > 0 ? pageTotals[pi - 1] : null;
    const bdRow = prevPt
      ? `<tr><td colspan="3" style="text-align:left;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;font-weight:bold;">b/d</td><td style="text-align:center;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${prevPt.qty.toFixed(3)}</td><td style="text-align:center;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${prevPt.unit}</td><td style="text-align:center;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;"></td><td style="text-align:right;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${prevPt.amt.toFixed(2)}</td></tr>`
      : "";

    const rows = pageItems.map((item: any, ri: number) => `
      <tr>
        <td style="text-align:center;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${b.start + ri + 1}</td>
        <td style="text-align:left;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;word-break:break-word;white-space:normal;">${item.productName}${item.bottleType ? ` (${item.bottleType})` : ""}${item.capacity ? ` ${item.capacity}` : ""}${item.weight ? ` ${item.weight}` : ""}</td>
        <td style="text-align:center;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${item.hsnCode || "-"}</td>
        <td style="text-align:center;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${item.quantity}</td>
        <td style="text-align:center;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${item.unit}</td>
        <td style="text-align:right;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${Number(item.rate).toFixed(2)}</td>
        <td style="text-align:right;vertical-align:top;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${Number(item.amount).toFixed(2)}</td>
      </tr>`).join("\n");

    // Carry Forward row on non-last pages
    const pt = pageTotals[pi];
    const cfRow = !b.last
      ? `<tr><td colspan="3" style="text-align:left;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;font-weight:bold;">Totals c/o</td><td style="text-align:center;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${pt.qty.toFixed(3)}</td><td style="text-align:center;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${pt.unit}</td><td style="text-align:center;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;"></td><td style="text-align:right;padding:4pt 4pt;font-size:8.5pt;border:1px solid #000;">${pt.amt.toFixed(2)}</td></tr>`
      : "";

    const pageStyle = pi < pageBoundaries.length - 1
      ? `page-break-after:always;min-height:100%;`
      : `min-height:100%;`;

    return `<div class="page" style="${pageStyle}">
      ${headerHtml()}
      ${tableHeaderHtml()}
      ${bdRow}
      ${rows}
      ${cfRow}
      ${b.last ? footerHtml() : `</tbody></table>`}
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Proforma Invoice - ${invoice.invoiceNumber}</title>
<style>
@page{size:A4 portrait;margin:0;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:297mm;}
body{font-family:Arial,sans-serif;font-size:9pt;color:#000;line-height:1.35;margin:0;padding:5mm;}
.page{width:100%;border:1.5px solid #000;overflow-wrap:break-word;display:flex;flex-direction:column;}
/* ── Header ── */
.header{text-align:center;border-bottom:1.5px solid #000;padding:6pt 8pt 5pt 8pt;}
.gstin-top{text-align:left;font-size:7.5pt;margin-bottom:3pt;}
.invoice-title{font-size:13pt;font-weight:bold;margin:2pt 0 3pt 0;text-decoration:underline;}
.company-name{font-size:16pt;font-weight:bold;letter-spacing:0.3pt;margin:0 0 2pt 0;}
.header-address{font-size:7.5pt;line-height:1.4;color:#000;margin-bottom:1pt;}
.header-email{font-size:7.5pt;margin-top:1pt;}
/* ── Party Section ── */
.party-section{display:flex;border-bottom:1.5px solid #000;}
.party-left{width:60%;padding:5pt 8pt;border-right:1.5px solid #000;}
.party-right{width:40%;padding:5pt 8pt;text-align:right;}
.party-label{font-weight:bold;font-size:9pt;margin-bottom:3pt;}
.party-name{font-weight:bold;font-size:9.5pt;}
.party-address{font-size:8.5pt;line-height:1.4;margin-top:2pt;}
.party-gstin{font-size:8.5pt;margin-top:3pt;}
.order-label{font-weight:bold;font-size:9pt;margin-bottom:3pt;}
.order-value{font-size:9pt;margin-bottom:4pt;}
.date-value{font-size:9pt;}
/* ── Order Text ── */
.order-text{font-size:8.5pt;font-style:italic;text-align:center;padding:4pt 0;border-bottom:1.5px solid #000;}
/* ── Items Table ── */
table.items{width:100%;table-layout:fixed;border-collapse:collapse;font-size:8.5pt;}
table.items th{background:#f0f0f0;border:1px solid #000;padding:4pt 4pt;text-align:center;font-weight:bold;font-size:8pt;height:22pt;overflow-wrap:break-word;}
table.items td{border:1px solid #000;padding:4pt 4pt;font-size:8.5pt;overflow-wrap:break-word;word-break:break-word;}
/* ── Summary Table ── */
.summary-table{width:100%;border-collapse:collapse;border-top:1.5px solid #000;}
.summary-table td{border:0;padding:2pt 6pt;font-size:8.5pt;}
.summary-table .total-row td{border-top:1.5px solid #000;font-weight:bold;font-size:9.5pt;padding:3pt 6pt;}
/* ── Tax Table ── */
.tax-summary{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:4pt;font-size:8pt;}
.tax-summary th{background:#f0f0f0;border:1px solid #000;padding:3pt 4pt;text-align:center;font-weight:bold;font-size:7.5pt;height:18pt;overflow-wrap:break-word;}
.tax-summary td{border:1px solid #000;padding:2pt 4pt;text-align:center;font-size:8pt;overflow-wrap:break-word;}
/* ── Amount in Words ── */
.amount-words{padding:5pt 8pt;font-size:8.5pt;border-top:1.5px solid #000;}
.amount-words strong{font-size:9pt;}
/* ── Footer Section ── */
.footer-section{width:100%;border-top:1.5px solid #000;margin-top:auto;}
.footer-section table{width:100%;border-collapse:collapse;}
.footer-section td{vertical-align:top;padding:5pt 8pt;width:50%;border:0;}
.bank-details{font-size:8pt;line-height:1.5;}
.bank-details strong{font-size:8.5pt;}
.terms{font-size:8pt;line-height:1.5;}
.terms strong{font-size:8.5pt;}
.terms div{margin-top:2pt;}
/* ── Disclaimer ── */
.disclaimer{border-top:1.5px solid #000;padding:4pt 8pt;font-size:7.5pt;text-align:center;line-height:1.4;}
.disclaimer strong{font-size:8pt;}
/* ── Signature ── */
.signature-section{display:flex;border-top:1.5px solid #000;padding:6pt 8pt 4pt 8pt;font-size:8.5pt;}
.sign-left{width:50%;}
.sign-right{width:50%;text-align:right;}
.sign-right .for-company{font-weight:bold;font-size:9pt;}
.sign-right .authorised{font-size:8pt;margin-top:2pt;}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
</style>
</head>
<body>
${pagesHtml}
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

  let productionOrder = null;
  const [po] = await db
    .select()
    .from(productionOrdersTable)
    .where(eq(productionOrdersTable.proformaInvoiceId, invoice.id));
  if (po) {
    let assignedManager = null;
    if (po.assignedProductionManagerId) {
      const [m] = await db.select().from(usersTable).where(eq(usersTable.id, po.assignedProductionManagerId));
      if (m) {
        const { passwordHash: _, ...safe } = m;
        assignedManager = safe;
      }
    }
    let lastUpdatedBy = null;
    if (po.updatedBy) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.updatedBy));
      if (u) lastUpdatedBy = u;
    }
    const timeline = await db
      .select({
        id: productionTimelineTable.id,
        status: productionTimelineTable.status,
        notes: productionTimelineTable.notes,
        createdAt: productionTimelineTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionTimelineTable)
      .leftJoin(usersTable, eq(usersTable.id, productionTimelineTable.createdBy))
      .where(eq(productionTimelineTable.productionOrderId, po.id))
      .orderBy(desc(productionTimelineTable.createdAt));
    const notes = await db
      .select({
        id: productionNotesTable.id,
        note: productionNotesTable.note,
        createdAt: productionNotesTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, productionNotesTable.createdBy))
      .where(eq(productionNotesTable.productionOrderId, po.id))
      .orderBy(desc(productionNotesTable.createdAt));
    productionOrder = {
      id: po.id,
      status: po.status,
      priority: po.priority,
      expectedDispatchDate: po.expectedDispatchDate,
      assignedProductionManager: assignedManager,
      productionUnit: po.productionUnit,
      productionRemarks: po.productionRemarks,
      updatedAt: po.updatedAt,
      lastUpdatedBy,
      timeline,
      notes,
    };
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
    productionOrder,
  };
}

// ── Lightweight HTML extraction from public registry ──
async function extractLiveGstLightweight(gstin: string) {
  const cleanGstin = gstin.toUpperCase().trim();

  const response = await axios.get(`https://app.gstzen.in/p/gstin-validator/${cleanGstin}/`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    },
    timeout: 8000,
  });

  const html = response.data;

  const nameMatch = html.match(/(?:Legal Name|Trade Name).*?<td[^>]*>([\s\S]*?)<\/td>/i);
  const addressMatch = html.match(/(?:Principal Place of Business|Address).*?<td[^>]*>([\s\S]*?)<\/td>/i);

  if (nameMatch && nameMatch[1]) {
    const companyName = nameMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const address = addressMatch
      ? addressMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "";

    return { companyName, address };
  }

  throw new Error("Details could not be parsed from HTML");
}

// ── GST Lookup — returns ALL structured fields, auto-fill ready ──
router.post("/proforma-invoices/gst-lookup", async (req, res) => {
  const { gstin } = req.body;

  if (!gstin || gstin.trim().length !== 15) {
    return res.json({ success: false, error: "Valid 15-character GSTIN required." });
  }

  const cleanGstin = gstin.trim().toUpperCase();

  // ── Helper: normalize any source into frontend format ──
  const pradr = (src: any) => src?.pradr?.addr || src?.pradr || {};
  const normalize = (src: any): any => ({
    success: true,
    legalName: src.legalName || src.legal_name || src.lgnm || src.companyName || src.businessName || "",
    tradeName: src.tradeName || src.trade_name || src.tradeNam || "",
    address: src.address || [pradr(src).bno, pradr(src).bnm, pradr(src).flno, pradr(src).st, pradr(src).loc].filter(Boolean).join(", ") || "",
    addressLine1: src.addressLine1 || src.address_line1 || src.addr1 || pradr(src).bno || pradr(src).bnm || "",
    addressLine2: src.addressLine2 || src.address_line2 || src.street || src.locality || pradr(src).st || pradr(src).loc || "",
    addressLine3: src.addressLine3 || src.address_line3 || src.landmark || pradr(src).flno || "",
    city: src.city || src.cityName || src.city_name || pradr(src).city || "",
    district: src.district || src.districtName || src.district_name || pradr(src).dst || "",
    state: (src.state || src.stateName || src.parts?.stateName || pradr(src).stcd || "").replace(/^\d+\s*-\s*/, ""),
    stateCode: src.stateCode || src.state_code || src.parts?.stateCode || "",
    pincode: src.pincode || src.pinCode || src.pinc || pradr(src).pncd || "",
    gstin: src.gstin || cleanGstin,
    status: src.status || src.sts || src.company_status || "Active",
    businessConstitution: src.businessConstitution || src.constitution || src.ctb || src.business_constitution || src.gstType || src.gst_type || "",
    registrationStatus: src.registrationStatus || src.sts || src.registration_status || src.status || "Active",
  });

  // ── Tier 1: RapidAPI India GSTIN Validator ──
  const rapidApiKey = process.env.RAPIDAPI_GST_KEY;
  const rapidApiHost = process.env.RAPIDAPI_GST_HOST;
  if (rapidApiKey && rapidApiHost) {
    try {
      const raRes = await axios.get(`https://${rapidApiHost}/gst.php?gst_no=${encodeURIComponent(cleanGstin)}`, {
        headers: {
          "x-rapidapi-host": rapidApiHost,
          "x-rapidapi-key": rapidApiKey,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      });
      console.log("[RapidAPI GST] status=%d body=%j", raRes.status, raRes.data);
      const raBody = raRes.data;
      const source = raBody?.data || raBody?.result || raBody;
      // Only proceed if the API returned a legal name (business details present)
      if (source?.lgnm) {
        // Parse city and state from the comma-separated adr string
        // adr format: "..., City, State, Pincode"
        let cityFromAddr = "";
        let stateFromAddr = "";
        if (source.adr) {
          const addrParts = source.adr.split(",").map((s: string) => s.trim()).filter(Boolean);
          stateFromAddr = addrParts.length >= 2 ? addrParts[addrParts.length - 2] : "";
          cityFromAddr = addrParts.length >= 3 ? addrParts[addrParts.length - 3] : "";
        }
        const mapped = {
          success: true,
          legalName: source.lgnm || "",
          tradeName: source.tradeName || "",
          address: source.adr || "",
          addressLine1: "",
          addressLine2: "",
          addressLine3: "",
          city: cityFromAddr,
          district: "",
          state: stateFromAddr,
          stateCode: "",
          pincode: source.pincode || "",
          gstin: source.gstin || cleanGstin,
          status: "Active",
          businessConstitution: source.ctb || "",
          registrationStatus: source.sts || "Active",
        };
        return res.json(mapped);
      }
      console.log("[RapidAPI GST] response lacks business details (no lgnm), falling through", raBody);
    } catch (raErr: any) {
      const status = raErr?.response?.status;
      const body = raErr?.response?.data;
      console.error("[RapidAPI GST] ERROR status=%d body=%j message=%s", status, body, raErr.message);
      req.log.warn({ err: raErr.message, status, body, gstin: cleanGstin }, "RapidAPI GST lookup failed, trying next tier");
    }
  }

  // ── Tier 2: GSTVerify (free — 10 demo calls, then ₹0.10/call) ──
  const gstVerifyKey = process.env.GSTVERIFY_API_KEY;
  if (gstVerifyKey) {
    try {
      const gstBaseUrl = (process.env.GSTVERIFY_BASE_URL || "https://gstverify.co.in/api").replace(/\/+$/, "");
      const gvRes = await axios.get(`${gstBaseUrl}/v1/verify/${cleanGstin}`, {
        headers: { "X-API-Key": gstVerifyKey, Accept: "application/json" },
        timeout: 8000,
      });
      const gvBody = gvRes.data;
      if (gvBody?.success && gvBody?.data) {
        return res.json(normalize(gvBody.data));
      }
    } catch (gvErr: any) {
      req.log.warn({ err: gvErr.message, gstin: cleanGstin }, "GSTVerify failed, trying next tier");
    }
  }

  // ── Tier 3: GSTZen API ──
  if (process.env.GST_API_URL && process.env.GST_API_KEY) {
    try {
      const provider = getGstProvider();
      const details = await provider.lookup(cleanGstin);
      return res.json({ success: true, ...details });
    } catch (apiErr: any) {
      req.log.warn({ err: apiErr.message, gstin: cleanGstin }, "GSTZen API failed");
    }
  }

  // ── Tier 4: Lightweight HTML extraction ──
  try {
    const data = await extractLiveGstLightweight(cleanGstin);
    return res.json({ success: true, ...data });
  } catch {
    // silent
  }

  // ── Tier 5: Local database fallback ──
  try {
    const [customer] = await db
      .select()
      .from(customerMasterTable)
      .where(eq(customerMasterTable.gstin, cleanGstin))
      .limit(1);
    if (customer) {
      return res.json(normalize({
        legalName: customer.companyName || "",
        tradeName: customer.tradeName || "",
        address: [customer.addressLine1, customer.addressLine2, customer.addressLine3].filter(Boolean).join(", "),
        addressLine1: customer.addressLine1 || "",
        addressLine2: customer.addressLine2 || "",
        addressLine3: customer.addressLine3 || "",
        city: customer.city || "",
        district: customer.district || "",
        state: customer.state || "",
        pincode: customer.pincode || "",
        gstin: cleanGstin,
        status: customer.gstStatus || "Active",
        businessConstitution: customer.customerType || "",
        registrationStatus: customer.gstStatus || "Active",
      }));
    }
  } catch {
    // silent
  }

  return res.json({ success: false, error: "Could not extract live details for this GSTIN. Please enter details manually." });
});

router.post("/proforma-invoices/gst-clear-cache", (_req, res) => {
  res.json({ ok: true });
});

router.get("/proforma-invoices", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, dateFrom, dateTo, ownerId, customer, page, limit } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(proformaInvoicesTable.isDeleted, false)];

    if (user.role === "sales") {
      conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    }

    // Unit isolation: non-admin, non-"All" users see only PIs for contacts in their unit
    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      conditions.push(sql`${proformaInvoicesTable.contactId} IN (
        SELECT ${contactsTable.id} FROM ${contactsTable}
        WHERE ${contactsTable.unit} IN (${sql.join(accessibleUnits.map(u => sql`${u}`), sql`, `)})
      )`);
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
    res.json({ data: enriched, total: count as number, page: pageNum, totalPages: Math.ceil((count as number) / pageSize) });
  } catch (err) {
    req.log.error({ err }, "List proforma invoices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/all", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status, search, dateFrom, dateTo, ownerId, customer, contactId } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(proformaInvoicesTable.isDeleted, false)];

    if (user.role === "sales") {
      conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    }

    // Unit isolation for /all endpoint
    const accessibleUnitsAll = getAccessibleUnits(user);
    if (accessibleUnitsAll) {
      conditions.push(sql`${proformaInvoicesTable.contactId} IN (
        SELECT ${contactsTable.id} FROM ${contactsTable}
        WHERE ${contactsTable.unit} IN (${sql.join(accessibleUnitsAll.map(u => sql`${u}`), sql`, `)})
      )`);
    }

    if (status && status !== "all") conditions.push(eq(proformaInvoicesTable.status, status));
    if (ownerId) conditions.push(eq(proformaInvoicesTable.salesOwnerId, Number(ownerId)));
    if (contactId) {
      conditions.push(sql`(
        ${proformaInvoicesTable.contactId} = ${Number(contactId)} OR
        ${proformaInvoicesTable.customerMasterId} IN (
          SELECT ${customerMasterTable.id} FROM ${customerMasterTable}
          WHERE ${customerMasterTable.linkedContactId} = ${Number(contactId)}
        )
      )`);
    }
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
    if (!mobile?.trim()) {
      res.status(400).json({ error: "Mobile number is required" });
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

    // Version management: auto-increment version for this deal
    const resolvedDealId = dealId || null;
    let nextVersion = 1;
    if (resolvedDealId) {
      nextVersion = await getNextPiVersion(db, resolvedDealId);
      // Deactivate any existing active PI for this deal (only one active at a time)
      await deactivateActivePis(db, resolvedDealId);
    }

    const [invoice] = await db
      .insert(proformaInvoicesTable)
      .values({
        invoiceNumber: finalInvoiceNumber,
        customerName,
        companyName: companyName || null,
        tradeName: tradeName || null,
        contactId: resolvedContactId,
        dealId: resolvedDealId,
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
        version: nextVersion,
        isActive: true,
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

    // Auto-create activity: PI Created
    if (resolvedDealId) {
      const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const versionNote = nextVersion > 1 ? ` (Version ${nextVersion})` : "";
      await db.insert(activitiesTable).values({
        dealId: resolvedDealId,
        contactId: resolvedContactId,
        type: "Note",
        notes: `Proforma Invoice Created — ${finalInvoiceNumber}${versionNote}\n\nAmount: ₹${Number(grandTotal || 0).toLocaleString("en-IN")}\nBy: ${user.name}\n${ts}`,
        createdBy: user.id,
      });
    }

    // Auto-update deal stage to "PI Sent" ONLY when PI is created with status="Sent" ("Generate & Send")
    // When status="Draft" ("Save Draft"), deal stays in its current stage
    const PI_SENT_STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received"];
    let dealStageUpdated = false;
    if (resolvedDealId && (status || "Draft") === "Sent") {
      const [currentDeal] = await db.select().from(dealsTable).where(eq(dealsTable.id, resolvedDealId));
      if (currentDeal && PI_SENT_STAGES.includes(currentDeal.stage)) {
        await db.update(dealsTable).set({ stage: "PI Sent", probability: 80, updatedAt: new Date() }).where(eq(dealsTable.id, resolvedDealId));
        dealStageUpdated = true;
        // Log stage change activity
        await db.insert(activitiesTable).values({
          dealId: resolvedDealId,
          contactId: resolvedContactId,
          type: "Note",
          notes: `Deal moved to PI Sent (Proforma Invoice ${finalInvoiceNumber} generated & sent)`,
          createdBy: user.id,
        });
      }
    }

    // Notify sales owner and admins about new invoice
    if (resolvedSalesOwnerId && resolvedSalesOwnerId !== user.id) {
      await createNotification({
        userId: resolvedSalesOwnerId,
        type: "invoice_created",
        title: "New Invoice Created",
        message: `Invoice #${finalInvoiceNumber} created for ${customerName}\nAmount: ₹${Number(grandTotal || 0).toLocaleString()}\nCreated By: ${user.name}`,
        link: `/proforma-invoices`,
        relatedId: invoice!.id,
        relatedType: "proforma_invoice",
      });
    }

    const response = await enrichInvoice(invoice!);
    res.status(201).json({ ...response, dealStageUpdated });
  } catch (err) {
    req.log.error({ err }, "Create proforma invoice error");
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

    if (!canModifyInvoice(user, invoice.createdBy)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(await enrichInvoice(invoice));
  } catch (err) {
    req.log.error({ err }, "Get proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/proforma-invoices/:id/production-progress", async (req, res) => {
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

    if (!canModifyInvoice(user, invoice.createdBy)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [po] = await db
      .select()
      .from(productionOrdersTable)
      .where(eq(productionOrdersTable.proformaInvoiceId, id));

    if (!po) { res.json(null); return; }

    let assignedManager = null;
    if (po.assignedProductionManagerId) {
      const [m] = await db.select().from(usersTable).where(eq(usersTable.id, po.assignedProductionManagerId));
      if (m) {
        const { passwordHash: _, ...safe } = m;
        assignedManager = safe;
      }
    }

    const timeline = await db
      .select({
        id: productionTimelineTable.id,
        status: productionTimelineTable.status,
        notes: productionTimelineTable.notes,
        createdAt: productionTimelineTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionTimelineTable)
      .leftJoin(usersTable, eq(usersTable.id, productionTimelineTable.createdBy))
      .where(eq(productionTimelineTable.productionOrderId, po.id))
      .orderBy(desc(productionTimelineTable.createdAt));

    const notes = await db
      .select({
        id: productionNotesTable.id,
        note: productionNotesTable.note,
        createdAt: productionNotesTable.createdAt,
        createdByName: usersTable.name,
      })
      .from(productionNotesTable)
      .leftJoin(usersTable, eq(usersTable.id, productionNotesTable.createdBy))
      .where(eq(productionNotesTable.productionOrderId, po.id))
      .orderBy(desc(productionNotesTable.createdAt));

    let lastUpdatedBy = null;
    if (po.updatedBy) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, po.updatedBy));
      if (u) lastUpdatedBy = u;
    }

    res.json({
      id: po.id,
      status: po.status,
      priority: po.priority,
      expectedDispatchDate: po.expectedDispatchDate,
      assignedProductionManager: assignedManager,
      productionUnit: po.productionUnit,
      productionRemarks: po.productionRemarks,
      updatedAt: po.updatedAt,
      lastUpdatedBy,
      timeline,
      notes,
    });
  } catch (err) {
    req.log.error({ err }, "Get production progress error");
    res.status(500).json({ error: "Internal server error" });
  }
});

function buildItemDiff(oldItems: any[], newItems: any[]): string[] {
  const changes: string[] = [];
  const oldMap = new Map(oldItems.map((it: any) => [it.productName, it]));
  const newMap = new Map(newItems.map((it: any) => [it.productName, it]));

  for (const [name, newItem] of newMap) {
    const oldItem = oldMap.get(name);
    if (!oldItem) {
      changes.push(`+ Added: ${name} (qty: ${newItem.quantity}, rate: ${newItem.rate})`);
    } else {
      const fieldChanges: string[] = [];
      if (Number(oldItem.quantity) !== Number(newItem.quantity)) fieldChanges.push(`qty: ${oldItem.quantity} → ${newItem.quantity}`);
      if (Number(oldItem.rate) !== Number(newItem.rate)) fieldChanges.push(`rate: ${oldItem.rate} → ${newItem.rate}`);
      if (Number(oldItem.discount || 0) !== Number(newItem.discount || 0)) fieldChanges.push(`discount: ${oldItem.discount || 0} → ${newItem.discount || 0}`);
      if (Number(oldItem.gstPercent || 0) !== Number(newItem.gstPercent || 0)) fieldChanges.push(`GST: ${oldItem.gstPercent || 0}% → ${newItem.gstPercent || 0}%`);
      if (fieldChanges.length > 0) changes.push(`~ ${name}: ${fieldChanges.join(", ")}`);
    }
  }

  for (const [name] of oldMap) {
    if (!newMap.has(name)) changes.push(`- Removed: ${name}`);
  }
  return changes;
}

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

    if (!canModifyInvoice(user, existing.createdBy)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { customerName, companyName, tradeName, contactId, dealId, address, addressLine1, addressLine2, addressLine3, city, district, state, pincode, gstNumber, gstStatus, mobile, taxableAmount, freight, cgst, sgst, igst, cgstPercent, sgstPercent, igstPercent, grandTotal, amountInWords, notes, items, customerType, idProofType, idProofNumber, invoiceNumber, terms, companyGstin, companyAddress, companyEmail, bankDetails, disclaimer, customerMasterId, revisionReason } = req.body;

    if (mobile !== undefined && !mobile.trim()) {
      res.status(400).json({ error: "Mobile number is required" });
      return;
    }

    const isDraft = existing.status === "Draft";

    if (!isDraft) {
      const oldItems = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.invoiceId, id));

      const nextVersion = (existing.version || 1) + 1;
      const newInvoiceNumber = await getNextInvoiceNumber();

      if (existing.dealId) {
        await deactivateActivePis(db, existing.dealId);
      }

      const merged = {
        invoiceNumber: newInvoiceNumber,
        customerName: customerName ?? existing.customerName,
        companyName: companyName !== undefined ? companyName : existing.companyName,
        tradeName: tradeName !== undefined ? tradeName : existing.tradeName,
        contactId: contactId !== undefined ? contactId : existing.contactId,
        dealId: dealId !== undefined ? dealId : existing.dealId,
        salesOwnerId: existing.salesOwnerId,
        customerMasterId: customerMasterId !== undefined ? customerMasterId : existing.customerMasterId,
        address: address !== undefined ? address : existing.address,
        addressLine1: addressLine1 !== undefined ? addressLine1 : existing.addressLine1,
        addressLine2: addressLine2 !== undefined ? addressLine2 : existing.addressLine2,
        addressLine3: addressLine3 !== undefined ? addressLine3 : existing.addressLine3,
        city: city !== undefined ? city : existing.city,
        district: district !== undefined ? district : existing.district,
        state: state !== undefined ? state : existing.state,
        pincode: pincode !== undefined ? pincode : existing.pincode,
        customerType: customerType !== undefined ? customerType : existing.customerType,
        gstNumber: gstNumber !== undefined ? gstNumber : existing.gstNumber,
        gstStatus: gstStatus !== undefined ? gstStatus : existing.gstStatus,
        idProofType: idProofType !== undefined ? idProofType : existing.idProofType,
        idProofNumber: idProofNumber !== undefined ? idProofNumber : existing.idProofNumber,
        mobile: mobile !== undefined ? mobile : existing.mobile,
        taxableAmount: String(taxableAmount ?? existing.taxableAmount ?? 0),
        freight: String(freight ?? existing.freight ?? 0),
        cgst: String(cgst ?? existing.cgst ?? 0),
        sgst: String(sgst ?? existing.sgst ?? 0),
        igst: String(igst ?? existing.igst ?? 0),
        cgstPercent: String(cgstPercent ?? existing.cgstPercent ?? 0),
        sgstPercent: String(sgstPercent ?? existing.sgstPercent ?? 0),
        igstPercent: String(igstPercent ?? existing.igstPercent ?? 0),
        grandTotal: String(grandTotal ?? existing.grandTotal ?? 0),
        amountInWords: amountInWords || existing.amountInWords || "",
        notes: notes !== undefined ? notes : existing.notes,
        status: "Draft" as const,
        version: nextVersion,
        isActive: true,
        revisionReason: revisionReason || null,
        createdBy: user.id,
      };

      const [newInvoice] = await db.insert(proformaInvoicesTable).values(merged).returning();

      const newItems = items || oldItems.map((it: any) => ({
        productName: it.productName, hsnCode: it.hsnCode, bottleType: it.bottleType,
        capacity: it.capacity, weight: it.weight, quantity: Number(it.quantity),
        unit: it.unit, rate: Number(it.rate), discountPercent: Number(it.discountPercent || 0),
        discount: Number(it.discount || 0), gstPercent: Number(it.gstPercent || 0), amount: Number(it.amount),
      }));

      await db.delete(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.invoiceId, newInvoice!.id));
      for (const item of newItems) {
        await db.insert(proformaInvoiceItemsTable).values({
          invoiceId: newInvoice!.id,
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

      const diffLines = buildItemDiff(oldItems, newItems);
      if (taxableAmount !== undefined && Number(taxableAmount) !== Number(existing.taxableAmount || 0)) {
        diffLines.unshift(`~ Subtotal: ${existing.taxableAmount} → ${taxableAmount}`);
      }
      if (grandTotal !== undefined && Number(grandTotal) !== Number(existing.grandTotal || 0)) {
        diffLines.unshift(`~ Grand Total: ${existing.grandTotal} → ${grandTotal}`);
      }
      if (customerName !== undefined && customerName !== existing.customerName) {
        diffLines.unshift(`~ Customer: ${existing.customerName} → ${customerName}`);
      }
      if (gstNumber !== undefined && gstNumber !== existing.gstNumber) {
        diffLines.unshift(`~ GSTIN: ${existing.gstNumber || "N/A"} → ${gstNumber || "N/A"}`);
      }

      const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const reasonNote = revisionReason ? `\nReason: ${revisionReason}` : "";
      const diffNote = diffLines.length > 0 ? `\n\nChanges:\n${diffLines.join("\n")}` : "";

      if (existing.dealId) {
        await db.insert(activitiesTable).values({
          dealId: existing.dealId,
          contactId: existing.contactId,
          type: "Note",
          notes: `Proforma Invoice Revised — ${newInvoiceNumber} (Version ${nextVersion})\n\nModified from: ${existing.invoiceNumber} (Version ${existing.version || 1}, status: ${existing.status})${reasonNote}${diffNote}\nBy: ${user.name}\n${ts}`,
          createdBy: user.id,
        });
      }

      await db.insert(proformaInvoiceHistoryTable).values({
        invoiceId: existing.id,
        statusFrom: existing.status,
        statusTo: existing.status,
        changedBy: user.id,
        notes: `Version ${nextVersion} created as ${newInvoiceNumber}${reasonNote}`,
      });

      // ── Production Sync for non-draft PI revision ──
      // Find production order linked to this deal and notify production
      try {
        let linkedOrder: any = null;
        if (existing.dealId) {
          // Find production order by dealId
          const [byDeal] = await db
            .select()
            .from(productionOrdersTable)
            .where(eq(productionOrdersTable.dealId, existing.dealId))
            .orderBy(desc(productionOrdersTable.createdAt))
            .limit(1);
          if (byDeal) {
            linkedOrder = byDeal;
            // Update production order to point to the new active PI
            await db
              .update(productionOrdersTable)
              .set({ proformaInvoiceId: newInvoice!.id, updatedAt: new Date(), updatedBy: user.id })
              .where(eq(productionOrdersTable.id, byDeal.id));
          }
        }

        if (linkedOrder) {
          const { handlePiModification } = await import("../lib/production-service");
          await handlePiModification(user, linkedOrder.id, nextVersion);
        }

        // Notify production users about PI revision
        if (existing.dealId) {
          await notifyProductionUsers({
            productionUnit: linkedOrder?.productionUnit || "Himatnagar",
            title: "Proforma Invoice Revised",
            message: `Invoice ${existing.invoiceNumber} revised to ${newInvoiceNumber} (Version ${nextVersion}) by ${user.name}.${reasonNote}`,
            link: `/production/orders/${linkedOrder?.id || ""}`,
            relatedId: newInvoice!.id,
            relatedType: "proforma_invoice",
            type: "pi_revision",
            excludeUserId: user.id,
          });
        }
      } catch (syncErr) {
        req.log.warn({ err: syncErr }, "Production sync failed for PI revision");
      }

      return res.status(201).json(await enrichInvoice(newInvoice!));
    }

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

    // Handle status transition: Draft → Sent ("Update & Send" in edit mode)
    const requestedStatus = req.body.status;
    if (requestedStatus && requestedStatus === "Sent" && existing.status === "Draft") {
      updateData.status = "Sent";
    }

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

    if (existing.dealId && Object.keys(updateData).length > 0) {
      const changedFields: string[] = [];
      if (updateData.customerName) changedFields.push("Customer Name");
      if (updateData.companyName) changedFields.push("Company Name");
      if (updateData.grandTotal) changedFields.push("Amount");
      if (updateData.gstNumber) changedFields.push("GSTIN");
      if (items) changedFields.push("Line Items");
      if (updateData.notes) changedFields.push("Notes");
      if (changedFields.length > 0) {
        const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        await db.insert(activitiesTable).values({
          dealId: existing.dealId,
          contactId: existing.contactId,
          type: "Note",
          notes: `Proforma Invoice Updated — ${existing.invoiceNumber}\n\nChanged: ${changedFields.join(", ")}\nBy: ${user.name}\n${ts}`,
          createdBy: user.id,
        });
      }
    }

    if (contactId && !existing.contactId) {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
      if (contact && !updateData.salesOwnerId) {
        await db.update(proformaInvoicesTable).set({ salesOwnerId: contact.salesOwnerId }).where(eq(proformaInvoicesTable.id, id));
      }
    }

    // When status transitions Draft → Sent ("Update & Send"), auto-update deal stage to PI Sent
    if (existing.dealId && updateData.status === "Sent" && existing.status === "Draft") {
      const PI_SENT_STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received"];
      const [currentDeal] = await db.select().from(dealsTable).where(eq(dealsTable.id, existing.dealId));
      if (currentDeal && PI_SENT_STAGES.includes(currentDeal.stage)) {
        await db.update(dealsTable).set({ stage: "PI Sent", probability: 80, updatedAt: new Date() }).where(eq(dealsTable.id, existing.dealId));
        await db.insert(activitiesTable).values({
          dealId: existing.dealId,
          contactId: existing.contactId,
          type: "Note",
          notes: `Deal moved to PI Sent (Proforma Invoice ${existing.invoiceNumber} generated & sent)`,
          createdBy: user.id,
        });
      }
    }

    try {
      const currentInvoice = invoice!;
      const piId = currentInvoice.id;
      const piDealId = currentInvoice.dealId;

      let linkedOrder: any = null;

      const [byPi] = await db
        .select()
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.proformaInvoiceId, piId))
        .limit(1);
      if (byPi) {
        linkedOrder = byPi;
      }

      if (!linkedOrder && piDealId) {
        const [byDeal] = await db
          .select()
          .from(productionOrdersTable)
          .where(eq(productionOrdersTable.dealId, piDealId))
          .orderBy(desc(productionOrdersTable.createdAt))
          .limit(1);
        if (byDeal) {
          linkedOrder = byDeal;
          await db
            .update(productionOrdersTable)
            .set({ proformaInvoiceId: piId })
            .where(eq(productionOrdersTable.id, byDeal.id));
        }
      }

      if (linkedOrder) {
        const { handlePiModification } = await import("../lib/production-service");
        const nextVersion = (existing.version || 1) + 1;
        await handlePiModification(user, linkedOrder.id, nextVersion);
      }
    } catch (syncErr) {
      req.log.warn({ err: syncErr }, "Production auto-sync failed for PI update");
    }

    res.json(await enrichInvoice(invoice!));
  } catch (err) {
    req.log.error({ err }, "Update proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
}

router.patch("/proforma-invoices/:id", updateInvoiceHandler);
router.put("/proforma-invoices/:id", updateInvoiceHandler);

// ── Last PI by phone (auto-fill party details from history) ──
router.get("/proforma-invoices/last-by-phone/:phone", async (req, res) => {
  try {
    const phone = (req.params.phone || "").replace(/\s/g, "").trim();
    if (phone.length < 10) {
      res.json({ found: false });
      return;
    }

    // Match against the mobile column (primary number)
    const [match] = await db
      .select({
        customerName: proformaInvoicesTable.customerName,
        companyName: proformaInvoicesTable.companyName,
        tradeName: proformaInvoicesTable.tradeName,
        address: proformaInvoicesTable.address,
        addressLine1: proformaInvoicesTable.addressLine1,
        addressLine2: proformaInvoicesTable.addressLine2,
        addressLine3: proformaInvoicesTable.addressLine3,
        city: proformaInvoicesTable.city,
        district: proformaInvoicesTable.district,
        state: proformaInvoicesTable.state,
        pincode: proformaInvoicesTable.pincode,
        gstNumber: proformaInvoicesTable.gstNumber,
        gstStatus: proformaInvoicesTable.gstStatus,
        customerType: proformaInvoicesTable.customerType,
        mobile: proformaInvoicesTable.mobile,
      })
      .from(proformaInvoicesTable)
      .where(and(
        eq(proformaInvoicesTable.mobile, phone),
        eq(proformaInvoicesTable.isDeleted, false),
      ))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(1);

    if (!match) {
      res.json({ found: false });
      return;
    }

    res.json({ found: true, ...match });
  } catch (err) {
    console.error("Last-by-phone lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /proforma-invoices/previous-by-contact/:contactId — previous PIs for "Repeat Previous Order"
router.get("/proforma-invoices/previous-by-contact/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contact ID" }); return; }

    const previousInvoices = await db
      .select({
        id: proformaInvoicesTable.id,
        invoiceNumber: proformaInvoicesTable.invoiceNumber,
        customerName: proformaInvoicesTable.customerName,
        companyName: proformaInvoicesTable.companyName,
        tradeName: proformaInvoicesTable.tradeName,
        gstNumber: proformaInvoicesTable.gstNumber,
        gstStatus: proformaInvoicesTable.gstStatus,
        customerType: proformaInvoicesTable.customerType,
        address: proformaInvoicesTable.address,
        addressLine1: proformaInvoicesTable.addressLine1,
        addressLine2: proformaInvoicesTable.addressLine2,
        addressLine3: proformaInvoicesTable.addressLine3,
        city: proformaInvoicesTable.city,
        district: proformaInvoicesTable.district,
        state: proformaInvoicesTable.state,
        pincode: proformaInvoicesTable.pincode,
        mobile: proformaInvoicesTable.mobile,
        freight: proformaInvoicesTable.freight,
        taxableAmount: proformaInvoicesTable.taxableAmount,
        grandTotal: proformaInvoicesTable.grandTotal,
        notes: proformaInvoicesTable.notes,
        status: proformaInvoicesTable.status,
        createdAt: proformaInvoicesTable.createdAt,
        customerMasterId: proformaInvoicesTable.customerMasterId,
      })
      .from(proformaInvoicesTable)
      .where(and(
        eq(proformaInvoicesTable.contactId, contactId),
        eq(proformaInvoicesTable.isDeleted, false),
      ))
      .orderBy(desc(proformaInvoicesTable.createdAt))
      .limit(10);

    // Enrich each invoice with its items
    const enriched = await Promise.all(previousInvoices.map(async (inv) => {
      const items = await db
        .select()
        .from(proformaInvoiceItemsTable)
        .where(eq(proformaInvoiceItemsTable.invoiceId, inv.id));
      return {
        ...inv,
        taxableAmount: Number(inv.taxableAmount),
        freight: Number(inv.freight),
        grandTotal: Number(inv.grandTotal),
        items: items.map(i => ({
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
        })),
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Previous by contact lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/proforma-invoices/:id/status", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { status, notes, productionUnit, productionRemarks } = req.body;
    if (!INVOICE_STATUSES.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    // Production Unit is no longer required at PI conversion time.
    // It will be required when marking the Deal as Won (via mark-won endpoint).
    // if ((status === "Converted to Order" || status === "Converted to Production") && !productionUnit) {
    //   res.status(400).json({ error: "Production Unit is required when converting to production" });
    //   return;
    // }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.isDeleted, false)));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

    if (!canModifyInvoice(user, invoice.createdBy)) {
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

    // Auto-create activity for key PI status transitions
    if (invoice.dealId && status !== prevStatus) {
      const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      let activityNote: string | null = null;
      if (status === "Sent") activityNote = `Proforma Invoice Sent — ${invoice.invoiceNumber}\n\nBy: ${user.name}\n${ts}`;
      else if (status === "Approved") activityNote = `Proforma Invoice Approved — ${invoice.invoiceNumber}\n\nBy: ${user.name}\n${ts}`;
      else if (status === "Rejected") activityNote = `Proforma Invoice Rejected — ${invoice.invoiceNumber}\n\nBy: ${user.name}\n${ts}`;
      if (activityNote) {
        await db.insert(activitiesTable).values({
          dealId: invoice.dealId,
          contactId: invoice.contactId,
          type: "Note",
          notes: activityNote,
          createdBy: user.id,
        });
      }
    }

    // When PI status transitions TO "Sent", auto-update deal stage to PI Sent (if not already there)
    if (invoice.dealId && status === "Sent" && prevStatus === "Draft") {
      const PI_SENT_STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received"];
      const [currentDeal] = await db.select().from(dealsTable).where(eq(dealsTable.id, invoice.dealId));
      if (currentDeal && PI_SENT_STAGES.includes(currentDeal.stage)) {
        await db.update(dealsTable).set({ stage: "PI Sent", probability: 80, updatedAt: new Date() }).where(eq(dealsTable.id, invoice.dealId));
        await db.insert(activitiesTable).values({
          dealId: invoice.dealId,
          contactId: invoice.contactId,
          type: "Note",
          notes: `Deal moved to PI Sent (Proforma Invoice ${invoice.invoiceNumber} sent to customer)`,
          createdBy: user.id,
        });
      }
    }

    // Auto-create Production Order when status changes to "Converted to Order" or "Converted to Production"
    const isConversion = (status === "Converted to Order" || status === "Converted to Production")
      && prevStatus !== "Converted to Order" && prevStatus !== "Converted to Production";
    if (isConversion) {
      const [existing] = await db
        .select()
        .from(productionOrdersTable)
        .where(eq(productionOrdersTable.proformaInvoiceId, id))
        .limit(1);

      if (!existing) {
        const creatorRoleLabel = user.role === "production_and_support" ? "Production & Support" : "Sales";

        // Inherit productionUnit from deal (single source of truth) if not explicitly provided
        let effectiveProductionUnit = productionUnit || null;
        if (!effectiveProductionUnit && invoice.dealId) {
          const [dealRow] = await db.select().from(dealsTable).where(eq(dealsTable.id, invoice.dealId)).limit(1);
          if (dealRow?.productionUnit) {
            effectiveProductionUnit = dealRow.productionUnit;
          }
        }

        await db.insert(productionOrdersTable).values({
          proformaInvoiceId: id,
          dealId: invoice.dealId || null,
          status: "Pending",
          priority: "Medium",
          productionUnit: effectiveProductionUnit,
          requestedUnit: effectiveProductionUnit,
          productionRemarks: productionRemarks || null,
          updatedBy: user.id,
          createdById: user.id,
          createdByName: user.name,
          createdByRole: user.role,
        });

        // Record initial timeline entry
        const [newOrder] = await db
          .select()
          .from(productionOrdersTable)
          .where(eq(productionOrdersTable.proformaInvoiceId, id))
          .limit(1);

          if (newOrder) {
          await db.insert(productionTimelineTable).values({
            productionOrderId: newOrder.id,
            status: "Pending",
            notes: `Order received from ${user.name} (${creatorRoleLabel})`,
            createdBy: user.id,
          });

          // Fetch product items for notification
          const items = await db
            .select()
            .from(proformaInvoiceItemsTable)
            .where(eq(proformaInvoiceItemsTable.invoiceId, id));

          const remarksLine = productionRemarks ? `\nRemarks: ${productionRemarks}` : "";

          // Notify production users based on unit permissions (single shared helper)
          // Only send notification if a real production unit is assigned (not PENDING_UNIT_ASSIGNMENT)
          const notifyUnit = effectiveProductionUnit && effectiveProductionUnit !== PENDING_UNIT_ASSIGNMENT ? effectiveProductionUnit : null;
          if (notifyUnit) {
            await notifyProductionUsers({
              productionUnit: notifyUnit,
              title: "New Production Order",
              message: [
                `Created By: ${user.name} (${creatorRoleLabel})`,
                `Production Unit: ${effectiveProductionUnit}`,
                ``,
                `Customer: ${invoice.customerName}`,
                `Company: ${invoice.companyName || "N/A"}`,
                `Product: ${items[0]?.productName || "Multiple Items"}`,
                `Quantity: ${items.reduce((sum, i) => sum + Number(i.quantity || 0), 0).toLocaleString("en-IN")} ${items[0]?.unit || "pcs"}`,
                `Order No: ${invoice.invoiceNumber}`,
                remarksLine,
              ].filter(Boolean).join("\n"),
              link: `/production/orders/${newOrder.id}`,
              relatedId: newOrder.id,
              relatedType: "production_order",
              type: "production_order_created",
              excludeUserId: user.id,
            });
          }
        }
      }
    }

    // Notify sales owner about status change
    const notifyUserId = invoice.salesOwnerId || invoice.createdBy;
    if (notifyUserId && notifyUserId !== user.id) {
      const isConverted = status === "Converted to Order" || status === "Converted to Production";
      const msg = isConverted
        ? `Invoice #${invoice.invoiceNumber} has been converted to Production.\nChanged By: ${user.name}`
        : `Invoice #${invoice.invoiceNumber} status changed from "${prevStatus}" to "${status}".\nChanged By: ${user.name}`;
      await createNotification({
        userId: notifyUserId,
        type: "invoice_updated",
        title: isConverted ? "Invoice Converted to Production" : "Invoice Status Updated",
        message: msg,
        link: `/proforma-invoices`,
        relatedId: id,
        relatedType: "proforma_invoice",
      });
    }

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

    if (!canModifyInvoice(user, source.createdBy)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const sourceItems = await db
      .select()
      .from(proformaInvoiceItemsTable)
      .where(eq(proformaInvoiceItemsTable.invoiceId, id));

    // Version management: increment version from source
    const nextVersion = (source.version || 1) + 1;
    const revisionReason = (req.body as Record<string, any>)?.revisionReason || null;

    // Deactivate any existing active PI for this deal
    if (source.dealId) {
      await deactivateActivePis(db, source.dealId);
    }

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
        version: nextVersion,
        isActive: true,
        revisionReason,
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

    // Auto-create activity: PI Revised (new version)
    if (source.dealId) {
      const ts = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const reasonNote = revisionReason ? `\nReason: ${revisionReason}` : "";
      await db.insert(activitiesTable).values({
        dealId: source.dealId,
        contactId: source.contactId,
        type: "Note",
        notes: `Proforma Invoice Revised — ${newInvoiceNumber} (Version ${nextVersion})\n\nCopied from: ${source.invoiceNumber} (Version ${source.version || 1})${reasonNote}\nBy: ${user.name}\n${ts}`,
        createdBy: user.id,
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

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, id));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

    // Soft-delete: mark as deleted with timestamp and user
    await db
      .update(proformaInvoicesTable)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id, isActive: false })
      .where(eq(proformaInvoicesTable.id, id));

    // Add activity log entry
    const userName = user.name || `User #${user.id}`;
    const nowStr = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    await db.insert(proformaInvoiceHistoryTable).values({
      invoiceId: id,
      statusFrom: invoice.status,
      statusTo: "Deleted",
      changedBy: user.id,
      notes: `Proforma Invoice ${invoice.invoiceNumber} deleted by ${userName} on ${nowStr}`,
    });

    // Notify sales owner about deletion
    const notifyUserId = invoice.salesOwnerId || invoice.createdBy;
    if (notifyUserId && notifyUserId !== user.id) {
      await createNotification({
        userId: notifyUserId,
        type: "invoice_deleted",
        title: "Invoice Deleted",
        message: `Invoice #${invoice.invoiceNumber} for ${invoice.customerName} has been deleted.\nDeleted By: ${userName}`,
        link: `/proforma-invoices`,
        relatedId: id,
        relatedType: "proforma_invoice",
      });
    }

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
      await page.setContent(html, { waitUntil: "networkidle0" as "load", timeout: 30000 });
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

// ── Version history: all versions for a deal ──
router.get("/proforma-invoices/:id/versions", async (req, res) => {
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

    if (!canModifyInvoice(user, invoice.createdBy)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    if (!invoice.dealId) {
      res.json([]); return;
    }

    const versions = await db
      .select({
        id: proformaInvoicesTable.id,
        invoiceNumber: proformaInvoicesTable.invoiceNumber,
        version: proformaInvoicesTable.version,
        isActive: proformaInvoicesTable.isActive,
        status: proformaInvoicesTable.status,
        taxableAmount: proformaInvoicesTable.taxableAmount,
        grandTotal: proformaInvoicesTable.grandTotal,
        revisionReason: proformaInvoicesTable.revisionReason,
        createdAt: proformaInvoicesTable.createdAt,
        createdBy: proformaInvoicesTable.createdBy,
        isDeleted: proformaInvoicesTable.isDeleted,
      })
      .from(proformaInvoicesTable)
      .where(and(
        eq(proformaInvoicesTable.dealId, invoice.dealId),
        eq(proformaInvoicesTable.isDeleted, false),
      ))
      .orderBy(desc(proformaInvoicesTable.version));

    const creatorIds = [...new Set(versions.map(v => v.createdBy).filter(Boolean))];
    let creatorMap = new Map<number, string>();
    if (creatorIds.length > 0) {
      const creators = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(sql`${usersTable.id} IN ${creatorIds}`);
      creatorMap = new Map(creators.map(c => [c.id, c.name]));
    }

    const result = versions.map(v => ({
      ...v,
      taxableAmount: Number(v.taxableAmount),
      grandTotal: Number(v.grandTotal),
      createdByName: creatorMap.get(v.createdBy) || null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Get version history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Diff: compare two versions of a PI ──
router.get("/proforma-invoices/:id/diff", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const compareVersion = Number(req.query.compareVersion);
    if (isNaN(compareVersion) || compareVersion < 1) {
      res.status(400).json({ error: "compareVersion query parameter required" }); return;
    }

    const [current] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.isDeleted, false)));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }

    if (!canModifyInvoice(user, current.createdBy)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    if (!current.dealId) {
      res.status(400).json({ error: "Invoice has no linked deal" }); return;
    }

    const [older] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(
        eq(proformaInvoicesTable.dealId, current.dealId),
        eq(proformaInvoicesTable.version, compareVersion),
        eq(proformaInvoicesTable.isDeleted, false),
      ))
      .limit(1);
    if (!older) { res.status(404).json({ error: `Version ${compareVersion} not found` }); return; }

    const [currentItems, olderItems] = await Promise.all([
      db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.invoiceId, current.id)),
      db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.invoiceId, older.id)),
    ]);

    const fieldChanges: { field: string; oldValue: any; newValue: any }[] = [];
    const compareFields: [string, any, any][] = [
      ["customerName", older.customerName, current.customerName],
      ["companyName", older.companyName, current.companyName],
      ["mobile", older.mobile, current.mobile],
      ["gstNumber", older.gstNumber, current.gstNumber],
      ["taxableAmount", older.taxableAmount, current.taxableAmount],
      ["freight", older.freight, current.freight],
      ["cgst", older.cgst, current.cgst],
      ["sgst", older.sgst, current.sgst],
      ["igst", older.igst, current.igst],
      ["grandTotal", older.grandTotal, current.grandTotal],
      ["notes", older.notes, current.notes],
    ];

    for (const [field, oldVal, newVal] of compareFields) {
      const ov = String(oldVal ?? "");
      const nv = String(newVal ?? "");
      if (ov !== nv) fieldChanges.push({ field, oldValue: oldVal, newValue: newVal });
    }

    const itemChanges = buildItemDiff(olderItems, currentItems);

    res.json({
      currentVersion: current.version,
      compareVersion,
      currentInvoiceNumber: current.invoiceNumber,
      compareInvoiceNumber: older.invoiceNumber,
      fieldChanges,
      itemChanges,
      summary: [
        ...fieldChanges.map(c => `~ ${c.field}: ${c.oldValue ?? "N/A"} → ${c.newValue ?? "N/A"}`),
        ...itemChanges,
      ],
    });
  } catch (err) {
    req.log.error({ err }, "Get diff error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
