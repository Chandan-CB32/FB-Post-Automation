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

  // --------------------------------------------------------------------------
  // Prompt 10 Suite 1: Foreign Key Safety & Placeholder Normalization
  // --------------------------------------------------------------------------
  it('Prompt 10.1: Custom niche stores profile_id = null and persists custom_niche without foreign key violation', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
    });

    // Save custom niche with placeholder __custom__
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        id: page.id,
        profile_id: '__custom__',
        custom_niche_name: 'Rare Deep Sea Bioluminescence',
        custom_caption_prompt: 'Cinematic deep sea exploration narrative.',
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.page.profile_id).toBeNull();
    expect(data.page.custom_niche).toBe('Rare Deep Sea Bioluminescence');
    expect(data.page.custom_caption_prompt_mode).toBe('replace');

    // Verify stored page in DB
    const persisted = await store.getPageById(page.id);
    expect(persisted?.profile_id).toBeNull();
    expect(persisted?.custom_niche).toBe('Rare Deep Sea Bioluminescence');
  });

  it('Prompt 10.1: Rejects non-existent profile_id with field-level error instead of raw SQL error', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
    });

    const res = await fetch(`${baseUrl}/api/pages`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        id: page.id,
        profile_id: 'non-existent-fake-profile-uuid',
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain('Selected profile no longer exists');
    expect(data.field).toBe('profile_id');
  });

  it('Prompt 10.1: Audits and rejects non-existent fb_account_id with field-level error', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
    });

    await expect(
      store.updatePage(page.id, {
        fb_account_id: 'non-existent-account-uuid',
      })
    ).rejects.toThrow('Selected Facebook account no longer exists');
  });

  // --------------------------------------------------------------------------
  // Prompt 10 Suite 2: False Concurrency Conflict Elimination
  // --------------------------------------------------------------------------
  it('Prompt 10.2: Operational updates do not bump settings_version and prevent false concurrency conflicts', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
    });

    const initialSettingsVersion = page.settings_version || 1;

    // Simulate operational background writes: token check, last synced, fan count, checklist recalculation
    await store.updatePage(
      page.id,
      {
        token_status: 'valid',
        last_synced_at: new Date().toISOString(),
        fan_count: 5200,
        checklist_status: { profileChosen: true },
      },
      { isOperational: true }
    );

    const reloaded = await store.getPageById(page.id);
    expect(reloaded?.settings_version).toBe(initialSettingsVersion);

    // User saving Page Settings now with initial expected version MUST succeed without conflict
    const res = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: page.id,
        publishing_mode: 'auto',
        expected_settings_version: initialSettingsVersion,
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.page.settings_version).toBe(initialSettingsVersion + 1);
  });

  it('Prompt 10.2: Returns 409 on true settings conflict and supports 3-way force resolution', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
    });

    // Update settings once to bump version
    await store.updatePage(page.id, { publishing_mode: 'hybrid' });

    // Try saving with stale expected version
    const res = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: page.id,
        publishing_mode: 'auto',
        expected_settings_version: 1, // Stale version
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.conflict).toBe(true);
    expect(data.currentRecord).toBeDefined();

    // 3-way Keep Mine: Force save bypasses conflict
    const forceRes = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: page.id,
        publishing_mode: 'auto',
        force: true,
      }),
    });

    const forceData = await forceRes.json();
    expect(forceRes.status).toBe(200);
    expect(forceData.success).toBe(true);
    expect(forceData.page.publishing_mode).toBe('auto');
  });

  // --------------------------------------------------------------------------
  // Prompt 10 Suite 3: Checklist Single-Source & Incomplete Count Consistency
  // --------------------------------------------------------------------------
  it('Prompt 10.3: Checklist status incomplete steps strictly match missing items count', () => {
    const blankPage = {
      id: 'page-blank',
      name: 'Test Page',
      active: false,
      profile_id: null,
      custom_niche: '',
      publishing_mode: 'review',
      mode_chosen: false,
      schedule: null,
      last_test_run_at: null,
      test_run_verified: false,
    };

    const status = evaluatePageChecklist(blankPage);
    expect(status.profileChosen).toBe(false);
    expect(status.scheduleSet).toBe(false);
    expect(status.modeChosen).toBe(false);
    expect(status.testRunDone).toBe(false);
    expect(status.missingSteps.length).toBe(4); // All 4 steps missing

    // Custom niche satisfies Step 1
    const nichePage = { ...blankPage, custom_niche: 'Space Archaeology' };
    const nicheStatus = evaluatePageChecklist(nichePage);
    expect(nicheStatus.profileChosen).toBe(true);
    expect(nicheStatus.missingSteps.length).toBe(3);
  });

  // --------------------------------------------------------------------------
  // Prompt 10 Suite 4: Verified Test Run Execution & Invalidation
  // --------------------------------------------------------------------------
  it('Prompt 10.4: Test run verifies pipeline and invalidates verified state when prompt or niche changes', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
    });

    // Execute test run
    const testRes = await fetch(`${baseUrl}/api/test-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({ pageId: page.id }),
    });

    const testData = await testRes.json();
    expect(testRes.status).toBe(200);
    expect(testData.success).toBe(true);
    expect(testData.qaScore).toBeGreaterThanOrEqual(70);

    const verifiedPage = await store.getPageById(page.id);
    expect(verifiedPage?.test_run_verified).toBe(true);
    expect(verifiedPage?.test_run_report).toBeDefined();

    // Now edit custom caption prompt: MUST invalidate test run
    await store.updatePage(page.id, {
      custom_caption_prompt: 'Updated new voice instructions.',
    });

    const invalidated = await store.getPageById(page.id);
    expect(invalidated?.test_run_verified).toBe(false);
    expect(invalidated?.last_test_run_at).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Prompt 10 Suite 5: Prompt Studio Validation & Starter Profiles Catalog
  // --------------------------------------------------------------------------
  it('Prompt 10.5: Validates minWords <= targetWords <= maxWords with field error', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
    });

    const badWordsRes = await fetch(`${baseUrl}/api/pages`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        id: page.id,
        overrides: {
          'caption.min': 500,
          'caption.target': 400, // Invalid: target < min
          'caption.max': 600,
        },
      }),
    });

    const badWordsData = await badWordsRes.json();
    expect(badWordsRes.status).toBe(400);
    expect(badWordsData.field).toBe('words');
  });

  it('Prompt 10.5: Validates first comment text required when enabled, and headline panel hex color', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
    });

    // 1. Missing first comment prompt when enabled
    const res1 = await fetch(`${baseUrl}/api/pages`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        id: page.id,
        first_comment_enabled: true,
        first_comment_prompt: '   ',
      }),
    });
    const data1 = await res1.json();
    expect(res1.status).toBe(400);
    expect(data1.field).toBe('first_comment_prompt');

    // 2. Invalid headline color
    const res2 = await fetch(`${baseUrl}/api/pages`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        id: page.id,
        overrides: {
          'image.headlinePanel.backgroundColor': 'not-a-hex-color',
        },
      }),
    });
    const data2 = await res2.json();
    expect(res2.status).toBe(400);
    expect(data2.field).toBe('headline_color');
  });

  it('Prompt 10.5: Starter profiles import inserts 27 profiles and reports importedCount & skippedCount', async () => {
    const res = await fetch(`${baseUrl}/api/profiles/import-starter`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
      },
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.count).toBe(27);
    expect(data.importedCount).toBe(27);
    expect(data.skippedCount).toBe(0);

    // Second import: all 27 should be skipped/already present
    const res2 = await fetch(`${baseUrl}/api/profiles/import-starter`, {
      method: 'POST',
      headers: {
        Cookie: authCookie,
      },
    });
    const data2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(data2.skippedCount).toBe(27);
    expect(data2.importedCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Prompt 10 Revision Loop, Slot Filtering, and Stale Profile Recovery
  // --------------------------------------------------------------------------
  it('Revision Loop: Returns effective prompt with masked secrets, structure rules, and attempts history', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
      profile_id: 'science_space',
      custom_caption_prompt: 'Primary voice secret: sk-1234567890abcdef1234567890 should be masked. Emphasize cosmic awe.',
      custom_caption_prompt_mode: 'replace',
      qa_pass_threshold: 80,
      max_sentences_per_paragraph: 3,
      min_words: 60,
      target_words: 130,
      max_words: 230,
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
    expect(data.effectivePrompt).toBeDefined();
    // Verify secret is masked
    expect(data.effectivePrompt).not.toContain('sk-1234567890abcdef1234567890');
    expect(data.effectivePrompt).toContain('sk-1...');

    // Verify structure rules are returned
    expect(data.structureRules).toEqual({
      minWords: 60,
      targetWords: 130,
      maxWords: 230,
      maxSentencesPerParagraph: 3,
      passThreshold: 80,
    });

    // Verify attempts history
    expect(Array.isArray(data.attempts)).toBe(true);
    expect(data.attempts.length).toBeGreaterThanOrEqual(1);
    expect(data.attempts[0].stage).toBe('content_generation');
    expect(data.attempts[0].qaScore).toBeGreaterThanOrEqual(70);
  });

  it('Slot Preview: Excludes past slots, calculates nextSlotLabel, and respects minimum lead buffer', async () => {
    const schedule = {
      postsPerDay: 3,
      mode: 'fixed' as const,
      postingTimes: ['09:00', '13:00', '18:00'],
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      timezone: 'America/New_York',
      windowStart: '09:00',
      windowEnd: '21:00',
      intervalHours: 4,
      jitterMinutes: 0,
      minGapMinutes: 60,
      leadTimeHours: 24,
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
    expect(data.slots.length).toBeGreaterThan(0);
    expect(data.nextSlotLabel).toBeDefined();
    expect(data.nextSlotLabel).toMatch(/Next post in/);

    // Verify all returned slots are in the future
    const now = Date.now();
    for (const slot of data.slots) {
      const slotTime = new Date(slot.slotIso || slot.utcIso).getTime();
      expect(slotTime).toBeGreaterThan(now);
    }
  });

  it('Stale Profile Recovery: Rejects unknown profile with missingId and content_profiles table reference', async () => {
    const page = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'EAABtesttoken123',
    });

    const badProfileRes = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: page.id,
        profile_id: 'non-existent-profile-id-12345',
      }),
    });

    const badData = await badProfileRes.json();
    expect(badProfileRes.status).toBe(400);
    expect(badData.missingId).toBe('non-existent-profile-id-12345');
    expect(badData.table).toBe('content_profiles');

    // Recovery: updating with profile_id = null and custom_niche succeeds
    const recoveryRes = await fetch(`${baseUrl}/api/pages/update-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie,
      },
      body: JSON.stringify({
        pageId: page.id,
        profile_id: null,
        custom_niche: 'Deep Space Astronomy',
      }),
    });

    const recoveryData = await recoveryRes.json();
    expect(recoveryRes.status).toBe(200);
    expect(recoveryData.success).toBe(true);
    expect(recoveryData.page.profile_id).toBeNull();
    expect(recoveryData.page.custom_niche).toBe('Deep Space Astronomy');
  });

  it('Safe Defaults: newly created page has publishing_mode = review and mode_chosen = false', async () => {
    const page = await store.createPage({
      name: 'Newly Discovered Page',
      fb_page_id: '999888777666',
      fb_page_token: 'EAABtoken123',
    });

    expect(page.active).toBe(false);
    expect(page.is_live).toBe(false);
    expect(page.publishing_mode).toBe('review');
    expect(page.mode_chosen).toBe(false);

    const checklist = evaluatePageChecklist(page);
    expect(checklist.modeChosen).toBe(false);
    expect(checklist.isReadyToGoLive).toBe(false);
  });
});
