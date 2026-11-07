import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSafeDatabaseUrl,
  assertSafeProductionToken,
  getAppEnv,
  isProductionEnv,
  isTestEnv,
} from '../packages/core/src/security/env-guard.js';
import { getDashboardOverviewMetrics } from '../apps/web/src/server/api-handlers.js';
import { SystemStore } from '../apps/web/src/server/storage.js';

describe('Production Safety & Database Isolation Guard (Milestone 12)', () => {
  const origAppEnv = process.env.APP_ENV;
  const origNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.APP_ENV = origAppEnv;
    process.env.NODE_ENV = origNodeEnv;
  });

  it('proves test runner refuses to run against production Supabase URL', () => {
    process.env.APP_ENV = 'test';
    const prodUrl = 'https://qoicjeilaqcgldcwyzqs.supabase.co';

    expect(() => assertSafeDatabaseUrl(prodUrl)).toThrow(
      /CRITICAL SECURITY VIOLATION.*Tests must NEVER touch the production Supabase database/
    );
  });

  it('proves test runner allows local test databases or empty URLs', () => {
    process.env.APP_ENV = 'test';
    expect(() => assertSafeDatabaseUrl('')).not.toThrow();
    expect(() => assertSafeDatabaseUrl('http://127.0.0.1:54321')).not.toThrow();
    expect(() => assertSafeDatabaseUrl('postgres://localhost:5432/testdb')).not.toThrow();
  });

  it('rejects fake/synthetic test tokens and mock IDs in production environment', () => {
    process.env.APP_ENV = 'production';
    process.env.NODE_ENV = 'production';

    // Synthetic tokens
    expect(() => assertSafeProductionToken('EAAB_test_token_123', 'real-page-123')).toThrow(
      /SECURITY REJECTION.*Synthetic test token or mock ID/
    );
    expect(() => assertSafeProductionToken('EAAB_old_token', 'real-page-123')).toThrow(
      /SECURITY REJECTION/
    );

    // Synthetic IDs
    expect(() => assertSafeProductionToken('EAAB_real_long_lived_token', 'fb-user-1794025787717')).toThrow(
      /SECURITY REJECTION/
    );
    expect(() => assertSafeProductionToken('EAAB_real_long_lived_token', 'user-1794025869551')).toThrow(
      /SECURITY REJECTION/
    );
    expect(() => assertSafeProductionToken('EAAB_real_long_lived_token', 'fb-page-1794025788614')).toThrow(
      /SECURITY REJECTION/
    );
    expect(() => assertSafeProductionToken('EAAB_real_long_lived_token', 'fb-discovered-12345')).toThrow(
      /SECURITY REJECTION/
    );

    // Legitimate production token & ID does not throw
    expect(() => assertSafeProductionToken('EAAB1234567890abcdefRealFacebookToken', '100089234827162')).not.toThrow();
  });

  it('proves fresh empty production DB shows zero fake rows and offline worker status without heartbeat', () => {
    const emptyMetrics = getDashboardOverviewMetrics({
      lastHeartbeat: null,
      killSwitchActive: false,
      pages: [],
      posts: [],
      alerts: [],
      providerDailyUsage: [],
    });

    expect(emptyMetrics.workerStatus).toBe('offline');
    expect(emptyMetrics.pagesCount).toBe(0);
    expect(emptyMetrics.postCounts.planned).toBe(0);
    expect(emptyMetrics.postCounts.pendingReview).toBe(0);
    expect(emptyMetrics.postCounts.scheduled).toBe(0);
    expect(emptyMetrics.postCounts.published).toBe(0);
    expect(emptyMetrics.recentAlerts.length).toBe(0);
    expect(emptyMetrics.providerQuotas.length).toBe(0);
  });

  it('reflects worker as stale when heartbeat is older than 5 minutes', () => {
    const staleTime = new Date(Date.now() - 35 * 60 * 1000).toISOString(); // 35 min ago
    const metrics = getDashboardOverviewMetrics({
      lastHeartbeat: staleTime,
      killSwitchActive: false,
      pages: [],
      posts: [],
    });

    expect(metrics.workerStatus).toBe('stale');
  });

  it('runs SystemStore in isolated in-memory test mode without database connection', async () => {
    process.env.APP_ENV = 'test';
    SystemStore.resetInstance();
    const store = SystemStore.getInstance();

    // 1. Create Account
    const acc = await store.createAccount({
      account_name: 'Test Isolation Account',
      fb_user_id: 'user-isolation-123',
      user_access_token: 'EAAB_test_isolated_token',
    });
    expect(acc.id).toBeDefined();
    expect(acc.account_name).toBe('Test Isolation Account');

    // 2. Fetch Accounts
    const accounts = await store.getAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts[0].id).toBe(acc.id);

    // 3. Create Page
    const page = await store.createPage({
      name: 'Test Isolated Page',
      fb_page_id: 'fb-page-isolation-999',
      fb_page_token: 'EAAB_test_isolated_page_token',
      fb_account_id: acc.id,
    });
    expect(page.id).toBeDefined();
    const pages = await store.getPages();
    expect(pages.length).toBe(1);

    // 4. Provider & Key CRUD
    const prov = await store.createProvider({
      name: 'Isolated Gemini Test',
      adapter_kind: 'gemini_native',
      daily_limit: 500,
    });
    expect(prov.id).toBeDefined();
    const key = await store.addProviderKey({
      provider_id: prov.id,
      raw_key: 'AIzaSy_ISOLATED_TEST_KEY_9999',
    });
    expect(key.id).toBeDefined();
    const keys = await store.getProviderKeys(prov.id);
    expect(keys.length).toBe(1);

    // 5. Delete Provider cascades keys
    await store.deleteProvider(prov.id);
    const keysAfter = await store.getProviderKeys(prov.id);
    expect(keysAfter.length).toBe(0);

    // 6. Delete Account cascades pages
    await store.deleteAccount(acc.id);
    const pagesAfter = await store.getPages();
    expect(pagesAfter.length).toBe(0);
  });
});

