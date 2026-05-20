import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { ImportExcelBody, ImportIndiaMartBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/import/excel", async (req, res) => {
  const parsed = ImportExcelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const { rows, defaultSalesOwnerId } = parsed.data;
  const users = await db.select().from(usersTable);
  const userNameMap = new Map(users.map(u => [u.name.toLowerCase(), u.id]));

  let imported = 0;
  let skipped = 0;
  const duplicates: string[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.mobile || !row.name) {
      errors.push(`Row missing name or mobile: ${JSON.stringify(row)}`);
      skipped++;
      continue;
    }
    const existing = await db.select().from(contactsTable).where(eq(contactsTable.mobile, row.mobile));
    if (existing.length > 0) {
      duplicates.push(row.mobile);
      skipped++;
      continue;
    }

    let salesOwnerId = defaultSalesOwnerId ?? null;
    if (row.salesOwnerName) {
      const found = userNameMap.get(row.salesOwnerName.toLowerCase());
      if (found) salesOwnerId = found;
    }
    if (!salesOwnerId) {
      errors.push(`No sales owner for row: ${row.name}`);
      skipped++;
      continue;
    }

    try {
      await db.insert(contactsTable).values({
        name: row.name,
        mobile: row.mobile,
        email: row.email ?? null,
        companyName: row.companyName ?? null,
        city: row.city ?? null,
        salesOwnerId,
        inquiryDate: row.inquiryDate ?? null,
        lastCallDate: row.lastCallDate ?? null,
        nextCallDate: row.nextCallDate ?? null,
        industry: row.industry ?? null,
        unit: row.unit ?? null,
      });
      imported++;
    } catch (err: any) {
      if (err?.code === "23505") {
        duplicates.push(row.mobile);
        skipped++;
      } else {
        errors.push(`Error importing ${row.name}: ${err?.message}`);
        skipped++;
      }
    }
  }

  res.json({ imported, skipped, duplicates, errors });
});

router.post("/import/indiamart", async (req, res) => {
  const parsed = ImportIndiaMartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const { companyName, clientName, clientMobile, email, city, requirement, quantity, salesOwnerId } = parsed.data;

  const existing = await db.select().from(contactsTable).where(eq(contactsTable.mobile, clientMobile));
  if (existing.length > 0) {
    res.status(409).json({ error: "Contact with this mobile already exists", contact: existing[0] });
    return;
  }

  const notes = [requirement, quantity ? `Qty: ${quantity}` : null].filter(Boolean).join(" | ");

  try {
    const users = await db.select().from(usersTable);
    const ownerId = salesOwnerId ?? users[0]?.id;
    if (!ownerId) {
      res.status(400).json({ error: "No sales owner available" });
      return;
    }

    const [contact] = await db.insert(contactsTable).values({
      name: clientName,
      mobile: clientMobile,
      email: email ?? null,
      companyName: companyName ?? null,
      city: city ?? null,
      salesOwnerId: ownerId,
      leadSource: "IndiaMart",
      inquiryDate: new Date().toISOString().split("T")[0]!,
    }).returning();

    res.status(201).json({ ...contact, notes });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Contact with this mobile or email already exists" });
      return;
    }
    req.log.error({ err }, "IndiaMart import error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
