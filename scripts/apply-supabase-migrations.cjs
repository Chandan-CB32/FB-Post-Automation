const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function applyMigrations() {
  const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
  const pwMatch = envContent.match(/OWNER_PASSWORD=(.*)/);
  const pw = pwMatch ? pwMatch[1].trim() : process.env.OWNER_PASSWORD;
  const ref = 'qoicjeilaqcgldcwyzqs';

  if (!pw) {
    throw new Error('Database password not found in .env.local');
  }

  const client = new Client({
    host: 'aws-0-ap-southeast-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.' + ref,
    password: pw,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to Postgres.');

  const sql1 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261118_content_library.sql'), 'utf8');
  console.log('Applying 20261118_content_library.sql...');
  await client.query(sql1);
  console.log('Successfully applied 20261118_content_library.sql');

  const sql2 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261118_content_library_drive.sql'), 'utf8');
  console.log('Applying 20261118_content_library_drive.sql...');
  await client.query(sql2);
  console.log('Successfully applied 20261118_content_library_drive.sql');

  // Reload PostgREST schema cache
  console.log('Reloading PostgREST schema cache...');
  await client.query("NOTIFY pgrst, 'reload schema';");
  console.log('PostgREST schema cache reloaded!');

  await client.end();
  console.log('Migration completed successfully!');
}

applyMigrations().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
