import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createDashboardServer } from '../apps/web/src/server';
import { SystemStore } from '../apps/web/src/server/storage';

describe('HTTP API: Provider Keys Multi-Key Preservation', () => {
  let server: http.Server;
  let baseUrl: string;
  const store = SystemStore.getInstance();

  beforeAll(async () => {
    // Clear test providers and keys
    const provs = await store.getProviders();
    for (const p of provs) {
      if (p.name.includes('Test')) {
        await store.deleteProvider(p.id);
      } else if (p.name === 'Google Gemini') {
        const keys = await store.getProviderKeys(p.id);
        for (const k of keys) {
          await store.deleteProviderKey(k.id);
        }
      }
    }

    server = createDashboardServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Clean up
    const provs = await store.getProviders();
    for (const p of provs) {
      if (p.name.includes('Test')) {
        await store.deleteProvider(p.id);
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('preserves keys and appends when submitting same provider to /api/providers', async () => {
    // 1. Submit Google Gemini with Key 1
    const res1 = await fetch(`${baseUrl}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset_id: 'gemini',
        initial_key: 'AIzaSy-FirstKey-AAAAAAAA',
        key_label: 'Primary Key',
      }),
    });
    const data1 = await res1.json();
    expect(res1.status).toBe(201);
    expect(data1.success).toBe(true);
    expect(data1.provider.name).toContain('Google Gemini');
    const providerId = data1.provider.id;

    // Verify 1 key exists
    let keys = await store.getProviderKeys(providerId);
    expect(keys.length).toBe(1);
    const key1Id = keys[0].id;

    // 2. User goes to "Add Provider" again, selects Google Gemini, enters Key 2
    const res2 = await fetch(`${baseUrl}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset_id: 'gemini',
        initial_key: 'AIzaSy-SecondKey-BBBBBBBB',
        key_label: 'Backup Key',
      }),
    });
    expect(res2.status).toBe(200); // 200 for existing updated
    const data2 = await res2.json();
    expect(data2.is_existing).toBe(true);
    expect(data2.provider.id).toBe(providerId);

    // CRITICAL: Key 1 was NOT deleted! Both Key 1 and Key 2 exist!
    keys = await store.getProviderKeys(providerId);
    expect(keys.length).toBe(2);
    expect(keys.map((k) => k.id)).toContain(key1Id);

    // 3. Add bulk keys via /api/provider-keys
    const res3 = await fetch(`${baseUrl}/api/provider-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: providerId,
        raw_key: 'AIzaSy-ThirdKey-CCCCCCCC\nAIzaSy-FourthKey-DDDDDDDD',
        label: 'Team Key',
      }),
    });
    expect(res3.status).toBe(201);
    const data3 = await res3.json();
    expect(data3.count).toBe(2);

    // All 4 keys exist!
    keys = await store.getProviderKeys(providerId);
    expect(keys.length).toBe(4);

    // 4. Update provider via PUT /api/providers with an extra key
    const res4 = await fetch(`${baseUrl}/api/providers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: providerId,
        daily_limit: 2000,
        new_keys: 'AIzaSy-FifthKey-EEEEEEEE',
      }),
    });
    expect(res4.status).toBe(200);

    // All 5 keys exist!
    keys = await store.getProviderKeys(providerId);
    expect(keys.length).toBe(5);

    // 5. GET /api/providers enriched payload
    const res5 = await fetch(`${baseUrl}/api/providers`);
    const provsList = await res5.json();
    const geminiProv = provsList.find((p: any) => p.id === providerId);
    expect(geminiProv.keyCount).toBe(5);
    expect(geminiProv.activeKeyCount).toBe(5);
    expect(geminiProv.keys.length).toBe(5);

    // Cleanup
    await store.deleteProvider(providerId);
  });
});
