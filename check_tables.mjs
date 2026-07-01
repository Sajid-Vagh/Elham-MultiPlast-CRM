import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");
const envContent = readFileSync(envPath, "utf-8");
envContent.split("\n").forEach((line) => {
  const [key, ...vals] = line.split("=");
  if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
});

const dbPath = "file:///" + resolve(__dirname, "lib/db/src/index.ts").replace(/\\/g, "/");
const { pool } = await import(dbPath);
const client = await pool.connect();
try {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log("Tables found:", result.rows.map((r) => r.table_name).join(", "));

  const docResult = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents'`,
  );
  console.log("\ndocuments columns:", docResult.rows.map((r) => r.column_name).join(", "));
  if (docResult.rows.length === 0) console.log("  (table does not exist)");

  const piResult = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proforma_invoices'`,
  );
  console.log("\nproforma_invoices columns:", piResult.rows.map((r) => r.column_name).join(", "));
  if (piResult.rows.length === 0) console.log("  (table does not exist)");
} finally {
  client.release();
  await pool.end();
}
