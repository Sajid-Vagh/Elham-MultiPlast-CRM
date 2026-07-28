const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // Check Supabase auth settings
  const settings = await client.query(`
    SELECT name, setting FROM pg_settings 
    WHERE name LIKE '%pgrst%' OR name LIKE '%supabase%' OR name LIKE '%postgrest%'
  `);
  console.log("PostgREST/Supabase settings:", settings.rows);

  // Check the authenticator role and its role graph
  const roleGraph = await client.query(`
    SELECT rolname, rolsuper, rolcreaterole, rolcanlogin, 
           (SELECT array_agg(m.member::regrole) FROM pg_auth_members m WHERE m.roleid = r.oid) as member_of
    FROM pg_roles r 
    WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin', 'postgres')
    ORDER BY rolname
  `);
  console.log("\nRole hierarchy:");
  for (const r of roleGraph.rows) {
    console.log(`  ${r.rolname}: super=${r.rolsuper}, login=${r.rolcanlogin}, member_of=${JSON.stringify(r.member_of)}`);
  }

  // Check if storage has its own schema-level grants for authenticator
  const authGrants = await client.query(`
    SELECT grantee, privilege_type, table_name 
    FROM information_schema.table_privileges 
    WHERE table_schema = 'storage' AND grantee IN ('anon', 'authenticated', 'service_role', 'authenticator')
    ORDER BY grantee, table_name
  `);
  console.log("\nStorage table grants:");
  for (const g of authGrants.rows) {
    console.log(`  ${g.grantee}: ${g.privilege_type} on ${g.table_name}`);
  }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
