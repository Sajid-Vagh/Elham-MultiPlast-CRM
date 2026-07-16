import { Router, type IRouter } from "express";
import { db, contactsTable, ordersTable, productsTable, complaintsTable, dispatchTable, proformaInvoicesTable } from "@workspace/db";
import { or, ilike, eq, and } from "drizzle-orm";
import { getUserFromRequest } from "./auth";

const router: IRouter = Router();

router.get("/search", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { q } = req.query as { q?: string };
    if (!q || q.length < 2) { res.json({ contacts: [], orders: [], products: [], complaints: [] }); return; }

    const s = `%${q}%`;
    const isDeleted = eq(ordersTable.isDeleted, false);

    const [contacts, orders, products, complaints] = await Promise.all([
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
    ]);

    res.json({ contacts, orders, products, complaints });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
