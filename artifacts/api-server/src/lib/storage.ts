import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

export interface StorageProvider {
  save(filename: string, buffer: Buffer, subDir?: string): Promise<string>;
  get(storagePath: string): Promise<Buffer | null>;
  delete(storagePath: string): Promise<boolean>;
  exists(storagePath: string): Promise<boolean>;
  getUrl(storagePath: string): string;
  getPhysicalPath(storagePath: string): string;
  verifyPublicAccess(storagePath: string): Promise<{ accessible: boolean; error?: string }>;
}

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

export { UPLOADS_ROOT };

// Strip path separators (POSIX + Windows), keep only safe characters, and never
// allow traversal sequences ("../", "..\") or a bare ".." to reach the filesystem.
function sanitizeFilename(filename: string): string {
  if (!filename) return "file";
  // Collapse both separators so path.basename always returns the last component
  const base = path.basename(filename.replace(/\\/g, "/"));
  // Whitelist-safe characters only, collapse dots, trim leading/trailing dots
  const clean = base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
  const safe = clean && !clean.includes("..") ? clean : "file";
  return safe.slice(0, 150);
}

// ────────────────────────────────────────────
// Local filesystem storage (for development)
// ────────────────────────────────────────────
class LocalStorageProvider implements StorageProvider {
  async save(filename: string, buffer: Buffer, subDir = "documents"): Promise<string> {
    const dir = path.join(UPLOADS_ROOT, subDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const uniqueName = `${randomUUID()}-${sanitizeFilename(filename)}`;
    const filePath = path.join(dir, uniqueName);
    await fs.promises.writeFile(filePath, buffer);
    return path.join(subDir, uniqueName).replace(/\\/g, "/");
  }

  async get(storagePath: string): Promise<Buffer | null> {
    const fullPath = path.join(UPLOADS_ROOT, storagePath);
    try {
      return await fs.promises.readFile(fullPath);
    } catch {
      return null;
    }
  }

  async delete(storagePath: string): Promise<boolean> {
    const fullPath = path.join(UPLOADS_ROOT, storagePath);
    try {
      await fs.promises.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    return fs.existsSync(path.join(UPLOADS_ROOT, storagePath));
  }

  getUrl(storagePath: string): string {
    return `/api/uploads/${storagePath}`;
  }

  getPhysicalPath(storagePath: string): string {
    return path.join(UPLOADS_ROOT, storagePath);
  }

  async verifyPublicAccess(storagePath: string): Promise<{ accessible: boolean; error?: string }> {
    const exists = await this.exists(storagePath);
    if (!exists) return { accessible: false, error: "File does not exist on disk" };
    return { accessible: true };
  }
}

// ────────────────────────────────────────────
// Supabase Storage (persistent cloud storage)
// Survives Render.com deploys/restarts
//
// Auth: Supabase Storage REST API requires the `apikey` header
// for publishable/anon keys. The `Authorization: Bearer` header
// only works with JWT-formatted keys (anon JWT or service_role JWT).
// ────────────────────────────────────────────
class SupabaseStorageProvider implements StorageProvider {
  private baseUrl: string;
  private key: string;
  private buckets: Set<string> = new Set();
  private bucketCheckDone = false;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || apiKey;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
    };
  }

  async save(filename: string, buffer: Buffer, subDir = "documents"): Promise<string> {
    const bucket = subDir;
    await this.ensureBucket(bucket);

    const uniqueName = `${randomUUID()}-${sanitizeFilename(filename)}`;
    const storagePath = `${bucket}/${uniqueName}`;
    const uploadUrl = `${this.baseUrl}/storage/v1/object/${storagePath}`;

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      webm: "audio/webm",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      m4a: "audio/mp4",
      mp4: "audio/mp4",
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      avif: "image/avif",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buffer,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase upload failed (${res.status}): ${text}`);
    }

    // Ensure the bucket is public so the returned public URL is actually
    // readable by the browser (avatars, documents, etc.).
    await this.ensureBucketPublic(bucket);

    return storagePath;
  }

  async get(storagePath: string): Promise<Buffer | null> {
    const url = `${this.baseUrl}/storage/v1/object/${storagePath}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async delete(storagePath: string): Promise<boolean> {
    const url = `${this.baseUrl}/storage/v1/object/${storagePath}`;
    const res = await fetch(url, { method: "DELETE", headers: this.headers() });
    return res.ok;
  }

  async exists(storagePath: string): Promise<boolean> {
    const bucket = storagePath.split("/")[0];

    // 1. Try public URL (works if bucket is public)
    try {
      const publicUrl = `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
      const res = await fetch(publicUrl, { method: "HEAD", redirect: "follow" });
      if (res.ok) return true;
    } catch { /* continue to auth check */ }

    // 2. Try authenticated access with apikey header
    try {
      const authUrl = `${this.baseUrl}/storage/v1/object/${storagePath}`;
      const res = await fetch(authUrl, {
        method: "HEAD",
        headers: this.headers(),
      });
      if (res.ok) {
        // File exists but bucket might not be public — fix it
        console.warn(`[storage] File exists via auth but bucket "${bucket}" not public. Setting public.`);
        await this.ensureBucketPublic(bucket);
        return true;
      }
      if (res.status === 404) {
        console.warn(`[storage] File NOT FOUND in storage: ${storagePath}`);
        return false;
      }
      console.warn(`[storage] Storage access check failed for ${storagePath}: HTTP ${res.status}`);
      return false;
    } catch (err: any) {
      console.error(`[storage] Storage access error for ${storagePath}:`, err?.message);
      return false;
    }
  }

  getUrl(storagePath: string): string {
    return `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
  }

  getPhysicalPath(storagePath: string): string {
    return this.getUrl(storagePath);
  }

  async verifyPublicAccess(storagePath: string): Promise<{ accessible: boolean; error?: string }> {
    // Try public URL
    try {
      const publicUrl = `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
      const res = await fetch(publicUrl, { method: "HEAD", redirect: "follow" });
      if (res.ok) return { accessible: true };
    } catch { /* continue */ }

    // Try authenticated access
    try {
      const authUrl = `${this.baseUrl}/storage/v1/object/${storagePath}`;
      const res = await fetch(authUrl, {
        method: "HEAD",
        headers: this.headers(),
      });
      if (res.ok) {
        await this.ensureBucketPublic(storagePath.split("/")[0]);
        return { accessible: true };
      }
      return { accessible: false, error: `HTTP ${res.status}: file not found in storage` };
    } catch (err: any) {
      return { accessible: false, error: err?.message || "Network error" };
    }
  }

  // ────────────────────────────────────────
  // Bucket management
  // ────────────────────────────────────────
  // Create a bucket by inserting into storage.buckets directly. The Postgres
  // connection role (table owner) bypasses RLS, so this works with the anon
  // publishable key — no service_role key required. Mirrors the Storage REST
  // API create shape (public, 10 MB limit, allowed MIME types).
  private async createBucketViaDb(bucket: string): Promise<boolean> {
    try {
      const { db } = await import("@workspace/db");
      await db.execute(sql`
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (${bucket}, ${bucket}, true, 10485760,
          ARRAY['audio/webm','audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/ogg','audio/mp4','audio/m4a','application/pdf','image/jpeg','image/png','image/gif','image/webp','image/svg+xml','image/bmp','image/avif'])
        ON CONFLICT (id) DO UPDATE SET public = true
      `);
      this.buckets.add(bucket);
      return true;
    } catch (err: any) {
      console.warn(`[storage] Database bucket creation failed for "${bucket}":`, err?.message);
      return false;
    }
  }

  // Set the public flag directly via the database (bypasses storage RLS, so it
  // does not depend on the API key having bucket-management privileges).
  private async setBucketPublicViaDb(bucket: string): Promise<boolean> {
    try {
      const { db } = await import("@workspace/db");
      await db.execute(sql`UPDATE storage.buckets SET public = true WHERE id = ${bucket}`);
      return true;
    } catch (err: any) {
      console.warn(`[storage] Could not set bucket "${bucket}" public via database:`, err?.message);
      return false;
    }
  }

  async ensureBucketExists(): Promise<boolean> {
    if (this.buckets.has("voice-notes")) return true;
    if (this.bucketCheckDone) return this.buckets.has("voice-notes");

    this.bucketCheckDone = true;

    // 1. Try listing buckets (informational; anon key may get RLS-filtered results)
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        headers: this.headers(),
      });
      if (res.ok) {
        const buckets = await res.json() as { id: string; public: boolean }[];
        for (const b of buckets) this.buckets.add(b.id);
        console.log(`[storage] Supabase buckets found: [${buckets.map(b => `${b.id}(public=${b.public})`).join(", ")}]`);
      }
    } catch (err: any) {
      console.warn(`[storage] Error listing Supabase buckets:`, err?.message);
    }

    if (this.buckets.has("voice-notes")) {
      console.log(`[storage] Bucket "voice-notes" exists.`);
      await this.ensureBucketPublic("voice-notes");
      return true;
    }

    // 2. Try creating via Storage REST API (requires a service_role key)
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "voice-notes",
          name: "voice-notes",
          public: true,
          file_size_limit: 10 * 1024 * 1024,
          allowed_mime_types: [
            "audio/webm", "audio/mpeg", "audio/mp3",
            "audio/wav", "audio/wave", "audio/x-wav",
            "audio/ogg", "audio/mp4", "audio/m4a",
            "application/pdf", "image/jpeg", "image/png",
          ],
        }),
      });
      if (res.ok) {
        this.buckets.add("voice-notes");
        console.log(`[storage] Created bucket "voice-notes" via API`);
      } else {
        const text = await res.text().catch(() => "");
        console.log(`[storage] API bucket creation unavailable (HTTP ${res.status}${text ? `: ${text}` : ""}). Falling back to database...`);
      }
    } catch (err: any) {
      console.warn(`[storage] API bucket creation error:`, err?.message);
    }

    // 3. Create via database (Postgres role bypasses RLS — reliable default)
    if (!this.buckets.has("voice-notes") && (await this.createBucketViaDb("voice-notes"))) {
      console.log(`[storage] Created bucket "voice-notes" via database`);
    }

    // 4. Ensure public via database so it doesn't depend on API key privileges
    if (this.buckets.has("voice-notes")) {
      await this.setBucketPublicViaDb("voice-notes");
      // Heal the missing storage.objects RLS policy (migration 072) even when
      // no file is uploaded yet — keeps existing deployments working without a
      // manual SQL step.
      await ensurePublicReadPolicies();
      return true;
    }

    console.error(`[storage] ═══════════════════════════════════════════════════════`);
    console.error(`[storage] CRITICAL: Cannot create "voice-notes" bucket.`);
    console.error(`[storage] Voice notes will NOT be stored or playable.`);
    console.error(`[storage] FIX: Create the bucket manually in Supabase Dashboard:`);
    console.error(`[storage]   1. Open your project at https://supabase.com/dashboard and go to Storage > Buckets`);
    console.error(`[storage]   2. Click "New Bucket"`);
    console.error(`[storage]   3. Name: voice-notes | Public: ON | Size limit: 10 MB`);
    console.error(`[storage]   4. Allowed MIME types: audio/webm, audio/mpeg, audio/mp3, audio/wav, audio/ogg, audio/mp4, audio/m4a`);
    console.error(`[storage] ═══════════════════════════════════════════════════════`);

    return false;
  }

  private async ensureBucket(bucket: string): Promise<void> {
    if (this.buckets.has(bucket)) return;
    await this.ensureBucketExists();
    if (this.buckets.has(bucket)) return;

    // Generic bucket creation for any bucket (voice-notes, profiles, etc.)
    // API first (service_role fast path), then database (anon-key safe).
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: true,
          file_size_limit: 10 * 1024 * 1024,
        }),
      });
      if (res.ok) {
        this.buckets.add(bucket);
        console.log(`[storage] Created bucket "${bucket}" via API`);
      }
    } catch (err: any) {
      console.warn(`[storage] Bucket creation error for "${bucket}":`, err?.message);
    }

    if (!this.buckets.has(bucket) && (await this.createBucketViaDb(bucket))) {
      console.log(`[storage] Created bucket "${bucket}" via database`);
    }

    await this.ensureBucketPublic(bucket);
  }

  private async ensureBucketPublic(bucket: string): Promise<void> {
    // Fast path: Storage REST API (works with service_role key). Uses the
    // valid HTTP PUT method — `UPDATE` is not a valid HTTP verb.
    let ok = false;
    try {
      const url = `${this.baseUrl}/storage/v1/bucket/${bucket}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ public: true }),
      });
      ok = res.ok;
      if (res.ok) console.log(`[storage] Bucket "${bucket}" set to public`);
    } catch {
      // fall through to database
    }

    if (!ok) {
      if (await this.setBucketPublicViaDb(bucket)) {
        console.log(`[storage] Bucket "${bucket}" set to public via database`);
      }
    }

    // Setting public=true is NOT enough: buckets created via direct SQL
    // (createBucketViaDb) bypass the Storage API, so no anon SELECT policy is
    // auto-created on storage.objects. Without one, anonymous public-URL loads
    // (<img src>, <audio src>) return 403. Ensure the policy on every
    // make-public event so the fix self-heals (idempotent, runs once/process).
    await ensurePublicReadPolicies();
  }
}

// ────────────────────────────────────────
// Storage RLS policies (module-level)
// ────────────────────────────────────────
// Root cause of "profile photo 403 / initials fallback for non-admin users":
// buckets are created by INSERTing into storage.buckets directly (bypassing
// the Storage REST API), so Supabase never generates the standard public-read
// SELECT policy on storage.objects. The bucket flag public=true alone does not
// let the browser's anonymous request download the object — storage.objects
// RLS still denies -> HTTP 403. This grants SELECT to PUBLIC (anon +
// authenticated) for every bucket flagged public, mirroring migration
// 072_add_storage_public_read_policies.sql. One generic policy covers
// profile-photos, voice-notes, documents, builty and future public buckets.
// Module-level (not a class method) so index.ts can run it once at boot after
// the DB connection is established, and existing deployments self-heal on next
// startup even if the migration was applied late. Idempotent — runs at most
// once per process.
let policiesEnsured = false;

const KNOWN_PUBLIC_BUCKETS = ["profile-photos", "voice-notes", "documents", "builty"];

export async function ensurePublicReadPolicies(): Promise<void> {
  if (policiesEnsured) return;
  try {
    const { db } = await import("@workspace/db");

    // The storage schema may not exist in this database (e.g. local dev without
    // Supabase). Bail silently instead of erroring on boot.
    const reg = await db.execute(sql`SELECT to_regclass('storage.objects') AS t`);
    const tableOid = (reg as any).rows?.[0]?.t;
    if (!tableOid) {
      console.warn("[storage] storage.objects not found — skipping public read policy setup.");
      policiesEnsured = true;
      return;
    }

    // Re-flag every known bucket public (idempotent, mirrors createBucketViaDb).
    const bucketList = KNOWN_PUBLIC_BUCKETS.map(b => `'${b}'`).join(", ");
    await db.execute(sql.raw(`UPDATE storage.buckets SET public = true WHERE id IN (${bucketList})`));

    // Drop any stale policy and recreate the single generic public-read policy.
    await db.execute(sql`DROP POLICY IF EXISTS "Public read access (all public buckets)" ON storage.objects`);
    await db.execute(sql`
      CREATE POLICY "Public read access (all public buckets)"
        ON storage.objects
        FOR SELECT
        TO public
        USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true))
    `);

    policiesEnsured = true;
    console.log("[storage] Public read policy ensured on storage.objects (anon SELECT for all public buckets)");
  } catch (err: any) {
    console.warn(`[storage] Could not ensure public read policy on storage.objects:`, err?.message);
    console.warn(`[storage] Apply migration lib/db/migrations/072_add_storage_public_read_policies.sql in Supabase SQL Editor.`);
  }
}

// ────────────────────────────────────────────
// Provider selection: Supabase if configured, else local
// ────────────────────────────────────────────
function createProvider(): StorageProvider {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log("[storage] Using Supabase Storage:", supabaseUrl);
    if (supabaseServiceRoleKey) {
      console.log("[storage] SUPABASE_SERVICE_ROLE_KEY configured — using it for all server-side Storage operations (bypasses RLS).");
    } else {
      console.warn("[storage] SUPABASE_SERVICE_ROLE_KEY not set — using publishable key (RLS applies). Set it in .env to bypass row-level security for uploads.");
    }
    const p = new SupabaseStorageProvider(supabaseUrl, supabaseKey);
    // Run bucket check in background (non-blocking)
    p.ensureBucketExists().then(ok => {
      if (ok) console.log("[storage] Supabase Storage ready");
      else console.warn("[storage] Supabase Storage NOT ready — voice notes disabled until bucket is created");
    });
    return p;
  }

  console.log("[storage] Using local filesystem storage:", UPLOADS_ROOT);
  console.warn("[storage] ⚠ Files stored locally will be LOST on Render deploy/restart. Set SUPABASE_URL + SUPABASE_KEY for persistence.");
  return new LocalStorageProvider();
}

let provider: StorageProvider = createProvider();

// ────────────────────────────────────────────
// Profile photo storage: shared provider (Supabase → local). Cloudinary has
// been removed — profile photos go straight to Supabase Storage so they
// survive Render/Vercel deploys and restarts.
// ────────────────────────────────────────────
export const profilePhotoStorage: StorageProvider = provider;

// Some legacy rows store `profilePhoto` as a relative local path
// (e.g. "/api/uploads/profile-photos/<file>.jpg") because they were uploaded
// while the local filesystem provider was active. On Render/Vercel the local
// filesystem is ephemeral, so those URLs 404 and the UI falls back to initials.
// When Supabase Storage is configured, re-map such paths to the equivalent
// public object URL so every user's photo loads regardless of role.
export function normalizeProfilePhotoUrl(url: string | null | undefined): string | null {
  if (!url) return url ?? null;

  // Legacy absolute URLs that point at the API server's OWN /api/uploads/...
  // path (e.g. "https://<api-host>/api/uploads/profile-photos/x.jpg" stored
  // while the local filesystem provider was active). Those files are ephemeral
  // on Render/Vercel, so remap them to the equivalent Supabase public object
  // URL exactly like the relative-path case below.
  if (/^https?:\/\/[^/]+\/api\/uploads\//.test(url)) {
    return buildPublicObjectUrl(url.replace(/^https?:\/\/[^/]+\/api\/uploads\//, ""));
  }

  // Already absolute (e.g. a Supabase public URL) — pass through unchanged.
  if (/^https?:\/\//i.test(url)) return url;

  // Any remaining value is treated as a relative/legacy storage path: strip a
  // leading "/" and the optional "/api/uploads/" prefix, then map to a full
  // Supabase public object URL. Without SUPABASE_URL (local development) the
  // local API upload route is used instead.
  const storagePath = url.replace(/^\/+/, "").replace(/^api\/uploads\//, "");
  return buildPublicObjectUrl(storagePath);
}

function buildPublicObjectUrl(storagePath: string): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${storagePath}`;
  }
  return `/api/uploads/${storagePath}`;
}

export function setStorageProvider(p: StorageProvider) {
  provider = p;
}

export function getStorageProvider(): StorageProvider {
  return provider;
}

export const storage = provider;
