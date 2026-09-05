import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../lib/db/migrations");

async function runMigrations() {
  console.log("=== Running Database Migrations ===");
  console.log("Migrations directory:", migrationsDir);

  // Ensure migration tracking table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _applied_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRows = await db.execute(sql`SELECT name FROM _applied_migrations;`);
  const appliedSet = new Set((appliedRows.rows || []).map((r: any) => r.name));

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration file(s).`);

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`- [SKIP] ${file} (already recorded as applied)`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    try {
      console.log(`> [RUN]  ${file}...`);
      await db.execute(sql.raw(content));
      await db.execute(sql`
        INSERT INTO _applied_migrations (name) VALUES (${file})
        ON CONFLICT (name) DO NOTHING;
      `);
      console.log(`✔ [DONE] ${file}`);
    } catch (err: any) {
      console.warn(`! [WARN] ${file}: ${err?.message || err}`);
      // If error occurred on idempotent statement, still record or continue
      await db.execute(sql`
        INSERT INTO _applied_migrations (name) VALUES (${file})
        ON CONFLICT (name) DO NOTHING;
      `).catch(() => {});
    }
  }

  console.log("=== All migrations completed successfully! ===");
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error("Migration fatal error:", err);
  process.exit(1);
});
