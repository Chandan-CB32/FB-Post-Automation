import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { SystemStore } from '../apps/web/src/server/storage.js';
import { createDashboardServer } from '../apps/web/src/server.js';
import type { Server } from 'node:http';

describe('Production Persistence, Governance & Audit Verification', () => {
  let store: SystemStore;
  let server: Server;
  let serverPort: number;
  let authCookie: string;

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.TEST_AUTH_ENABLED = 'true';
    process.env.TEST_SAFETY_CONFIRMED = 'true';
    process.env.OWNER_EMAIL = 'admin@example.com';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Create 30-day HMAC auth cookie
    const payload = {
      email: 'admin@example.com',
      sub: 'usr_owner_123',
      exp: Math.floor(Date.now() / 1000) + 2592000,
    };
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const hmac = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update(rawPayload).digest('base64url');
    authCookie = `app_session=${rawPayload}.${hmac}`;

    store = new SystemStore();

    server = createDashboardServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as any).port;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('updates page settings with strict write-verification and increments version', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'valid_test_token_abc123',
      category: 'Science & Curiosity',
      publishing_mode: 'review',
      profile_id: 'default-niche',
      schedule: {
        postsPerDay: 3,
        postingTimes: ['10:00', '15:00', '20:00'],
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        timezone: 'America/New_York',
        mode: 'fixed',
      },
    });

    const initialVersion = page.version || 1;
    const initialUpdatedAt = page.updated_at;

    const updated = await store.updatePage(
      page.id,
      {
        publishing_mode: 'auto',
        schedule: {
          postsPerDay: 5,
          postingTimes: ['09:00', '12:00', '15:00', '18:00', '21:00'],
          daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
          timezone: 'America/New_York',
          mode: 'fixed',
        },
      },
      {
        expectedUpdatedAt: initialUpdatedAt,
        expectedVersion: initialVersion,
      }
    );

    expect(updated.publishing_mode).toBe('auto');
    expect(updated.schedule.postsPerDay).toBe(5);
    expect(updated.schedule.postingTimes).toEqual(['09:00', '12:00', '15:00', '18:00', '21:00']);
    expect(updated.version).toBe(initialVersion + 1);

    // Verify persistence by reading back from store
    const readBack = await store.getPageById(page.id);
    expect(readBack?.publishing_mode).toBe('auto');
    expect(readBack?.schedule.postsPerDay).toBe(5);
  });

  it('detects concurrency conflict (409) when updating with stale expectedUpdatedAt', async () => {
    const page = await store.createPage({
      name: 'Conflict Page',
      fb_page_id: '123456789',
      fb_page_token: 'valid_test_token_conflict',
      category: 'General',
      publishing_mode: 'review',
    });

    const staleTimestamp = '2026-01-01T00:00:00.000Z';

    await expect(
      store.updatePage(
        page.id,
        { publishing_mode: 'auto' },
        { expectedUpdatedAt: staleTimestamp }
      )
    ).rejects.toThrow(/concurrency conflict/i);
  });

  it('cancels pending and planned posts when auto-posting is stopped with cancel_pending action', async () => {
    const page = await store.createPage({
      name: 'Cancel Test Page',
      fb_page_id: '9988776655',
      fb_page_token: 'valid_token_cancel',
      category: 'General',
      publishing_mode: 'review',
      active: true,
      is_live: true,
    });

    // Create 3 posts: 1 planned, 1 pending_review, 1 published
    await store.createPost({
      page_id: page.id,
      title: 'Draft post 1',
      caption: 'Draft post 1',
      status: 'planned',
      scheduled_for: new Date(Date.now() + 3600000).toISOString(),
    });

    await store.createPost({
      page_id: page.id,
      title: 'Draft post 2',
      caption: 'Draft post 2',
      status: 'pending_review',
      scheduled_for: new Date(Date.now() + 7200000).toISOString(),
    });

    await store.createPost({
      page_id: page.id,
      title: 'Published post',
      caption: 'Published post',
      status: 'published',
      published_at: new Date().toISOString(),
    });

    const cancelledCount = await store.cancelPendingPagePosts(page.id);
    expect(cancelledCount).toBe(2);

    const posts = (await store.getPosts()).filter((p) => p.page_id === page.id);
    const cancelled = posts.filter((p) => p.status === 'cancelled');
    const published = posts.filter((p) => p.status === 'published');

    expect(cancelled.length).toBe(2);
    expect(published.length).toBe(1);
  });

  it('imports starter profiles into store without duplicates', async () => {
    const res = await store.importStarterProfiles();
    expect(res.count).toBe(27);
    expect(res.profiles.length).toBe(27);

    const names = res.profiles.map((p) => p.name);
    expect(names).toContain('Historical Photos');
    expect(names).toContain('Real-Life Photography');
    expect(names).toContain('Science & Space');
    expect(names).toContain('Vintage Cars');
    expect(names).toContain('Horror Story');
    expect(names).toContain('Crime Story');
    expect(names).toContain('Science Story');

    // Re-importing should not duplicate
    const secondRun = await store.importStarterProfiles();
    expect(secondRun.importedCount).toBe(0);
    expect(secondRun.skippedCount).toBe(27);
  });

  it('exports settings backup strictly stripping tokens and secrets, and restores cleanly', async () => {
    await store.createPage({
      name: 'Secret Stripping Page',
      fb_page_id: 'fb-secret-123',
      fb_page_token: 'super_secret_raw_facebook_token',
      category: 'Science',
      publishing_mode: 'auto',
      schedule: { postsPerDay: 5, postingTimes: ['09:00', '12:00', '15:00', '18:00', '21:00'], timezone: 'America/New_York', mode: 'fixed' },
    });

    const backup = await store.exportSettingsBackup();
    expect(backup.exportedAt).toBeDefined();
    expect(backup.backupVersion).toBe('1.0.0');
    expect(backup.pages.length).toBeGreaterThanOrEqual(1);

    // Verify secrets are strictly stripped
    const exportedPage = backup.pages.find((p) => p.fb_page_id === 'fb-secret-123');
    expect(exportedPage).toBeDefined();
    expect((exportedPage as any).access_token).toBeUndefined();
    expect((exportedPage as any).encrypted_access_token).toBeUndefined();

    // Verify restore works
    const restoreResult = await store.restoreSettingsBackup(backup);
    expect(restoreResult.imported.pages).toBeGreaterThanOrEqual(1);
  });

  it('evaluates 11-point system readiness checks', async () => {
    const readiness = await store.getSystemReadiness();
    expect(readiness.checks.length).toBe(11);
    expect(readiness.score.total).toBe(11);

    const checkNames = readiness.checks.map((c) => c.name);
    expect(checkNames).toContain('Database Schema Completeness');
    expect(checkNames).toContain('Supabase Read/Write Connection');
    expect(checkNames).toContain('ENCRYPTION_KEY Consistency');
    expect(checkNames).toContain('AI Model Providers & Quotas');
    expect(checkNames).toContain('Meta App Configuration');
    expect(checkNames).toContain('Facebook Page Token & Permissions');
    expect(checkNames).toContain('Background Worker Heartbeat');
    expect(checkNames).toContain('Scheduled Pipeline (GitHub Actions / Cron)');
    expect(checkNames).toContain('Public Compliance Endpoints');
    expect(checkNames).toContain('Zero Test Data in Production');
    expect(checkNames).toContain('Global Kill Switch Status');
  });

  it('verifies HTTP API endpoints for readiness, schema check, backup, and restore with auth', async () => {
    const headers = { Cookie: authCookie, 'Content-Type': 'application/json' };

    // 1. GET /api/settings/readiness
    const readinessRes = await fetch(`http://localhost:${serverPort}/api/settings/readiness`, { headers });
    expect(readinessRes.status).toBe(200);
    const readinessData = await readinessRes.json();
    expect(readinessData.checks.length).toBe(11);

    // 2. GET /api/settings/schema-check
    const schemaRes = await fetch(`http://localhost:${serverPort}/api/settings/schema-check`, { headers });
    expect(schemaRes.status).toBe(200);
    const schemaData = await schemaRes.json();
    expect(schemaData.totalTables).toBe(19);

    // 3. GET /api/settings/backup
    const backupRes = await fetch(`http://localhost:${serverPort}/api/settings/backup`, { headers });
    expect(backupRes.status).toBe(200);
    const backupData = await backupRes.json();
    expect(backupData.backupVersion).toBe('1.0.0');

    // 4. POST /api/profiles/import-starter
    const importRes = await fetch(`http://localhost:${serverPort}/api/profiles/import-starter`, {
      method: 'POST',
      headers,
    });
    expect(importRes.status).toBe(200);
    const importData = await importRes.json();
    expect(importData.success).toBe(true);
    expect(importData.count).toBe(27);
  });
});
