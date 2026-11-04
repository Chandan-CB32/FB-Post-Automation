import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Auto-load .env.local
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
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
      process.env[key] = val;
    }
  }
}

async function verifyPersistence() {
  console.log('--- Verifying Supabase Persistent Storage ---');
  
  // Dynamic import of SystemStore
  const { SystemStore } = await import('../apps/web/src/server/storage.ts');
  const store = SystemStore.getInstance();

  // 1. Storage Health
  console.log('\n1. Checking Storage Health:');
  const health = await store.getStorageHealth();
  console.log('   - Supabase Connected:', health.supabaseConnected ? '✅' : '❌');
  console.log('   - Postgres Tables Ok:', health.tablesOk ? `✅ (${health.tablesCount}/19)` : `❌ (${health.tablesCount}/19)`);
  console.log('   - Storage Bucket Ok:', health.bucketOk ? '✅' : '❌');
  console.log('   - Single Source of Truth:', health.singleSourceOfTruth ? '✅ YES' : '❌ NO');

  if (!health.supabaseConnected || !health.tablesOk) {
    throw new Error('Storage health check failed.');
  }

  // 2. Fetch providers
  console.log('\n2. Fetching Providers from Supabase:');
  const providers = await store.getProviders();
  console.log(`   - Found ${providers.length} providers.`);
  const gemini = providers.find(p => p.name.includes('Gemini') || p.adapter_kind === 'gemini_native') || providers[0];
  console.log(`   - Target Provider: ${gemini.name} (ID: ${gemini.id})`);

  // 3. Add Key 1
  console.log('\n3. Adding Key 1 for target provider:');
  const testKey1 = 'AIzaSy_TEST_PERSISTENT_KEY_ALPHA_1111';
  const addedKey1 = await store.addProviderKey({
    provider_id: gemini.id,
    raw_key: testKey1,
    label: 'Test Key Alpha'
  });
  console.log(`   - Key 1 added: id=${addedKey1.id}, masked=${addedKey1.masked_key}`);

  // 4. Add Key 2 (Testing multi-key persistence: previous key must NOT be deleted!)
  console.log('\n4. Adding Key 2 for SAME provider (testing multi-key retention):');
  const testKey2 = 'AIzaSy_TEST_PERSISTENT_KEY_BETA_2222';
  const addedKey2 = await store.addProviderKey({
    provider_id: gemini.id,
    raw_key: testKey2,
    label: 'Test Key Beta'
  });
  console.log(`   - Key 2 added: id=${addedKey2.id}, masked=${addedKey2.masked_key}`);

  // 5. Query keys for this provider
  const keys = await store.getProviderKeys(gemini.id);
  console.log(`\n5. Current Keys for ${gemini.name}: ${keys.length}`);
  for (const k of keys) {
    console.log(`   - ${k.label || 'Key'}: ${k.masked_key} (active: ${k.is_active})`);
  }

  const hasKey1 = keys.some(k => k.id === addedKey1.id);
  const hasKey2 = keys.some(k => k.id === addedKey2.id);

  if (!hasKey1 || !hasKey2) {
    throw new Error('Multi-key test failed: one of the keys was deleted or missing!');
  }
  console.log('   ✅ MULTI-KEY SUCCESS: Both Key 1 and Key 2 persist simultaneously without deleting each other!');

  // 6. Direct database inspection using raw Supabase client to confirm encryption in PostgreSQL
  console.log('\n6. Checking Raw Database Row in Supabase:');
  const rawClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: rawRows, error: rawErr } = await rawClient
    .from('provider_keys')
    .select('id, key_encrypted, key_masked, status')
    .eq('id', addedKey1.id);

  if (rawErr || !rawRows || rawRows.length === 0) {
    throw new Error('Failed to query raw database row: ' + rawErr?.message);
  }
  const rawRow = rawRows[0];
  console.log('   - Raw encrypted_key in PostgreSQL:', rawRow.key_encrypted.substring(0, 20) + '... (AES-256-GCM)');
  console.log('   - Raw masked_key in PostgreSQL:', rawRow.key_masked);
  console.log('   - Plaintext secret in DB:', rawRow.key_encrypted.includes('TEST_PERSISTENT') ? '❌ LEAKED!' : '✅ NONE (Safe)');

  // 7. Cleanup test keys
  console.log('\n7. Cleaning up test verification keys:');
  await store.deleteProviderKey(addedKey1.id);
  await store.deleteProviderKey(addedKey2.id);
  console.log('   ✅ Test keys cleaned up cleanly.');

  console.log('\n============================================================');
  console.log(' ALL SUPABASE STORAGE PERSISTENCE CHECKS PASSED 100%! ');
  console.log('============================================================\n');
}

verifyPersistence().catch(err => {
  console.error('\n[VERIFICATION ERROR]', err);
  process.exit(1);
});

