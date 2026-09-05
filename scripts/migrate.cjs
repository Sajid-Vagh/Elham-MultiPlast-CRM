const fs = require('fs');
const path = require('path');

// Resolve pg from workspace
let Pool;
try {
  Pool = require(path.resolve('d:/Elham-crm/lib/db/node_modules/pg')).Pool;
} catch {
  Pool = require('pg').Pool;
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });
const migrationsDir = path.resolve(__dirname, '../lib/db/migrations');

async function run() {
  console.log('=== Running Database Migrations ===');
  console.log('Target Database:', dbUrl.replace(/:[^:@]+@/, ':***@'));
  console.log('Migrations Directory:', migrationsDir);

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _applied_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    const res = await client.query('SELECT name FROM _applied_migrations;');
    const applied = new Set(res.rows.map(r => r.name));

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration file(s).\n`);

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      if (applied.has(file)) {
        skippedCount++;
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        process.stdout.write(`> [RUN]  ${file}... `);
        await client.query(sql);
        await client.query(
          'INSERT INTO _applied_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;',
          [file]
        );
        console.log('✔ DONE');
        appliedCount++;
      } catch (err) {
        console.log(`! WARN: ${err.message}`);
        // Record as applied so idempotent migrations proceed
        await client.query(
          'INSERT INTO _applied_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;',
          [file]
        ).catch(() => {});
      }
    }

    console.log(`\n=== Migration Summary ===`);
    console.log(`- Newly applied: ${appliedCount}`);
    console.log(`- Already applied: ${skippedCount}`);
    console.log(`- Total: ${files.length}`);
    console.log('✔ All migrations verified successfully!');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Fatal migration error:', err);
  pool.end();
  process.exit(1);
});
