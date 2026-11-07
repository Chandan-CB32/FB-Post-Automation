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
  console.error('[DRY RUN ERROR] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function isFakeAccount(acc) {
  if (!acc) return false;
  const name = acc.account_name || '';
  const email = acc.email || '';
  const fbUserId = acc.fb_user_id || '';

  if (name.includes('Test Sync User') || name.includes('Chandan Biswas (Test)')) return true;
  if (email.endsWith('@example.com') || email.includes('test@')) return true;
  if (fbUserId.startsWith('user-') || fbUserId.startsWith('fb-user-')) return true;
  if (name === 'Chandan Biswas' && email === 'chandan.test@example.com') return true;
  return false;
}

function isFakePage(page) {
  if (!page) return false;
  const name = page.name || '';
  const pageId = page.fb_page_id || '';

  if (name === 'Freshly Discovered Page' || name === 'Disappearing Page' || name === 'Autonomous FB AI Page') return true;
  if (pageId.startsWith('fb-page-') || pageId.startsWith('fb-discovered-') || pageId.startsWith('fb-disappearing-')) return true;
  return false;
}

function isFakeAuditLog(log) {
  if (!log) return false;
  const msg = log.message || '';
  if (msg.includes('del_') && msg.includes('Facebook User Data Deletion Callback for user: unknown')) return true;
  return false;
}

async function runDryRun() {
  console.log('========================================================================');
  console.log(' DRY-RUN CLEANUP ASSESSMENT (READ-ONLY: NO DATA MODIFIED OR DELETED)');
  console.log(' Database Target:', supabaseUrl);
  console.log(' Timestamp:', new Date().toISOString());
  console.log('========================================================================\n');

  // 1. Facebook Accounts
  const { data: accounts = [] } = await client.from('facebook_accounts').select('*');
  const fakeAccounts = accounts.filter(isFakeAccount);
  const realAccounts = accounts.filter(a => !isFakeAccount(a));

  console.log(`[1] TABLE: facebook_accounts (Total: ${accounts.length})`);
  console.log(`    Identified Fake/Test Rows: ${fakeAccounts.length}`);
  for (const fa of fakeAccounts) {
    console.log(`      - ID: ${fa.id}`);
    console.log(`        Name: "${fa.account_name}" | FB User ID: "${fa.fb_user_id}" | Email: "${fa.email || '(none)'}"`);
    console.log(`        Reason: Matches test generator pattern (user-* / fb-user-* / @example.com)`);
  }
  console.log(`    Preserved Real Rows: ${realAccounts.length}`);
  for (const ra of realAccounts) {
    console.log(`      - ID: ${ra.id} | Name: "${ra.account_name}" | Email: "${ra.email}"`);
  }

  // 2. Pages
  const { data: pages = [] } = await client.from('pages').select('*');
  const fakePages = pages.filter(p => isFakePage(p) || fakeAccounts.some(fa => fa.id === p.fb_account_id));
  const realPages = pages.filter(p => !fakePages.includes(p));

  console.log(`\n[2] TABLE: pages (Total: ${pages.length})`);
  console.log(`    Identified Fake/Test Rows: ${fakePages.length}`);
  for (const fp of fakePages) {
    console.log(`      - ID: ${fp.id}`);
    console.log(`        Name: "${fp.name}" | FB Page ID: "${fp.fb_page_id}" | Account ID: ${fp.fb_account_id}`);
    console.log(`        Reason: Test discovery row (Autonomous FB AI Page / Freshly Discovered / Disappearing)`);
  }
  console.log(`    Preserved Real Rows: ${realPages.length}`);

  // 3. Audit Log
  const { data: auditLogs = [] } = await client.from('audit_log').select('*');
  const fakeAuditLogs = auditLogs.filter(isFakeAuditLog);
  const realAuditLogs = auditLogs.filter(a => !isFakeAuditLog(a));

  console.log(`\n[3] TABLE: audit_log (Total: ${auditLogs.length})`);
  console.log(`    Identified Fake/Test Rows: ${fakeAuditLogs.length}`);
  for (const fal of fakeAuditLogs) {
    console.log(`      - ID: ${fal.id} | Action: ${fal.action} | Message: "${fal.message}"`);
  }
  console.log(`    Preserved Real Rows: ${realAuditLogs.length}`);

  // 4. Settings
  const { data: settings = [] } = await client.from('settings').select('*');
  console.log(`\n[4] TABLE: settings (Total: ${settings.length})`);
  for (const s of settings) {
    console.log(`      - Key: "${s.key}" | Value: ${JSON.stringify(s.value)} (KEEP SYSTEM CONFIGURATION)`);
  }

  // 5. Providers & Keys
  const { data: providers = [] } = await client.from('providers').select('*');
  const { data: providerKeys = [] } = await client.from('provider_keys').select('*');
  console.log(`\n[5] TABLE: providers & provider_keys`);
  console.log(`    Providers: ${providers.length} | Provider Keys: ${providerKeys.length}`);

  // 6. Other Tables
  const otherTables = [
    'content_profiles', 'profile_versions', 'topic_queue_items',
    'series', 'series_episodes', 'research_sources', 'research_items',
    'posts', 'topic_history', 'job_logs', 'alerts', 'provider_usage_daily'
  ];
  console.log(`\n[6] OTHER PRODUCTION TABLES:`);
  for (const t of otherTables) {
    const { count } = await client.from(t).select('*', { count: 'exact', head: true });
    console.log(`    - ${t}: ${count || 0} rows`);
  }

  console.log('\n========================================================================');
  console.log(' SUMMARY OF PROPOSED CLEANUP:');
  console.log(`   - facebook_accounts: DELETE ${fakeAccounts.length} fake rows, KEEP ${realAccounts.length}`);
  console.log(`   - pages:             DELETE ${fakePages.length} fake rows, KEEP ${realPages.length}`);
  console.log(`   - audit_log:         DELETE ${fakeAuditLogs.length} test deletion callbacks, KEEP ${realAuditLogs.length}`);
  console.log(`   - settings:          PRESERVE ALL ${settings.length} system configuration rows`);
  console.log(`   - providers/keys:    PRESERVE ALL (${providers.length} providers, ${providerKeys.length} keys)`);
  console.log(' NO ROWS HAVE BEEN MODIFIED OR DELETED.');
  console.log(' AWAITING EXPLICIT USER CONFIRMATION: "approve cleanup"');
  console.log('========================================================================\n');
}

runDryRun().catch(err => {
  console.error('[DRY RUN FATAL]', err);
  process.exit(1);
});

