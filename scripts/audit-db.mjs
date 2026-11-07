import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
const lines = fs.readFileSync('.env', 'utf8').split('\n');
for (const line of lines) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) {
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
}

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function run() {
  const { data: accounts } = await client.from('facebook_accounts').select('id, account_name, fb_user_id, email, token_status, created_at');
  console.log('=== FACEBOOK ACCOUNTS (' + (accounts?.length || 0) + ') ===');
  console.log(JSON.stringify(accounts, null, 2));

  const { data: pages } = await client.from('pages').select('id, fb_account_id, name, fb_page_id, token_status, created_at');
  console.log('\n=== PAGES (' + (pages?.length || 0) + ') ===');
  console.log(JSON.stringify(pages, null, 2));

  const { data: auditLogs } = await client.from('audit_log').select('id, action, message, created_at');
  console.log('\n=== AUDIT LOGS (' + (auditLogs?.length || 0) + ') ===');
  console.log(JSON.stringify(auditLogs, null, 2));

  const { data: settings } = await client.from('settings').select('key, value, updated_at');
  console.log('\n=== SETTINGS (' + (settings?.length || 0) + ') ===');
  console.log(JSON.stringify(settings, null, 2));
}

run();
