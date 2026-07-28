const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected to database");

  const tables = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'storage'");
  console.log("Storage schema tables:", tables.rows.map(r => r.table_name));

  try {
    await client.query(`
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('voice-notes', 'voice-notes', true, 10485760, 
        ARRAY['audio/webm','audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/ogg','audio/mp4','audio/m4a','application/pdf','image/jpeg','image/png']::text[])
      ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760
    `);
    console.log("Bucket created/updated successfully");
  } catch (err) {
    console.error("Bucket creation error:", err.message);
  }

  const bucket = await client.query("SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'voice-notes'");
  console.log("Bucket:", JSON.stringify(bucket.rows));

  try {
    const objects = await client.query("SELECT name, created_at FROM storage.objects WHERE bucket_id = 'voice-notes' LIMIT 10");
    console.log("Objects in bucket:", objects.rows.length);
    for (const obj of objects.rows) {
      console.log("  -", obj.name, "created:", obj.created_at);
    }
  } catch (err) {
    console.log("Could not query objects:", err.message);
  }

  await client.end();
  console.log("Done");
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
