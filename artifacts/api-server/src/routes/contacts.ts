import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable, activitiesTable, dealsTable } from "@workspace/db";
import { eq, or, and, ilike, lte, isNotNull, inArray, SQL } from "drizzle-orm";
import { CreateContactBody, UpdateContactBody, GetContactParams, UpdateContactParams, DeleteContactParams, ListContactsQueryParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";

const router: IRouter = Router();

async function withOwner(contact: typeof contactsTable.$inferSelect) {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, contact.salesOwnerId));
  const { passwordHash: _, ...safeOwner } = owner ?? {};
  return { ...contact, salesOwner: owner ? safeOwner : null };
}

router.get("/contacts", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const params = ListContactsQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];

    if (user.role === "sales") {
      conditions.push(eq(contactsTable.salesOwnerId, user.id));
    }

    if (params.success) {
      if (params.data.salesOwnerId && user.role === "admin") conditions.push(eq(contactsTable.salesOwnerId, params.data.salesOwnerId));
      if (params.data.city) conditions.push(ilike(contactsTable.city, `%${params.data.city}%`));
      if (params.data.unit) conditions.push(eq(contactsTable.unit, params.data.unit));
      if (params.data.industry) conditions.push(eq(contactsTable.industry, params.data.industry));
      if (params.data.category) conditions.push(eq(contactsTable.category, params.data.category));
      if (params.data.search) {
        const s = `%${params.data.search}%`;
        conditions.push(
          or(
            ilike(contactsTable.name, s),
            ilike(contactsTable.mobile, s),
            ilike(contactsTable.companyName, s),
            ilike(contactsTable.city, s)
          )!
        );
      }
      if (params.data.followUpDue) {
        const today = new Date().toISOString().slice(0, 10);
        conditions.push(isNotNull(contactsTable.nextCallDate));
        conditions.push(lte(contactsTable.nextCallDate, today));
      }
    }
    const contacts = conditions.length
      ? await db.select().from(contactsTable).where(and(...conditions)).orderBy(contactsTable.createdAt)
      : await db.select().from(contactsTable).orderBy(contactsTable.createdAt);

    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    res.json(contacts.map(c => ({ ...c, salesOwner: userMap.get(c.salesOwnerId) ?? null })));
  } catch (err) {
    req.log.error({ err }, "List contacts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(403).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  const values = parsed.data;
  if (user.role === "sales" && !user.canAssignLeads && !values.salesOwnerId) {
    values.salesOwnerId = user.id;
  }
  try {
    const [contact] = await db.insert(contactsTable).values(values).returning();
    if (contact && values.salesOwnerId && values.salesOwnerId !== user.id) {
      const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, values.salesOwnerId));
      if (owner) {
        const assignmentTime = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        await createNotification({
          userId: values.salesOwnerId,
          type: "enquiry_assigned",
          title: "New Enquiry Assigned",
          message: `Customer: ${contact.name}\nMobile: ${contact.mobile || "-"}\nAssigned By: ${user.name}\nTime: ${assignmentTime}`,
          link: `/leads/${contact.id}`,
          relatedId: contact.id,
          relatedType: "contact",
        });
      }
    }
    res.status(201).json(await withOwner(contact!));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Mobile or email already exists" });
      return;
    }
    req.log.error({ err }, "Create contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/contacts/duplicates", async (req, res) => {
  try {
    const contacts = await db.select().from(contactsTable);
    const users = await db.select().from(usersTable);
    const userMap = new Map(users.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    const mobileMap = new Map<string, typeof contacts>();
    const emailMap = new Map<string, typeof contacts>();

    for (const c of contacts) {
      if (c.mobile) {
        if (!mobileMap.has(c.mobile)) mobileMap.set(c.mobile, []);
        mobileMap.get(c.mobile)!.push(c);
      }
      if (c.email) {
        if (!emailMap.has(c.email)) emailMap.set(c.email, []);
        emailMap.get(c.email)!.push(c);
      }
    }

    const groups: any[] = [];
    for (const [value, list] of mobileMap) {
      const ownerIds = new Set(list.map(c => c.salesOwnerId));
      if (ownerIds.size > 1) {
        groups.push({
          field: "mobile",
          value,
          contacts: list.map(c => ({ ...c, salesOwner: userMap.get(c.salesOwnerId) ?? null })),
        });
      }
    }
    for (const [value, list] of emailMap) {
      const ownerIds = new Set(list.map(c => c.salesOwnerId));
      if (ownerIds.size > 1) {
        groups.push({
          field: "email",
          value,
          contacts: list.map(c => ({ ...c, salesOwner: userMap.get(c.salesOwnerId) ?? null })),
        });
      }
    }
    res.json(groups);
  } catch (err) {
    req.log.error({ err }, "Duplicate contacts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/contacts/:id", async (req, res) => {
  const parsed = GetContactParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, parsed.data.id));
    if (!contact) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "sales" && contact.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await withOwner(contact));
  } catch (err) {
    req.log.error({ err }, "Get contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/contacts/:id", async (req, res) => {
  const params = UpdateContactParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [oldContact] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));
    if (!oldContact) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "sales" && oldContact.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (user.role === "sales" && !user.canAssignLeads && parsed.data.salesOwnerId !== undefined) {
      if (parsed.data.salesOwnerId !== user.id) {
        delete parsed.data.salesOwnerId;
      }
    }

    const [contact] = await db.update(contactsTable).set(parsed.data).where(eq(contactsTable.id, params.data.id)).returning();
    if (!contact) { res.status(404).json({ error: "Not found" }); return; }

    const newOwnerId = parsed.data.salesOwnerId;
    if (newOwnerId !== undefined && newOwnerId !== oldContact.salesOwnerId) {
      const assignedByName = user?.name || "Admin";
      const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, newOwnerId));
      if (owner) {
        const assignmentTime = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        await createNotification({
          userId: newOwnerId,
          type: "enquiry_assigned",
          title: "New Enquiry Assigned",
          message: `Customer: ${contact.name}\nMobile: ${contact.mobile || "-"}\nAssigned By: ${assignedByName}\nTime: ${assignmentTime}`,
          link: `/leads/${contact.id}`,
          relatedId: contact.id,
          relatedType: "contact",
        });
      }
    }

    const FIELD_LABELS: Record<string, string> = {
      name: "Customer Name", mobile: "Mobile", email: "Email",
      companyName: "Company Name", salesOwnerId: "Sales Owner",
      otherPhone: "Other Phone", otherEmail: "Other Email",
      leadSource: "Lead Source", city: "City", state: "State",
      address: "Address", unit: "Unit", industry: "Industry",
      tags: "Tags", inquiryDate: "Inquiry Date",
      lastCallDate: "Last Call Date", nextCallDate: "Next Follow-up",
      category: "Category"
    };
    const changes: string[] = [];
    const updates = parsed.data as Record<string, any>;
    for (const [key, newVal] of Object.entries(updates)) {
      if (newVal === undefined) continue;
      const oldVal = (oldContact as any)[key];
      const oldStr = oldVal == null ? "" : String(oldVal);
      const newStr = newVal == null ? "" : String(newVal);
      if (oldStr !== newStr) {
        const label = FIELD_LABELS[key] || key;
        changes.push(`- ${label}\n  ${oldStr || "(empty)"} → ${newStr || "(empty)"}`);
      }
    }
    if (changes.length > 0) {
      const [existingDeal] = await db
        .select({ id: dealsTable.id })
        .from(dealsTable)
        .where(eq(dealsTable.contactId, contact.id))
        .limit(1);
      const dealId = existingDeal?.id;
      if (dealId) {
        const now = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        await db.insert(activitiesTable).values({
          dealId,
          contactId: contact.id,
          type: "Note",
          notes: `${user.name} updated Lead\n\nChanged:\n${changes.join("\n\n")}\n\n${now}`,
          createdBy: user.id,
        });
      }
    }

    res.json(await withOwner(contact));
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Mobile or email already exists" });
      return;
    }
    req.log.error({ err }, "Update contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/contacts/bulk-delete", async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  try {
    let deleted = 0;
    for (const id of ids) {
      if (user.role === "sales") {
        const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId }).from(contactsTable).where(eq(contactsTable.id, id));
        if (!contact || contact.salesOwnerId !== user.id) continue;
      }
      await db.delete(contactsTable).where(eq(contactsTable.id, id));
      deleted++;
    }
    res.json({ deleted });
  } catch (err) {
    req.log.error({ err }, "Bulk delete contacts error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/contacts/:id", async (req, res) => {
  const params = DeleteContactParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role === "sales") {
      const [contact] = await db.select({ salesOwnerId: contactsTable.salesOwnerId }).from(contactsTable).where(eq(contactsTable.id, params.data.id));
      if (!contact || contact.salesOwnerId !== user.id) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    await db.delete(contactsTable).where(eq(contactsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
