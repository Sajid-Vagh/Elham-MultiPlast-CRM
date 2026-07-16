import { Router, type IRouter } from "express";
import { db, contactsTable, usersTable, activitiesTable, dealsTable, notificationsTable, commentHistoryTable, categoryHistoryTable, documentsTable, proformaInvoicesTable, proformaInvoiceItemsTable } from "@workspace/db";
import { eq, or, and, ilike, lte, isNotNull, isNull, inArray, SQL, desc } from "drizzle-orm";
import { CreateContactBody, UpdateContactBody, GetContactParams, UpdateContactParams, DeleteContactParams, ListContactsQueryParams } from "@workspace/api-zod";
import { getUserFromRequest } from "./auth";
import { createNotification } from "./notifications";
import { completePendingActivitiesForDeal } from "../lib/activity-helpers";
import { getAccessibleUnits } from "../lib/unit-filter";

const router: IRouter = Router();

async function withOwner(contact: typeof contactsTable.$inferSelect) {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, contact.salesOwnerId));
  const { passwordHash: _, ...safeOwner } = owner ?? {};
  let commentUser = null;
  if (contact.commentUpdatedBy) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, contact.commentUpdatedBy));
    if (u) { const { passwordHash: _, ...safe } = u; commentUser = safe; }
  }
  return { ...contact, salesOwner: owner ? safeOwner : null, commentUpdatedByUser: commentUser };
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

    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits) {
      conditions.push(inArray(contactsTable.unit, accessibleUnits));
    }

    const isAdmin = user.role === "admin";
    const categoryParam = req.query.category as string | undefined;

    if (params.success) {
      if (params.data.salesOwnerId && isAdmin) conditions.push(eq(contactsTable.salesOwnerId, params.data.salesOwnerId));
      if (params.data.city) conditions.push(ilike(contactsTable.city, `%${params.data.city}%`));
      if (params.data.unit) conditions.push(eq(contactsTable.unit, params.data.unit));
      if (params.data.industry) conditions.push(eq(contactsTable.industry, params.data.industry));
      if (categoryParam && categoryParam !== "Regular Follow up") {
        conditions.push(eq(contactsTable.category, categoryParam));
      } else if (categoryParam === "Regular Follow up") {
        // Virtual RFU: My Client contacts with active deals are shown alongside physical RFU
        // We handle this below after building the base query
      }
      if (params.data.search) {
        const s = `%${params.data.search}%`;
        conditions.push(
          or(
            ilike(contactsTable.name, s),
            ilike(contactsTable.mobile, s),
            ilike(contactsTable.otherPhone, s),
            ilike(contactsTable.companyName, s),
            ilike(contactsTable.city, s),
            ilike(contactsTable.customerComments, s)
          )!
        );
      }
      if (params.data.followUpDue) {
        const today = new Date().toISOString().slice(0, 10);
        conditions.push(isNotNull(contactsTable.nextCallDate));
        conditions.push(lte(contactsTable.nextCallDate, today));
      }
    }

    let contacts: (typeof contactsTable.$inferSelect)[];
    if (categoryParam === "Regular Follow up") {
      // Physical RFU contacts
      const rfuContacts = await db.select().from(contactsTable)
        .where(and(eq(contactsTable.category, "Regular Follow up"), ...conditions))
        .orderBy(contactsTable.createdAt);
      // My Client contacts with active deals
      const myClientContacts = await db.select().from(contactsTable)
        .where(and(eq(contactsTable.category, "My Client"), ...conditions))
        .orderBy(contactsTable.createdAt);
      const allDeals = await db.select().from(dealsTable);
      const activeDealContactIds = new Set(
        allDeals.filter(d => d.stage !== "Won" && d.stage !== "Lost").map(d => d.contactId)
      );
      const virtualContacts = myClientContacts.filter(c => activeDealContactIds.has(c.id));
      contacts = [...rfuContacts, ...virtualContacts];
    } else if (categoryParam) {
      conditions.push(eq(contactsTable.category, categoryParam));
      contacts = await db.select().from(contactsTable).where(and(...conditions)).orderBy(contactsTable.createdAt);
    } else {
      contacts = conditions.length
        ? await db.select().from(contactsTable).where(and(...conditions)).orderBy(contactsTable.createdAt)
        : await db.select().from(contactsTable).orderBy(contactsTable.createdAt);
    }

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
  // Sales users auto-assign to themselves
  if (user.role === "sales") {
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
          title: "New Lead Assigned",
          message: `Lead: ${contact.name}\nCompany: ${contact.companyName || "-"}\nAssigned By: ${user.name}\nDate & Time: ${assignmentTime}`,
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
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
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
    const accessibleUnits = getAccessibleUnits(user);
    if (accessibleUnits && !accessibleUnits.includes(contact.unit)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await withOwner(contact));
  } catch (err) {
    req.log.error({ err }, "Get contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get comment history for a contact
router.get("/contacts/:id/comments", async (req, res) => {
  const parsed = GetContactParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const history = await db
      .select({
        id: commentHistoryTable.id,
        contactId: commentHistoryTable.contactId,
        comment: commentHistoryTable.comment,
        updatedBy: commentHistoryTable.updatedBy,
        updatedAt: commentHistoryTable.updatedAt,
        updatedByName: usersTable.name,
      })
      .from(commentHistoryTable)
      .leftJoin(usersTable, eq(usersTable.id, commentHistoryTable.updatedBy))
      .where(eq(commentHistoryTable.contactId, parsed.data.id))
      .orderBy(desc(commentHistoryTable.updatedAt));
    res.json(history);
  } catch (err) {
    req.log.error({ err }, "Get comment history error");
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
    // Sales cannot change owner
    if (user.role === "sales") {
      delete parsed.data.salesOwnerId;
    }

    // Handle customer comments separately with history tracking
    const { customerComments, ...restUpdate } = parsed.data;
    const updatePayload = { ...restUpdate } as Record<string, any>;

    if (customerComments !== undefined) {
      const now = new Date();
      updatePayload.customerComments = customerComments;
      updatePayload.commentUpdatedAt = now;
      updatePayload.commentUpdatedBy = user.id;

      // Save history entry for every comment change
      if (customerComments !== oldContact.customerComments) {
        await db.insert(commentHistoryTable).values({
          contactId: params.data.id,
          comment: customerComments || "",
          updatedBy: user.id,
          updatedAt: new Date(),
        });
      }
    }

    // Validate category BEFORE any DB write (prevents silent corruption)
    const newCategory = parsed.data.category;
    if (newCategory !== undefined && newCategory !== oldContact.category) {
      const VALID_CATEGORIES = ["Regular Follow up", "Category A", "Category B", "Category C", "My Client"];
      if (!VALID_CATEGORIES.includes(newCategory)) {
        res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` });
        return;
      }
      // My Clients is permanent: customers with isMyClient=true can never be moved out
      if (oldContact.isMyClient && newCategory !== "My Client") {
        res.status(400).json({ error: "Cannot move a customer with isMyClient=true out of My Clients. My Clients is permanent." });
        return;
      }
      // Block manual assignment to "My Client" (only allowed via deal WON flow)
      if (newCategory === "My Client") {
        const [wonDeal] = await db.select().from(dealsTable).where(
          and(eq(dealsTable.contactId, oldContact.id), eq(dealsTable.stage, "Won"))
        ).limit(1);
        if (!wonDeal) {
          res.status(400).json({ error: "Cannot manually set category to My Client. A deal must be Won first." });
          return;
        }
      }
    }

    const [contact] = await db.update(contactsTable).set(updatePayload).where(eq(contactsTable.id, params.data.id)).returning();
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
          title: "New Lead Assigned",
          message: `Lead: ${contact.name}\nCompany: ${contact.companyName || "-"}\nAssigned By: ${assignedByName}\nDate & Time: ${assignmentTime}`,
          link: `/leads/${contact.id}`,
          relatedId: contact.id,
          relatedType: "contact",
        });
        // Also notify admin(s) about the assignment
        const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
        for (const admin of admins) {
          if (admin.id !== user.id) {
            await createNotification({
              userId: admin.id,
              type: "enquiry_assigned",
              title: "Lead Assigned",
              message: `Lead "${contact.name}" was assigned to ${owner.name}\nAssigned By: ${assignedByName}\nDate & Time: ${assignmentTime}`,
              link: `/leads/${contact.id}`,
              relatedId: contact.id,
              relatedType: "contact",
            });
          }
        }
      }
    }

    // Record category history (guards already passed above)
    if (newCategory !== undefined && newCategory !== oldContact.category) {
      await db.insert(categoryHistoryTable).values({
        contactId: params.data.id,
        previousCategory: oldContact.category,
        newCategory: newCategory,
        changedBy: user.id,
      });
    }

    // If category changed away from "Regular Follow up", close deals and complete pending follow-ups
    if (newCategory && newCategory !== "Regular Follow up" && oldContact.category === "Regular Follow up") {
      // Auto-close active deals as Lost
      const contactDeals = await db
        .select({ id: dealsTable.id })
        .from(dealsTable)
        .where(and(
          eq(dealsTable.contactId, contact.id),
          eq(dealsTable.stage, "New"),
        ));
      if (contactDeals.length > 0) {
        await db
          .update(dealsTable)
          .set({ stage: "Lost", lostReason: "Lead moved out of pipeline category", updatedAt: new Date() })
          .where(inArray(dealsTable.id, contactDeals.map(d => d.id)));
      }

      // Find and complete pending follow-ups via deal relation
      const [existingDeal] = await db
        .select({ id: dealsTable.id })
        .from(dealsTable)
        .where(eq(dealsTable.contactId, contact.id))
        .limit(1);

      if (existingDeal) {
        const pendingFollowUps = await db
          .select({ id: activitiesTable.id })
          .from(activitiesTable)
          .where(
            and(
              eq(activitiesTable.dealId, existingDeal.id),
              eq(activitiesTable.type, "FollowUp"),
              or(eq(activitiesTable.callStatus, "Pending"), isNull(activitiesTable.callStatus)),
            )
          );

        if (pendingFollowUps.length > 0) {
          const followUpIds = pendingFollowUps.map(f => f.id);
          await db
            .update(activitiesTable)
            .set({ callStatus: "Completed", updatedAt: new Date(), updatedBy: user.id, isEdited: true })
            .where(inArray(activitiesTable.id, followUpIds));

          await db
            .update(notificationsTable)
            .set({ readAt: new Date() })
            .where(
              and(
                inArray(notificationsTable.relatedId, followUpIds),
                eq(notificationsTable.relatedType, "activity"),
                isNull(notificationsTable.readAt),
              )
            );
        }
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

// POST /contacts/:id/mark-lost — Mark a contact's inquiry as Lost
router.post("/contacts/:id/mark-lost", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
    if (!contact) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "sales" && contact.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const { lostReason, otherReason, lostNotes, lostCategory } = req.body as { lostReason?: string; otherReason?: string; lostNotes?: string; lostCategory?: string };
    if (!lostReason) { res.status(400).json({ error: "Lost reason is required" }); return; }

    const now = new Date();

    // Save lost fields on the contact
    await db.update(contactsTable).set({
      lostReason,
      otherReason: otherReason || null,
      lostNotes: lostNotes || null,
      lostDate: now,
    }).where(eq(contactsTable.id, id));

    // Move contact to Category A/B/C based on lostCategory
    // EXCEPTION: My Client is permanent — they stay regardless
    if (!contact.isMyClient && lostCategory) {
      const prevCategory = contact.category;
      const categoryMap: Record<string, string> = {
        A: "Category A",
        B: "Category B",
        C: "Category C",
      };
      const newCategory = categoryMap[lostCategory] || "Category C";

      await db.update(contactsTable).set({ category: newCategory }).where(eq(contactsTable.id, id));

      await db.insert(categoryHistoryTable).values({
        contactId: id,
        previousCategory: prevCategory,
        newCategory,
        changedBy: user.id,
        reason: `Deal Lost - Categorized as ${newCategory}`,
      });
    }

    // Mark all active deals as Lost
    const activeDeals = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(eq(dealsTable.contactId, id), eq(dealsTable.stage, "New")));
    for (const deal of activeDeals) {
      await db.update(dealsTable).set({
        stage: "Lost",
        lostReason,
        otherReason: otherReason || null,
        lostNotes: lostNotes || null,
        updatedAt: now,
        completedAt: now,
      }).where(eq(dealsTable.id, deal.id));
    }

    // Complete pending activities for each affected deal
    for (const deal of activeDeals) {
      await completePendingActivitiesForDeal(db, deal.id, id, "Lost", user.id);
    }

    // Create activity for the mark-lost action
    const [existingDeal] = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(eq(dealsTable.contactId, id))
      .limit(1);

    const displayReason = lostReason === "Other" && otherReason ? `Other - ${otherReason}` : lostReason;
    await db.insert(activitiesTable).values({
      contactId: id,
      dealId: existingDeal?.id || null,
      type: "Note",
      notes: `Lead marked as Lost\n\nLost Reason: ${displayReason}`,
      createdBy: user.id,
    });

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err, message: err?.message, stack: err?.stack }, "Mark lost error");
    res.status(500).json({ success: false, error: err?.message || "Internal server error" });
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
    const [contactToDelete] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));
    if (!contactToDelete) { res.status(404).json({ error: "Not found" }); return; }
    if (user.role === "sales" && contactToDelete.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Notify sales owner and admins about lead deletion
    const deleteTime = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    if (contactToDelete.salesOwnerId && contactToDelete.salesOwnerId !== user.id) {
      await createNotification({
        userId: contactToDelete.salesOwnerId,
        type: "lead_deleted",
        title: "Lead Deleted",
        message: `Lead "${contactToDelete.name}" has been deleted.\nDeleted By: ${user.name}\nDate & Time: ${deleteTime}`,
        link: `/leads`,
        relatedId: contactToDelete.id,
        relatedType: "contact",
      });
    }
    const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
    for (const admin of admins) {
      if (admin.id !== user.id && admin.id !== contactToDelete.salesOwnerId) {
        await createNotification({
          userId: admin.id,
          type: "lead_deleted",
          title: "Lead Deleted",
          message: `Lead "${contactToDelete.name}" (${contactToDelete.companyName || "-"}) was deleted by ${user.name}.\nDate & Time: ${deleteTime}`,
          link: `/leads`,
          relatedId: contactToDelete.id,
          relatedType: "contact",
        });
      }
    }

    await db.delete(contactsTable).where(eq(contactsTable.id, params.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete contact error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get category history for a contact
router.get("/contacts/:id/category-history", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const history = await db
      .select({
        id: categoryHistoryTable.id,
        previousCategory: categoryHistoryTable.previousCategory,
        newCategory: categoryHistoryTable.newCategory,
        changedBy: categoryHistoryTable.changedBy,
        changedByName: usersTable.name,
        reason: categoryHistoryTable.reason,
        createdAt: categoryHistoryTable.createdAt,
      })
      .from(categoryHistoryTable)
      .leftJoin(usersTable, eq(usersTable.id, categoryHistoryTable.changedBy))
      .where(eq(categoryHistoryTable.contactId, id))
      .orderBy(desc(categoryHistoryTable.createdAt));
    res.json(history);
  } catch (err) {
    req.log.error({ err }, "Get category history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get combined activity timeline for a contact
router.get("/contacts/:id/timeline", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
    if (!contact) { res.status(404).json({ error: "Not found" }); return; }

    const timeline: any[] = [];

    // 1. Lead created event
    timeline.push({
      type: "lead_created",
      description: "Lead Created",
      user: null,
      createdAt: contact.createdAt,
    });

    // 2. Activity events
    const acts = await db
      .select({
        id: activitiesTable.id,
        type: activitiesTable.type,
        notes: activitiesTable.notes,
        followUpDate: activitiesTable.followUpDate,
        callStatus: activitiesTable.callStatus,
        createdBy: activitiesTable.createdBy,
        createdByName: usersTable.name,
        createdAt: activitiesTable.createdAt,
        updatedAt: activitiesTable.updatedAt,
        isEdited: activitiesTable.isEdited,
      })
      .from(activitiesTable)
      .leftJoin(usersTable, eq(usersTable.id, activitiesTable.createdBy!))
      .where(eq(activitiesTable.contactId, id))
      .orderBy(activitiesTable.createdAt);
    for (const a of acts) {
      timeline.push({
        type: a.type === "FollowUp" ? "follow_up" : a.type === "Call" ? "call" : a.type === "WhatsApp" ? "whatsapp" : a.type === "Email" ? "email" : a.type === "Note" ? "note" : "activity",
        description: a.type === "FollowUp" ? "Follow-up Scheduled" : `${a.type} Logged`,
        notes: a.notes,
        followUpDate: a.followUpDate,
        callStatus: a.callStatus,
        user: a.createdByName ? { name: a.createdByName } : null,
        isEdited: a.isEdited,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      });
    }

    // 3. Category history events
    const catHistory = await db
      .select({
        id: categoryHistoryTable.id,
        previousCategory: categoryHistoryTable.previousCategory,
        newCategory: categoryHistoryTable.newCategory,
        changedBy: categoryHistoryTable.changedBy,
        changedByName: usersTable.name,
        createdAt: categoryHistoryTable.createdAt,
      })
      .from(categoryHistoryTable)
      .leftJoin(usersTable, eq(usersTable.id, categoryHistoryTable.changedBy))
      .where(eq(categoryHistoryTable.contactId, id))
      .orderBy(desc(categoryHistoryTable.createdAt));
    // Reverse to add in chronological order
    for (const c of catHistory.reverse()) {
      timeline.push({
        type: "category_change",
        description: `Category changed from "${c.previousCategory || '(none)'}" to "${c.newCategory}"`,
        user: c.changedByName ? { name: c.changedByName } : null,
        createdAt: c.createdAt,
      });
    }

    // 4. Comment history events
    const commentHist = await db
      .select({
        id: commentHistoryTable.id,
        comment: commentHistoryTable.comment,
        updatedBy: commentHistoryTable.updatedBy,
        updatedByName: usersTable.name,
        updatedAt: commentHistoryTable.updatedAt,
      })
      .from(commentHistoryTable)
      .leftJoin(usersTable, eq(usersTable.id, commentHistoryTable.updatedBy))
      .where(eq(commentHistoryTable.contactId, id))
      .orderBy(desc(commentHistoryTable.updatedAt));
    // Reverse to add in chronological order
    for (const h of commentHist.reverse()) {
      timeline.push({
        type: "comment_updated",
        description: "Customer Comments Updated",
        user: h.updatedByName ? { name: h.updatedByName } : null,
        createdAt: h.updatedAt,
      });
    }

    // 5. Deal events
    const contactDeals = await db
      .select({
        id: dealsTable.id,
        title: dealsTable.title,
        stage: dealsTable.stage,
        totalValue: dealsTable.totalValue,
        probability: dealsTable.probability,
        createdAt: dealsTable.createdAt,
        updatedAt: dealsTable.updatedAt,
      })
      .from(dealsTable)
      .where(eq(dealsTable.contactId, id));
    for (const d of contactDeals) {
      timeline.push({
        type: "deal_created",
        description: `Deal Created${d.title ? `: ${d.title}` : ""}`,
        dealStage: d.stage,
        dealValue: d.totalValue,
        createdAt: d.createdAt,
      });
      if (d.updatedAt && d.updatedAt !== d.createdAt) {
        timeline.push({
          type: "deal_updated",
          description: `Deal Stage: ${d.stage}`,
          dealStage: d.stage,
          dealValue: d.totalValue,
          createdAt: d.updatedAt,
        });
      }
    }

    // 6. Document events
    const contactDocs = await db
      .select({
        id: documentsTable.id,
        name: documentsTable.name,
        documentType: documentsTable.documentType,
        version: documentsTable.version,
        uploadedBy: documentsTable.uploadedBy,
        createdAt: documentsTable.createdAt,
        updatedAt: documentsTable.updatedAt,
      })
      .from(documentsTable)
      .where(and(eq(documentsTable.contactId, id), eq(documentsTable.isDeleted, false)));
    for (const d of contactDocs) {
      timeline.push({
        type: "document_uploaded",
        description: `${d.documentType} Uploaded: ${d.name}`,
        user: null,
        createdAt: d.createdAt,
      });
      if (d.version > 1 && d.updatedAt && d.updatedAt !== d.createdAt) {
        timeline.push({
          type: "document_replaced",
          description: `${d.documentType} Replaced: ${d.name} (v${d.version})`,
          user: null,
          createdAt: d.updatedAt,
        });
      }
    }

    // Sort by createdAt DESC (newest first)
    timeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(timeline);
  } catch (err) {
    req.log.error({ err }, "Get timeline error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get notification history for a contact
router.get("/contacts/:id/notifications", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const notifications = await db
      .select({
        id: notificationsTable.id,
        type: notificationsTable.type,
        title: notificationsTable.title,
        message: notificationsTable.message,
        readAt: notificationsTable.readAt,
        createdAt: notificationsTable.createdAt,
      })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.relatedId, id),
        eq(notificationsTable.relatedType, "contact"),
      ))
      .orderBy(desc(notificationsTable.createdAt));
    res.json(notifications);
  } catch (err) {
    req.log.error({ err }, "Get notification history error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /contacts/search/mobile — search contact by mobile number
router.get("/contacts/search/mobile", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { mobile } = req.query as Record<string, string | undefined>;
    if (!mobile) {
      res.status(400).json({ error: "Mobile number is required" });
      return;
    }

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(or(eq(contactsTable.mobile, mobile), eq(contactsTable.otherPhone, mobile)))
      .limit(1);

    if (!contact) {
      res.status(404).json({ error: "No contact found with that mobile number" });
      return;
    }

    const result = await withOwner(contact);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Search contact by mobile error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /contacts/:id/proforma-invoices — list proforma invoices linked to a contact
router.get("/contacts/:id/proforma-invoices", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid contact ID" }); return; }

    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(
        eq(proformaInvoicesTable.contactId, id),
        eq(proformaInvoicesTable.isDeleted, false),
      ))
      .orderBy(desc(proformaInvoicesTable.createdAt));

    const enriched = await Promise.all(invoices.map(async (inv) => {
      const items = await db
        .select()
        .from(proformaInvoiceItemsTable)
        .where(eq(proformaInvoiceItemsTable.invoiceId, inv.id));
      return {
        ...inv,
        taxableAmount: Number(inv.taxableAmount),
        freight: Number(inv.freight),
        cgst: Number(inv.cgst),
        sgst: Number(inv.sgst),
        igst: Number(inv.igst),
        cgstPercent: Number(inv.cgstPercent || 0),
        sgstPercent: Number(inv.sgstPercent || 0),
        igstPercent: Number(inv.igstPercent || 0),
        grandTotal: Number(inv.grandTotal),
        items: items.map((i) => ({
          ...i,
          quantity: Number(i.quantity),
          rate: Number(i.rate),
          discount: Number(i.discount || 0),
          discountPercent: Number(i.discountPercent || 0),
          gstPercent: Number(i.gstPercent || 0),
          amount: Number(i.amount),
        })),
      };
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "List contact proforma invoices error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
