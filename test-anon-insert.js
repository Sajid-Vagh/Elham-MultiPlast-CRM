const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected\n");

  // Test: Can anon role actually INSERT into storage.objects?
  try {
    await client.query("SET ROLE anon");
    const result = await client.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata, version)
      VALUES ('voice-notes', 'test-anon-insert.webm', null, '{"size": 100, "mimetype": "audio/webm"}'::jsonb, '1')
      RETURNING id, name
    `);
    console.log("Anon INSERT SUCCESS:", result.rows);
    await client.query("RESET ROLE");
    // Clean up
    await client.query("DELETE FROM storage.objects WHERE name = 'test-anon-insert.webm'");
  } catch (err) {
    console.log("Anon INSERT FAILED:", err.message);
    await client.query("RESET ROLE");
  }

  // Test: Check if there's an auth.trigger that's blocking inserts
  const triggers = await client.query(`
    SELECT trigger_name, event_manipulation, action_statement 
    FROM information_schema.triggers 
    WHERE event_object_schema = 'storage' AND event_object_table = 'objects'
  `);
  console.log("\nTriggers on storage.objects:");
  for (const t of triggers.rows) {
    console.log("  -", t.trigger_name, "|", t.event_manipulation, "|", t.action_statement.substring(0, 100));
  }

  // Check if there's a supabase_storage_admin role and what it can do
  try {
    await client.query("SET ROLE supabase_storage_admin");
    const result = await client.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata, version)
      VALUES ('voice-notes', 'test-admin-insert.webm', null, '{"size": 100, "mimetype": "audio/webm"}'::jsonb, '1')
      RETURNING id, name
    `);
    console.log("\nSupabase_storage_admin INSERT SUCCESS:", result.rows);
    await client.query("RESET ROLE");
    await client.query("DELETE FROM storage.objects WHERE name = 'test-admin-insert.webm'");
  } catch (err) {
    console.log("\nSupabase_storage_admin INSERT FAILED:", err.message);
    await client.query("RESET ROLE");
  }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
