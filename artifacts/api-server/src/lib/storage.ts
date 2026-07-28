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
// ────────────────────────────────────────────
class SupabaseStorageProvider implements StorageProvider {
  private baseUrl: string;
  private apiKey: string;
  private buckets: Set<string> = new Set();

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async save(filename: string, buffer: Buffer, subDir = "documents"): Promise<string> {
    const bucket = subDir;
    await this.ensureBucket(bucket);

    const uniqueName = `${randomUUID()}-${filename}`;
    const storagePath = `${bucket}/${uniqueName}`;
    const uploadUrl = `${this.baseUrl}/storage/v1/object/${storagePath}`;

    // Determine MIME type from filename extension
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
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buffer,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase upload failed (${res.status}): ${text}`);
    }

    return storagePath;
  }

  async get(storagePath: string): Promise<Buffer | null> {
    const url = `${this.baseUrl}/storage/v1/object/${storagePath}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  async delete(storagePath: string): Promise<boolean> {
    const url = `${this.baseUrl}/storage/v1/object/${storagePath}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    return res.ok;
  }

  async exists(storagePath: string): Promise<boolean> {
    // Try public URL first — lightweight HEAD check
    try {
      const publicUrl = `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
      const res = await fetch(publicUrl, { method: "HEAD", redirect: "follow" });
      if (res.ok) return true;
      // If 403/404, try authenticated access as fallback (bucket might be private)
      if (res.status === 403 || res.status === 404) {
        const authUrl = `${this.baseUrl}/storage/v1/object/${storagePath}`;
        const authRes = await fetch(authUrl, {
          method: "HEAD",
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (authRes.ok) {
          // File exists but bucket is not public — fix it
          console.warn(`[storage] Bucket for ${storagePath.split("/")[0]} is not public. Attempting to fix.`);
          await this.ensureBucketPublic(storagePath.split("/")[0]);
          return true;
        }
      }
      return false;
    } catch {
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
    try {
      const publicUrl = `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
      const res = await fetch(publicUrl, { method: "HEAD", redirect: "follow" });
      if (res.ok) return { accessible: true };
      // If bucket is private, try authenticated access
      if (res.status === 403 || res.status === 404) {
        const authUrl = `${this.baseUrl}/storage/v1/object/${storagePath}`;
        const authRes = await fetch(authUrl, {
          method: "HEAD",
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (authRes.ok) {
          // File exists but bucket isn't public — fix it
          const bucket = storagePath.split("/")[0];
          console.warn(`[storage] Bucket "${bucket}" is not public. Fixing...`);
          await this.ensureBucketPublic(bucket);
          return { accessible: true };
        }
        return { accessible: false, error: `HTTP ${res.status}: file not accessible publicly or via auth` };
      }
      return { accessible: false, error: `HTTP ${res.status}: ${res.statusText}` };
    } catch (err: any) {
      return { accessible: false, error: err?.message || "Network error" };
    }
  }

  private async ensureBucket(bucket: string): Promise<void> {
    if (this.buckets.has(bucket)) return;

    try {
      const listUrl = `${this.baseUrl}/storage/v1/bucket`;
      const res = await fetch(listUrl, { headers: this.headers() });
      if (res.ok) {
        const buckets = await res.json() as { id: string }[];
        for (const b of buckets) {
          this.buckets.add(b.id);
        }
      }
    } catch {
      // Non-critical — bucket might already exist
    }

    if (this.buckets.has(bucket)) {
      // Bucket exists — ensure it is public (may have been created as private)
      await this.ensureBucketPublic(bucket);
      return;
    }

    // Create the bucket as public
    try {
      const createUrl = `${this.baseUrl}/storage/v1/bucket`;
      const res = await fetch(createUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          id: bucket,
          name: bucket,
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
        this.buckets.add(bucket);
        console.log(`[storage] Created Supabase bucket "${bucket}" (public)`);
      } else {
        const text = await res.text().catch(() => "");
        console.error(`Failed to create Supabase bucket "${bucket}":`, text);
      }
    } catch (err) {
      console.error(`Error creating Supabase bucket "${bucket}":`, err);
    }
  }

  private async ensureBucketPublic(bucket: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/storage/v1/bucket/${bucket}`;
      const res = await fetch(url, {
        method: "UPDATE",
        headers: this.headers(),
        body: JSON.stringify({ public: true }),
      });
      if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => "");
        console.warn(`[storage] Could not set bucket "${bucket}" to public: ${text}`);
      }
    } catch {
      // Non-critical — bucket might already be public
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
    return new SupabaseStorageProvider(supabaseUrl, supabaseKey);
  }

  console.log("[storage] Using local filesystem storage:", UPLOADS_ROOT);
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
