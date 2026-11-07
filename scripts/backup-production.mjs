import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Auto-load .env or .env.local
const env = {};
const envFiles = ['.env.local', '.env'];
for (const file of envFiles) {
  const fullPath = path.resolve(file);
  if (fs.existsSync(fullPath)) {
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in env)) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[m[1]] = val;
      }
    }
  }
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('[BACKUP ERROR] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const ALL_TABLES = [
  'facebook_accounts',
  'pages',
  'providers',
  'provider_keys',
  'provider_chains',
  'content_profiles',
  'profile_versions',
  'topic_queue_items',
  'series',
  'series_episodes',
  'research_sources',
  'research_items',
  'posts',
  'topic_history',
  'job_logs',
  'alerts',
  'audit_log',
  'settings',
  'provider_usage_daily'
];

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve('.backup', `backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`[BACKUP] Starting full database backup to: ${backupDir}`);
  console.log(`[BACKUP] Source: ${supabaseUrl}`);

  const summary = {
    timestamp: new Date().toISOString(),
    sourceUrl: supabaseUrl,
    tables: {}
  };

  for (const table of ALL_TABLES) {
    try {
      const { data, error } = await client.from(table).select('*');
      if (error) {
        console.error(`[BACKUP] Error fetching table ${table}:`, error.message);
        summary.tables[table] = { error: error.message, count: 0 };
        continue;
      }

      const filePath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data || [], null, 2), 'utf8');
      summary.tables[table] = { count: (data || []).length, file: `${table}.json` };
      console.log(`[BACKUP] Table ${table}: ${data?.length || 0} rows saved.`);
    } catch (err) {
      console.error(`[BACKUP] Exception on table ${table}:`, err.message);
      summary.tables[table] = { error: err.message, count: 0 };
    }
  }

  const summaryPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[BACKUP] Full backup completed successfully! Manifest written to: ${summaryPath}`);
}

backupDatabase().catch(err => {
  console.error('[BACKUP FATAL]', err);
  process.exit(1);
});

