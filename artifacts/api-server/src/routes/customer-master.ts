import { Router, type IRouter } from "express";
import { db, customerMasterTable, proformaInvoicesTable, contactCompaniesLinkTable, contactsTable } from "@workspace/db";
import { eq, desc, and, sql, or } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { lookupGstinFromProviders } from "./gst";

const router: IRouter = Router();

// ── M:N Contact ↔ Company/GST linking ──
// `contact_companies_link` maps contactId → customer_master.id (junction table).
// A customer_master row is the single source of truth for a company's GST data;
// linking it to another contact (e.g. Person B working at the same company) only
// adds a junction row — the company's GST record is never duplicated.

// Lookup customer by GSTIN — used for auto-fill on the form
router.post("/customer-master/lookup-by-gstin", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { gstin } = req.body;
    if (!gstin || typeof gstin !== "string") {
      res.status(400).json({ error: "GSTIN is required" });
      return;
    }

    const [customer] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.gstin, gstin.toUpperCase().trim()), eq(customerMasterTable.isDeleted, false)));

    if (!customer) {
      res.json({ found: false, error: "Customer not found" });
      return;
    }

    res.json({ found: true, ...customer });
  } catch (err) {
    req.log.error({ err }, "Customer master lookup error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// POST /customer-master/:id/refresh-gst — fetch fresh GST data from providers and update the record
router.post("/customer-master/:id/refresh-gst", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.id, id), eq(customerMasterTable.isDeleted, false)));

    if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }

    if (!existing.gstin) {
      res.status(400).json({ error: "No GSTIN on record — cannot refresh GST data" });
      return;
    }

    const gstData = await lookupGstinFromProviders(existing.gstin, req);
    if (!gstData) {
      res.status(404).json({ error: "Could not fetch fresh GST data. Please try again later." });
      return;
    }

    const updates: Record<string, any> = {};
    const changes: Record<string, { old: string | null; new: string | null }> = {};

    const fields: [string, string | null][] = [
      ["companyName", gstData.tradeName || gstData.legalName || null],
      ["tradeName", gstData.tradeName || null],
      ["addressLine1", gstData.addressLine1 || null],
      ["addressLine2", gstData.addressLine2 || null],
      ["addressLine3", gstData.addressLine3 || null],
      ["city", gstData.city || null],
      ["district", gstData.district || null],
      ["state", gstData.state || null],
      ["pincode", gstData.pincode || null],
      ["gstStatus", gstData.registrationStatus || gstData.status || null],
      ["businessConstitution", gstData.businessConstitution || null],
    ];

    for (const [field, freshVal] of fields) {
      const oldVal = (existing as any)[field] as string | null;
      const trimmed = freshVal?.trim() || null;
      if (trimmed && trimmed !== oldVal) {
        (updates as any)[field] = trimmed;
        changes[field] = { old: oldVal, new: trimmed };
      }
    }

    if (Object.keys(updates).length === 0) {
      res.json({ success: true, updated: false, message: "Customer data is already up to date", customer: existing, changes: {} });
      return;
    }

    await db
      .update(customerMasterTable)
      .set(updates)
      .where(eq(customerMasterTable.id, id));

    const [updated] = await db
      .select()
      .from(customerMasterTable)
      .where(eq(customerMasterTable.id, id));

    res.json({ success: true, updated: true, customer: updated, changes });
  } catch (err) {
    req.log.error({ err }, "Customer GST refresh error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Create customer master
// POST /customer-master — Find-or-Create (Upsert) customer/GST profile.
//  1. Look up an existing profile by GSTIN FIRST — INCLUDING soft-deleted rows. The
//     `gstin` UNIQUE constraint still reserves the value after a soft-delete, so a blind
//     INSERT would throw a 23505 unique violation → 500. If found, REUSE the companyId
//     (reviving + refreshing the row if it was soft-deleted) instead of inserting.
//  2. If no GSTIN match exists, INSERT a new profile and use its id.
//  3. Link the current contact to the resolved companyId in the junction table
//     (contact_companies_link) with ON CONFLICT DO NOTHING — no duplicate links.
//  4. All of the above runs in a single DB transaction; failures return a clean JSON 400
//     with the error message instead of crashing the server.
router.post("/customer-master", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { companyName, tradeName, contactPerson, gstin, addressLine1, addressLine2, addressLine3, city, district, state, pincode, mobile, email, customerType, gstStatus, businessConstitution, notes, linkedContactId, idProofType, idProofNumber } = req.body;

    if (!companyName && !mobile) {
      res.status(400).json({ error: "Company name or mobile number is required" });
      return;
    }

    const normalizedGstin = gstin ? gstin.toUpperCase().trim() : null;
    const normalizedMobile = mobile ? mobile.replace(/\s/g, "").trim() : null;
    const normalizedIdProofNumber = idProofNumber ? idProofNumber.toUpperCase().trim() : null;

    // Duplicate pre-check for profiles WITHOUT a GSTIN. Unregistered profiles are keyed by
    // their ID proof number (PAN/Aadhaar are unique per person); only fall back to the mobile
    // duplicate check when no ID proof was provided. A 409 → the client adopts the existing
    // profile instead of creating a duplicate.
    if (!normalizedGstin) {
      if (idProofType && normalizedIdProofNumber) {
        const [existing] = await db
          .select()
          .from(customerMasterTable)
          .where(and(eq(customerMasterTable.idProofNumber, normalizedIdProofNumber), eq(customerMasterTable.isDeleted, false)));
        if (existing) {
          res.status(409).json({ error: "Customer with this ID proof already exists", existing });
          return;
        }
      } else if (normalizedMobile) {
        const [existing] = await db
          .select()
          .from(customerMasterTable)
          .where(and(eq(customerMasterTable.mobile, normalizedMobile), eq(customerMasterTable.isDeleted, false)));
        if (existing) {
          res.status(409).json({ error: "Customer with this mobile number already exists", existing });
          return;
        }
      }
    }

    const values = {
      companyName: companyName || "",
      tradeName: tradeName || null,
      contactPerson: contactPerson || null,
      gstin: normalizedGstin,
      idProofType: normalizedGstin ? null : (idProofType || null),
      idProofNumber: normalizedGstin ? null : normalizedIdProofNumber,
      addressLine1: addressLine1 || null,
      addressLine2: addressLine2 || null,
      addressLine3: addressLine3 || null,
      city: city || null,
      district: district || null,
      state: state || null,
      pincode: pincode || null,
      mobile: normalizedMobile,
      email: email || null,
      customerType: customerType || (normalizedGstin ? "GST" : "Unregistered"),
      gstStatus: gstStatus || (normalizedGstin ? "Active" : null),
      businessConstitution: businessConstitution || null,
      notes: notes || null,
      linkedContactId: linkedContactId ? Number(linkedContactId) || null : null,
    };

    const result = await db.transaction(async (tx) => {
      let companyId: number | null = null;
      let created = false;

      // 1. Find-or-create by GSTIN (search includes soft-deleted rows so the UNIQUE
      //    constraint on gstin can't reject the re-registration).
      if (normalizedGstin) {
        const [found] = await tx
          .select()
          .from(customerMasterTable)
          .where(eq(customerMasterTable.gstin, normalizedGstin))
          .limit(1);
        if (found) {
          companyId = found.id;
          if (found.isDeleted) {
            // Revive the soft-deleted profile and refresh its data — no new row, no 23505.
            await tx
              .update(customerMasterTable)
              .set({ ...values, isDeleted: false, deletedAt: null, deletedBy: null })
              .where(eq(customerMasterTable.id, found.id));
          }
        }
      }

      // 2. No existing profile with this GSTIN → insert a new one.
      if (companyId === null) {
        const [inserted] = await tx
          .insert(customerMasterTable)
          .values({ ...values, createdBy: user.id })
          .returning();
        companyId = inserted.id;
        created = true;
      }

      // 3. Link to the current contact (M:N junction) — idempotent, no duplicate links.
      const cid = linkedContactId ? Number(linkedContactId) : null;
      if (companyId !== null && cid && !isNaN(cid) && cid > 0) {
        await tx
          .insert(contactCompaniesLinkTable)
          .values({ contactId: cid, companyId, createdBy: user.id })
          .onConflictDoNothing();
      }

      const [profile] = await tx
        .select()
        .from(customerMasterTable)
        .where(eq(customerMasterTable.id, companyId));
      return { profile, created };
    });

    res.status(result.created ? 201 : 200).json(result.profile);
  } catch (err: any) {
    req.log.error({ err }, "Create customer master error");
    // Unique violation (concurrent find-or-create race on gstin) → surface a clean,
    // retryable error instead of crashing with a 500.
    res.status(err?.code === "23505" ? 409 : 400).json({ error: err?.message || "Failed to save customer" });
  }
});

// Update existing customer master
router.patch("/customer-master/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.id, id), eq(customerMasterTable.isDeleted, false)));

    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const { companyName, tradeName, contactPerson, gstin, addressLine1, addressLine2, addressLine3, city, district, state, pincode, mobile, email, customerType, gstStatus, businessConstitution, notes, linkedContactId, idProofType, idProofNumber } = req.body;

    const updateData: any = {};
    if (companyName !== undefined) updateData.companyName = companyName;
    if (tradeName !== undefined) updateData.tradeName = tradeName;
    if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
    if (gstin !== undefined) updateData.gstin = gstin ? gstin.toUpperCase().trim() : null;
    if (idProofType !== undefined) updateData.idProofType = idProofType;
    if (idProofNumber !== undefined) updateData.idProofNumber = idProofNumber ? idProofNumber.toUpperCase().trim() : null;
    if (addressLine1 !== undefined) updateData.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2;
    if (addressLine3 !== undefined) updateData.addressLine3 = addressLine3;
    if (city !== undefined) updateData.city = city;
    if (district !== undefined) updateData.district = district;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (mobile !== undefined) updateData.mobile = mobile;
    if (email !== undefined) updateData.email = email;
    if (customerType !== undefined) updateData.customerType = customerType;
    if (gstStatus !== undefined) updateData.gstStatus = gstStatus;
    if (businessConstitution !== undefined) updateData.businessConstitution = businessConstitution;
    if (notes !== undefined) updateData.notes = notes;
    if (linkedContactId !== undefined) updateData.linkedContactId = linkedContactId ? Number(linkedContactId) || null : null;

    await db
      .update(customerMasterTable)
      .set(updateData)
      .where(eq(customerMasterTable.id, id));

    // Keep the M:N junction in sync when a primary contact is (un)linked.
    if (linkedContactId !== undefined) {
      const cid = Number(linkedContactId);
      if (!isNaN(cid) && cid > 0) {
        await db
          .insert(contactCompaniesLinkTable)
          .values({ contactId: cid, companyId: id, createdBy: user.id })
          .onConflictDoNothing();
      }
    }

    const [updated] = await db
      .select()
      .from(customerMasterTable)
      .where(eq(customerMasterTable.id, id));

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update customer master error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// List customer master with search
router.get("/customer-master", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { search } = req.query as Record<string, string | undefined>;

    let customers;
    if (search) {
      const s = `%${search.toLowerCase()}%`;
      customers = await db
        .select()
        .from(customerMasterTable)
        .where(and(
          eq(customerMasterTable.isDeleted, false),
          or(
            sql`LOWER(${customerMasterTable.companyName}) LIKE ${s}`,
            sql`LOWER(${customerMasterTable.gstin}) LIKE ${s}`,
            sql`LOWER(${customerMasterTable.mobile}) LIKE ${s}`,
            sql`LOWER(${customerMasterTable.city}) LIKE ${s}`,
            sql`LOWER(${customerMasterTable.tradeName}) LIKE ${s}`,
          )
        ))
        .orderBy(desc(customerMasterTable.createdAt))
        .limit(50);
    } else {
      customers = await db
        .select()
        .from(customerMasterTable)
        .where(eq(customerMasterTable.isDeleted, false))
        .orderBy(desc(customerMasterTable.createdAt))
        .limit(50);
    }

    res.json(customers);
  } catch (err) {
    req.log.error({ err }, "List customer master error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET /customer-master/lookup?mobile=... — return ALL GST profiles for a mobile number
// (canonical mobile lookup; returns an ARRAY like search-by-mobile).
// Must be registered before "/customer-master/:id" so it isn't swallowed by the param route.
router.get("/customer-master/lookup", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const mobile = String(req.query.mobile || "").replace(/\s/g, "");
    if (!mobile || mobile.length < 10) {
      res.status(400).json({ error: "Valid mobile number required (min 10 digits)" });
      return;
    }

    // Search by direct mobile match, by linked contact's mobile/otherPhone,
    // AND by M:N junction links (contact_companies_link → contact with this mobile).
    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(
        eq(customerMasterTable.isDeleted, false),
        or(
          eq(customerMasterTable.mobile, mobile),
          sql`${customerMasterTable.linkedContactId} IN (
            SELECT id FROM contacts WHERE mobile = ${mobile} OR other_phone = ${mobile}
          )`,
          sql`${customerMasterTable.id} IN (
            SELECT ccl.company_id FROM contact_companies_link ccl
            JOIN contacts c ON c.id = ccl.contact_id
            WHERE c.mobile = ${mobile} OR c.other_phone = ${mobile}
          )`
        )
      ))
      .orderBy(desc(customerMasterTable.createdAt));

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Customer master mobile lookup error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get single customer master
router.get("/customer-master/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [customer] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.id, id), eq(customerMasterTable.isDeleted, false)));

    if (!customer) { res.status(404).json({ error: "Not found" }); return; }

    res.json(customer);
  } catch (err) {
    req.log.error({ err }, "Get customer master error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get proforma history for a customer
router.get("/customer-master/:id/proforma-history", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [customer] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.id, id), eq(customerMasterTable.isDeleted, false)));

    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

    const invoices = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(
        eq(proformaInvoicesTable.customerMasterId, id),
        eq(proformaInvoicesTable.isDeleted, false),
      ))
      .orderBy(desc(proformaInvoicesTable.createdAt));

    const totalProformas = invoices.length;
    const lastProforma = invoices.length > 0 ? invoices[0] : null;

    res.json({
      totalProformas,
      lastProformaDate: lastProforma ? lastProforma.createdAt : null,
      lastInvoiceNumber: lastProforma ? lastProforma.invoiceNumber : null,
      invoices,
    });
  } catch (err) {
    req.log.error({ err }, "Customer proforma history error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET /customer-master/by-contact/:contactId — return all GST profiles linked to a contact
// Includes: M:N junction links (contact_companies_link), legacy linkedContactId, and
// profiles whose stored mobile matches the contact's mobile/otherPhone.
router.get("/customer-master/by-contact/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contact ID" }); return; }

    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(
        eq(customerMasterTable.isDeleted, false),
        or(
          sql`${customerMasterTable.id} IN (
            SELECT company_id FROM contact_companies_link WHERE contact_id = ${contactId}
          )`,
          eq(customerMasterTable.linkedContactId, contactId),
          sql`${customerMasterTable.mobile} IN (
            SELECT mobile FROM contacts WHERE id = ${contactId}
            UNION
            SELECT other_phone FROM contacts WHERE id = ${contactId} AND other_phone IS NOT NULL
          )`
        )
      ))
      .orderBy(desc(customerMasterTable.createdAt));

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Get customer master by contact error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET /customer-master/search-by-mobile/:mobile — search GST profiles by mobile number
// Searches customer_master.mobile AND customer_master.linkedContactId → contact mobile/otherPhone
router.get("/customer-master/search-by-mobile/:mobile", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const mobile = req.params.mobile?.replace(/\s/g, "");
    if (!mobile || mobile.length < 10) {
      res.status(400).json({ error: "Valid mobile number required (min 10 digits)" });
      return;
    }

    // Search by direct mobile match, by linked contact's mobile/otherPhone,
    // AND by M:N junction links (contact_companies_link → contact with this mobile).
    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(
        eq(customerMasterTable.isDeleted, false),
        or(
          eq(customerMasterTable.mobile, mobile),
          sql`${customerMasterTable.linkedContactId} IN (
            SELECT id FROM contacts WHERE mobile = ${mobile} OR other_phone = ${mobile}
          )`,
          sql`${customerMasterTable.id} IN (
            SELECT ccl.company_id FROM contact_companies_link ccl
            JOIN contacts c ON c.id = ccl.contact_id
            WHERE c.mobile = ${mobile} OR c.other_phone = ${mobile}
          )`
        )
      ))
      .orderBy(desc(customerMasterTable.createdAt));

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Search customer master by mobile error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET /customer-master/search-by-name/:name — search customer master by party name or trade name
router.get("/customer-master/search-by-name/:name", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const name = req.params.name?.trim();
    if (!name || name.length < 2) {
      res.status(400).json({ error: "Search term required (min 2 characters)" });
      return;
    }

    const s = `%${name.toLowerCase()}%`;
    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(
        eq(customerMasterTable.isDeleted, false),
        or(
          sql`LOWER(${customerMasterTable.companyName}) LIKE ${s}`,
          sql`LOWER(${customerMasterTable.tradeName}) LIKE ${s}`,
        )
      ))
      .orderBy(desc(customerMasterTable.createdAt))
      .limit(20);

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Search customer master by name error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Soft-delete customer master profile (profiles are referenced by proforma_invoices
// and voice_notes, so we never hard-delete — historical invoices keep their link).
router.delete("/customer-master/:id", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.id, id), eq(customerMasterTable.isDeleted, false)));

    if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }

    await db
      .update(customerMasterTable)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: user.id })
      .where(eq(customerMasterTable.id, id));

    res.json({ success: true, id });
  } catch (err) {
    req.log.error({ err }, "Delete customer master error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// POST /customer-master/:id/link-contact — attach an EXISTING Company/GST profile to a
// contact (M:N). This is the "Attach Existing Company/GST" operation: Person B can be
// linked to 'Company X' without retyping or duplicating the GST record.
// Idempotent — (contact_id, company_id) is unique, so re-linking is a no-op.
router.post("/customer-master/:id/link-contact", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid customer id" }); return; }

    const { contactId } = req.body as { contactId?: number | string };
    const cid = Number(contactId);
    if (!contactId || isNaN(cid)) {
      res.status(400).json({ error: "contactId is required" });
      return;
    }

    const [customer] = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.id, id), eq(customerMasterTable.isDeleted, false)));
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(eq(contactsTable.id, cid));
    if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }

    await db
      .insert(contactCompaniesLinkTable)
      .values({ contactId: contact.id, companyId: id, createdBy: user.id })
      .onConflictDoNothing();

    res.json({ success: true, customerId: id, contactId: contact.id });
  } catch (err) {
    req.log.error({ err }, "Link customer to contact error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// DELETE /customer-master/:id/link-contact/:contactId — remove an M:N link.
// (Removing the link does NOT delete the shared Company/GST profile.)
router.delete("/customer-master/:id/link-contact/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    const contactId = Number(req.params.contactId);
    if (isNaN(id) || isNaN(contactId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    await db
      .delete(contactCompaniesLinkTable)
      .where(and(
        eq(contactCompaniesLinkTable.companyId, id),
        eq(contactCompaniesLinkTable.contactId, contactId),
      ));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Unlink customer from contact error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
