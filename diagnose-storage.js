/**
 * VOICE NOTE DIAGNOSTIC — Supabase Storage only
 * Checks whether the voice-notes bucket exists and files are accessible.
 */

const SUPABASE_URL = "https://rzcbdtxlkspdgksycamg.supabase.co";
const SUPABASE_KEY = "sb_publishable_t9yVnBGGxHxfdvuHWyCE-g_c2Dojz8y";

async function req(url, method = "GET", headers = {}) {
  try {
    const res = await fetch(url, { method, redirect: "follow", headers });
    const ct = res.headers.get("content-type") || "";
    let body = null;
    if (ct.includes("json")) body = await res.json().catch(() => null);
    else body = await res.text().catch(() => null);
    return { status: res.status, ok: res.ok, statusText: res.statusText, body };
  } catch (err) {
    return { status: 0, ok: false, statusText: err.message, body: null };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("SUPABASE STORAGE DIAGNOSTIC");
  console.log("=".repeat(70));

  // 1. Check API key by listing buckets
  console.log("\n[1] API Key + Bucket List");
  const buckets = await req(`${SUPABASE_URL}/storage/v1/bucket`, "GET", {
    Authorization: `Bearer ${SUPABASE_KEY}`,
  });
  console.log(`    Status: HTTP ${buckets.status}`);
  if (buckets.ok && Array.isArray(buckets.body)) {
    for (const b of buckets.body) {
      console.log(`    Bucket: "${b.id}" | public=${b.public} | fileSizeLimit=${b.file_size_limit} | allowed=${JSON.stringify(b.allowed_mime_types)}`);
    }
  } else {
    console.log(`    ERROR: ${JSON.stringify(buckets.body)}`);
  }

  // 2. Check if "voice-notes" bucket exists
  const vnBucket = buckets.ok ? buckets.body?.find(b => b.id === "voice-notes") : null;
  console.log(`\n[2] "voice-notes" bucket exists: ${vnBucket ? "YES" : "NO"}`);
  if (vnBucket) {
    console.log(`    public: ${vnBucket.public}`);
    console.log(`    file_size_limit: ${vnBucket.file_size_limit}`);
    console.log(`    allowed_mime_types: ${JSON.stringify(vnBucket.allowed_mime_types)}`);
  }

  // 3. Try to create the bucket if it doesn't exist
  if (!vnBucket) {
    console.log("\n[3] Attempting to create 'voice-notes' bucket...");
    const create = await req(`${SUPABASE_URL}/storage/v1/bucket`, "POST", {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    }, JSON.stringify({
      id: "voice-notes",
      name: "voice-notes",
      public: true,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: [
        "audio/webm", "audio/mpeg", "audio/mp3",
        "audio/wav", "audio/wave", "audio/x-wav",
        "audio/ogg", "audio/mp4", "audio/m4a",
        "application/pdf", "image/jpeg", "image/png",
      ],
    }));
    console.log(`    Status: HTTP ${create.status}`);
    console.log(`    Response: ${JSON.stringify(create.body)}`);
  }

  // 4. Try to list objects in the voice-notes bucket
  if (vnBucket || !buckets.ok) {
    console.log("\n[4] List objects in 'voice-notes' bucket");
    const list = await req(`${SUPABASE_URL}/storage/v1/object/list/voice-notes?limit=200`, "GET", {
      Authorization: `Bearer ${SUPABASE_KEY}`,
    });
    console.log(`    Status: HTTP ${list.status}`);
    if (list.ok && Array.isArray(list.body)) {
      console.log(`    Total objects: ${list.body.length}`);
      if (list.body.length === 0) {
        console.log("    *** BUCKET IS EMPTY — no files stored ***");
      } else {
        for (const obj of list.body.slice(0, 10)) {
          console.log(`    - ${obj.name} | size=${obj.metadata?.size || "?"} | type=${obj.metadata?.mimetype || "?"} | created=${obj.created_at || "?"}`);
        }
        if (list.body.length > 10) {
          console.log(`    ... and ${list.body.length - 10} more`);
        }
      }
    } else {
      console.log(`    Response: ${JSON.stringify(list.body)}`);
    }
  }

  // 5. Test public URL access
  console.log("\n[5] Public URL Access Test");
  const testUrl = `${SUPABASE_URL}/storage/v1/object/public/voice-notes/test-file.webm`;
  const pubTest = await req(testUrl, "HEAD");
  console.log(`    HEAD ${testUrl}`);
  console.log(`    Status: HTTP ${pubTest.status} (expected 404 for non-existent file)`);

  // 6. If bucket doesn't exist, also try "documents" bucket
  console.log("\n[6] Check 'documents' bucket (used by other uploads)");
  const docBucket = buckets.ok ? buckets.body?.find(b => b.id === "documents") : null;
  console.log(`    "documents" bucket exists: ${docBucket ? "YES" : "NO"}`);
  if (docBucket) {
    console.log(`    public: ${docBucket.public}`);
  }

  // 7. List ALL buckets and their details
  console.log("\n[7] All buckets summary");
  if (buckets.ok && Array.isArray(buckets.body)) {
    for (const b of buckets.body) {
      const objs = await req(`${SUPABASE_URL}/storage/v1/object/list/${b.id}?limit=5`, "GET", {
        Authorization: `Bearer ${SUPABASE_KEY}`,
      });
      const count = Array.isArray(objs.body) ? objs.body.length : "?";
      console.log(`    "${b.id}": public=${b.public}, objects(>0)=${count}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("DONE");
  console.log("=".repeat(70));
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
