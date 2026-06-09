import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable } from "@workspace/db";
import { eq, or, and, ilike, lte, isNotNull, SQL } from "drizzle-orm";
import { CreateContactBody, UpdateContactBody, GetContactParams, UpdateContactParams, DeleteContactParams, ListContactsQueryParams } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function withOwner(contact: typeof contactsTable.$inferSelect) {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, contact.salesOwnerId));
  const { passwordHash: _, ...safeOwner } = owner ?? {};
  return { ...contact, salesOwner: owner ? safeOwner : null };
}

router.get("/contacts", async (req, res) => {
  try {
    const params = ListContactsQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];
    if (params.success) {
      if (params.data.salesOwnerId) conditions.push(eq(contactsTable.salesOwnerId, params.data.salesOwnerId));
      if (params.data.city) conditions.push(ilike(contactsTable.city, `%${params.data.city}%`));
      if (params.data.unit) conditions.push(eq(contactsTable.unit, params.data.unit));
      if (params.data.industry) conditions.push(eq(contactsTable.industry, params.data.industry));
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
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error });
    return;
  }
  try {
    const [contact] = await db.insert(contactsTable).values(parsed.data).returning();
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
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, parsed.data.id));
    if (!contact) { res.status(404).json({ error: "Not found" }); return; }
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
    const [contact] = await db.update(contactsTable).set(parsed.data).where(eq(contactsTable.id, params.data.id)).returning();
    if (!contact) { res.status(404).json({ error: "Not found" }); return; }
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
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  try {
    let deleted = 0;
    for (const id of ids) {
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
    await db.delete(contactsTable).where(eq(contactsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
