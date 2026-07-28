/**
 * VOICE NOTE DIAGNOSTIC SCRIPT
 * 
 * This script connects to the production database and Supabase Storage,
 * checks every voice note record, and reports the exact status of each.
 * 
 * Run: node diagnose-voice-notes.js
 */

const { Client } = require("pg");

// Production database
const DB_URL = "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

// Supabase Storage
const SUPABASE_URL = "https://rzcbdtxlkspdgksycamg.supabase.co";
const SUPABASE_KEY = "sb_publishable_t9yVnBGGxHxfdvuHWyCE-g_c2Dojz8y";

async function headRequest(url, headers = {}) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", headers });
    return { status: res.status, ok: res.ok, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()) };
  } catch (err) {
    return { status: 0, ok: false, statusText: err.message, headers: {} };
  }
}

async function getRequest(url, headers = {}) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", headers });
    const contentType = res.headers.get("content-type") || "";
    let body = null;
    if (contentType.includes("json")) {
      body = await res.json().catch(() => null);
    }
    return { status: res.status, ok: res.ok, statusText: res.statusText, contentType, body };
  } catch (err) {
    return { status: 0, ok: false, statusText: err.message, contentType: "", body: null };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("VOICE NOTE DIAGNOSTIC");
  console.log("=".repeat(70));

  // Step 1: Check Supabase API key validity
  console.log("\n--- STEP 1: Supabase API Key Check ---");
  const bucketList = await getRequest(`${SUPABASE_URL}/storage/v1/bucket`, {
    Authorization: `Bearer ${SUPABASE_KEY}`,
  });
  console.log(`API Key Valid: ${bucketList.ok} (HTTP ${bucketList.status})`);
  if (bucketList.ok && bucketList.body) {
    console.log(`Buckets found: ${JSON.stringify(bucketList.body.map(b => ({ id: b.id, public: b.public })), null, 2)}`);
  } else {
    console.log(`Error: ${JSON.stringify(bucketList.body || bucketList.statusText)}`);
  }

  // Step 2: Connect to database
  console.log("\n--- STEP 2: Database Connection ---");
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log("Connected to production database");
  } catch (err) {
    console.error("FAILED to connect to database:", err.message);
    return;
  }

  // Step 3: Query ALL voice notes
  console.log("\n--- STEP 3: Voice Note Records ---");
  const result = await client.query(`
    SELECT 
      vn.id,
      vn.deal_id,
      vn.production_order_id,
      vn.proforma_invoice_id,
      vn.order_id,
      vn.lead_id,
      vn.customer_id,
      vn.uploaded_by_id,
      vn.created_by_role,
      vn.file_name,
      vn.original_name,
      vn.mime_type,
      vn.file_size,
      vn.storage_path,
      vn.duration_ms,
      vn.is_replaced,
      vn.deleted_at,
      vn.created_at,
      u.name as uploader_name
    FROM voice_notes vn
    LEFT JOIN users u ON vn.uploaded_by_id = u.id
    WHERE vn.deleted_at IS NULL
    ORDER BY vn.created_at DESC
  `);

  console.log(`Total voice note records in DB: ${result.rows.length}`);

  if (result.rows.length === 0) {
    console.log("\nNo voice notes found in database.");
    await client.end();
    return;
  }

  // Step 4: For EACH voice note, check Supabase Storage
  console.log("\n--- STEP 4: Per-Note Storage Check ---");
  console.log("=".repeat(70));

  let available = 0;
  let unavailable = 0;

  for (const note of result.rows) {
    const storagePath = note.storage_path;
    const bucketName = storagePath ? storagePath.split("/")[0] : "UNKNOWN";
    const fileInBucket = storagePath ? storagePath.split("/").slice(1).join("/") : "UNKNOWN";

    console.log(`\nVoice Note #${note.id}`);
    console.log(`  DB Record:        EXISTS`);
    console.log(`  Order ID:         production_order=${note.production_order_id}, deal=${note.deal_id}, PI=${note.proforma_invoice_id}`);
    console.log(`  Uploaded By:      ${note.uploader_name || "unknown"} (${note.created_by_role})`);
    console.log(`  Storage Path:     ${storagePath}`);
    console.log(`  Bucket Name:      ${bucketName}`);
    console.log(`  File in Bucket:   ${fileInBucket}`);
    console.log(`  MIME Type:        ${note.mime_type}`);
    console.log(`  File Size:        ${note.file_size} bytes`);
    console.log(`  Duration:         ${note.duration_ms}ms`);
    console.log(`  Is Replaced:      ${note.is_replaced}`);
    console.log(`  Created At:       ${note.created_at}`);

    // Check 1: HEAD on public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`;
    const publicCheck = await headRequest(publicUrl);
    console.log(`  Public URL:       ${publicUrl}`);
    console.log(`  Public HEAD:      HTTP ${publicCheck.status} ${publicCheck.statusText}`);

    // Check 2: HEAD on authenticated URL (if public failed)
    let authCheck = null;
    if (!publicCheck.ok) {
      const authUrl = `${SUPABASE_URL}/storage/v1/object/${storagePath}`;
      authCheck = await headRequest(authUrl, { Authorization: `Bearer ${SUPABASE_KEY}` });
      console.log(`  Auth URL:         ${authUrl}`);
      console.log(`  Auth HEAD:        HTTP ${authCheck.status} ${authCheck.statusText}`);
      if (authCheck.ok) {
        console.log(`  >>> FILE EXISTS but bucket "${bucketName}" is NOT PUBLIC <<<`);
      }
    }

    // Check 3: List objects in bucket to see what's actually there
    if (!publicCheck.ok && (!authCheck || !authCheck.ok)) {
      const listUrl = `${SUPABASE_URL}/storage/v1/object/list/${bucketName}?limit=5&search=${fileInBucket.split("-")[0]}`;
      const listCheck = await getRequest(listUrl, { Authorization: `Bearer ${SUPABASE_KEY}` });
      console.log(`  Bucket List:      HTTP ${listCheck.status}`);
      if (listCheck.ok && listCheck.body) {
        console.log(`  Matching Objects: ${JSON.stringify(listCheck.body)}`);
      }
    }

    // Check 4: Try listing ALL objects in the bucket
    if (!publicCheck.ok && (!authCheck || !authCheck.ok)) {
      const listAllUrl = `${SUPABASE_URL}/storage/v1/object/list/${bucketName}?limit=100`;
      const listAllCheck = await getRequest(listAllUrl, { Authorization: `Bearer ${SUPABASE_KEY}` });
      console.log(`  All Bucket Objects (up to 100): HTTP ${listAllCheck.status}`);
      if (listAllCheck.ok && listAllCheck.body) {
        if (Array.isArray(listAllCheck.body)) {
          console.log(`  Object Count: ${listAllCheck.body.length}`);
          if (listAllCheck.body.length > 0) {
            console.log(`  First 5 objects:`);
            listAllCheck.body.slice(0, 5).forEach(obj => {
              console.log(`    - ${obj.name} (${obj.metadata?.size || "?"} bytes, ${obj.metadata?.mimetype || "?"})`);
            });
          }
        } else {
          console.log(`  Response: ${JSON.stringify(listAllCheck.body)}`);
        }
      }
    }

    // Determine final status
    const fileExists = publicCheck.ok || (authCheck && authCheck.ok);
    const playbackUrl = publicCheck.ok ? publicUrl : (authCheck?.ok ? `${SUPABASE_URL}/storage/v1/object/${storagePath}` : "");

    if (fileExists) {
      available++;
      console.log(`  STATUS:            AVAILABLE (playback URL: ${playbackUrl})`);
    } else {
      unavailable++;
      console.log(`  STATUS:            UNAVAILABLE`);
      if (!publicCheck.ok && !authCheck?.ok) {
        console.log(`  REASON:            File not found in Supabase Storage`);
        console.log(`  This means the file was either:`);
        console.log(`    1. Never uploaded to Supabase (uploaded to local filesystem before migration)`);
        console.log(`    2. Uploaded but subsequently deleted`);
        console.log(`    3. Bucket "${bucketName}" does not exist in Supabase`);
      }
    }
    console.log("  " + "-".repeat(60));
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total Records:     ${result.rows.length}`);
  console.log(`Available:         ${available}`);
  console.log(`Unavailable:       ${unavailable}`);
  console.log(`Supabase Key OK:   ${bucketList.ok}`);
  console.log(`Buckets:           ${bucketList.ok ? JSON.stringify(bucketList.body?.map(b => b.id)) : "N/A"}`);

  // Check if any bucket named "voice-notes" exists
  if (bucketList.ok && bucketList.body) {
    const vnBucket = bucketList.body.find(b => b.id === "voice-notes");
    if (vnBucket) {
      console.log(`voice-notes bucket: EXISTS (public=${vnBucket.public}, file_size_limit=${vnBucket.file_size_limit})`);
    } else {
      console.log(`voice-notes bucket: DOES NOT EXIST — this is a problem!`);
    }
  }

  await client.end();
  console.log("\nDiagnostic complete.");
}

main().catch(err => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
