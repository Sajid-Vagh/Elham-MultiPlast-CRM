import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable, CATEGORIES } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

const CATEGORY_VALUES = [...CATEGORIES] as const;
type Category = (typeof CATEGORY_VALUES)[number];

const ImportExcelRowSchema = z.object({
  name: z.string().nullish(),
  mobile: z.string().nullish(),
  email: z.string().nullish(),
  companyName: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  salesOwnerName: z.string().nullish(),
  inquiryDate: z.string().nullish(),
  lastCallDate: z.string().nullish(),
  nextCallDate: z.string().nullish(),
  industry: z.string().nullish(),
  unit: z.string().nullish(),
  notes: z.string().nullish(),
  category: z.string().nullish(),
  address: z.string().nullish(),
  tags: z.string().nullish(),
});

const ImportExcelRequestSchema = z.object({
  rows: z.array(ImportExcelRowSchema),
  defaultSalesOwnerId: z.number().nullish(),
  category: z.enum(CATEGORY_VALUES),
  useCategoryFromFile: z.boolean().optional().default(false),
  duplicateAction: z.enum(["skip", "update"]).optional().default("skip"),
});

router.post("/import/excel", async (req, res) => {
  const parsed = ImportExcelRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const { rows, defaultSalesOwnerId, category, useCategoryFromFile, duplicateAction } = parsed.data;

  req.log.info({ category, useCategoryFromFile, duplicateAction, rowCount: rows.length }, "Excel import request");

  const users = await db.select().from(usersTable);
  const userNameMap = new Map(users.map(u => [u.name.toLowerCase(), u.id]));

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let autoNamed = 0;
  const duplicates: string[] = [];
  const errors: string[] = [];

  const defaultCategory: Category = category;
  let noMobileIdx = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;

    // Reject only if ALL of name, mobile, email, company are missing
    const hasName = !!row.name?.trim();
    const hasMobile = !!row.mobile?.trim();
    const hasEmail = !!row.email?.trim();
    const hasCompany = !!row.companyName?.trim();

    if (!hasName && !hasMobile && !hasEmail && !hasCompany) {
      errors.push(`Row ${rowNum}: missing all of Name, Mobile, Email, Company`);
      skipped++;
      continue;
    }

    // Auto-name: companyName > Lead-mobile > email prefix
    let contactName: string;
    if (row.name?.trim()) {
      contactName = row.name.trim();
    } else if (row.companyName?.trim()) {
      contactName = row.companyName.trim();
      autoNamed++;
    } else if (row.mobile?.trim()) {
      contactName = `Lead-${row.mobile.trim()}`;
      autoNamed++;
    } else if (row.email?.trim()) {
      contactName = row.email.trim().split("@")[0]!;
      autoNamed++;
    } else {
      contactName = "Unknown Lead";
      autoNamed++;
    }

    // Mobile placeholder for NOT NULL + UNIQUE constraint
    let contactMobile: string;
    if (row.mobile?.trim()) {
      contactMobile = row.mobile.trim();
    } else {
      noMobileIdx++;
      contactMobile = `no-mobile-${noMobileIdx}-${Date.now()}`;
    }

    let contactCategory = defaultCategory;
    if (useCategoryFromFile && row.category?.trim()) {
      const fileCat = row.category.trim();
      if (CATEGORY_VALUES.includes(fileCat as Category)) {
        contactCategory = fileCat as Category;
      }
    }

    const conditions = [eq(contactsTable.mobile, contactMobile)];
    if (row.email?.trim()) {
      conditions.push(eq(contactsTable.email, row.email.trim()));
    }

    const existing = await db.select().from(contactsTable).where(or(...conditions));

    if (existing.length > 0) {
      if (duplicateAction === "update") {
        try {
          await db.update(contactsTable)
            .set({
              name: contactName,
              email: row.email?.trim() ?? null,
              companyName: row.companyName?.trim() ?? null,
              city: row.city?.trim() ?? null,
              state: row.state?.trim() ?? null,
              inquiryDate: row.inquiryDate?.trim() ?? null,
              lastCallDate: row.lastCallDate?.trim() ?? null,
              nextCallDate: row.nextCallDate?.trim() ?? null,
              industry: row.industry?.trim() ?? null,
              unit: row.unit?.trim() ?? null,
              category: contactCategory,
              address: row.address?.trim() ?? null,
              tags: row.tags?.trim() ?? null,
            })
            .where(eq(contactsTable.id, existing[0]!.id));
          updated++;
        } catch (err: any) {
          errors.push(`Error updating row ${rowNum} (${contactName}): ${err?.message}`);
          skipped++;
        }
      } else {
        duplicates.push(contactMobile);
        skipped++;
      }
      continue;
    }

    let salesOwnerId = defaultSalesOwnerId ?? null;
    if (row.salesOwnerName?.trim()) {
      const found = userNameMap.get(row.salesOwnerName.trim().toLowerCase());
      if (found) salesOwnerId = found;
    }
    if (!salesOwnerId) {
      errors.push(`No sales owner for row ${rowNum}: ${contactName}`);
      skipped++;
      continue;
    }

    try {
      await db.insert(contactsTable).values({
        name: contactName,
        mobile: contactMobile,
        email: row.email?.trim() ?? null,
        companyName: row.companyName?.trim() ?? null,
        city: row.city?.trim() ?? null,
        state: row.state?.trim() ?? null,
        salesOwnerId,
        inquiryDate: row.inquiryDate?.trim() ?? null,
        lastCallDate: row.lastCallDate?.trim() ?? null,
        nextCallDate: row.nextCallDate?.trim() ?? null,
        industry: row.industry?.trim() ?? null,
        unit: row.unit?.trim() ?? null,
        category: contactCategory,
        address: row.address?.trim() ?? null,
        tags: row.tags?.trim() ?? null,
      });
      imported++;
    } catch (err: any) {
      if (err?.code === "23505") {
        duplicates.push(contactMobile);
        skipped++;
      } else {
        errors.push(`Error importing row ${rowNum} (${contactName}): ${err?.message}`);
        skipped++;
      }
    }
  }

  req.log.info({ imported, updated, skipped, autoNamed, importCategory: defaultCategory }, "Excel import result");

  res.json({
    imported,
    updated,
    skipped,
    autoNamed,
    duplicates,
    errors,
    importedInto: defaultCategory,
  });
});

const IndiaMartImportSchema = z.object({
  companyName: z.string().nullish(),
  clientName: z.string(),
  clientMobile: z.string(),
  email: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  requirement: z.string().nullish(),
  quantity: z.string().nullish(),
  salesOwnerId: z.number().nullish(),
  unit: z.string().nullish(),
  category: z.enum(CATEGORY_VALUES),
});

router.post("/import/indiamart", async (req, res) => {
  const parsed = IndiaMartImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const fields = parsed.data;

  const contactName = fields.clientName?.trim() || "Unknown Lead";
  const contactMobile = fields.clientMobile?.trim() || "No Contact Number";

  const existing = await db.select().from(contactsTable).where(eq(contactsTable.mobile, contactMobile));
  if (existing.length > 0) {
    res.status(409).json({ error: "Contact with this mobile already exists", contact: existing[0] });
    return;
  }

  const notes = [fields.requirement, fields.quantity ? `Qty: ${fields.quantity}` : null].filter(Boolean).join(" | ");

  try {
    const users = await db.select().from(usersTable);
    const ownerId = fields.salesOwnerId ?? users[0]?.id;
    if (!ownerId) {
      res.status(400).json({ error: "No sales owner available" });
      return;
    }

    const contactCategory = fields.category;

    req.log.info({ category: contactCategory }, "IndiaMart import with category");

    const [contact] = await db.insert(contactsTable).values({
      name: contactName,
      mobile: contactMobile,
      email: fields.email?.trim() ?? null,
      companyName: fields.companyName?.trim() ?? null,
      city: fields.city?.trim() ?? null,
      state: fields.state?.trim() ?? null,
      salesOwnerId: ownerId,
      leadSource: "IndiaMart",
      inquiryDate: new Date().toISOString().split("T")[0]!,
      category: contactCategory,
    }).returning();

    const adminUser = await getUserFromRequest(req);
    const assignedByName = adminUser?.name || "Admin";
    const reqTitle = fields.requirement ? fields.requirement.slice(0, 80) : "";
    await createNotification({
      userId: ownerId,
      type: "assignment",
      title: "New IndiaMART Enquiry Assigned",
      message: `Customer: ${contactName}${reqTitle ? `\nProduct: ${reqTitle}` : ""}\nAssigned By: ${assignedByName}`,
      link: `/leads/${contact!.id}`,
      relatedId: contact!.id,
      relatedType: "contact",
    });

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
