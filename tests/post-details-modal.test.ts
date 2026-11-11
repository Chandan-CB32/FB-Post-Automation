import { describe, it, expect, beforeEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { handleRequest } from '../apps/web/src/server.js';
import { SystemStore } from '../apps/web/src/server/storage.js';

describe('Post Details Modal & Timezone-Aware Calendar Display', () => {
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = secret;
    process.env.OWNER_EMAIL = 'admin@example.com';
    process.env.OWNER_PASSWORD_HASH = crypto.createHash('sha256').update('secret123').digest('hex');
    process.env.TEST_AUTH_ENABLED = 'true';
  });

  function createValidSessionCookie(): string {
    const payload = {
      email: 'admin@example.com',
      sub: 'usr_owner_123',
      exp: Math.floor(Date.now() / 1000) + 2592000,
    };
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const hmac = crypto.createHmac('sha256', secret).update(rawPayload).digest('base64url');
    return `app_session=${rawPayload}.${hmac}`;
  }

  it('serves /api/post-details?id=<id> with full post metadata, page name, and timezone', async () => {
    const store = SystemStore.getInstance();
    const testPage = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'test_token',
      token_status: 'valid',
      publishing_mode: 'auto',
      schedule: {
        timezone: 'America/New_York',
        postsPerDay: 5,
        postingTimes: ['08:00', '10:00', '12:00', '15:00', '17:00'],
      },
    });

    const testPost = await store.createPost({
      page_id: testPage.id,
      title: 'Webb Telescope Identifies Potential Hycean Atmosphere on K2-18b',
      caption: 'Astrophysicists analyzing spectroscopic transmission data have detected methane and carbon dioxide.',
      status: 'scheduled_on_fb',
      scheduled_for: new Date().toISOString(),
      fb_post_id: '1347402001799226_122101392093544048',
      fb_permalink: 'https://www.facebook.com/1347402001799226/posts/122101392093544048',
      qa_score: 100,
    });

    const server = http.createServer(async (req, res) => {
      await handleRequest(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/post-details?id=${testPost.id}`, {
        headers: { Cookie: createValidSessionCookie() },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(testPost.id);
      expect(data.title).toContain('Webb Telescope');
      expect(data.pageName).toBe('Beyond the Known');
      expect(data.pageTimezone).toBe('America/New_York');
      expect(data.fb_post_id).toBe('1347402001799226_122101392093544048');
      expect(data.qa_score).toBe(100);
    } finally {
      server.close();
    }
  });

  it('renders Calendar grid with EST audience time, IST local time, and openPostDetailsModal onclick', async () => {
    const store = SystemStore.getInstance();
    const testPage = await store.createPage({
      name: 'Beyond the Known',
      fb_page_id: '1347402001799226',
      fb_page_token: 'test_token',
      token_status: 'valid',
      publishing_mode: 'auto',
      schedule: {
        timezone: 'America/New_York',
        postsPerDay: 5,
        postingTimes: ['08:00', '10:00', '12:00', '15:00', '17:00'],
      },
    });

    const testPost = await store.createPost({
      page_id: testPage.id,
      title: 'Webb Telescope Identifies Potential Hycean Atmosphere on K2-18b',
      caption: 'Astrophysicists analyzing spectroscopic transmission data have detected methane and carbon dioxide.',
      status: 'scheduled_on_fb',
      scheduled_for: new Date().toISOString(),
      fb_post_id: '1347402001799226_122101392093544048',
      fb_permalink: 'https://www.facebook.com/1347402001799226/posts/122101392093544048',
      qa_score: 100,
    });

    const server = http.createServer(async (req, res) => {
      await handleRequest(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/calendar`, {
        headers: { Cookie: createValidSessionCookie() },
      });
      expect(res.status).toBe(200);
      const html = await res.text();

      // Assert post details modal container exists
      expect(html).toContain('id="postDetailsModal"');
      expect(html).toContain('id="pdmAudienceTime"');
      expect(html).toContain('id="pdmLocalTime"');
      expect(html).toContain('id="pdmFbLinkBtn"');
      expect(html).toContain('id="pdmCaption"');

      // Assert calendar post card has click handler and timezones
      expect(html).toContain(`openPostDetailsModal('${testPost.id}')`);
      expect(html).toContain('EST');
      expect(html).toContain('IST');
    } finally {
      server.close();
    }
  });
});
