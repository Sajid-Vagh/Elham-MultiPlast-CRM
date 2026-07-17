import { Router, type IRouter } from "express";
import { db, contactsTable, ordersTable, productsTable, complaintsTable, dispatchTable, proformaInvoicesTable, dealsTable } from "@workspace/db";
import { or, ilike, eq, and, desc } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

router.get("/search", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { q } = req.query as { q?: string };
    if (!q || q.length < 2) { res.json({ contacts: [], orders: [], products: [], complaints: [], deals: [] }); return; }

    const s = `%${q}%`;
    const isDeleted = eq(ordersTable.isDeleted, false);

    const [contacts, orders, products, complaints, deals] = await Promise.all([
      db.select({ id: contactsTable.id, name: contactsTable.name, companyName: contactsTable.companyName, mobile: contactsTable.mobile, type: contactsTable.category })
        .from(contactsTable)
        .where(or(ilike(contactsTable.name, s), ilike(contactsTable.companyName, s), ilike(contactsTable.mobile, s), ilike(contactsTable.email, s), ilike(contactsTable.otherPhone, s)))
        .limit(10),
      db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, customerName: ordersTable.customerName, status: ordersTable.status })
        .from(ordersTable)
        .where(and(isDeleted, or(ilike(ordersTable.orderNumber, s), ilike(ordersTable.customerName, s), ilike(ordersTable.companyName, s), ilike(ordersTable.mobile, s))))
        .limit(10),
      db.select({ id: productsTable.id, name: productsTable.name, productCode: productsTable.productCode, category: productsTable.category })
        .from(productsTable)
        .where(or(ilike(productsTable.name, s), ilike(productsTable.productCode, s)))
        .limit(10),
      db.select({ id: complaintsTable.id, complaintNumber: complaintsTable.complaintNumber, customerName: complaintsTable.customerName, status: complaintsTable.status })
        .from(complaintsTable)
        .where(and(eq(complaintsTable.isDeleted, false), or(ilike(complaintsTable.complaintNumber, s), ilike(complaintsTable.customerName, s))))
        .limit(10),
      // Deals: search by title, include active PI status
      (async () => {
        const dealRows = await db
          .select({
            id: dealsTable.id,
            title: dealsTable.title,
            stage: dealsTable.stage,
            contactId: dealsTable.contactId,
          })
          .from(dealsTable)
          .where(or(ilike(dealsTable.title, s)))
          .limit(10);
        // Enrich each deal with active PI info and contact name
        const enriched = await Promise.all(dealRows.map(async (d) => {
          let contact = null;
          if (d.contactId) {
            const [c] = await db.select({ id: contactsTable.id, name: contactsTable.name, companyName: contactsTable.companyName }).from(contactsTable).where(eq(contactsTable.id, d.contactId));
            contact = c ?? null;
          }
          const [activePI] = await db
            .select({ invoiceNumber: proformaInvoicesTable.invoiceNumber, status: proformaInvoicesTable.status })
            .from(proformaInvoicesTable)
            .where(and(eq(proformaInvoicesTable.dealId, d.id), eq(proformaInvoicesTable.isActive, true), eq(proformaInvoicesTable.isDeleted, false)))
            .limit(1);
          return {
            id: d.id,
            name: d.title || (contact ? `${contact.name} — Deal #${d.id}` : `Deal #${d.id}`),
            companyName: contact?.companyName || null,
            stage: d.stage,
            piStatus: activePI?.status || "No PI",
            piNumber: activePI?.invoiceNumber || null,
          };
        }));
        return enriched;
      })(),
    ]);

    res.json({ contacts, orders, products, complaints, deals });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
