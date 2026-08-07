import { pool } from "@workspace/db";

// Resets PostgreSQL auto-increment sequences after test rows were deleted,
// so newly created records pick up the next available integer instead of
// leaving gaps (e.g. EML_2627_1 → EML_2627_5).
//
// It is safe to re-run: for each table it reads the current MAX(id) and
// calls setval() on the owning sequence to continue from MAX(id) + 1.
// Empty tables are reset so the next id is 1.
//
// Run:      npm run reset-sequences              (dry run — prints what it would do)
//           npm run reset-sequences -- --apply   (writes to the database)
//           npm run reset-sequences -- orders proforma_invoices   (custom tables)
//
// Env:      DATABASE_URL (loaded via --env-file ../.env)

const DEFAULT_TABLES = ["orders", "proforma_invoices", "deals", "contacts"];

const APPLY = process.argv.includes("--apply");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tables = args.length > 0 ? args : DEFAULT_TABLES;

// Identifiers cannot be bound as parameters in pg, so only accept safe names.
const TABLE_NAME_RE = /^[a-z_][a-z0-9_]*$/;

interface Result {
  table: string;
  seqName: string;
  maxId: number | null;
  next: number;
  status: string;
}

function isSafeIdentifier(name: string): boolean {
  return TABLE_NAME_RE.test(name);
}

async function main() {
  console.log(`Sequence reset — ${APPLY ? "APPLY mode (writes DB)" : "DRY RUN (no writes)"}\n`);

  const results: Result[] = [];
  const client = await pool.connect();
  try {
    for (const table of tables) {
      if (!isSafeIdentifier(table)) {
        console.log(`  ! Skipping "${table}" — not a valid table name.`);
        continue;
      }

      // 1. Find the serial sequence owning this table's `id` column.
      const seqRes = await client.query("SELECT pg_get_serial_sequence($1, 'id') AS seq", [table]);
      let seqName: string | null = seqRes.rows[0]?.seq ?? null;

      if (!seqName) {
        // Fallback to the conventional <table>_id_seq name, but confirm it exists.
        seqName = `${table}_id_seq`;
        const exists = await client.query("SELECT to_regclass($1) AS rel", [seqName]);
        if (exists.rows[0]?.rel === null) {
          console.log(`  ! Skipping "${table}" — no serial sequence found (tried "${seqName}").`);
          continue;
        }
      }

      // 2. Current MAX(id). pg returns int8 as a string, so coerce with Number().
      const maxRes = await client.query(`SELECT MAX(id)::bigint AS max_id FROM ${table}`);
      const rawMax = maxRes.rows[0]?.max_id;
      const maxId = rawMax === null || rawMax === undefined ? null : Number(rawMax);

      if (maxId === null) {
        // Empty table → next id should be 1.
        if (APPLY) {
          await client.query("SELECT setval($1::regclass, 1, false)", [seqName]);
        }
        results.push({ table, seqName, maxId: null, next: 1, status: APPLY ? "set → next 1" : "would set → next 1" });
      } else {
        // Non-empty → next id should be MAX(id) + 1.
        const next = maxId + 1;
        if (APPLY) {
          await client.query("SELECT setval($1::regclass, $2, true)", [seqName, maxId]);
        }
        results.push({ table, seqName, maxId, next, status: APPLY ? `set → next ${next}` : `would set → next ${next}` });
      }
    }
  } finally {
    client.release();
  }

  console.log("");
  const header = ["Table", "Sequence", "Max ID", "Next ID", "Status"].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log([r.table, r.seqName, r.maxId === null ? "(empty)" : String(r.maxId), String(r.next), r.status].join(" | "));
  }

  if (results.length === 0) {
    console.log("\nNo sequences were found to reset.");
  } else {
    console.log(APPLY ? "\nDone." : "\nRun with --apply to write the changes.");
  }
}

main()
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
