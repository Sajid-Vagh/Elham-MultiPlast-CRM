const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // List ALL policies on storage.objects with full details
  const policies = await client.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects'
    ORDER BY policyname
  `);
  console.log("All storage.objects policies:", policies.rows.length);
  for (const p of policies.rows) {
    console.log("---");
    console.log("  name:", p.policyname);
    console.log("  permissive:", p.permissive);
    console.log("  roles:", p.roles);
    console.log("  cmd:", p.cmd);
    console.log("  qual:", p.qual);
    console.log("  with_check:", p.with_check);
  }

  // Check if RLS is actually enforced (maybe the table has FORCE ROW LEVEL SECURITY)
  const tableInfo = await client.query(`
    SELECT relname, relowner::regrole, relrowsecurity, relforcerowsecurity
    FROM pg_class 
    WHERE relname = 'objects' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'storage')
  `);
  console.log("\nTable RLS info:", tableInfo.rows);

  // Try creating a test table with RLS and matching policy to see if the mechanism works
  try {
    await client.query("DROP TABLE IF EXISTS test_rls_check");
    await client.query("CREATE TABLE test_rls_check (id int, data text)");
    await client.query("ALTER TABLE test_rls_check ENABLE ROW LEVEL SECURITY");
    await client.query("CREATE POLICY test_policy ON test_rls_check FOR INSERT TO public WITH CHECK (true)");
    await client.query("SET ROLE anon");
    await client.query("INSERT INTO test_rls_check VALUES (1, 'test')");
    console.log("\nAnon can INSERT on test table: YES");
    await client.query("RESET ROLE");
    await client.query("DROP TABLE test_rls_check");
  } catch (err) {
    console.log("\nAnon can INSERT on test table: NO -", err.message);
    await client.query("RESET ROLE").catch(() => {});
    await client.query("DROP TABLE test_rls_check").catch(() => {});
  }

  // Check if the issue is that the postgres role on pgbouncer can't set role
  try {
    await client.query("SET ROLE anon");
    const currentRole = await client.query("SELECT current_user, session_user");
    console.log("\nAfter SET ROLE anon:", currentRole.rows);
    await client.query("RESET ROLE");
  } catch (err) {
    console.log("\nSET ROLE failed:", err.message);
  }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
