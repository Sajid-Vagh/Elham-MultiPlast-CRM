const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function main() {
  const client = await pool.connect();
  try {
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    console.log("Tables:", tables.rows.map((r) => r.table_name).join(", "));

    const checks = ["documents", "document_versions", "proforma_invoices", "proforma_invoice_items"];
    for (const t of checks) {
      const cols = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [t],
      );
      if (cols.rows.length === 0) {
        console.log(`${t}: TABLE NOT FOUND`);
      } else {
        console.log(`${t}: ${cols.rows.map((r) => r.column_name).join(", ")}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  pool.end();
});
