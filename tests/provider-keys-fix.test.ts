import { describe, it, expect, beforeEach } from 'vitest';
import { SystemStore, parseRawKeysInput } from '../apps/web/src/server/storage';

describe('Providers and Key Pool Management', () => {
  let store: SystemStore;

  beforeEach(() => {
    store = SystemStore.getInstance();
    // Clean up test providers
    const provs = store.getProviders();
    for (const p of provs) {
      store.deleteProvider(p.id);
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

  it('keeps previous keys when adding multiple keys to a provider', () => {
    // 1. Create provider
    const prov = store.createProvider({
      name: 'Google Gemini Test',
      adapter_kind: 'gemini_native',
      model_name: 'gemini-2.5-flash',
    });

    // 2. Add first key
    const key1 = store.addProviderKey({
      provider_id: prov.id,
      raw_key: 'AIzaSy-FirstKey-111111111111111111',
      label: 'Primary Key',
    });

    expect(key1.id).toBeDefined();
    let keys = store.getProviderKeys(prov.id);
    expect(keys.length).toBe(1);
    expect(keys[0].id).toBe(key1.id);

    // 3. Add second key to same provider
    const key2 = store.addProviderKey({
      provider_id: prov.id,
      raw_key: 'AIzaSy-SecondKey-2222222222222222',
      label: 'Secondary Key',
    });

    expect(key2.id).toBeDefined();
    expect(key2.id).not.toBe(key1.id);

    // Verify BOTH keys exist! Key 1 was NOT deleted
    keys = store.getProviderKeys(prov.id);
    expect(keys.length).toBe(2);
    expect(keys.map((k) => k.id)).toContain(key1.id);
    expect(keys.map((k) => k.id)).toContain(key2.id);

    // 4. Add bulk keys
    const bulkKeys = store.addProviderKeysBulk({
      provider_id: prov.id,
      raw_keys: [
        'AIzaSy-ThirdKey-33333333333333333',
        'AIzaSy-FourthKey-4444444444444444',
      ],
      base_label: 'Rotation Key',
    });

    expect(bulkKeys.length).toBe(2);

    // All 4 keys exist simultaneously
    keys = store.getProviderKeys(prov.id);
    expect(keys.length).toBe(4);
    expect(keys.every((k) => k.is_active)).toBe(true);

    // 5. Delete only one key (e.g. key2)
    const deleted = store.deleteProviderKey(key2.id);
    expect(deleted).toBe(true);

    keys = store.getProviderKeys(prov.id);
    expect(keys.length).toBe(3);
    expect(keys.map((k) => k.id)).not.toContain(key2.id);
    expect(keys.map((k) => k.id)).toContain(key1.id);
  });

  it('prevents duplicate provider creation when adding another key for the same provider', () => {
    // 1. Create provider
    const prov1 = store.createProvider({
      name: 'Google Gemini (Gemini 2.5 Flash)',
      adapter_kind: 'gemini_native',
      model_name: 'gemini-2.5-flash',
    });

    store.addProviderKey({
      provider_id: prov1.id,
      raw_key: 'AIzaSy-Initial-Key-1234567890',
      label: 'Key #1',
    });

    // 2. User tries to "create" or add provider again with the same name
    const prov2 = store.createProvider({
      name: 'Google Gemini (Gemini 2.5 Flash)',
      adapter_kind: 'gemini_native',
      model_name: 'gemini-2.5-flash',
    });

    // Should return existing provider ID without creating a duplicate!
    expect(prov2.id).toBe(prov1.id);

    // Add key to prov2 (which is prov1)
    store.addProviderKey({
      provider_id: prov2.id,
      raw_key: 'AIzaSy-Additional-Key-9876543210',
      label: 'Key #2',
    });

    const allProvs = store.getProviders().filter(
      (p) => p.name === 'Google Gemini (Gemini 2.5 Flash)'
    );
    expect(allProvs.length).toBe(1);

    const keys = store.getProviderKeys(prov1.id);
    expect(keys.length).toBe(2);
  });
});

