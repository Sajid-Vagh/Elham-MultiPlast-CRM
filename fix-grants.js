const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected\n");

  // 1. Grant schema usage to anon and authenticated roles
  const grants = [
    "GRANT USAGE ON SCHEMA storage TO anon",
    "GRANT USAGE ON SCHEMA storage TO authenticated",
    "GRANT USAGE ON SCHEMA storage TO service_role",
    "GRANT ALL ON storage.objects TO anon",
    "GRANT ALL ON storage.objects TO authenticated",
    "GRANT ALL ON storage.objects TO service_role",
    "GRANT ALL ON storage.buckets TO anon",
    "GRANT ALL ON storage.buckets TO authenticated",
    "GRANT ALL ON storage.buckets TO service_role",
    "GRANT SELECT ON storage.buckets TO anon",
    "GRANT SELECT ON storage.objects TO anon",
    "GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO service_role",
    "GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO anon",
  ];

  for (const sql of grants) {
    try {
      await client.query(sql);
      console.log("OK:", sql);
    } catch (err) {
      console.log("ERR:", sql, "->", err.message);
    }
  }

  // 2. Check what policies exist now
  const policies = await client.query("SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname");
  console.log("\nAll storage policies:");
  for (const p of policies.rows) {
    console.log("  -", p.policyname, "| cmd:", p.cmd, "| roles:", p.roles);
  }

  // 3. Also check for any functions/triggers that Storage API might use
  const funcs = await client.query(`
    SELECT routine_name, routine_type 
    FROM information_schema.routines 
    WHERE routine_schema = 'storage' 
    ORDER BY routine_name 
    LIMIT 20
  `);
  console.log("\nStorage schema functions (first 20):", funcs.rows.map(f => f.routine_name));

  await client.end();
  console.log("\nDone");
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
