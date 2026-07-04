import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, documentsTable, documentVersionsTable, contactsTable, usersTable, activitiesTable } from "@workspace/db";
import { eq, and, desc, like, or, SQL, sql } from "drizzle-orm";
import { getUserFromRequest } from "./auth";
import { storage } from "../lib/storage";
import path from "node:path";
import fs from "node:fs";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Upload single document
router.post("/documents/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }

    const contactId = Number(req.body.contactId);
    const dealId = req.body.dealId ? Number(req.body.dealId) : null;
    const proformaInvoiceId = req.body.proformaInvoiceId ? Number(req.body.proformaInvoiceId) : null;
    const documentType = req.body.documentType || "Other";
    const category = req.body.category || "Customer Documents";
    const docName = req.body.name || file.originalname;

    if (!contactId) { res.status(400).json({ error: "contactId is required" }); return; }

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
    if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
    if (user.role === "sales" && contact.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Not your customer" }); return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const storagePath = await storage.save(file.originalname, file.buffer, "documents");

    const [doc] = await db.insert(documentsTable).values({
      contactId,
      dealId,
      proformaInvoiceId,
      name: docName,
      originalName: file.originalname,
      documentType,
      category,
      mimeType: file.mimetype,
      fileExtension: ext,
      fileSize: String(file.size),
      storagePath,
      storageProvider: "local",
      version: 1,
      uploadedBy: user.id,
    }).returning();

    // Record version
    await db.insert(documentVersionsTable).values({
      documentId: doc.id,
      version: 1,
      originalName: file.originalname,
      fileSize: String(file.size),
      mimeType: file.mimetype,
      storagePath,
      uploadedBy: user.id,
      action: "upload",
    });

    // Create activity entry
    await db.insert(activitiesTable).values({
      contactId,
      type: "Note",
      notes: `${documentType} Uploaded: ${docName}`,
      createdBy: user.id,
    });

    res.json(doc);
  } catch (err) {
    console.error("[Document Upload Error]", err);
    req.log.error({ err }, "Document upload error");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// Upload multiple documents
router.post("/documents/upload-multiple", upload.array("files", 20), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: "No files provided" }); return; }

    const contactId = Number(req.body.contactId);
    const dealId = req.body.dealId ? Number(req.body.dealId) : null;
    const proformaInvoiceId = req.body.proformaInvoiceId ? Number(req.body.proformaInvoiceId) : null;
    const documentType = req.body.documentType || "Other";
    const category = req.body.category || "Customer Documents";

    if (!contactId) { res.status(400).json({ error: "contactId is required" }); return; }

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
    if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
    if (user.role === "sales" && contact.salesOwnerId !== user.id) {
      res.status(403).json({ error: "Not your customer" }); return;
    }

    const results: any[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const storagePath = await storage.save(file.originalname, file.buffer, "documents");
      const docName = file.originalname;

      const [doc] = await db.insert(documentsTable).values({
        contactId, dealId, proformaInvoiceId,
        name: docName,
        originalName: file.originalname,
        documentType, category,
        mimeType: file.mimetype, fileExtension: ext,
        fileSize: String(file.size), storagePath,
        version: 1, uploadedBy: user.id,
      }).returning();

      await db.insert(documentVersionsTable).values({
        documentId: doc.id, version: 1,
        originalName: file.originalname,
        fileSize: String(file.size), mimeType: file.mimetype,
        storagePath, uploadedBy: user.id, action: "upload",
      });

      results.push(doc);
    }

    await db.insert(activitiesTable).values({
      contactId, type: "Note",
      notes: `${results.length} document(s) uploaded`,
      createdBy: user.id,
    });

    res.json(results);
  } catch (err) {
    console.error("[Document Multiple Upload Error]", err);
    req.log.error({ err }, "Multiple upload error");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

// List documents
router.get("/documents", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { contactId, dealId, search, documentType, category, ownerId, page, pageSize } = req.query as Record<string, string | undefined>;
    const conditions: SQL[] = [eq(documentsTable.isDeleted, false)];

    if (user.role === "sales") {
      const contacts = await db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.salesOwnerId, user.id));
      const contactIds = contacts.map(c => c.id);
      if (contactIds.length === 0) { res.json({ data: [], total: 0 }); return; }
      conditions.push(sql`${documentsTable.contactId} = ANY(${contactIds}::int[])`);
    }

    if (contactId) conditions.push(eq(documentsTable.contactId, Number(contactId)));
    if (dealId) conditions.push(eq(documentsTable.dealId, Number(dealId)));
    if (documentType) conditions.push(eq(documentsTable.documentType, documentType));
    if (category) conditions.push(eq(documentsTable.category, category));
    if (ownerId) conditions.push(eq(documentsTable.uploadedBy, Number(ownerId)));

    if (search) {
      const s = `%${search}%`;
      conditions.push(or(
        like(documentsTable.name, s),
        like(documentsTable.originalName, s),
        like(documentsTable.documentType, s),
      )!);
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const offset = (pageNum - 1) * size;

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(documentsTable).where(and(...conditions));
    const docs = await db.select().from(documentsTable).where(and(...conditions)).orderBy(desc(documentsTable.createdAt)).limit(size).offset(offset);

    // Enrich with user names
    const userIds = [...new Set(docs.map(d => d.uploadedBy).concat(docs.map(d => d.updatedBy).filter(Boolean) as number[]))];
    const docUsers = userIds.length > 0 ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds}::int[])`) : [];
    const userMap = new Map(docUsers.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    const enriched = docs.map(d => ({
      ...d,
      uploadedByUser: userMap.get(d.uploadedBy) || null,
      updatedByUser: d.updatedBy ? userMap.get(d.updatedBy) || null : null,
    }));

    res.json({ data: enriched, total: Number(count), page: pageNum, pageSize: size });
  } catch (err) {
    req.log.error({ err }, "List documents error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single document
router.get("/documents/:id", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.isDeleted, false)));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    const [uploader] = await db.select().from(usersTable).where(eq(usersTable.id, doc.uploadedBy));
    const { passwordHash: _, ...uploaderSafe } = uploader || {};
    let updaterSafe = null;
    if (doc.updatedBy) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, doc.updatedBy));
      if (u) { const { passwordHash: _, ...s } = u; updaterSafe = s; }
    }

    res.json({ ...doc, uploadedByUser: uploaderSafe, updatedByUser: updaterSafe });
  } catch (err) {
    req.log.error({ err }, "Get document error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Download document
router.get("/documents/:id/download", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.isDeleted, false)));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    const fullPath = path.join(UPLOADS_ROOT, doc.storagePath);
    if (!fs.existsSync(fullPath)) { res.status(404).json({ error: "File not found on disk" }); return; }
    if (!fullPath.startsWith(UPLOADS_ROOT)) { res.status(403).json({ error: "Invalid path" }); return; }

    // Record activity for download
    await db.insert(activitiesTable).values({
      contactId: doc.contactId, type: "Note",
      notes: `${doc.documentType} Downloaded: ${doc.name}`,
      createdBy: user.id,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${doc.originalName}"`);
    res.sendFile(fullPath);
  } catch (err) {
    req.log.error({ err }, "Download error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Preview document (inline view)
router.get("/documents/:id/preview", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.isDeleted, false)));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    const fullPath = path.join(UPLOADS_ROOT, doc.storagePath);
    if (!fs.existsSync(fullPath)) { res.status(404).json({ error: "File not found on disk" }); return; }
    if (!fullPath.startsWith(UPLOADS_ROOT)) { res.status(403).json({ error: "Invalid path" }); return; }

    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
      ".pdf": "application/pdf",
    };
    const mime = mimeTypes[doc.fileExtension || ""] || doc.mimeType || "application/octet-stream";

    if (doc.fileExtension === ".pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${doc.originalName}"`);
    } else {
      res.setHeader("Content-Type", mime);
    }
    res.sendFile(fullPath);
  } catch (err) {
    req.log.error({ err }, "Preview error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Rename document
router.patch("/documents/:id/rename", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const { name } = req.body as { name?: string };
    if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }

    const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.isDeleted, false)));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    if (user.role === "sales") {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, doc.contactId));
      if (contact?.salesOwnerId !== user.id) { res.status(403).json({ error: "Not your customer's document" }); return; }
    }

    await db.update(documentsTable).set({ name: name.trim(), updatedBy: user.id }).where(eq(documentsTable.id, id));
    res.json({ message: "Document renamed" });
  } catch (err) {
    req.log.error({ err }, "Rename error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Replace document (new version)
router.post("/documents/:id/replace", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file provided" }); return; }

    const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.isDeleted, false)));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    if (user.role === "sales") {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, doc.contactId));
      if (contact?.salesOwnerId !== user.id) { res.status(403).json({ error: "Not your customer's document" }); return; }
    }

    const newVersion = doc.version + 1;
    const storagePath = await storage.save(file.originalname, file.buffer, "documents");
    const ext = path.extname(file.originalname).toLowerCase();

    await db.update(documentsTable).set({
      version: newVersion,
      originalName: file.originalname,
      fileSize: String(file.size),
      mimeType: file.mimetype,
      fileExtension: ext,
      storagePath,
      updatedBy: user.id,
    }).where(eq(documentsTable.id, id));

    await db.insert(documentVersionsTable).values({
      documentId: id, version: newVersion,
      originalName: file.originalname,
      fileSize: String(file.size), mimeType: file.mimetype,
      storagePath, uploadedBy: user.id, action: "replace",
    });

    await db.insert(activitiesTable).values({
      contactId: doc.contactId, type: "Note",
      notes: `${doc.documentType} Replaced: ${doc.name} (v${newVersion})`,
      createdBy: user.id,
    });

    res.json({ message: "Document replaced", version: newVersion });
  } catch (err) {
    req.log.error({ err }, "Replace error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get version history
router.get("/documents/:id/versions", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const versions = await db.select({
      id: documentVersionsTable.id,
      version: documentVersionsTable.version,
      originalName: documentVersionsTable.originalName,
      fileSize: documentVersionsTable.fileSize,
      mimeType: documentVersionsTable.mimeType,
      action: documentVersionsTable.action,
      uploadedBy: documentVersionsTable.uploadedBy,
      createdAt: documentVersionsTable.createdAt,
    }).from(documentVersionsTable)
      .leftJoin(usersTable, eq(usersTable.id, documentVersionsTable.uploadedBy))
      .where(eq(documentVersionsTable.documentId, id))
      .orderBy(desc(documentVersionsTable.version));

    // Enrich with user names
    const userIds = [...new Set(versions.map(v => v.uploadedBy))];
    const docUsers = userIds.length > 0 ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds}::int[])`) : [];
    const userMap = new Map(docUsers.map(u => {
      const { passwordHash: _, ...safe } = u;
      return [u.id, safe];
    }));

    res.json(versions.map(v => ({ ...v, uploadedByUser: userMap.get(v.uploadedBy) || null })));
  } catch (err) {
    req.log.error({ err }, "Versions error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete document (soft delete, admin only)
router.delete("/documents/:id", async (req: Request, res: Response) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (user.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

    const [doc] = await db.select().from(documentsTable).where(and(eq(documentsTable.id, id), eq(documentsTable.isDeleted, false)));
    if (!doc) { res.status(404).json({ error: "Not found" }); return; }

    await db.update(documentsTable).set({ isDeleted: true, updatedBy: user.id }).where(eq(documentsTable.id, id));

    await db.insert(activitiesTable).values({
      contactId: doc.contactId, type: "Note",
      notes: `${doc.documentType} Deleted: ${doc.name}`,
      createdBy: user.id,
    });

    res.json({ message: "Document deleted" });
  } catch (err) {
    req.log.error({ err }, "Delete error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
