import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Requires explicit flag
if (!process.argv.includes('--approve')) {
  console.error('[CLEANUP BLOCKED] Execution requires "--approve" flag following user authorization.');
  process.exit(1);
}

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

async function executeCleanup() {
  console.log('--- EXECUTING APPROVED PRODUCTION CLEANUP ---');

  // 1. Pages
  const { data: pages = [] } = await client.from('pages').select('*');
  const fakePages = pages.filter(isFakePage);
  let deletedPages = 0;
  for (const fp of fakePages) {
    const { error } = await client.from('pages').delete().eq('id', fp.id);
    if (error) console.error(`Error deleting page ${fp.id}:`, error.message);
    else deletedPages++;
  }
  console.log(`[CLEANUP] Deleted ${deletedPages}/${fakePages.length} fake pages.`);

  // 2. Facebook Accounts
  const { data: accounts = [] } = await client.from('facebook_accounts').select('*');
  const fakeAccounts = accounts.filter(isFakeAccount);
  let deletedAccounts = 0;
  for (const fa of fakeAccounts) {
    const { error } = await client.from('facebook_accounts').delete().eq('id', fa.id);
    if (error) console.error(`Error deleting account ${fa.id}:`, error.message);
    else deletedAccounts++;
  }
  console.log(`[CLEANUP] Deleted ${deletedAccounts}/${fakeAccounts.length} fake accounts.`);

  // 3. Audit Log
  const { data: auditLogs = [] } = await client.from('audit_log').select('*');
  const fakeAuditLogs = auditLogs.filter(isFakeAuditLog);
  let deletedAudit = 0;
  for (const fal of fakeAuditLogs) {
    const { error } = await client.from('audit_log').delete().eq('id', fal.id);
    if (error) console.error(`Error deleting audit row ${fal.id}:`, error.message);
    else deletedAudit++;
  }
  console.log(`[CLEANUP] Deleted ${deletedAudit}/${fakeAuditLogs.length} fake test audit logs.`);

  console.log('--- CLEANUP COMPLETE ---');
}

executeCleanup().catch(err => {
  console.error('[CLEANUP FATAL]', err);
  process.exit(1);
});

