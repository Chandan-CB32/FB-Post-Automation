import { describe, it, expect, beforeEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { createDashboardServer } from '../apps/web/src/server.js';

describe('30-Day Auth Persistence & Session Management Tests', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.OWNER_EMAIL = 'admin@example.com';
    process.env.TEST_AUTH_ENABLED = 'true';
  });

  it('rejects access to protected /api/overview when unauthenticated', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/overview`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('redirects unauthenticated browser requests on / to /login', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://localhost:${port}/`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('authenticates and persists session via HMAC app_session fallback token for 30 days', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // Craft a 30-day HMAC signed app_session token
      const secret = process.env.ENCRYPTION_KEY || 'fb-auto-session-secret-key-32ch';
      const payload = {
        email: 'admin@example.com',
        sub: 'usr_owner_123',
        exp: Math.floor(Date.now() / 1000) + 2592000, // 30 days in future
      };
      const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const hmac = crypto.createHmac('sha256', secret).update(rawPayload).digest('base64url');
      const validAppSession = `${rawPayload}.${hmac}`;

      // Request /api/auth/session with valid app_session cookie
      const sessionRes = await fetch(`http://localhost:${port}/api/auth/session`, {
        headers: {
          Cookie: `app_session=${validAppSession}`,
        },
      });
      expect(sessionRes.status).toBe(200);
      const sessionData = await sessionRes.json();
      expect(sessionData.authenticated).toBe(true);
      expect(sessionData.email).toBe('admin@example.com');

      // Request protected dashboard root / with cookie
      const dashRes = await fetch(`http://localhost:${port}/`, {
        headers: {
          Cookie: `app_session=${validAppSession}`,
        },
        redirect: 'manual',
      });
      expect(dashRes.status).toBe(200);
      const html = await dashRes.text();
      expect(html).toContain('FB Auto 247');
      expect(html).toContain('/dashboard.js');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects tampered or expired app_session tokens', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      // 1. Tampered signature
      const fakeToken = Buffer.from(JSON.stringify({ email: 'admin@example.com' })).toString('base64url') + '.invalidSignature';
      const fakeRes = await fetch(`http://localhost:${port}/api/auth/session`, {
        headers: { Cookie: `app_session=${fakeToken}` },
      });
      const fakeData = await fakeRes.json();
      expect(fakeData.authenticated).toBe(false);

      // 2. Expired session (exp in past)
      const secret = process.env.ENCRYPTION_KEY || 'fb-auto-session-secret-key-32ch';
      const expiredPayload = {
        email: 'admin@example.com',
        exp: Math.floor(Date.now() / 1000) - 100, // expired
      };
      const rawExpired = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
      const expHmac = crypto.createHmac('sha256', secret).update(rawExpired).digest('base64url');
      const expiredToken = `${rawExpired}.${expHmac}`;

      const expRes = await fetch(`http://localhost:${port}/api/auth/session`, {
        headers: { Cookie: `app_session=${expiredToken}` },
      });
      const expData = await expRes.json();
      expect(expData.authenticated).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('clears all session cookies on /api/auth/logout', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/auth/logout`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login');

      // Check Set-Cookie headers clear tokens
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('sb_access_token=;');
      expect(setCookie).toContain('Max-Age=0');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
