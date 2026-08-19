import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable, CATEGORIES, dealsTable, activitiesTable, categoryHistoryTable } from "@workspace/db";
import { eq, or, and, desc, like } from "drizzle-orm";
import { z } from "zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { normalizeProfilePhotoUrl } from "../lib/storage";
import { normalizeStateCity } from "../utils/geoMapping";
import { generateCustomerCode } from "../lib/customer-code-generator";

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
    ownerProfilePhoto: normalizeProfilePhotoUrl(owner?.profilePhoto),
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
  const userIdToUnitMap = new Map(users.filter(u => u.unit && u.unit !== "All").map(u => [u.id, u.unit]));

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
          const geo = normalizeStateCity({ city: row.city, state: row.state });
          await db.update(contactsTable)
            .set({
              name: contactName,
              email: row.email?.trim() ?? null,
              companyName: row.companyName?.trim() ?? null,
              city: geo.city,
              state: geo.state,
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
      // Auto-fill unit from sales owner's unit if not provided in row
      let effectiveUnit = row.unit?.trim() || null;
      if (!effectiveUnit && salesOwnerId) {
        const ownerUnit = userIdToUnitMap.get(salesOwnerId);
        if (ownerUnit) effectiveUnit = ownerUnit;
      }
      // Standardize city/state (auto-fills state from a known city when missing)
      const geo = normalizeStateCity({ city: row.city, state: row.state });
      await db.insert(contactsTable).values({
        name: contactName,
        mobile: contactMobile,
        email: row.email?.trim() ?? null,
        companyName: row.companyName?.trim() ?? null,
        city: geo.city,
        state: geo.state,
        salesOwnerId,
        inquiryDate: row.inquiryDate?.trim() ?? null,
        lastCallDate: row.lastCallDate?.trim() ?? null,
        nextCallDate: row.nextCallDate?.trim() ?? null,
        industry: row.industry?.trim() ?? null,
        unit: effectiveUnit,
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

    // Auto-fill unit from owner's unit when not explicitly set
    let effectiveUnit = fields.unit?.trim() || null;
    if (!effectiveUnit && ownerId) {
      const ownerUser = users.find(u => u.id === ownerId);
      if (ownerUser && ownerUser.unit && ownerUser.unit !== "All") {
        effectiveUnit = ownerUser.unit;
      }
    }

    const geo = normalizeStateCity({ city: fields.city, state: fields.state });
    const [contact] = await db.insert(contactsTable).values({
      name: contactName,
      mobile: contactMobile,
      email: fields.email?.trim() ?? null,
      companyName: fields.companyName?.trim() ?? null,
      city: geo.city,
      state: geo.state,
      salesOwnerId: ownerId,
      leadSource: "IndiaMart",
      inquiryDate: new Date().toISOString().split("T")[0]!,
      unit: effectiveUnit,
      industry: fields.industry?.trim() ?? null,
      category: contactCategory,
    }).returning();

    const assignedByName = currentUser?.name || "Admin";
    const reqTitle = fields.requirement ? fields.requirement.slice(0, 80) : "";
    await createNotification({
      createdById: currentUser?.id ?? null,
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
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BULK CUSTOMER IMPORT — simplified 5-column Excel (Name, Company, Mobile, City, State)
// ══════════════════════════════════════════════════════════════════════════════

function normalizeBulkMobile(raw: string): string {
  const parts = raw.split(",").map(p => p.trim()).filter(Boolean);
  const normalized = parts.map(p => {
    const digits = p.replace(/\D/g, "");
    return digits.slice(-10);
  }).filter(n => n.length >= 10);
  const unique = [...new Set(normalized)];
  return unique.join(", ");
}

function normalizeBulkEmails(raw: string): string {
  const parts = raw.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter(p => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
  const unique = [...new Set(valid)];
  return unique.join(", ");
}

const BulkCustomerRowSchema = z.object({
  name: z.string().nullish(),
  companyName: z.string().nullish(),
  mobile: z.string().nullish(),
  email: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
});

const BulkCustomerImportRequestSchema = z.object({
  rows: z.array(BulkCustomerRowSchema),
  category: z.enum(CATEGORY_VALUES),
  defaultSalesOwnerId: z.number().nullish(),
});

router.post("/import/bulk-customers", async (req, res) => {
  const currentUser = await getUserFromRequest(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = BulkCustomerImportRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  let { rows, category, defaultSalesOwnerId } = parsed.data;

  if (currentUser.role === "sales") {
    defaultSalesOwnerId = currentUser.id;
  }

  req.log.info({ category, rowCount: rows.length }, "Bulk customer import request");

  let imported = 0;
  let skipped = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  const duplicateDetails: Array<{
    rowNum: number;
    mobile: string;
    name: string;
    existingContactId: number;
    existingContactName: string;
    existingCategory: string;
  }> = [];
  const errors: Array<{ rowNum: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;

    // ── Validate mobile (mandatory) ──
    const rawMobile = row.mobile?.trim();
    if (!rawMobile) {
      errors.push({ rowNum, reason: "Mobile Number is missing" });
      invalidCount++;
      continue;
    }

    // ── Normalize all mobile numbers in the cell ──
    const normalizedMobile = normalizeBulkMobile(rawMobile);
    if (!normalizedMobile) {
      errors.push({ rowNum, reason: `Invalid mobile number: "${rawMobile}"` });
      invalidCount++;
      continue;
    }

    // ── Normalize emails (optional, comma-separated) ──
    const normalizedEmail = row.email?.trim() ? normalizeBulkEmails(row.email.trim()) : null;

    // ── Check for duplicates against existing contacts ──
    // Split normalized mobile into individual numbers for checking
    const mobileParts = normalizedMobile.split(",").map(m => m.trim()).filter(Boolean);
    let isDuplicate = false;
    let existingContact: any = null;

    for (const num of mobileParts) {
      // Exact match: existing mobile == single part (contact has only this one number)
      const [exactMatch] = await db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        mobile: contactsTable.mobile,
        category: contactsTable.category,
      }).from(contactsTable)
        .where(eq(contactsTable.mobile, num))
        .limit(1);

      if (exactMatch) {
        isDuplicate = true;
        existingContact = exactMatch;
        break;
      }

      // Substring match: existing mobile contains this number (e.g., "0987654321, 1234567890" contains "0987654321")
      const [substringMatch] = await db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        mobile: contactsTable.mobile,
        category: contactsTable.category,
      }).from(contactsTable)
        .where(like(contactsTable.mobile, `%${num}%`))
        .limit(1);

      if (substringMatch) {
        isDuplicate = true;
        existingContact = substringMatch;
        break;
      }
    }

    // Also check if the full normalized mobile matches any existing contact
    if (!isDuplicate) {
      const [fullMatch] = await db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        mobile: contactsTable.mobile,
        category: contactsTable.category,
      }).from(contactsTable)
        .where(eq(contactsTable.mobile, normalizedMobile))
        .limit(1);

      if (fullMatch) {
        isDuplicate = true;
        existingContact = fullMatch;
      }
    }

    // Also check duplicate by email (if provided)
    if (!isDuplicate && normalizedEmail) {
      const emailParts = normalizedEmail.split(",").map(e => e.trim()).filter(Boolean);
      for (const emailAddr of emailParts) {
        const [emailMatch] = await db.select({
          id: contactsTable.id,
          name: contactsTable.name,
          mobile: contactsTable.mobile,
          email: contactsTable.email,
          category: contactsTable.category,
        }).from(contactsTable)
          .where(eq(contactsTable.email, emailAddr))
          .limit(1);

        if (emailMatch) {
          isDuplicate = true;
          existingContact = emailMatch;
          break;
        }
      }
    }

    if (isDuplicate && existingContact) {
      duplicateCount++;
      duplicateDetails.push({
        rowNum,
        mobile: normalizedMobile,
        name: existingContact.name,
        existingContactId: existingContact.id,
        existingContactName: existingContact.name,
        existingCategory: existingContact.category,
      });
      skipped++;
      continue;
    }

    // ── Resolve name (fallback to company > Lead-mobile) ──
    let contactName: string;
    const hasName = !!row.name?.trim();
    const hasCompany = !!row.companyName?.trim();
    if (hasName) {
      contactName = row.name!.trim();
    } else if (hasCompany) {
      contactName = row.companyName!.trim();
    } else {
      contactName = `Lead-${mobileParts[0]}`;
    }

    // ── Resolve sales owner ──
    const salesOwnerId = defaultSalesOwnerId ?? currentUser.id;

    // ── Normalize city/state ──
    const geo = normalizeStateCity({ city: row.city, state: row.state });

    // ── Insert contact ──
    try {
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(contactsTable).values({
        name: contactName,
        mobile: normalizedMobile,
        email: normalizedEmail || null,
        companyName: row.companyName?.trim() || null,
        city: geo.city,
        state: geo.state,
        salesOwnerId,
        category,
        inquiryDate: today,
        leadSource: "Bulk Import",
      });
      imported++;
    } catch (err: any) {
      if (err?.code === "23505") {
        // Unique constraint violation — duplicate mobile
        duplicateCount++;
        duplicateDetails.push({
          rowNum,
          mobile: normalizedMobile,
          name: contactName,
          existingContactId: 0,
          existingContactName: "(detected by unique constraint)",
          existingCategory: category,
        });
        skipped++;
      } else {
        errors.push({ rowNum, reason: `Import error: ${err?.message || "unknown"}` });
        skipped++;
      }
    }
  }

  req.log.info({ imported, skipped, invalidCount, duplicateCount, category }, "Bulk customer import result");

  res.json({
    imported,
    skipped,
    invalid: invalidCount,
    duplicates: duplicateCount,
    duplicateDetails,
    errors,
    importedInto: category,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MY CLIENT IMPORT — bulk upload contacts directly as permanent "My Client"
// ══════════════════════════════════════════════════════════════════════════════

const MyClientRowSchema = z.object({
  name: z.string().nullish(),
  companyName: z.string().nullish(),
  mobile: z.string().nullish(),
  email: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  customerSince: z.string().nullish(),
});

const MyClientImportRequestSchema = z.object({
  rows: z.array(MyClientRowSchema),
  defaultSalesOwnerId: z.number().nullish(),
});

router.post("/import/my-client", async (req, res) => {
  const currentUser = await getUserFromRequest(req);
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = MyClientImportRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  let { rows, defaultSalesOwnerId } = parsed.data;

  if (currentUser.role === "sales") {
    defaultSalesOwnerId = currentUser.id;
  }

  req.log.info({ rowCount: rows.length }, "My Client import request");

  let imported = 0;
  let skipped = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  const duplicateDetails: Array<{
    rowNum: number;
    mobile: string;
    name: string;
    existingContactId: number;
    existingContactName: string;
    existingCategory: string;
  }> = [];
  const errors: Array<{ rowNum: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;

    // ── Validate mobile (mandatory) ──
    const rawMobile = row.mobile?.trim();
    if (!rawMobile) {
      errors.push({ rowNum, reason: "Mobile Number is missing" });
      invalidCount++;
      continue;
    }

    // ── Normalize mobile ──
    const normalizedMobile = normalizeBulkMobile(rawMobile);
    if (!normalizedMobile) {
      errors.push({ rowNum, reason: `Invalid mobile number: "${rawMobile}"` });
      invalidCount++;
      continue;
    }

    // ── Normalize email ──
    const normalizedEmail = row.email?.trim() ? normalizeBulkEmails(row.email.trim()) : null;

    // ── Check for duplicates ──
    const mobileParts = normalizedMobile.split(",").map(m => m.trim()).filter(Boolean);
    let isDuplicate = false;
    let existingContact: any = null;

    for (const num of mobileParts) {
      // Exact match
      const [exactMatch] = await db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        mobile: contactsTable.mobile,
        category: contactsTable.category,
      }).from(contactsTable)
        .where(eq(contactsTable.mobile, num))
        .limit(1);

      if (exactMatch) {
        isDuplicate = true;
        existingContact = exactMatch;
        break;
      }

      // Substring match: existing mobile contains this number
      const [substringMatch] = await db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        mobile: contactsTable.mobile,
        category: contactsTable.category,
      }).from(contactsTable)
        .where(like(contactsTable.mobile, `%${num}%`))
        .limit(1);

      if (substringMatch) {
        isDuplicate = true;
        existingContact = substringMatch;
        break;
      }
    }

    // Also check if the full normalized mobile matches
    if (!isDuplicate) {
      const [fullMatch] = await db.select({
        id: contactsTable.id,
        name: contactsTable.name,
        mobile: contactsTable.mobile,
        category: contactsTable.category,
      }).from(contactsTable)
        .where(eq(contactsTable.mobile, normalizedMobile))
        .limit(1);

      if (fullMatch) {
        isDuplicate = true;
        existingContact = fullMatch;
      }
    }

    // Check duplicate by email
    if (!isDuplicate && normalizedEmail) {
      const emailParts = normalizedEmail.split(",").map(e => e.trim()).filter(Boolean);
      for (const emailAddr of emailParts) {
        const [emailMatch] = await db.select({
          id: contactsTable.id,
          name: contactsTable.name,
          mobile: contactsTable.mobile,
          email: contactsTable.email,
          category: contactsTable.category,
        }).from(contactsTable)
          .where(eq(contactsTable.email, emailAddr))
          .limit(1);

        if (emailMatch) {
          isDuplicate = true;
          existingContact = emailMatch;
          break;
        }
      }
    }

    if (isDuplicate && existingContact) {
      duplicateCount++;
      duplicateDetails.push({
        rowNum,
        mobile: normalizedMobile,
        name: existingContact.name,
        existingContactId: existingContact.id,
        existingContactName: existingContact.name,
        existingCategory: existingContact.category,
      });
      skipped++;
      continue;
    }

    // ── Resolve name ──
    let contactName: string;
    if (row.name?.trim()) {
      contactName = row.name.trim();
    } else if (row.companyName?.trim()) {
      contactName = row.companyName.trim();
    } else {
      contactName = `Lead-${mobileParts[0]}`;
    }

    // ── Resolve sales owner ──
    const salesOwnerId = defaultSalesOwnerId ?? currentUser.id;

    // ── Normalize city/state ──
    const geo = normalizeStateCity({ city: row.city, state: row.state });

    // ── Parse customerSince ──
    const today = new Date().toISOString().slice(0, 10);
    let customerSince = today;
    if (row.customerSince?.trim()) {
      const parsed = row.customerSince.trim();
      // Accept YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
        customerSince = parsed;
      } else if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(parsed)) {
        const [d, m, y] = parsed.split(/[\/\-]/);
        customerSince = `${y}-${m}-${d}`;
      }
    }

    // ── Generate customer code ──
    const customerCode = await generateCustomerCode();

    // ── Insert contact ──
    try {
      const [inserted] = await db.insert(contactsTable).values({
        name: contactName,
        mobile: normalizedMobile,
        email: normalizedEmail || null,
        companyName: row.companyName?.trim() || null,
        city: geo.city,
        state: geo.state,
        salesOwnerId,
        category: "My Client",
        isMyClient: true,
        customerStatus: "Active",
        customerSince,
        customerCode,
        leadSource: "Bulk Import",
      }).returning({ id: contactsTable.id });

      // ── Record category history ──
      if (inserted?.id) {
        await db.insert(categoryHistoryTable).values({
          contactId: inserted.id,
          previousCategory: null,
          newCategory: "My Client",
          changedBy: currentUser.id,
          reason: "Bulk Import — My Client",
        });
      }

      imported++;
    } catch (err: any) {
      if (err?.code === "23505") {
        duplicateCount++;
        duplicateDetails.push({
          rowNum,
          mobile: normalizedMobile,
          name: contactName,
          existingContactId: 0,
          existingContactName: "(detected by unique constraint)",
          existingCategory: "My Client",
        });
        skipped++;
      } else {
        errors.push({ rowNum, reason: `Import error: ${err?.message || "unknown"}` });
        skipped++;
      }
    }
  }

  req.log.info({ imported, skipped, invalidCount, duplicateCount }, "My Client import result");

  res.json({
    imported,
    skipped,
    invalid: invalidCount,
    duplicates: duplicateCount,
    duplicateDetails,
    errors,
    importedInto: "My Client",
  });
});

export default router;
