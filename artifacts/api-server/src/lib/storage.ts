import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
  private buckets: Set<string> = new Set();
  private bucketCheckDone = false;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  // Storage API headers — uses `apikey` header for publishable keys
  private authHeaders(): Record<string, string> {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
    };
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
  async ensureBucketExists(): Promise<boolean> {
    if (this.buckets.has("voice-notes")) return true;
    if (this.bucketCheckDone) return this.buckets.has("voice-notes");

    this.bucketCheckDone = true;

    // 1. Try listing buckets with apikey header
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        headers: this.authHeaders(),
      });
      if (res.ok) {
        const buckets = await res.json() as { id: string; public: boolean }[];
        for (const b of buckets) this.buckets.add(b.id);
        console.log(`[storage] Supabase buckets found: [${buckets.map(b => `${b.id}(public=${b.public})`).join(", ")}]`);
      } else {
        const text = await res.text().catch(() => "");
        console.error(`[storage] Failed to list Supabase buckets: HTTP ${res.status}: ${text}`);
      }
    } catch (err: any) {
      console.error(`[storage] Error listing Supabase buckets:`, err?.message);
    }

    if (this.buckets.has("voice-notes")) {
      console.log(`[storage] Bucket "voice-notes" exists.`);
      await this.ensureBucketPublic("voice-notes");
      return true;
    }

    // 2. Try creating via Storage REST API (requires service_role key)
    console.log(`[storage] Bucket "voice-notes" not found. Attempting to create via API...`);
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
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
        return true;
      }
      const text = await res.text().catch(() => "");
      console.warn(`[storage] API bucket creation failed: ${text}`);
    } catch (err: any) {
      console.warn(`[storage] API bucket creation error:`, err?.message);
    }

    // 3. Try creating via database (insert into storage.buckets)
    console.log(`[storage] Trying database bucket creation...`);
    try {
      const { db } = await import("@workspace/db");
      // Use raw SQL to insert bucket into storage schema
      await db.execute(
        `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
         VALUES ('voice-notes', 'voice-notes', true, 10485760,
           ARRAY['audio/webm','audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/ogg','audio/mp4','audio/m4a','application/pdf','image/jpeg','image/png'])
         ON CONFLICT (id) DO UPDATE SET public = true`
      );
      this.buckets.add("voice-notes");
      console.log(`[storage] Created bucket "voice-notes" via database`);
      // Set bucket public via API
      await this.ensureBucketPublic("voice-notes");
      return true;
    } catch (err: any) {
      console.warn(`[storage] Database bucket creation failed:`, err?.message);
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
    console.log(`[storage] Bucket "${bucket}" not found. Attempting to create via API...`);
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
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
      } else if (res.status !== 409) {
        const text = await res.text().catch(() => "");
        console.warn(`[storage] Bucket creation failed for "${bucket}": ${text}`);
      }
    } catch (err: any) {
      console.warn(`[storage] Bucket creation error for "${bucket}":`, err?.message);
    }

    await this.ensureBucketPublic(bucket);
  }

  private async ensureBucketPublic(bucket: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/storage/v1/bucket/${bucket}`;
      const res = await fetch(url, {
        method: "UPDATE",
        headers: { ...this.authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ public: true }),
      });
      if (res.ok) {
        console.log(`[storage] Bucket "${bucket}" set to public`);
      } else if (res.status !== 404) {
        const text = await res.text().catch(() => "");
        console.warn(`[storage] Could not set bucket "${bucket}" to public: HTTP ${res.status}: ${text}`);
      }
    } catch {
      // Non-critical
    }
  }
}

// ────────────────────────────────────────────
// Provider selection: Supabase if configured, else local
// ────────────────────────────────────────────
function createProvider(): StorageProvider {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (supabaseUrl && supabaseKey) {
    console.log("[storage] Using Supabase Storage:", supabaseUrl);
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

export function setStorageProvider(p: StorageProvider) {
  provider = p;
}

export function getStorageProvider(): StorageProvider {
  return provider;
}

export const storage = provider;
