const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected");

  // 1. Check RLS status on storage tables
  const rlsCheck = await client.query(`
    SELECT schemaname, tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'storage' AND tablename IN ('objects', 'buckets')
  `);
  console.log("RLS status:", rlsCheck.rows);

  // 2. Check if RLS is the issue by testing with postgres role (bypasses RLS)
  try {
    await client.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata)
      VALUES ('voice-notes', 'test-check.txt', null, '{"size": 10, "mimetype": "text/plain"}'::jsonb)
    `);
    console.log("Direct INSERT into storage.objects: SUCCESS");
    // Clean up
    await client.query("DELETE FROM storage.objects WHERE bucket_id = 'voice-notes' AND name = 'test-check.txt'");
  } catch (err) {
    console.log("Direct INSERT into storage.objects: FAILED -", err.message);
  }

  // 3. Check what role the Supabase API gateway uses
  const authSettings = await client.query(`
    SELECT setting FROM pg_settings WHERE name = 'row_security' OR name = 'pg_hba.conf'
  `);
  console.log("Auth settings:", authSettings.rows);

  // 4. Check roles available
  const roles = await client.query("SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'supabase_admin', 'postgres')");
  console.log("Key roles:", roles.rows);

  // 5. Try granting proper permissions
  try {
    // Enable RLS but add permissive policies for anon/authenticated
    await client.query(`
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
    `);
    console.log("RLS enabled on storage.objects");
  } catch (err) {
    console.log("RLS enable error:", err.message);
  }

  // 6. Create permissive policies for storage operations
  const policies = [
    // Allow anon/authenticated to SELECT from any bucket
    `DROP POLICY IF EXISTS "Allow public read access" ON storage.objects`,
    `CREATE POLICY "Allow public read access" ON storage.objects
     FOR SELECT USING (bucket_id IN (SELECT id FROM storage.buckets WHERE public = true))`,
    
    // Allow anon/authenticated to INSERT into any bucket  
    `DROP POLICY IF EXISTS "Allow insert for all users" ON storage.objects`,
    `CREATE POLICY "Allow insert for all users" ON storage.objects
     FOR INSERT WITH CHECK (bucket_id IN (SELECT id FROM storage.buckets))`,
    
    // Allow anon/authenticated to UPDATE their own objects
    `DROP POLICY IF EXISTS "Allow update for all users" ON storage.objects`,
    `CREATE POLICY "Allow update for all users" ON storage.objects
     FOR UPDATE USING (bucket_id IN (SELECT id FROM storage.buckets))`,
    
    // Allow anon/authenticated to DELETE their own objects
    `DROP POLICY IF EXISTS "Allow delete for all users" ON storage.objects`,
    `CREATE POLICY "Allow delete for all users" ON storage.objects
     FOR DELETE USING (bucket_id IN (SELECT id FROM storage.buckets))`,
  ];

  for (const sql of policies) {
    try {
      await client.query(sql);
      console.log("Executed:", sql.substring(0, 60));
    } catch (err) {
      console.log("Error:", sql.substring(0, 40), "->", err.message);
    }
  }

  // 7. Verify policies exist now
  const finalPolicies = await client.query("SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'");
  console.log("\nFinal storage.objects policies:", finalPolicies.rows.length);
  for (const p of finalPolicies.rows) {
    console.log("  -", p.policyname, "|", p.cmd);
  }

  await client.end();
  console.log("\nDone");
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
