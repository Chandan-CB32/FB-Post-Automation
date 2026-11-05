import { describe, it, expect, beforeEach } from 'vitest';
import { SystemStore, parseRawKeysInput } from '../apps/web/src/server/storage';

describe('Providers and Key Pool Management', () => {
  let store: SystemStore;

  beforeEach(async () => {
    store = SystemStore.getInstance();
    // Clean up dedicated test providers
    const provs = await store.getProviders();
    for (const p of provs) {
      if (p.name.includes('KeyPool Unique Fix')) {
        await store.deleteProvider(p.id);
      }
    }
  });

  it('correctly parses raw key strings with newlines, commas, quotes, and comments', () => {
    const multilineInput = `
      AIzaSyD-key1_test
      # Some comment
      AIzaSyD-key2_test # with inline comment
      "AIzaSyD-key3_test", 'AIzaSyD-key4_test'
    `;
    const parsed = parseRawKeysInput(multilineInput);
    expect(parsed).toEqual([
      'AIzaSyD-key1_test',
      'AIzaSyD-key2_test',
      'AIzaSyD-key3_test',
      'AIzaSyD-key4_test',
    ]);
  });

  it('keeps previous keys when adding multiple keys to a provider', async () => {
    // 1. Create provider
    const prov = await store.createProvider({
      name: 'KeyPool Unique Fix 1',
      adapter_kind: 'gemini_native',
      model_name: 'gemini-2.5-flash',
    });

    // 2. Add first key
    const key1 = await store.addProviderKey({
      provider_id: prov.id,
      raw_key: 'AIzaSy-FirstKey-111111111111111111',
      label: 'Primary Key',
    });

    expect(key1.id).toBeDefined();
    let keys = await store.getProviderKeys(prov.id);
    expect(keys.length).toBe(1);
    expect(keys[0].id).toBe(key1.id);

    // 3. Add second key to same provider
    const key2 = await store.addProviderKey({
      provider_id: prov.id,
      raw_key: 'AIzaSy-SecondKey-2222222222222222',
      label: 'Secondary Key',
    });

    expect(key2.id).toBeDefined();
    expect(key2.id).not.toBe(key1.id);

    // Verify BOTH keys exist! Key 1 was NOT deleted
    keys = await store.getProviderKeys(prov.id);
    expect(keys.length).toBe(2);
    expect(keys.map((k) => k.id)).toContain(key1.id);
    expect(keys.map((k) => k.id)).toContain(key2.id);

    // 4. Add bulk keys
    const bulkKeys = await store.addProviderKeysBulk({
      provider_id: prov.id,
      raw_keys: [
        'AIzaSy-ThirdKey-33333333333333333',
        'AIzaSy-FourthKey-4444444444444444',
      ],
      base_label: 'Rotation Key',
    });

    expect(bulkKeys.length).toBe(2);

    // All 4 keys exist simultaneously
    keys = await store.getProviderKeys(prov.id);
    expect(keys.length).toBe(4);
    expect(keys.every((k) => k.is_active)).toBe(true);

    // 5. Delete only one key (e.g. key2)
    const deleted = await store.deleteProviderKey(key2.id);
    expect(deleted).toBe(true);

    keys = await store.getProviderKeys(prov.id);
    expect(keys.length).toBe(3);
    expect(keys.map((k) => k.id)).not.toContain(key2.id);
    expect(keys.map((k) => k.id)).toContain(key1.id);

    // Clean up
    await store.deleteProvider(prov.id);
  });

  it('prevents duplicate provider creation when adding another key for the same provider', async () => {
    // 1. Create provider
    const prov1 = await store.createProvider({
      name: 'KeyPool Unique Fix 2',
      adapter_kind: 'gemini_native',
      model_name: 'gemini-2.5-flash',
    });

    await store.addProviderKey({
      provider_id: prov1.id,
      raw_key: 'AIzaSy-Initial-Key-1234567890',
      label: 'Key #1',
    });

    // 2. User tries to "create" or add provider again with the same name
    const prov2 = await store.createProvider({
      name: 'KeyPool Unique Fix 2',
      adapter_kind: 'gemini_native',
      model_name: 'gemini-2.5-flash',
    });

    // Should return existing provider ID without creating a duplicate!
    expect(prov2.id).toBe(prov1.id);

    // Add key to prov2 (which is prov1)
    await store.addProviderKey({
      provider_id: prov2.id,
      raw_key: 'AIzaSy-Additional-Key-9876543210',
      label: 'Key #2',
    });

    const allProvs = (await store.getProviders()).filter(
      (p) => p.name === 'KeyPool Unique Fix 2'
    );
    expect(allProvs.length).toBe(1);

    const keys = await store.getProviderKeys(prov1.id);
    expect(keys.length).toBe(2);

    // Clean up
    await store.deleteProvider(prov1.id);
  });
});
