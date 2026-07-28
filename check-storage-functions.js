const { Client } = require("D:/Elham-crm/lib/db/node_modules/pg");

const client = new Client({
  connectionString: "postgresql://postgres.rzcbdtxlkspdgksycamg:Elhammultiplast@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log("Connected\n");

  // 1. Check if there's an internal upload function
  try {
    const funcs = await client.query(`
      SELECT routine_name, routine_type, security_type
      FROM information_schema.routines 
      WHERE routine_schema = 'storage' 
      AND (routine_name LIKE '%upload%' OR routine_name LIKE '%insert%' OR routine_name LIKE '%put%')
      ORDER BY routine_name
    `);
    console.log("Storage upload/insert functions:");
    for (const f of funcs.rows) {
      console.log(`  ${f.routine_name} (${f.routine_type}, security=${f.security_type})`);
    }
  } catch(e) { console.log("Error listing functions:", e.message); }

  // 2. Check the full signature of storage.upload or storage.insert
  try {
    const uploadFunc = await client.query(`
      SELECT p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as returns,
             p.prosecdef as security_definer, p.proacl as grants
      FROM pg_proc p 
      JOIN pg_namespace n ON p.pronamespace = n.oid 
      WHERE n.nspname = 'storage' AND p.proname LIKE '%upload%'
    `);
    console.log("\nStorage upload function details:");
    for (const f of uploadFunc.rows) {
      console.log(`  ${f.proname}(${f.args}) → ${f.returns}`);
      console.log(`    security_definer: ${f.security_definer}`);
      console.log(`    grants: ${f.grants}`);
    }
  } catch(e) { console.log("Error:", e.message); }

  // 3. Try to call the storage upload function directly
  // First, see what functions are callable
  try {
    const allFuncs = await client.query(`
      SELECT p.proname, pg_get_function_arguments(p.oid) as args
      FROM pg_proc p 
      JOIN pg_namespace n ON p.pronamespace = n.oid 
      WHERE n.nspname = 'storage'
      ORDER BY p.proname
    `);
    console.log("\nAll storage functions:");
    for (const f of allFuncs.rows) {
      console.log(`  ${f.proname}(${f.args})`);
    }
  } catch(e) { console.log("Error:", e.message); }

  // 4. Try the simplest internal function approach
  // The Storage API likely uses a function like storage.upload() 
  // that handles both the S3 upload and metadata insert
  try {
    // Try calling storage.operation - it might be the base function
    const op = await client.query(`SELECT storage.operation()`);
    console.log("\nstorage.operation():", op.rows);
  } catch(e) { console.log("\nstorage.operation():", e.message); }

  await client.end();
}

main().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
