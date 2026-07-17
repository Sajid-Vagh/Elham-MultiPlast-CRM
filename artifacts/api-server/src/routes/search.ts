import { Router, type IRouter } from "express";
import { db, contactsTable, ordersTable, productsTable, complaintsTable, dispatchTable, proformaInvoicesTable, dealsTable, productionOrdersTable, activitiesTable } from "@workspace/db";
import { or, ilike, eq, and, desc, inArray, type SQL } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { getAccessibleUnits } from "../lib/unit-filter";

const router: IRouter = Router();

router.get("/search", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { q } = req.query as { q?: string };
    if (!q || q.length < 2) {
      res.json({ contacts: [], orders: [], products: [], complaints: [], deals: [], productionOrders: [], proformaInvoices: [], activities: [] });
      return;
    }

    const s = `%${q}%`;
    const isDeleted = eq(ordersTable.isDeleted, false);

    // Role + unit conditions for each entity
    const accessibleUnits = getAccessibleUnits(user);
    const contactUnitCond = accessibleUnits ? inArray(contactsTable.unit, accessibleUnits) : undefined;
    const orderUnitCond = accessibleUnits ? inArray(ordersTable.productionUnit, accessibleUnits) : undefined;
    const salesOwnCond = user.role === "sales" ? eq(contactsTable.salesOwnerId, user.id) : undefined;
    const orderSalesOwnCond = user.role === "sales" ? eq(ordersTable.salesOwnerId, user.id) : undefined;

    const [contacts, orders, products, complaints, deals, productionOrders, proformaInvoices, activities] = await Promise.all([
      // Contacts — search by name, company, primary mobile, secondary mobile, email
      db.select({ id: contactsTable.id, name: contactsTable.name, companyName: contactsTable.companyName, mobile: contactsTable.mobile, type: contactsTable.category })
        .from(contactsTable)
        .where(and(
          or(
            ilike(contactsTable.name, s),
            ilike(contactsTable.companyName, s),
            ilike(contactsTable.mobile, s),
            ilike(contactsTable.email, s),
            ilike(contactsTable.otherPhone, s),
          ),
          contactUnitCond,
          salesOwnCond,
        ))
        .limit(10),

      // Orders — search by order number, customer name, company, mobile
      db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, customerName: ordersTable.customerName, status: ordersTable.status })
        .from(ordersTable)
        .where(and(isDeleted,
          or(
            ilike(ordersTable.orderNumber, s),
            ilike(ordersTable.customerName, s),
            ilike(ordersTable.companyName, s),
            ilike(ordersTable.mobile, s),
          ),
          orderUnitCond,
          orderSalesOwnCond,
        ))
        .limit(10),

      // Products — search by name, code
      db.select({ id: productsTable.id, name: productsTable.name, productCode: productsTable.productCode, category: productsTable.category })
        .from(productsTable)
        .where(or(ilike(productsTable.name, s), ilike(productsTable.productCode, s)))
        .limit(10),

      // Complaints — search by complaint number, customer name, product name
      db.select({ id: complaintsTable.id, complaintNumber: complaintsTable.complaintNumber, customerName: complaintsTable.customerName, status: complaintsTable.status })
        .from(complaintsTable)
        .where(and(eq(complaintsTable.isDeleted, false), or(
          ilike(complaintsTable.complaintNumber, s),
          ilike(complaintsTable.customerName, s),
          ilike(complaintsTable.productName, s),
        )))
        .limit(10),

      // Deals — search by title, include active PI status
      (async () => {
        const dealConditions: (SQL | undefined)[] = [or(ilike(dealsTable.title, s))];
        if (user.role === "sales") dealConditions.push(eq(dealsTable.salesOwnerId, user.id));
        const dealRows = await db
          .select({
            id: dealsTable.id,
            title: dealsTable.title,
            stage: dealsTable.stage,
            contactId: dealsTable.contactId,
          })
          .from(dealsTable)
          .where(and(...dealConditions))
          .limit(10);
        let filteredDeals = dealRows;
        if (accessibleUnits) {
          const allowedContactIds = new Set(
            (await db.select({ id: contactsTable.id }).from(contactsTable).where(contactUnitCond!)).map(c => c.id)
          );
          filteredDeals = dealRows.filter(d => d.contactId && allowedContactIds.has(d.contactId));
        }
        const enriched = await Promise.all(filteredDeals.map(async (d) => {
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

      // Production Orders — search via proforma invoice (PI) linked to production order
      db.select({
        id: productionOrdersTable.id,
        orderNumber: proformaInvoicesTable.invoiceNumber,
        customerName: proformaInvoicesTable.customerName,
        companyName: proformaInvoicesTable.companyName,
        status: productionOrdersTable.status,
      })
        .from(productionOrdersTable)
        .innerJoin(proformaInvoicesTable, eq(productionOrdersTable.proformaInvoiceId, proformaInvoicesTable.id))
        .where(and(
          or(
            ilike(proformaInvoicesTable.invoiceNumber, s),
            ilike(proformaInvoicesTable.customerName, s),
            ilike(proformaInvoicesTable.companyName, s),
          ),
          accessibleUnits ? eq(productionOrdersTable.productionUnit, accessibleUnits[0]) : undefined,
        ))
        .limit(10),

      // Proforma Invoices — search by invoice number, customer name
      db.select({
        id: proformaInvoicesTable.id,
        invoiceNumber: proformaInvoicesTable.invoiceNumber,
        customerName: proformaInvoicesTable.customerName,
        status: proformaInvoicesTable.status,
      })
        .from(proformaInvoicesTable)
        .where(and(
          eq(proformaInvoicesTable.isDeleted, false),
          or(
            ilike(proformaInvoicesTable.invoiceNumber, s),
            ilike(proformaInvoicesTable.customerName, s),
          ),
        ))
        .limit(10),

      // Activities — search by notes content (recent only)
      (async () => {
        const actConditions: SQL[] = [ilike(activitiesTable.notes, s)];
        if (user.role === "sales") actConditions.push(eq(activitiesTable.createdBy, user.id));
        const actRows = await db.select({
          id: activitiesTable.id,
          type: activitiesTable.type,
          notes: activitiesTable.notes,
          dealId: activitiesTable.dealId,
          contactId: activitiesTable.contactId,
          createdAt: activitiesTable.createdAt,
        })
          .from(activitiesTable)
          .where(and(...actConditions))
          .orderBy(desc(activitiesTable.createdAt))
          .limit(10);
        if (accessibleUnits && actRows.length > 0) {
          const allowedContactIds = new Set(
            (await db.select({ id: contactsTable.id }).from(contactsTable).where(contactUnitCond!)).map(c => c.id)
          );
          return actRows.filter(a => a.contactId && allowedContactIds.has(a.contactId));
        }
        return actRows;
      })(),
    ]);

    res.json({ contacts, orders, products, complaints, deals, productionOrders, proformaInvoices, activities });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
