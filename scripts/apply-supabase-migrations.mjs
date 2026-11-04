import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

async function applyMigrations() {
  console.log('Connecting to Supabase PostgreSQL at aws-0-ap-southeast-1.pooler.supabase.com:5432...');
  const client = new Client({
    host: 'aws-0-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.qoicjeilaqcgldcwyzqs',
    password: 'ec1xcMEJBdihhNQH',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected successfully as postgres user.');

  const migrationPath = path.resolve('supabase/all_migrations.sql');
  console.log(`Reading SQL file: ${migrationPath}`);
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`Applying migrations (${sql.length} bytes)...`);
  const start = Date.now();
  await client.query(sql);
  console.log(`Migrations successfully applied in ${Date.now() - start}ms.`);

  // Verify tables
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  console.log(`\nCreated ${res.rows.length} tables in public schema:`);
  for (const row of res.rows) {
    console.log(`  - ${row.table_name}`);
  }

  await client.end();
}

applyMigrations().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
