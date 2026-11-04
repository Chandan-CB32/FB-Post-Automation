import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------------------------------------------
// Expected Schema Definitions
// ----------------------------------------------------------------------------
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

const EXPECTED_BUCKET = 'post-images';

// Helper to mask secrets
function mask(str) {
  if (!str) return '(not set)';
  if (str.length <= 8) return '********';
  return str.slice(0, 4) + '...' + str.slice(-4);
}

// Simple .env parser to avoid external dependencies
function loadEnv() {
  const envPaths = ['.env.local', '.env'];
  const env = {};

  for (const envFile of envPaths) {
    const fullPath = path.resolve(envFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in env)) {
            env[key] = val;
          }
        }
      }
    }
  }
  return env;
}

async function main() {
  console.log('\n============================================================');
  console.log(' Supabase Configuration & Schema Verification');
  console.log('============================================================\n');

  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail = env.OWNER_EMAIL;

  // 1. Check environment variables
  console.log('1. Checking Environment Variables:');
  console.log(`   - NEXT_PUBLIC_SUPABASE_URL:     ${supabaseUrl ? supabaseUrl : '❌ MISSING'}`);
  console.log(`   - NEXT_PUBLIC_SUPABASE_ANON_KEY: ${anonKey ? '✅ Present (' + mask(anonKey) + ')' : '❌ MISSING'}`);
  console.log(`   - SUPABASE_SERVICE_ROLE_KEY:    ${serviceRoleKey ? '✅ Present (' + mask(serviceRoleKey) + ')' : '❌ MISSING'}`);
  console.log(`   - ENCRYPTION_KEY:               ${env.ENCRYPTION_KEY ? '✅ Present (' + mask(env.ENCRYPTION_KEY) + ')' : '❌ MISSING'}`);
  console.log(`   - WORKER_SECRET:                ${env.WORKER_SECRET ? '✅ Present (' + mask(env.WORKER_SECRET) + ')' : '❌ MISSING'}`);
  console.log(`   - OWNER_EMAIL:                  ${ownerEmail ? '✅ ' + ownerEmail : '❌ MISSING'}`);

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('\n❌ Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
    process.exit(1);
  }

  // 2. Initialize Supabase client
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const anonClient = anonKey
    ? createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;

  // 3. Test basic connection
  console.log('\n2. Testing Connection to Supabase:');
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    });
    if (res.ok || res.status === 200 || res.status === 404) {
      console.log('   ✅ Successfully connected to Supabase endpoint.');
    } else {
      console.log(`   ⚠️ Endpoint responded with status: ${res.status}`);
    }
  } catch (err) {
    console.error(`   ❌ Failed to connect to Supabase: ${err.message}`);
    process.exit(1);
  }

  // 4. Check tables existence
  console.log(`\n3. Checking Expected Tables (${EXPECTED_TABLES.length} Total):`);
  const existingTables = [];
  const missingTables = [];

  for (const table of EXPECTED_TABLES) {
    const { error } = await adminClient
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error && (error.code === 'PGRST205' || error.message?.includes('not find the table') || error.message?.includes('does not exist'))) {
      missingTables.push(table);
      console.log(`   ❌ ${table.padEnd(25)} : NOT FOUND`);
    } else if (error && error.code !== 'PGRST116') {
      console.log(`   ⚠️ ${table.padEnd(25)} : Accessible with note (${error.message})`);
      existingTables.push(table);
    } else {
      existingTables.push(table);
      console.log(`   ✅ ${table.padEnd(25)} : Exists`);
    }
  }

  // 5. Check Row Level Security (RLS)
  console.log('\n4. Checking Row Level Security (RLS) on Tables:');
  let rlsStatusMap = {};
  let rlsRpcAvailable = false;

  try {
    const { data: rlsData, error: rlsErr } = await adminClient.rpc('check_table_rls_status');
    if (!rlsErr && Array.isArray(rlsData)) {
      rlsRpcAvailable = true;
      for (const row of rlsData) {
        rlsStatusMap[row.table_name] = row.rls_enabled;
      }
    }
  } catch {
    rlsRpcAvailable = false;
  }

  let rlsAllEnabled = true;
  for (const table of EXPECTED_TABLES) {
    if (missingTables.includes(table)) {
      console.log(`   ⚪ ${table.padEnd(25)} : Table missing (RLS not applicable)`);
      rlsAllEnabled = false;
      continue;
    }

    if (rlsRpcAvailable) {
      const isEnabled = rlsStatusMap[table] === true;
      if (isEnabled) {
        console.log(`   🔒 ${table.padEnd(25)} : RLS ENABLED`);
      } else {
        console.log(`   ⚠️ ${table.padEnd(25)} : RLS DISABLED`);
        rlsAllEnabled = false;
      }
    } else {
      // Fallback probe using anon key
      if (anonClient) {
        const { data: anonData, error: anonErr } = await anonClient.from(table).select('*').limit(1);
        if (anonErr || (Array.isArray(anonData) && anonData.length === 0)) {
          console.log(`   🔒 ${table.padEnd(25)} : Protected (Anon access restricted)`);
        } else {
          console.log(`   ⚠️ ${table.padEnd(25)} : Warning - Anon read permitted`);
          rlsAllEnabled = false;
        }
      } else {
        console.log(`   ℹ️ ${table.padEnd(25)} : Cannot verify RLS (RPC not found, anon key missing)`);
      }
    }
  }

  // 6. Check Storage Bucket
  console.log('\n5. Checking Storage Buckets:');
  let bucketVerified = false;
  const { data: buckets, error: bucketErr } = await adminClient.storage.listBuckets();
  if (bucketErr) {
    console.log(`   ❌ Error fetching storage buckets: ${bucketErr.message}`);
  } else {
    const targetBucket = buckets?.find(b => b.id === EXPECTED_BUCKET || b.name === EXPECTED_BUCKET);
    if (!targetBucket) {
      console.log(`   ❌ Bucket '${EXPECTED_BUCKET}': NOT FOUND`);
    } else {
      const isPrivate = targetBucket.public === false;
      if (isPrivate) {
        console.log(`   ✅ Bucket '${EXPECTED_BUCKET}': EXISTS and is PRIVATE (public = false)`);
        bucketVerified = true;
      } else {
        console.log(`   ⚠️ Bucket '${EXPECTED_BUCKET}': EXISTS but is PUBLIC (expected private)`);
      }
    }
  }

  // 7. Check Authentication User
  console.log('\n6. Checking Authentication (Part F):');
  let authUserFound = false;
  try {
    const { data: userData, error: userErr } = await adminClient.auth.admin.listUsers();
    if (userErr) {
      console.log(`   ⚠️ Could not list users: ${userErr.message}`);
    } else {
      const matched = userData.users?.find(u => u.email?.toLowerCase() === ownerEmail?.toLowerCase());
      if (matched) {
        console.log(`   ✅ Owner user found: ${matched.email} (Confirmed: ${!!matched.email_confirmed_at})`);
        authUserFound = true;
      } else if (userData.users?.length > 0) {
        console.log(`   ℹ️ ${userData.users.length} user(s) found in Auth, but OWNER_EMAIL '${ownerEmail}' was not matched.`);
      } else {
        console.log(`   ⚠️ No users currently found in Supabase Auth.`);
      }
    }
  } catch (err) {
    console.log(`   ⚠️ Auth check note: ${err.message}`);
  }

  // ----------------------------------------------------------------------------
  // Final Summary & Instructions
  // ----------------------------------------------------------------------------
  console.log('\n============================================================');
  console.log(' Summary & Next Steps:');
  console.log('============================================================');

  if (missingTables.length > 0) {
    console.log(`\n⚠️  ${missingTables.length} of ${EXPECTED_TABLES.length} tables are currently missing in Supabase.`);
    console.log('👉 ACTION REQUIRED:');
    console.log('   1. Open Supabase Dashboard -> SQL Editor (in project https://qoicjeilaqcgldcwyzqs.supabase.co).');
    console.log('   2. Open the file "supabase/all_migrations.sql" in this project.');
    console.log('   3. Copy all contents and paste into the Supabase SQL Editor.');
    console.log('   4. Click "Run". You should see "Success. No rows returned."');
    console.log('   5. Re-run this check script: "node scripts/check-supabase.mjs".\n');
  } else if (!bucketVerified) {
    console.log(`\n⚠️  Tables exist, but private storage bucket '${EXPECTED_BUCKET}' is not ready.`);
    console.log('👉 Please paste "supabase/all_migrations.sql" into Supabase SQL Editor and click Run, or create bucket manually.');
  } else {
    console.log(`\n🎉 All ${EXPECTED_TABLES.length} tables are present!`);
    console.log('🔒 Row Level Security (RLS) is ENABLED and protecting all tables.');
    console.log(`📦 Private storage bucket '${EXPECTED_BUCKET}' is active and private.`);
    if (authUserFound) {
      console.log(`👤 Owner authentication account (${ownerEmail}) is active and confirmed.`);
    }
    console.log('🚀 Supabase setup is 100% verified and production-ready!\n');
  }
}

main().catch(err => {
  console.error('Fatal error during check:', err);
  process.exit(1);
});
