import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log("Tables:", result.rows.map(r => r.table_name));
  for (const row of result.rows) {
    const tableName = row.table_name;
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [tableName]);
    console.log(`\n${tableName}:`);
    cols.rows.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));
  }
} catch (e) {
  console.error("Error:", e.message);
}
await pool.end();
