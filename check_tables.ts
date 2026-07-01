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

import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    console.log("Tables:", result.rows.map((r: any) => r.table_name).join(", "));

    const docCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents'",
    );
    console.log("documents columns:", docCols.rows.map((r: any) => r.column_name).join(", ") || "(NOT FOUND)");

    const piCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proforma_invoices'",
    );
    console.log("proforma_invoices columns:", piCols.rows.map((r: any) => r.column_name).join(", ") || "(NOT FOUND)");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
