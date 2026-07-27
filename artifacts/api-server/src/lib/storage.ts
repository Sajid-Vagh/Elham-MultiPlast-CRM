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

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/octet-stream",
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
    // Use public URL — no auth needed for public buckets, avoids 405 on HEAD /object/info/
    try {
      const publicUrl = `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
      const res = await fetch(publicUrl, { method: "GET", redirect: "follow" });
      return res.ok;
    } catch {
      return false;
    }
  }

  getUrl(storagePath: string): string {
    // Use public URL — bucket must be public
    return `${this.baseUrl}/storage/v1/object/public/${storagePath}`;
  }

  getPhysicalPath(storagePath: string): string {
    // Cloud storage — no local path. Return the public URL for logging.
    return this.getUrl(storagePath);
  }

  private async ensureBucket(bucket: string): Promise<void> {
    if (this.buckets.has(bucket)) return;

    try {
      // Check if bucket exists
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

    if (this.buckets.has(bucket)) return;

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
          file_size_limit: 10 * 1024 * 1024, // 10MB
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
      } else {
        const text = await res.text().catch(() => "");
        console.error(`Failed to create Supabase bucket "${bucket}":`, text);
      }
    } catch (err) {
      console.error(`Error creating Supabase bucket "${bucket}":`, err);
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
