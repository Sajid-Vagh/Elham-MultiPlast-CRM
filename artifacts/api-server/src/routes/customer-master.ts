import { Router, type IRouter } from "express";
import { db, customerMasterTable, proformaInvoicesTable } from "@workspace/db";
import { eq, desc, and, sql, or } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { lookupGstinFromProviders } from "./gst";

const router: IRouter = Router();

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
      ["companyName", gstData.legalName || gstData.tradeName || null],
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
router.post("/customer-master", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { companyName, tradeName, contactPerson, gstin, addressLine1, addressLine2, addressLine3, city, district, state, pincode, mobile, email, customerType, gstStatus, businessConstitution, notes } = req.body;

    if (!companyName && !mobile) {
      res.status(400).json({ error: "Company name or mobile number is required" });
      return;
    }

    const normalizedGstin = gstin ? gstin.toUpperCase().trim() : null;
    const normalizedMobile = mobile ? mobile.replace(/\s/g, "").trim() : null;

    // Duplicate check: by GSTIN if provided, else by mobile (deleted profiles don't block re-creation)
    let existing = null;
    if (normalizedGstin) {
      const [found] = await db
        .select()
        .from(customerMasterTable)
        .where(and(eq(customerMasterTable.gstin, normalizedGstin), eq(customerMasterTable.isDeleted, false)));
      existing = found;
    } else if (normalizedMobile) {
      const [found] = await db
        .select()
        .from(customerMasterTable)
        .where(and(eq(customerMasterTable.mobile, normalizedMobile), eq(customerMasterTable.isDeleted, false)));
      existing = found;
    }

    if (existing) {
      res.status(409).json({ error: normalizedGstin ? "GSTIN already exists" : "Customer with this mobile number already exists", existing });
      return;
    }

    const [customer] = await db
      .insert(customerMasterTable)
      .values({
        companyName: companyName || "",
        tradeName: tradeName || null,
        contactPerson: contactPerson || null,
        gstin: normalizedGstin,
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
        createdBy: user.id,
      })
      .returning();

    res.status(201).json(customer);
  } catch (err) {
    req.log.error({ err }, "Create customer master error");
    res.status(500).json({ success: false, error: "Internal Server Error" });
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

    const { companyName, tradeName, contactPerson, gstin, addressLine1, addressLine2, addressLine3, city, district, state, pincode, mobile, email, customerType, gstStatus, businessConstitution, notes } = req.body;

    const updateData: any = {};
    if (companyName !== undefined) updateData.companyName = companyName;
    if (tradeName !== undefined) updateData.tradeName = tradeName;
    if (contactPerson !== undefined) updateData.contactPerson = contactPerson;
    if (gstin !== undefined) updateData.gstin = gstin ? gstin.toUpperCase().trim() : null;
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

    await db
      .update(customerMasterTable)
      .set(updateData)
      .where(eq(customerMasterTable.id, id));

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

    // Search by direct mobile match AND by linked contact's mobile/otherPhone
    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(
        eq(customerMasterTable.isDeleted, false),
        or(
          eq(customerMasterTable.mobile, mobile),
          sql`${customerMasterTable.linkedContactId} IN (
            SELECT id FROM contacts WHERE mobile = ${mobile} OR other_phone = ${mobile}
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
router.get("/customer-master/by-contact/:contactId", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const contactId = Number(req.params.contactId);
    if (isNaN(contactId)) { res.status(400).json({ error: "Invalid contact ID" }); return; }

    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(eq(customerMasterTable.linkedContactId, contactId), eq(customerMasterTable.isDeleted, false)))
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

    // Search by direct mobile match AND by linked contact's mobile/otherPhone
    const profiles = await db
      .select()
      .from(customerMasterTable)
      .where(and(
        eq(customerMasterTable.isDeleted, false),
        or(
          eq(customerMasterTable.mobile, mobile),
          sql`${customerMasterTable.linkedContactId} IN (
            SELECT id FROM contacts WHERE mobile = ${mobile} OR other_phone = ${mobile}
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

export default router;
