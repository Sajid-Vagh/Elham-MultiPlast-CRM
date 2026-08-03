require("dotenv").config();
const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  console.error("Create a .env file at the repo root with DATABASE_URL=<postgres connection string>.");
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected\n");

  // The postgres role should bypass RLS (as table owner? or superuser equivalent?)
  try {
    const result = await client.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata, version)
      VALUES ('voice-notes', 'test-postgres-insert.webm', null, '{"size": 100, "mimetype": "audio/webm"}'::jsonb, '1')
      RETURNING id, name
    `);
    console.log("Postgres INSERT SUCCESS:", result.rows);
    // Clean up
    await client.query("DELETE FROM storage.objects WHERE name = 'test-postgres-insert.webm'");
    console.log("Cleaned up test record");
  } catch (err) {
    console.log("Postgres INSERT FAILED:", err.message);
  }

  // Now the real test: Can we create a SECURITY DEFINER function that inserts?
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION storage.insert_object_direct(
        p_bucket_id text, p_name text, p_metadata jsonb
      ) RETURNS jsonb AS $$
      DECLARE
        v_id uuid;
      BEGIN
        INSERT INTO storage.objects (bucket_id, name, owner, metadata, version)
        VALUES (p_bucket_id, p_name, null, p_metadata, '1')
        RETURNING id INTO v_id;
        RETURN jsonb_build_object('id', v_id, 'name', p_name);
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER
    `);
    console.log("\nCreated SECURITY DEFINER function");

    // Test it
    const result = await client.query("SELECT storage.insert_object_direct('voice-notes', 'test-func-insert.webm', '{\"size\": 100, \"mimetype\": \"audio/webm\"}'::jsonb)");
    console.log("Function INSERT SUCCESS:", result.rows);
    await client.query("DELETE FROM storage.objects WHERE name = 'test-func-insert.webm'");
  } catch (err) {
    console.log("Function creation/insert FAILED:", err.message);
  }

  // Check: what about Supabase's can_insert_object function?
  try {
    const canInsert = await client.query("SELECT storage.can_insert_object('voice-notes')");
    console.log("\ncan_insert_object('voice-notes'):", canInsert.rows);
  } catch (err) {
    console.log("\ncan_insert_object error:", err.message);
  }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
