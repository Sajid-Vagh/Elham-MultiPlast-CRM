const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  // Check storage.objects columns
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'storage' AND table_name = 'objects'
    ORDER BY ordinal_position
  `);
  console.log("storage.objects columns:");
  for (const c of cols.rows) {
    console.log(`  ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`);
  }

  // Check for any existing objects to see what they look like
  const existing = await client.query("SELECT * FROM storage.objects LIMIT 5");
  console.log("\nExisting objects:", existing.rows.length);
  for (const obj of existing.rows) {
    console.log("  -", JSON.stringify(obj, null, 2).substring(0, 500));
  }

  // Check storage.buckets columns
  const bucketCols = await client.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'storage' AND table_name = 'buckets'
    ORDER BY ordinal_position
  `);
  console.log("\nstorage.buckets columns:");
  for (const c of bucketCols.rows) {
    console.log(`  ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`);
  }

  // Check if voice-notes bucket exists  
  const bucket = await client.query("SELECT * FROM storage.buckets WHERE id = 'voice-notes'");
  console.log("\nvoice-notes bucket:", bucket.rows);

  // Check storage.migrations for hints about how storage works
  try {
    const funcs = await client.query(`
      SELECT routine_name, routine_type 
      FROM information_schema.routines 
      WHERE routine_schema = 'storage' 
      ORDER BY routine_name
      LIMIT 30
    `);
    console.log("\nStorage functions (first 30):");
    for (const f of funcs.rows) {
      console.log(`  ${f.routine_name} (${f.routine_type})`);
    }
  } catch(e) {}

  // The real test: can we insert a real file with actual binary content?
  // Postgres has 'lo' (large objects) but storage.objects might use a different mechanism
  // Let's try inserting actual binary data in a text-like column
  try {
    const fakeAudio = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1D, 0x43, 0x86, 0x81, 0x01, 0x42, 0x87, 0x04, 0x86, 0x83, 0x81, 0x01, 0x57, 0x41, 0x56, 0x45, 0x88, 0x84, 0x01, 0x00, 0x00, 0x01]);
    const result = await client.query(`
      INSERT INTO storage.objects (bucket_id, name, owner, metadata, version)
      VALUES ('voice-notes', 'test-real-data.webm', null, $1::jsonb, '1')
      RETURNING id, name, metadata
    `, [JSON.stringify({ size: fakeAudio.length, mimetype: 'audio/webm', cacheControl: 'no-cache' })]);
    console.log("\nReal data INSERT SUCCESS:", result.rows);
    
    // Can we access it via public URL?
    // Check the file size to see if it's actually stored
    const check = await client.query("SELECT length(metadata::text) as meta_len FROM storage.objects WHERE name = 'test-real-data.webm'");
    console.log("Metadata length:", check.rows);
  } catch (err) {
    console.log("\nReal data INSERT FAILED:", err.message);
  }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
