import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StorageProvider {
  save(filename: string, buffer: Buffer, subDir?: string): Promise<string>;
  get(storagePath: string): Promise<Buffer | null>;
  delete(storagePath: string): Promise<boolean>;
  getUrl(storagePath: string): string;
  getPhysicalPath(storagePath: string): string;
}

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

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

  getUrl(storagePath: string): string {
    return `/api/uploads/${storagePath}`;
  }

  getPhysicalPath(storagePath: string): string {
    return path.join(UPLOADS_ROOT, storagePath);
  }
}

let provider: StorageProvider = new LocalStorageProvider();

export function setStorageProvider(p: StorageProvider) {
  provider = p;
}

export function getStorageProvider(): StorageProvider {
  return provider;
}

export const storage = provider;
