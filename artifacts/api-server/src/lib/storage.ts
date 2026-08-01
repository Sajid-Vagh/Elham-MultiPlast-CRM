import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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

// ────────────────────────────────────────────
// Local filesystem storage (for development)
// ────────────────────────────────────────────
class LocalStorageProvider implements StorageProvider {
  async save(filename: string, buffer: Buffer, subDir = "documents"): Promise<string> {
    const dir = path.join(UPLOADS_ROOT, subDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const uniqueName = `${randomUUID()}-${filename}`;
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
  private apiKey: string;
  private adminKey?: string;
  private buckets: Set<string> = new Set();
  private bucketCheckDone = false;

  constructor(baseUrl: string, apiKey: string, adminKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    // Optional service_role key for admin Storage operations (bucket create /
    // set-public). Unlike the publishable/anon key, it bypasses RLS so bucket
    // management succeeds via the Storage REST API instead of the DB fallback.
    this.adminKey = adminKey;
  }

  // Storage API headers — uses `apikey` header for publishable keys
  private headersFor(key: string): Record<string, string> {
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
  }

  private authHeaders(): Record<string, string> {
    return this.headersFor(this.apiKey);
  }

  // Admin headers for bucket-management endpoints — use the service_role key
  // when configured, otherwise fall back to the publishable/anon key.
  private adminHeaders(): Record<string, string> {
    return this.headersFor(this.adminKey || this.apiKey);
  }

  async save(filename: string, buffer: Buffer, subDir = "documents"): Promise<string> {
    const bucket = subDir;
    await this.ensureBucket(bucket);

    const uniqueName = `${randomUUID()}-${filename}`;
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
    };
    const contentType = mimeMap[ext] || "application/octet-stream";

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
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
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async delete(storagePath: string): Promise<boolean> {
    const url = `${this.baseUrl}/storage/v1/object/${storagePath}`;
    const res = await fetch(url, { method: "DELETE", headers: this.authHeaders() });
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
        headers: this.authHeaders(),
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
        headers: this.authHeaders(),
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
          ARRAY['audio/webm','audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/ogg','audio/mp4','audio/m4a','application/pdf','image/jpeg','image/png'])
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
        headers: this.adminHeaders(),
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
        headers: { ...this.adminHeaders(), "Content-Type": "application/json" },
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
      return true;
    }

    console.error(`[storage] ═══════════════════════════════════════════════════════`);
    console.error(`[storage] CRITICAL: Cannot create "voice-notes" bucket.`);
    console.error(`[storage] Voice notes will NOT be stored or playable.`);
    console.error(`[storage] FIX: Create the bucket manually in Supabase Dashboard:`);
    console.error(`[storage]   1. Go to https://supabase.com/dashboard/project/rzcbdtxlkspdgksycamg/storage/buckets`);
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
        headers: { ...this.adminHeaders(), "Content-Type": "application/json" },
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
        headers: { ...this.adminHeaders(), "Content-Type": "application/json" },
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
  }
}

// ────────────────────────────────────────────
// Cloudinary (persistent image hosting for profile photos)
//
// Server-to-server signed uploads via Cloudinary's Upload API using
// native fetch — no npm package required. Unlike Supabase's anon-key
// storage, signed uploads never depend on storage RLS policies, so they
// work reliably on Vercel/Render serverless runtimes where the local
// filesystem is ephemeral. The returned secure URL is an absolute,
// CDN-backed URL (https://res.cloudinary.com/...).
//
// Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// ────────────────────────────────────────────
function mimeFromExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
  };
  return mimeMap[ext] || "application/octet-stream";
}

class CloudinaryStorageProvider implements StorageProvider {
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(cloudName: string, apiKey: string, apiSecret: string) {
    this.cloudName = cloudName;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private uploadEndpoint(): string {
    return `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`;
  }

  private destroyEndpoint(): string {
    return `https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`;
  }

  // Cloudinary signs all non-file, non-key parameters (sorted alphabetically
  // as `key=value&...` with the API secret appended, SHA-1 hashed).
  private signature(params: Record<string, string | number | boolean>): string {
    const sorted = Object.entries(params)
      .filter(([k]) => k !== "file" && k !== "api_key" && k !== "signature" && k !== "cloud_name")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return createHash("sha1").update(`${sorted}${this.apiSecret}`).digest("hex");
  }

  async save(filename: string, buffer: Buffer, subDir = "profiles"): Promise<string> {
    const publicId = `${subDir}/${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.signature({ public_id: publicId, overwrite: true, timestamp });

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeFromExt(filename) }), filename);
    form.append("public_id", publicId);
    form.append("overwrite", "true");
    form.append("timestamp", String(timestamp));
    form.append("api_key", this.apiKey);
    form.append("signature", signature);

    const res = await fetch(this.uploadEndpoint(), { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloudinary upload failed (${res.status}): ${text}`);
    }
    return publicId;
  }

  async get(storagePath: string): Promise<Buffer | null> {
    const res = await fetch(this.getUrl(storagePath));
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(storagePath: string): Promise<boolean> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.signature({ public_id: storagePath, timestamp });
    const form = new FormData();
    form.append("public_id", storagePath);
    form.append("timestamp", String(timestamp));
    form.append("api_key", this.apiKey);
    form.append("signature", signature);

    const res = await fetch(this.destroyEndpoint(), { method: "POST", body: form });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({})) as { result?: string };
    return body.result === "ok";
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      const res = await fetch(this.getUrl(storagePath), { method: "HEAD", redirect: "follow" });
      return res.ok;
    } catch {
      return false;
    }
  }

  getUrl(storagePath: string): string {
    return `https://res.cloudinary.com/${this.cloudName}/image/upload/${storagePath}`;
  }

  getPhysicalPath(storagePath: string): string {
    return this.getUrl(storagePath);
  }

  async verifyPublicAccess(storagePath: string): Promise<{ accessible: boolean; error?: string }> {
    try {
      const res = await fetch(this.getUrl(storagePath), { method: "HEAD", redirect: "follow" });
      return res.ok
        ? { accessible: true }
        : { accessible: false, error: `Cloudinary returned HTTP ${res.status}` };
    } catch (err: any) {
      return { accessible: false, error: err?.message || "Network error" };
    }
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
      console.log("[storage] SUPABASE_SERVICE_ROLE_KEY configured — using it for bucket management (bypasses storage RLS).");
    } else {
      console.warn("[storage] SUPABASE_SERVICE_ROLE_KEY not set. Bucket management will fall back to database inserts. Set it in .env to use the Storage REST API directly.");
    }
    const p = new SupabaseStorageProvider(supabaseUrl, supabaseKey, supabaseServiceRoleKey);
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
// Profile photo storage: Cloudinary when configured (reliable server-side
// signed uploads), otherwise the shared provider (Supabase → local).
// ────────────────────────────────────────────
function createProfilePhotoProvider(): StorageProvider {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) {
    console.log(`[storage] Profile photos: using Cloudinary (${cloudName})`);
    return new CloudinaryStorageProvider(cloudName, apiKey, apiSecret);
  }
  console.warn("[storage] Profile photos: CLOUDINARY_* env vars not set — falling back to the shared storage provider.");
  return provider;
}

export const profilePhotoStorage: StorageProvider = createProfilePhotoProvider();

export function setStorageProvider(p: StorageProvider) {
  provider = p;
}

export function getStorageProvider(): StorageProvider {
  return provider;
}

export const storage = provider;
