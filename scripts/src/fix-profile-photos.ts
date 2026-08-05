import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

// Root cause: some profile_photo rows hold a relative local path
// ("/api/uploads/profile-photos/<file>.jpg") because the photo was uploaded
// while the local-filesystem storage provider was active. On Render/Vercel the
// local filesystem is ephemeral, so those URLs 404 and the avatar falls back to
// initials for everyone except the Admin (whose photo is a full Supabase URL).
//
// This script:
//   1. Finds every user whose profile_photo is a relative /api/uploads path.
//   2. If the source file still exists on disk, uploads it to the Supabase
//      "profile-photos" bucket and updates the DB row to the public URL.
//   3. Reports users whose source file no longer exists (must be re-uploaded
//      manually via Settings → Edit Profile → Upload Photo).
//
// Run:      npm run fix-profile-photos            (dry run)
//           npm run fix-profile-photos -- --apply (writes to the database)
//
// Env:      SUPABASE_URL + SUPABASE_KEY (+ optional SUPABASE_SERVICE_ROLE_KEY)

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";

const LOCAL_ROOTS = [
  path.resolve(process.cwd(), "uploads"),
  path.resolve(process.cwd(), "../uploads"),
  path.resolve(process.cwd(), "../artifacts/api-server/uploads"),
  path.resolve(process.cwd(), "../artifacts/api-server/uploads/uploads"),
];

function findLocalFile(storagePath: string): string | null {
  for (const root of LOCAL_ROOTS) {
    const full = path.join(root, storagePath);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function uploadToSupabase(storagePath: string, filePath: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("   ! SUPABASE_URL / SUPABASE_KEY not set — cannot upload.");
    return false;
  }
  const ext = storagePath.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  };
  const buffer = fs.readFileSync(filePath);
  const url = `${SUPABASE_URL}/storage/v1/object/${storagePath}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": mimeMap[ext] || "application/octet-stream",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    console.error(`   ! Supabase upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(`Profile photo backfill — ${APPLY ? "APPLY mode (writes DB)" : "DRY RUN (no writes)"}\n`);

  const users = await db.select().from(usersTable).orderBy(usersTable.id);
  const broken: Array<{ id: number; name: string; url: string }> = [];

  for (const u of users) {
    const url = u.profilePhoto;
    if (!url || url.startsWith("http")) continue; // absolute URL already fine
    if (!url.startsWith("/api/uploads/")) {
      console.log(`#${u.id} ${u.name}: unrecognized relative value — "${url}"`);
      continue;
    }
    const storagePath = url.replace(/^\/api\/uploads\//, "");
    const local = findLocalFile(storagePath);
    if (!local) {
      broken.push({ id: u.id, name: u.name, url });
      console.log(`#${u.id} ${u.name}: source file MISSING (${url}) — re-upload manually.`);
      continue;
    }
    console.log(`#${u.id} ${u.name}: local file found at ${local}`);
    if (!APPLY) continue;
    const ok = await uploadToSupabase(storagePath, local);
    if (ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`;
      await db.update(usersTable).set({ profilePhoto: publicUrl }).where(eq(usersTable.id, u.id));
      console.log(`   -> updated profile_photo to ${publicUrl}`);
    }
  }

  console.log(`\nSummary: ${broken.length} user(s) need manual photo re-upload:`);
  for (const b of broken) console.log(`   #${b.id} ${b.name} — upload via Settings → Edit Profile (${b.url})`);
  console.log(APPLY ? "Done." : "Run with --apply to write changes.");
}

main()
  .catch((e) => {
    console.error("Error:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
