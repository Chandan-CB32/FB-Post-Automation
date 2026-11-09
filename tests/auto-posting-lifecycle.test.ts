import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { SystemStore } from '../apps/web/src/server/storage.js';
import { createDashboardServer } from '../apps/web/src/server.js';
import { calculateNextSlots } from '../worker/src/schedulers/slot-planner.js';
import type { Server } from 'node:http';

describe('Auto-Posting Start / Stop Lifecycle & Governance', () => {
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

    const payload = {
      email: 'admin@example.com',
      sub: 'usr_owner_123',
      exp: Math.floor(Date.now() / 1000) + 2592000,
    };
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const hmac = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update(rawPayload).digest('base64url');
    authCookie = `app_session=${rawPayload}.${hmac}`;

    store = SystemStore.getInstance();
    server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as any).port;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('blocks taking page live if setup checklist is incomplete unless force is true', async () => {
    const page = await store.createPage({
      name: 'Checklist Test Page',
      fb_page_id: 'page_checklist_01',
      fb_page_token: 'valid_token_01',
      category: 'Science',
      publishing_mode: 'review',
      profile_id: '__custom__', // Incomplete profile
      schedule: { postsPerDay: 0, postingTimes: [], timezone: 'America/New_York', mode: 'fixed' }, // Incomplete schedule
    });

    const headers = { Cookie: authCookie, 'Content-Type': 'application/json' };

    // Attempt to turn on without force
    const tryRes = await fetch(`http://localhost:${serverPort}/api/pages/toggle-live`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pageId: page.id, active: true }),
    });

    expect(tryRes.status).toBe(400);
    const tryData = await tryRes.json();
    expect(tryData.blocked).toBe(true);
    expect(tryData.missingSteps.length).toBeGreaterThanOrEqual(1);

    // Force turn on
    const forceRes = await fetch(`http://localhost:${serverPort}/api/pages/toggle-live`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pageId: page.id, active: true, force: true }),
    });

    expect(forceRes.status).toBe(200);
    const forceData = await forceRes.json();
    expect(forceData.success).toBe(true);
    expect(forceData.page.active).toBe(true);
  });

  it('pauses auto-posting with action "pause" and preserves existing pending posts', async () => {
    const page = await store.createPage({
      name: 'Pause Test Page',
      fb_page_id: 'page_pause_01',
      fb_page_token: 'valid_token_02',
      category: 'Science',
      publishing_mode: 'review',
      active: true,
      is_live: true,
    });

    // Create 1 planned draft post
    await store.createPost({
      page_id: page.id,
      title: 'Preserved Draft',
      caption: 'Preserved Draft',
      status: 'planned',
      scheduled_for: new Date(Date.now() + 3600000).toISOString(),
    });

    const headers = { Cookie: authCookie, 'Content-Type': 'application/json' };

    const pauseRes = await fetch(`http://localhost:${serverPort}/api/pages/toggle-live`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pageId: page.id, active: false, action: 'pause' }),
    });

    expect(pauseRes.status).toBe(200);
    const pauseData = await pauseRes.json();
    expect(pauseData.success).toBe(true);
    expect(pauseData.page.active).toBe(false);

    // Check that post remains planned (not cancelled)
    const posts = (await store.getPosts()).filter((p) => p.page_id === page.id);
    expect(posts[0].status).toBe('planned');

    const updatedPage = await store.getPageById(page.id);
    expect(updatedPage?.active).toBe(false);
    expect(updatedPage?.is_live).toBe(false);
    expect(updatedPage?.auto_posting_stopped_action).toBe('pause');
  });

  it('stops auto-posting with action "cancel_pending" and cancels all scheduled posts in database', async () => {
    const page = await store.createPage({
      name: 'Stop & Cancel Page',
      fb_page_id: 'page_stop_01',
      fb_page_token: 'valid_token_03',
      category: 'Science',
      publishing_mode: 'review',
      active: true,
      is_live: true,
    });

    await store.createPost({
      page_id: page.id,
      title: 'To Be Cancelled',
      caption: 'To Be Cancelled',
      status: 'planned',
      scheduled_for: new Date(Date.now() + 3600000).toISOString(),
    });

    const headers = { Cookie: authCookie, 'Content-Type': 'application/json' };

    const stopRes = await fetch(`http://localhost:${serverPort}/api/pages/toggle-live`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pageId: page.id, active: false, action: 'cancel_pending' }),
    });

    expect(stopRes.status).toBe(200);
    const stopData = await stopRes.json();
    expect(stopData.success).toBe(true);
    expect(stopData.page.active).toBe(false);

    const posts = (await store.getPosts()).filter((p) => p.page_id === page.id);
    expect(posts[0].status).toBe('cancelled');

    const updatedPage = await store.getPageById(page.id);
    expect(updatedPage?.active).toBe(false);
    expect(updatedPage?.is_live).toBe(false);
    expect(updatedPage?.auto_posting_stopped_action).toBe('cancel_pending');
  });

  it('calculates slots strictly starting from now and skips when active or is_live is false', () => {
    const inactiveConfig = {
      active: false,
      is_live: false,
      postsPerDay: 3,
      postingTimes: ['10:00', '15:00', '20:00'],
      timezone: 'America/New_York',
      mode: 'fixed' as const,
    };

    // Inactive page produces 0 slots
    const inactiveSlots = calculateNextSlots(inactiveConfig, new Date(), 7);
    expect(inactiveSlots.length).toBe(0);

    // Active page produces slots strictly starting from now (no past backfilling)
    const activeConfig = {
      ...inactiveConfig,
      active: true,
      is_live: true,
    };
    const activeSlots = calculateNextSlots(activeConfig, new Date(), 7);
    expect(activeSlots.length).toBeGreaterThan(0);

    const now = new Date();
    activeSlots.forEach((slotDate) => {
      expect(slotDate.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
    });
  });
});
