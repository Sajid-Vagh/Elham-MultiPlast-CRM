import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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

const { pool } = require("./lib/db/dist/index.js");
const client = await pool.connect();
try {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  console.log("Tables:", result.rows.map((r) => r.table_name).join(", "));

  const tables = ["documents", "document_versions", "proforma_invoices", "proforma_invoice_items"];
  for (const table of tables) {
    const cols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
      [table],
    );
    if (cols.rows.length === 0) {
      console.log(`${table}: TABLE NOT FOUND`);
    } else {
      console.log(`${table}: ${cols.rows.map((r) => r.column_name).join(", ")}`);
    }
  }
} finally {
  client.release();
  await pool.end();
}
