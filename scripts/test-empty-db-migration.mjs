import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_TABLES = [
  'content_profiles',
  'profile_versions',
  'facebook_accounts',
  'pages',
  'providers',
  'provider_keys',
  'provider_chains',
  'provider_usage_daily',
  'research_sources',
  'research_items',
  'topic_queue_items',
  'series',
  'series_episodes',
  'posts',
  'topic_history',
  'job_logs',
  'alerts',
  'audit_log',
  'settings'
];

async function runTest() {
  console.log('--- Initializing Empty Postgres Database (PGlite WASM) ---');
  const db = new PGlite();

  const migrationPath = path.resolve('supabase/all_migrations.sql');
  console.log(`Reading: ${migrationPath}`);
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`Executing SQL migration (${sql.length} bytes)...`);
  const startTime = Date.now();
  await db.exec(sql);
  console.log(`Migration executed cleanly in ${Date.now() - startTime}ms.`);

  // 1. Check all expected tables exist
  console.log('\n--- Verifying Tables Existence ---');
  const tablesResult = await db.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  `);
  const actualTables = new Set(tablesResult.rows.map(r => r.table_name));

  let missingTables = 0;
  for (const table of EXPECTED_TABLES) {
    if (actualTables.has(table)) {
      console.log(`  [OK] Table public.${table}`);
    } else {
      console.error(`  [FAIL] Missing table: public.${table}`);
      missingTables++;
    }
  }

  if (missingTables > 0) {
    throw new Error(`Verification failed: ${missingTables} expected table(s) missing.`);
  }

  // 2. Check Row Level Security
  console.log('\n--- Verifying Row Level Security (RLS) ---');
  const rlsResult = await db.query(`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public';
  `);
  const rlsMap = new Map(rlsResult.rows.map(r => [r.tablename, r.rowsecurity]));

  let rlsMissing = 0;
  for (const table of EXPECTED_TABLES) {
    const isEnabled = rlsMap.get(table);
    if (isEnabled) {
      console.log(`  [OK] RLS enabled on public.${table}`);
    } else {
      console.error(`  [FAIL] RLS NOT enabled on public.${table}`);
      rlsMissing++;
    }
  }

  if (rlsMissing > 0) {
    throw new Error(`Verification failed: RLS not enabled on ${rlsMissing} table(s).`);
  }

  // 3. Check storage bucket
  console.log('\n--- Verifying Storage Bucket ---');
  const bucketResult = await db.query(`
    SELECT id, name, public, file_size_limit 
    FROM storage.buckets 
    WHERE id = 'post-images';
  `);

  if (bucketResult.rows.length === 0) {
    throw new Error("Verification failed: Storage bucket 'post-images' not found.");
  }
  const bucket = bucketResult.rows[0];
  if (bucket.public === true) {
    throw new Error("Verification failed: Storage bucket 'post-images' must be private (public = false).");
  }
  console.log(`  [OK] Bucket '${bucket.id}' exists, private: ${!bucket.public}, size limit: ${bucket.file_size_limit} bytes`);

  // 4. Check check_table_rls_status helper function
  console.log('\n--- Testing check_table_rls_status Function ---');
  const rlsFnResult = await db.query(`SELECT * FROM public.check_table_rls_status();`);
  console.log(`  [OK] check_table_rls_status() returned ${rlsFnResult.rows.length} rows.`);

  // 5. Check claim_next_post_job RPC Function
  console.log('\n--- Testing claim_next_post_job Function ---');
  const claimResult = await db.query(`SELECT * FROM public.claim_next_post_job('planned', 'researching');`);
  console.log(`  [OK] claim_next_post_job() executed cleanly (found ${claimResult.rows.length} jobs on empty table).`);

  // 6. Check seed data
  console.log('\n--- Verifying Seed Data ---');
  const settingsResult = await db.query(`SELECT key FROM public.settings;`);
  console.log(`  [OK] Seeded settings: ${settingsResult.rows.map(r => r.key).join(', ')}`);

  const providersResult = await db.query(`SELECT name, kind FROM public.providers;`);
  console.log(`  [OK] Seeded providers count: ${providersResult.rows.length}`);

  console.log('\n============================================================');
  console.log(' ALL DATABASE VERIFICATION CHECKS PASSED ON EMPTY POSTGRES! ');
  console.log('============================================================\n');
}

runTest().catch((err) => {
  console.error('\n[ERROR]', err.message || err);
  process.exit(1);
});

