import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { SystemStore } from '../apps/web/src/server/storage.js';
import { createDashboardServer } from '../apps/web/src/server.js';
import { getSeedProfiles, getAllNicheProfiles } from '../packages/core/src/profiles/seed-profiles.js';
import { evaluatePageChecklist } from '../packages/core/src/scheduler/page-checklist.js';

describe('Production Critical Bugs & Fixes Suite (fbauto247.vercel.app)', () => {
  let server: http.Server;
  let baseUrl: string;
  let store: SystemStore;
  let authCookie: string;
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = secret;
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
    const hmac = crypto.createHmac('sha256', secret).update(rawPayload).digest('base64url');
    authCookie = `app_session=${rawPayload}.${hmac}`;

    store = SystemStore.getInstance();
    server = createDashboardServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // --------------------------------------------------------------------------
  // Bug A: Page Settings Save & Page Concurrency Verification
  // --------------------------------------------------------------------------
  it('Bug A: Successfully updates page even when version column is absent, and rejects non-existent page with descriptive error', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: null as any,
    });

    expect(page.id).toBeDefined();

    // Updating page settings should succeed without "Page not found" error
    const res = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: page.id,
        profile_id: 'science_space',
        publishing_mode: 'auto',
        schedule: {
          postsPerDay: 4,
          postingTimes: ['09:00', '13:00', '18:00', '21:00'],
          timezone: 'America/New_York',
        },
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.page.profile_id).toBe('science_space');
    expect(data.page.publishing_mode).toBe('auto');

    // Trying to update non-existent page ID must return 404 with exact descriptive error
    const badRes = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: '00000000-0000-0000-0000-000000000000',
        publishing_mode: 'auto',
      }),
    });
    const badData = await badRes.json();
    expect(badRes.status).toBe(404);
    expect(badData.error).toContain('not found');
  });

  // --------------------------------------------------------------------------
  // Bug B: Prompt Studio Save Prompts
  // --------------------------------------------------------------------------
  it('Bug B: PUT /api/pages saves custom prompts, overrides, and returns verified payload', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
    });

    const putRes = await fetch(`${baseUrl}/api/pages`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        id: page.id,
        profile_id: 'science_space',
        custom_caption_prompt: 'Focus on recent James Webb exoplanet discoveries.',
        custom_caption_prompt_mode: 'append',
        custom_image_prompt: 'Dramatic cinematic infrared photography of exoplanet.',
        custom_image_prompt_mode: 'append',
        first_comment_enabled: true,
        first_comment_prompt: 'Share your thoughts on alien life below!',
        overrides: {
          'caption.min': 500,
          'caption.target': 700,
          'caption.max': 900,
          'image.aspectRatio': '4:5',
          'image.headlinePanel.enabled': true,
          'image.headlinePanel.backgroundColor': '#050b14',
        },
      }),
    });

    const putData = await putRes.json();
    expect(putRes.status).toBe(200);
    expect(putData.success).toBe(true);
    expect(putData.savedAt).toBeDefined();
    expect(putData.page.custom_caption_prompt).toBe('Focus on recent James Webb exoplanet discoveries.');
    expect(putData.page.overrides['caption.target']).toBe(700);
  });

  // --------------------------------------------------------------------------
  // Bug C: Live Schedule Preview Contract & Dual Timezones
  // --------------------------------------------------------------------------
  it('Bug C: POST /api/pages/preview-schedule returns slots array, count, warnings and resolves dual timezones', async () => {
    const schedule = {
      postsPerDay: 4,
      mode: 'fixed' as const,
      postingTimes: ['09:00', '13:00', '18:00', '21:00'],
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      timezone: 'America/New_York',
      jitterMinutes: 10,
    };

    const res = await fetch(`${baseUrl}/api/pages/preview-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        schedule,
        countDays: 7,
        userTimezone: 'Asia/Kolkata',
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.slots)).toBe(true);
    expect(Array.isArray(data.preview)).toBe(true); // Backwards-compatible
    expect(data.count).toBe(28); // 4 posts/day * 7 days
    expect(data.slots.length).toBe(28);

    // Each slot must contain audience time and local IST time
    const firstSlot = data.slots[0];
    expect(firstSlot.audienceTime).toBeDefined();
    expect(firstSlot.localTime).toBeDefined();
    expect(firstSlot.audienceTimezone).toBe('America/New_York');
  });

  // --------------------------------------------------------------------------
  // Bug D: Test Run with Null Profile ID (No toLowerCase Crash)
  // --------------------------------------------------------------------------
  it('Bug D: POST /api/test-run handles page with null profile_id gracefully without throwing toLowerCase error', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: null as any, // Simulating production state where profile_id is null
    });

    const res = await fetch(`${baseUrl}/api/test-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({ pageId: page.id }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.stages).toBeDefined();
    expect(data.stages.length).toBe(4);
    expect(data.qaScore).toBeGreaterThanOrEqual(90);
    expect(data.topic.title).toBeDefined();
    expect(data.caption).toBeDefined();
    expect(data.imagePrompt).toBeDefined();

    // Verify page last_test_run_at was recorded
    const updated = await store.getPageById(page.id);
    expect(updated?.last_test_run_at).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Bug E: Bundled Starter Profiles & Custom Niche Inline Support
  // --------------------------------------------------------------------------
  it('Bug E: Bundled starter profiles are always available (including Science & Space) without requiring prompts/ on disk', async () => {
    // Calling getSeedProfiles with a non-existent directory tests the fallback bundling
    const profiles = getSeedProfiles('c:/non_existent_directory_for_testing');
    expect(profiles.length).toBeGreaterThanOrEqual(7);

    const names = profiles.map((p) => p.name);
    expect(names).toContain('Science & Space');
    expect(names).toContain('Historical Photos');
    expect(names).toContain('Real-Life Photography');
    expect(names).toContain('Vintage Cars');
    expect(names).toContain('Horror Story');
    expect(names).toContain('Crime Story');
    expect(names).toContain('Science Story');

    // Extended catalog has 27 niches
    const all = getAllNicheProfiles('c:/non_existent_directory_for_testing');
    expect(all.length).toBe(27);
  });

  it('Bug E: Checklist Step 1 is completed if custom niche text is provided for __custom__ profile', () => {
    const pageWithCustomText = {
      id: 'page-1',
      name: 'My Custom Page',
      active: false,
      profile_id: '__custom__',
      custom_niche_text: 'Deep space exploration and James Webb telescope discoveries.',
      publishing_mode: 'auto',
    };

    const status = evaluatePageChecklist(pageWithCustomText);
    expect(status.profileChosen).toBe(true);

    const pageWithoutCustomText = {
      id: 'page-2',
      name: 'Empty Custom Page',
      active: false,
      profile_id: '__custom__',
      custom_niche_text: '',
      publishing_mode: 'auto',
    };
    const statusEmpty = evaluatePageChecklist(pageWithoutCustomText);
    expect(statusEmpty.profileChosen).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Requirements 7 & 8: Overnight Warnings and Activation Guard
  // --------------------------------------------------------------------------
  it('Requirement 7 & 8: Activation guard rejects starting auto-posting if checklist is incomplete', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: null as any,
    });

    // Attempting to go live without completing checklist steps must be rejected
    const toggleRes = await fetch(`${baseUrl}/api/pages/toggle-live`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({ pageId: page.id, active: true }),
    });

    const toggleData = await toggleRes.json();
    expect(toggleRes.status).toBe(400);
    expect(toggleData.success).toBe(false);
    expect(toggleData.missingSteps.length).toBeGreaterThan(0);
  });
});
