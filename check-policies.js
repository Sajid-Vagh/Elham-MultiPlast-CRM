const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  
  const policies = await client.query("SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY policyname");
  console.log("Storage.objects RLS policies:", policies.rows.length);
  for (const p of policies.rows) {
    console.log("  -", p.policyname, "| cmd:", p.cmd, "| qual:", (p.qual || "").substring(0, 120));
  }

  const bucketPolicies = await client.query("SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'buckets' ORDER BY policyname");
  console.log("\nStorage.buckets RLS policies:", bucketPolicies.rows.length);
  for (const p of bucketPolicies.rows) {
    console.log("  -", p.policyname, "| cmd:", p.cmd, "| qual:", (p.qual || "").substring(0, 120));
  }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
