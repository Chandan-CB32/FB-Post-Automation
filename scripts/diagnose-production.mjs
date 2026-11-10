import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load env from .env.local first, then .env
function loadEnv() {
  const env = {};
  for (const filename of ['.env.local', '.env']) {
    if (fs.existsSync(filename)) {
      const lines = fs.readFileSync(filename, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
        if (m) {
          let val = m[2].trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!env[m[1]]) env[m[1]] = val;
        }
      }
    }
  }
  return env;
}

const env = loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('[Diagnose] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function runDiagnostics() {
  console.log('=== TASK 0.1: PAGES & ACCOUNTS READ-ONLY CHECK ===');
  
  // 1. Check facebook_accounts
  const { data: accounts, error: accErr } = await client
    .from('facebook_accounts')
    .select('id, account_name, fb_user_id, email, token_status, created_at, updated_at');
  
  if (accErr) {
    console.error('Error querying facebook_accounts:', accErr.message);
  } else {
    console.log(`Total facebook_accounts rows: ${accounts.length}`);
    for (const acc of accounts) {
      console.log(`- Account ID: ${acc.id} | Name: ${acc.account_name} | FB User ID: ${acc.fb_user_id} | Status: ${acc.token_status}`);
    }
  }

  // 2. Check pages
  const { data: pages, error: pagesErr } = await client
    .from('pages')
    .select('*');

  if (pagesErr) {
    console.error('Error querying pages:', pagesErr.message);
  } else {
    console.log(`Total pages rows: ${pages.length}`);
    const targetPrefix = 'bf56ab0c';
    const foundTarget = pages.find(p => p.id && p.id.toLowerCase().startsWith(targetPrefix));
    console.log(`Page starting with "${targetPrefix}": ${foundTarget ? 'FOUND' : 'NOT FOUND'}`);

    for (const p of pages) {
      const isTarget = p.id && p.id.toLowerCase().startsWith(targetPrefix);
      const maskedToken = p.fb_page_token ? `[MASKED len=${p.fb_page_token.length}]` : '[NONE]';
      console.log(`\nPage Row ${isTarget ? '>>> TARGET <<<' : ''}:`);
      console.log(`  id: ${p.id}`);
      console.log(`  name: ${p.name}`);
      console.log(`  fb_page_id: ${p.fb_page_id}`);
      console.log(`  fb_account_id: ${p.fb_account_id}`);
      console.log(`  token_status: ${p.token_status}`);
      console.log(`  fb_page_token: ${maskedToken}`);
      console.log(`  profile_id: ${p.profile_id}`);
      console.log(`  active: ${p.active} | is_live: ${p.is_live}`);
      console.log(`  version: ${p.version}`);
      console.log(`  publishing_mode: ${p.publishing_mode}`);
      console.log(`  daily_cap: ${p.daily_cap}`);
      console.log(`  schedule: ${JSON.stringify(p.schedule)}`);
      console.log(`  checklist_status: ${JSON.stringify(p.checklist_status)}`);
      console.log(`  custom_caption_prompt: ${p.custom_caption_prompt ? '[SET]' : '[EMPTY]'}`);
      console.log(`  custom_image_prompt: ${p.custom_image_prompt ? '[SET]' : '[EMPTY]'}`);
      console.log(`  created_at: ${p.created_at}`);
      console.log(`  updated_at: ${p.updated_at}`);
    }
  }

  // 3. Check content_profiles
  const { data: profiles, error: profErr } = await client
    .from('content_profiles')
    .select('*')
    .limit(1);

  console.log(`\n=== CONTENT PROFILES ===`);
  if (profErr) {
    console.error('Error querying content_profiles:', profErr.message);
  } else {
    console.log('content_profiles columns:', profiles && profiles[0] ? Object.keys(profiles[0]).join(', ') : 'table is empty');
  }

  // 4. Check providers
  const { data: providers, error: provErr } = await client
    .from('providers')
    .select('*')
    .limit(1);

  console.log(`\n=== PROVIDERS ===`);
  if (provErr) {
    console.error('Error querying providers:', provErr.message);
  } else {
    console.log('providers columns:', providers && providers[0] ? Object.keys(providers[0]).join(', ') : 'table is empty');
    if (providers && providers[0]) {
      console.log('sample provider row:', JSON.stringify(providers[0]));
    }
  }

  console.log('\n=== TASK 0.2: REAL DATABASE SCHEMA & DELTA MIGRATION CHECK ===');
  // Query column names of table 'pages' via standard PostgREST or schema check
  // Since PostgREST doesn't always expose information_schema directly unless configured,
  // we check what fields exist on a selected row or by checking system store checkDatabaseSchema()
  const expectedPagesColumns = [
    'id', 'fb_account_id', 'name', 'fb_page_id', 'fb_page_token', 'token_status',
    'category', 'picture_url', 'tasks', 'fan_count', 'secondary_account_ids',
    'profile_id', 'publishing_mode', 'hybrid_min_score', 'daily_cap', 'active',
    'is_live', 'version', 'auto_posting_stopped_action', 'schedule', 'niche_analysis',
    'ai_disclosure_enabled', 'ai_disclosure_text', 'source_attribution_enabled',
    'last_test_run_at', 'checklist_status', 'custom_caption_prompt',
    'custom_caption_prompt_mode', 'custom_image_prompt', 'custom_image_prompt_mode',
    'first_comment_enabled', 'first_comment_prompt', 'overrides', 'connected_at',
    'last_synced_at', 'created_at', 'updated_at'
  ];

  if (pages && pages.length > 0) {
    const actualColumns = Object.keys(pages[0]);
    const missingInPages = expectedPagesColumns.filter(c => !actualColumns.includes(c));
    console.log(`Actual columns on 'pages' (${actualColumns.length}):`, actualColumns.join(', '));
    if (missingInPages.length === 0) {
      console.log('✅ ALL expected columns are present on table "pages".');
    } else {
      console.log('❌ MISSING columns on table "pages":', missingInPages.join(', '));
    }
  }

  // Also check other tables
  const expectedTables = [
    'facebook_accounts', 'pages', 'content_profiles', 'prompt_packs', 'posts',
    'topic_queue', 'publishing_calendar', 'system_heartbeat', 'system_alerts',
    'audit_log', 'rate_limits', 'providers', 'provider_keys', 'provider_daily_usage',
    'settings', 'research_sources', 'content_series'
  ];

  for (const table of expectedTables) {
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`❌ Table "${table}": ERROR (${error.message})`);
    } else {
      console.log(`✅ Table "${table}": EXISTS (rows: ${count ?? 0})`);
    }
  }
}

runDiagnostics().catch(console.error);
