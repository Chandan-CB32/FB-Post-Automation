import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDashboardServer,
  validateSameOriginReturnTo,
  VALID_DASHBOARD_ROUTES,
  lookupOfficialFreeQuota,
} from '../apps/web/src/server.js';
import { SystemStore } from '../apps/web/src/server/storage.js';

describe('Dashboard Clean URL Routing, Nav State & In-Place Persistence', () => {
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

  describe('Clean Route Handlers & SSR Route Embedding', () => {
    function escapeHtml(str: string): string {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const cleanRoutes = Object.entries(VALID_DASHBOARD_ROUTES).map(([route, meta]) => ({
      route,
      tabId: meta.tabId,
      title: meta.title,
    }));

    it.each(cleanRoutes)('serves 200 with dynamic title and active tab for $route', async ({ route, tabId, title }) => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://localhost:${port}${route}`, {
          headers: { Cookie: createValidSessionCookie() },
        });

        expect(res.status).toBe(200);
        const html = await res.text();

        // 1. Title contains the escaped tab title
        expect(html).toContain(`<title>FB Auto 247 - ${escapeHtml(title)}</title>`);

        // 2. Embedded initial route meta
        expect(html).toContain(`pathname: "${route}"`);
        expect(html).toContain(`tabId: "${tabId}"`);

        // 3. Tab content active class
        expect(html).toContain(`id="tab-${tabId}" class="tab-content active"`);

        // 4. Nav item button active class
        expect(html).toContain(`class="active" data-tab="${tabId}"`);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('redirects root "/" and "/dashboard" (302) to "/overview"', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        // Authenticated "/"
        const resRoot = await fetch(`http://localhost:${port}/`, {
          headers: { Cookie: createValidSessionCookie() },
          redirect: 'manual',
        });
        expect(resRoot.status).toBe(302);
        expect(resRoot.headers.get('location')).toBe('/overview');

        // Authenticated "/dashboard"
        const resDash = await fetch(`http://localhost:${port}/dashboard`, {
          headers: { Cookie: createValidSessionCookie() },
          redirect: 'manual',
        });
        expect(resDash.status).toBe(302);
        expect(resDash.headers.get('location')).toBe('/overview');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('returns custom 404 page for unknown web routes with link to /overview', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://localhost:${port}/unknown-nonexistent-tab`, {
          headers: { Cookie: createValidSessionCookie() },
        });
        expect(res.status).toBe(404);
        const html = await res.text();
        expect(html).toContain('Page Not Found (404)');
        expect(html).toContain('/overview');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Open-Redirect Prevention & ReturnTo Sanitization', () => {
    it('allows valid same-origin paths with and without query params', () => {
      expect(validateSameOriginReturnTo('/overview')).toBe('/overview');
      expect(validateSameOriginReturnTo('/pages?page=p1&panel=settings')).toBe('/pages?page=p1&panel=settings');
      expect(validateSameOriginReturnTo('/providers?provider=gemini&dialog=keys')).toBe('/providers?provider=gemini&dialog=keys');
      expect(validateSameOriginReturnTo('/prompts?profile=prof_123')).toBe('/prompts?profile=prof_123');
    });

    it('rejects external URLs, protocol schemes, and slash-based bypasses', () => {
      expect(validateSameOriginReturnTo('https://evil.com')).toBe('/overview');
      expect(validateSameOriginReturnTo('http://evil.com')).toBe('/overview');
      expect(validateSameOriginReturnTo('//evil.com')).toBe('/overview');
      expect(validateSameOriginReturnTo('\\\\evil.com')).toBe('/overview');
      expect(validateSameOriginReturnTo('javascript:alert(1)')).toBe('/overview');
      expect(validateSameOriginReturnTo('data:text/html,evil')).toBe('/overview');
      expect(validateSameOriginReturnTo(null)).toBe('/overview');
      expect(validateSameOriginReturnTo('')).toBe('/overview');
    });
  });

  describe('Auth Gate & Login "next" Parameter Handling', () => {
    it('redirects unauthenticated tab access to /login?next=<path>', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://localhost:${port}/providers?provider=gemini&dialog=keys`, {
          redirect: 'manual',
        });
        expect(res.status).toBe(302);
        const loc = res.headers.get('location') || '';
        expect(loc).toContain('/login?next=');
        expect(decodeURIComponent(loc)).toContain('/providers?provider=gemini&dialog=keys');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('redirects to validated next parameter after successful login', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'admin@example.com',
            password: 'secret123',
            next: '/pages?page=p_123&panel=settings',
          }),
        });

        expect(loginRes.status).toBe(200);
        const data = await loginRes.json();
        expect(data.success).toBe(true);
        expect(data.redirectUrl).toBe('/pages?page=p_123&panel=settings');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('sanitizes malicious next parameter to /overview on login', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const loginRes = await fetch(`http://localhost:${port}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'admin@example.com',
            password: 'secret123',
            next: 'https://attacker.com/steal',
          }),
        });

        expect(loginRes.status).toBe(200);
        const data = await loginRes.json();
        expect(data.success).toBe(true);
        expect(data.redirectUrl).toBe('/overview');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Facebook OAuth returnTo Flow', () => {
    it('sets fb_oauth_returnto cookie and redirects to Meta OAuth', async () => {
      process.env.FACEBOOK_APP_ID = '1234567890';
      process.env.FACEBOOK_LOGIN_CONFIG_ID = 'cfg_biz_123';
      process.env.APP_URL = 'http://localhost:3000';

      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const res = await fetch(
          `http://localhost:${port}/api/auth/facebook?returnTo=/pages?page=pg_test&panel=settings`,
          {
            headers: { Cookie: createValidSessionCookie() },
            redirect: 'manual',
          }
        );

        expect(res.status).toBe(302);
        const setCookie = res.headers.get('set-cookie') || '';
        expect(setCookie).toContain('fb_oauth_returnto=');

        const loc = res.headers.get('location') || '';
        expect(loc).toContain('facebook.com');
        expect(loc).toContain('config_id=cfg_biz_123');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Providers Failover Chains, Reordering & Live Test Probes', () => {
    it('correctly reports official free tier quota limits', () => {
      expect(lookupOfficialFreeQuota('gemini')).toMatchObject({
        rpdLimit: 1500,
        unit: 'reqs/day',
      });
      expect(lookupOfficialFreeQuota('groq')).toMatchObject({
        rpdLimit: 14400,
        unit: 'reqs/day',
      });
      expect(lookupOfficialFreeQuota('openrouter')).toMatchObject({
        rpdLimit: 200,
        unit: 'reqs/day',
      });
      expect(lookupOfficialFreeQuota('cloudflare')).toMatchObject({
        rpdLimit: 10000,
        unit: 'neurons/day',
      });
    });

    it('handles POST /api/providers/reorder up and down swaps', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const store = SystemStore.getInstance();
        const p1 = await store.createProvider({
          name: 'Text Provider Alpha',
          adapter_kind: 'gemini',
          priority: 1,
          daily_limit: 1500,
          enabled: true,
        });
        const p2 = await store.createProvider({
          name: 'Text Provider Beta',
          adapter_kind: 'groq',
          priority: 2,
          daily_limit: 14400,
          enabled: true,
        });

        // Swap p1 down
        const reorderRes = await fetch(`http://localhost:${port}/api/providers/reorder`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: createValidSessionCookie(),
          },
          body: JSON.stringify({
            providerId: p1.id,
            direction: 'down',
          }),
        });

        expect(reorderRes.status).toBe(200);
        const data = await reorderRes.json();
        expect(data.success).toBe(true);

        // Verify priorities swapped
        const providers = await store.getProviders();
        const updatedP1 = providers.find((p) => p.id === p1.id);
        const updatedP2 = providers.find((p) => p.id === p2.id);

        expect(updatedP1?.priority).toBe(2);
        expect(updatedP2?.priority).toBe(1);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('handles POST /api/providers/test reporting health status', async () => {
      const server = createDashboardServer();
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      try {
        const store = SystemStore.getInstance();
        const p = await store.createProvider({
          name: 'Pollinations Test Image Provider',
          adapter_kind: 'pollinations',
          priority: 1,
          daily_limit: 100,
          enabled: true,
        });

        const testRes = await fetch(`http://localhost:${port}/api/providers/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: createValidSessionCookie(),
          },
          body: JSON.stringify({
            providerId: p.id,
          }),
        });

        expect(testRes.status).toBe(200);
        const result = await testRes.json();
        expect(result.providerId).toBe(p.id);
        expect(typeof result.latency_ms).toBe('number');
        expect(['healthy', 'failing']).toContain(result.health_status);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('Zero Dashboard Reloads Guarantee', () => {
    it('guarantees dashboard.js has zero window.location.reload() occurrences', () => {
      const scriptPath = path.resolve(process.cwd(), 'apps/web/public/dashboard.js');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      const matches = content.match(/location\.reload/g) || [];
      expect(matches.length).toBe(0);
    });
  });
});
