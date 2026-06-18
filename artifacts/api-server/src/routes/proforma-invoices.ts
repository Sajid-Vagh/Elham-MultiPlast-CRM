import { Router, type IRouter } from "express";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, proformaInvoiceHistoryTable, usersTable, INVOICE_STATUSES } from "@workspace/db";
import { eq, desc, and, SQL, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { amountToWords } from "../lib/amount-to-words";
import * as XLSX from "xlsx";

const router: IRouter = Router();

function generateInvoiceNumber(): string {
  return "PI-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
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
      <td style="text-align:center">${i + 1}</td>
      <td>${item.productName}</td>
      <td style="text-align:center">${item.hsnCode || "-"}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:center">${item.unit}</td>
      <td style="text-align:right">${Number(item.rate).toFixed(2)}</td>
      <td style="text-align:right">${Number(item.amount).toFixed(2)}</td>
    </tr>`
    )
    .join("\n");

  const dateStr = new Date(invoice.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const gstLabel = isInterstate
    ? `<tr><td colspan="5" style="text-align:right;padding:3px 6px;font-weight:bold">IGST @ ${igstPct}%</td><td style="text-align:right;padding:3px 6px;font-weight:bold">${igstAmount.toFixed(2)}</td></tr>`
    : `<tr><td colspan="5" style="text-align:right;padding:3px 6px">CGST @ ${cgstPct}%</td><td style="text-align:right;padding:3px 6px">${cgstAmount.toFixed(2)}</td></tr>
    <tr><td colspan="5" style="text-align:right;padding:3px 6px">SGST @ ${sgstPct}%</td><td style="text-align:right;padding:3px 6px">${sgstAmount.toFixed(2)}</td></tr>`;

  const totalTax = cgstAmount + sgstAmount + igstAmount;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Proforma Invoice</title>
<style>
@page{size:A4;margin:0;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:9pt;color:#000;line-height:1.3;}
.invoice{width:190mm;min-height:267mm;margin:8mm auto;border:1.5px solid #000;padding:0;position:relative;}
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
hr{ border: none; border-top: 1px solid #000; margin: 2pt 0; }
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.invoice{page-break-after:avoid;}}
</style>
</head>
<body>
<div class="invoice">

<div class="header">
<div class="gstin-top">GSTIN : 24AAJFE2064P1Z6</div>
<div class="company-name">ELHAM MULTIPLAST LLP</div>
<div class="company-address">
PLOT NO. 1429-1430, NR. FORTUNE PETROL PUMP,<br>
OPP. KHIJADIYA TALAV, ILOL, HIMATNAGAR,<br>
SABARKANTHA, GUJARAT - 383220
</div>
<div class="company-email">elhammultiplast@gmail.com</div>
<div class="invoice-title">PROFORMA INVOICE</div>
</div>

<div class="party-section">
<div class="party-left">
<div class="party-label">Party Details :</div>
<div class="party-name">${invoice.customerName}</div>
<div class="party-address">
${partyAddressLines.length > 0 ? partyAddressLines.join("<br>") + "<br>" : ""}
${cityStatePincode ? cityStatePincode + "<br>" : ""}
${invoice.address ? invoice.address + "<br>" : ""}
</div>
<div style="font-size:8.5pt;margin-top:2pt;">GSTIN / UIN : ${invoice.gstNumber || ""}</div>
</div>
<div class="party-right">
<div style="font-weight:bold;font-size:9pt;">Order No : ${invoice.invoiceNumber}</div>
<div style="margin-top:4pt;font-size:8.5pt;">Date : ${dateStr}</div>
</div>
</div>

<div class="order-text">We are pleased to receive the order for the following items</div>

<table class="items">
<thead>
<tr>
<th style="width:5%">S.N.</th>
<th style="width:32%">Description of Goods</th>
<th style="width:11%">HSN Code</th>
<th style="width:8%">Qty</th>
<th style="width:8%">Unit</th>
<th style="width:10%">Price</th>
<th style="width:12%">Amount</th>
</tr>
</thead>
<tbody>
${productRows}
</tbody>
</table>

<table class="summary-table">
${freight > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">Freight Charges</td><td style="text-align:right;padding:3pt 6pt">${freight.toFixed(2)}</td></tr>` : ""}
${cgstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">CGST @ ${cgstPct}%</td><td style="text-align:right;padding:3pt 6pt">${cgstAmount.toFixed(2)}</td></tr>` : ""}
${sgstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">SGST @ ${sgstPct}%</td><td style="text-align:right;padding:3pt 6pt">${sgstAmount.toFixed(2)}</td></tr>` : ""}
${igstPct > 0 ? `<tr><td colspan="5" style="text-align:right;padding:3pt 6pt">IGST @ ${igstPct}%</td><td style="text-align:right;padding:3pt 6pt">${igstAmount.toFixed(2)}</td></tr>` : ""}
<tr class="total-row"><td colspan="5" style="text-align:right;padding:3pt 6pt">Grand Total</td><td style="text-align:right;padding:3pt 6pt">${grandTotal.toFixed(2)}</td></tr>
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
<td style="width:50%;border:0;padding:3pt 6pt;">
<div class="bank-details">
<strong>Bank Details</strong><br>
ICICI BANK, HIMATNAGAR<br>
A/C NO: 045205014806<br>
IFSC: ICIC0000452
</div>
</td>
<td style="width:50%;border:0;padding:3pt 6pt;">
<div class="terms">
<strong>Terms &amp; Conditions</strong>
<ul>
<li>Freight Charges Additional</li>
<li>100% Advance Payment</li>
</ul>
</div>
</td>
</tr>
</table>
</div>

<div class="disclaimer">
<strong>DISCLAIMER : </strong>Products supplied are generic industrial packaging developed independently by Elham Multiplast LLP for functional applications. Any branding, labeling, or market usage by the buyer shall be at the buyer's sole responsibility.
</div>

<div class="signature-section">
<div class="sign-left">
<div style="font-size:8pt;">Receiver's Signature</div>
<br><br>
<div style="border-top:1px solid #000;width:120px;font-size:7pt;text-align:center;padding-top:1pt;">Receiver Signature</div>
</div>
<div class="sign-right">
<div style="margin-bottom:40pt;">For ELHAM MULTIPLAST LLP</div>
<br>
<div>Authorised Signatory</div>
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
      amount: Number(i.amount),
    })),
    createdByUser,
  };
}

router.get("/proforma-invoices", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { status } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [];

    if (user.role === "sales") {
      conditions.push(eq(proformaInvoicesTable.createdBy, user.id));
    }

    if (status) conditions.push(eq(proformaInvoicesTable.status, status));

    const invoices = conditions.length
      ? await db.select().from(proformaInvoicesTable).where(and(...conditions)).orderBy(desc(proformaInvoicesTable.createdAt))
      : await db.select().from(proformaInvoicesTable).orderBy(desc(proformaInvoicesTable.createdAt));

    const enriched = await Promise.all(invoices.map(enrichInvoice));
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "List proforma invoices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/proforma-invoices", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { customerName, companyName, address, addressLine1, addressLine2, addressLine3, city, state, pincode, gstNumber, mobile, taxableAmount, freight, cgst, sgst, igst, cgstPercent, sgstPercent, igstPercent, grandTotal, amountInWords, status, notes, items } = req.body;

    if (!customerName || !items?.length) {
      res.status(400).json({ error: "Customer name and at least one item required" });
      return;
    }

    const invoiceNumber = generateInvoiceNumber();
    const words = amountInWords || amountToWords(Number(grandTotal) || 0);

    const [invoice] = await db
      .insert(proformaInvoicesTable)
      .values({
        invoiceNumber,
        customerName,
        companyName: companyName || null,
        address: address || null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        addressLine3: addressLine3 || null,
        city: city || null,
        state: state || null,
        pincode: pincode || null,
        gstNumber: gstNumber || null,
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
        quantity: String(item.quantity),
        unit: item.unit || "Pcs",
        rate: String(item.rate),
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

router.get("/proforma-invoices/:id", async (req, res) => {
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

router.patch("/proforma-invoices/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    if (user.role === "sales") {
      const [existing] = await db.select({ createdBy: proformaInvoicesTable.createdBy }).from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, id));
      if (!existing || existing.createdBy !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const { customerName, companyName, address, addressLine1, addressLine2, addressLine3, city, state, pincode, gstNumber, mobile, taxableAmount, freight, cgst, sgst, igst, cgstPercent, sgstPercent, igstPercent, grandTotal, amountInWords, notes, items } = req.body;

    const updateData: any = {};
    if (customerName !== undefined) updateData.customerName = customerName;
    if (companyName !== undefined) updateData.companyName = companyName;
    if (address !== undefined) updateData.address = address;
    if (addressLine1 !== undefined) updateData.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2;
    if (addressLine3 !== undefined) updateData.addressLine3 = addressLine3;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (gstNumber !== undefined) updateData.gstNumber = gstNumber;
    if (mobile !== undefined) updateData.mobile = mobile;
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
          quantity: String(item.quantity),
          unit: item.unit || "Pcs",
          rate: String(item.rate),
          amount: String(item.amount),
        });
      }
    }

    const [invoice] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(eq(proformaInvoicesTable.id, id));

    res.json(await enrichInvoice(invoice!));
  } catch (err) {
    req.log.error({ err }, "Update proforma invoice error");
    res.status(500).json({ error: "Internal server error" });
  }
});

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
      .where(eq(proformaInvoicesTable.id, id));

    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

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

router.delete("/proforma-invoices/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    if (user.role === "sales") {
      const [existing] = await db.select({ createdBy: proformaInvoicesTable.createdBy }).from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, id));
      if (!existing || existing.createdBy !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    await db.delete(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, id));
    res.status(204).send();
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
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" } });
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
