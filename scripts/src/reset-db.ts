import { pool } from "@workspace/db";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("Error: DATABASE_URL environment variable is required.");
  process.exit(1);
}

async function main() {
  console.log("Connecting to Database...");
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT current_database(), current_user");
    console.log("Connected to DB:", res.rows[0]);

    // Dynamically query all existing base tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '__drizzle%'
    `);

    const tables = tablesRes.rows.map(r => r.table_name);
    if (tables.length === 0) {
      console.log("No tables found to truncate.");
      return;
    }

    console.log(`Found ${tables.length} tables in production database:`, tables.join(", "));
    console.log(`Truncating all tables and restarting sequences to 1...`);
    const query = `TRUNCATE TABLE ${tables.map(t => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`;
    await client.query(query);
    console.log("✅ All production tables successfully wiped and reset to 0!");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
