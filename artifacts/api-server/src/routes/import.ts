import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable, CATEGORIES, dealsTable, activitiesTable } from "@workspace/db";
import { eq, or, and, desc } from "drizzle-orm";
import { z } from "zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

async function getDuplicateMetadata(existingContactId: number) {
  const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, existingContactId)).limit(1);
  if (!existing) return null;
  const [owner] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, profilePhoto: usersTable.profilePhoto })
    .from(usersTable).where(eq(usersTable.id, existing.salesOwnerId)).limit(1);
  const [latestDeal] = await db.select({ stage: dealsTable.stage })
    .from(dealsTable).where(eq(dealsTable.contactId, existing.id))
    .orderBy(desc(dealsTable.updatedAt)).limit(1);
  const [lastActivity] = await db.select({ followUpDate: activitiesTable.followUpDate, createdAt: activitiesTable.createdAt })
    .from(activitiesTable).where(eq(activitiesTable.contactId, existing.id))
    .orderBy(desc(activitiesTable.followUpDate)).limit(1);
  return {
    duplicate: true,
    leadId: existing.id,
    customerName: existing.name,
    companyName: existing.companyName || null,
    mobile: existing.mobile,
    email: existing.email || null,
    ownerId: existing.salesOwnerId,
    ownerName: owner?.name || "Unknown",
    ownerRole: owner?.role || "sales",
    ownerProfilePhoto: owner?.profilePhoto || null,
    unit: existing.unit || null,
    category: existing.category,
    dealStage: latestDeal?.stage || null,
    status: existing.customerStatus || "Active",
    lastFollowUp: lastActivity?.followUpDate || lastActivity?.createdAt || null,
    createdAt: existing.createdAt,
    viewUrl: `/leads/${existing.id}`,
  };
}

const CATEGORY_VALUES = [...CATEGORIES] as const;
type Category = (typeof CATEGORY_VALUES)[number];

const ImportExcelRowSchema = z.object({
  name: z.string().nullish(),
  mobile: z.string().nullish(),
  otherPhone: z.string().nullish(),
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
  comments: z.string().nullish(),
});

const ImportExcelRequestSchema = z.object({
  rows: z.array(ImportExcelRowSchema),
  defaultSalesOwnerId: z.number().nullish(),
  category: z.enum(CATEGORY_VALUES),
  useCategoryFromFile: z.boolean().optional().default(false),
  duplicateAction: z.enum(["skip", "update"]).optional().default("skip"),
});

router.post("/import/excel", async (req, res) => {
  const currentUser = await getUserFromRequest(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = ImportExcelRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  let { rows, defaultSalesOwnerId, category, useCategoryFromFile, duplicateAction } = parsed.data;

  // Sales users auto-assign to themselves
  if (currentUser.role === "sales") {
    defaultSalesOwnerId = currentUser.id;
  }

  req.log.info({ category, useCategoryFromFile, duplicateAction, rowCount: rows.length }, "Excel import request");

  const users = await db.select().from(usersTable);
  const userNameMap = new Map(users.map(u => [u.name.toLowerCase(), u.id]));

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let autoNamed = 0;
  const duplicates: string[] = [];
  const duplicateDetails: Array<{
    rowNum: number;
    mobile: string;
    name: string;
    existingOwnerId: number;
    existingOwnerName: string;
    unit: string | null;
    category: string;
    action: "skipped" | "updated";
  }> = [];
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
    if (row.otherPhone?.trim()) {
      conditions.push(eq(contactsTable.otherPhone, row.otherPhone.trim()));
    }
    if (row.email?.trim()) {
      conditions.push(eq(contactsTable.email, row.email.trim()));
    }

    const existing = await db.select().from(contactsTable).where(or(...conditions));

    if (existing.length > 0) {
      if (duplicateAction === "update") {
        // My Clients is permanent: preserve category for permanent clients
        if (contactCategory !== "My Client" && existing[0]!.isMyClient) {
          contactCategory = "My Client";
        }

        // Fetch existing owner name for duplicate details
        const [existingOwner] = await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable).where(eq(usersTable.id, existing[0]!.salesOwnerId)).limit(1);

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
            customerComments: row.comments?.trim() ?? null,
            otherPhone: row.otherPhone?.trim() ?? null,
          })
            .where(eq(contactsTable.id, existing[0]!.id));
          updated++;
          duplicateDetails.push({
            rowNum,
            mobile: contactMobile,
            name: existing[0]!.name,
            existingOwnerId: existing[0]!.salesOwnerId,
            existingOwnerName: existingOwner?.name || "Unknown",
            unit: existing[0]!.unit || null,
            category: existing[0]!.category,
            action: "updated",
          });
        } catch (err: any) {
          errors.push(`Error updating row ${rowNum} (${contactName}): ${err?.message}`);
          skipped++;
        }
      } else {
        duplicates.push(contactMobile);
        skipped++;

        // Fetch existing owner name for duplicate details
        const [existingOwner] = await db.select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable).where(eq(usersTable.id, existing[0]!.salesOwnerId)).limit(1);

        duplicateDetails.push({
          rowNum,
          mobile: contactMobile,
          name: existing[0]!.name,
          existingOwnerId: existing[0]!.salesOwnerId,
          existingOwnerName: existingOwner?.name || "Unknown",
          unit: existing[0]!.unit || null,
          category: existing[0]!.category,
          action: "skipped",
        });
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
        customerComments: row.comments?.trim() ?? null,
        otherPhone: row.otherPhone?.trim() ?? null,
      });
      imported++;
    } catch (err: any) {
      if (err?.code === "23505") {
        duplicates.push(contactMobile);
        skipped++;
        // Try to find existing for duplicate details
        try {
          const [conflict] = await db.select().from(contactsTable)
            .where(eq(contactsTable.mobile, contactMobile)).limit(1);
          if (conflict) {
            const [conflictOwner] = await db.select({ id: usersTable.id, name: usersTable.name })
              .from(usersTable).where(eq(usersTable.id, conflict.salesOwnerId)).limit(1);
            duplicateDetails.push({
              rowNum,
              mobile: contactMobile,
              name: conflict.name,
              existingOwnerId: conflict.salesOwnerId,
              existingOwnerName: conflictOwner?.name || "Unknown",
              unit: conflict.unit || null,
              category: conflict.category,
              action: "skipped",
            });
          }
        } catch { /* ignore secondary errors */ }
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
    duplicateDetails,
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
  industry: z.string().nullish(),
  category: z.enum(CATEGORY_VALUES),
});

router.post("/import/indiamart", async (req, res) => {
  const currentUser = await getUserFromRequest(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = IndiaMartImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const fields = parsed.data;

  // Sales users auto-assign to themselves
  if (currentUser.role === "sales") {
    fields.salesOwnerId = currentUser.id;
  }

  const contactName = fields.clientName?.trim() || "Unknown Lead";
  const contactMobile = fields.clientMobile?.trim() || "No Contact Number";

  const existing = await db.select().from(contactsTable).where(eq(contactsTable.mobile, contactMobile));
  if (existing.length > 0) {
    const meta = await getDuplicateMetadata(existing[0]!.id);
    res.status(409).json(meta || { error: "Contact with this mobile already exists", duplicate: true });
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
      unit: fields.unit?.trim() ?? null,
      industry: fields.industry?.trim() ?? null,
      category: contactCategory,
    }).returning();

    const assignedByName = currentUser?.name || "Admin";
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
      // Try to find existing for rich metadata
      const [conflict] = await db.select().from(contactsTable)
        .where(eq(contactsTable.mobile, contactMobile)).limit(1);
      if (conflict) {
        const meta = await getDuplicateMetadata(conflict.id);
        res.status(409).json(meta || { error: "Contact with this mobile or email already exists", duplicate: true });
      } else {
        res.status(409).json({ error: "Contact with this mobile or email already exists", duplicate: true });
      }
      return;
    }
    req.log.error({ err }, "IndiaMart import error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
