import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  generateFacebookAuthUrl,
  parseFacebookDeletionSignedRequest,
  encryptPageToken,
  decryptPageToken,
} from '../packages/core/src/index.js';
import { createDashboardServer } from '../apps/web/src/server';
import { SystemStore } from '../apps/web/src/server/storage';

describe('Facebook OAuth & Facebook Login for Business Flow', () => {
  let server: http.Server;
  let baseUrl: string;
  let store: SystemStore;

  beforeAll(async () => {
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

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('OAuth URL Generation & Facebook Login for Business', () => {
    it('generates Facebook Login for Business dialog URL using config_id', () => {
      const urlStr = generateFacebookAuthUrl({
        appId: '123456789012345',
        redirectUri: 'https://my-domain.vercel.app/api/auth/facebook/callback',
        state: 'secure-state-123',
        configId: 'business-config-999',
      });

      const parsed = new URL(urlStr);
      expect(parsed.origin).toBe('https://www.facebook.com');
      expect(parsed.pathname).toBe('/v21.0/dialog/oauth');
      expect(parsed.searchParams.get('client_id')).toBe('123456789012345');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://my-domain.vercel.app/api/auth/facebook/callback'
      );
      expect(parsed.searchParams.get('config_id')).toBe('business-config-999');
      expect(parsed.searchParams.get('state')).toBe('secure-state-123');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.has('scope')).toBe(false);
    });

    it('falls back to standard page permissions scope if config_id is unset', () => {
      const urlStr = generateFacebookAuthUrl({
        appId: '123456789012345',
        redirectUri: 'https://my-domain.vercel.app/api/auth/facebook/callback',
        state: 'secure-state-456',
      });

      const parsed = new URL(urlStr);
      expect(parsed.searchParams.get('scope')).toBe(
        'pages_show_list,pages_read_engagement,pages_manage_posts'
      );
      expect(parsed.searchParams.has('config_id')).toBe(false);
    });

    it('adds auth_type=rerequest when reconnect option is true', () => {
      const urlStr = generateFacebookAuthUrl({
        appId: '123456789012345',
        redirectUri: 'https://my-domain.vercel.app/api/auth/facebook/callback',
        state: 'secure-state-789',
        configId: 'business-config-999',
        reconnect: true,
      });

      const parsed = new URL(urlStr);
      expect(parsed.searchParams.get('auth_type')).toBe('rerequest');
    });

    it('throws when required parameters are missing', () => {
      expect(() =>
        generateFacebookAuthUrl({ appId: '', redirectUri: 'http://test', state: 'abc' })
      ).toThrow('Facebook App ID is required.');
      expect(() =>
        generateFacebookAuthUrl({ appId: '123', redirectUri: '', state: 'abc' })
      ).toThrow('Redirect URI is required.');
      expect(() =>
        generateFacebookAuthUrl({ appId: '123', redirectUri: 'http://test', state: '' })
      ).toThrow('OAuth state is required');
    });
  });

  describe('Signed Request Validation for Data Deletion', () => {
    const testSecret = 'secret-app-test-key-32charslong';

    it('validates authentic signed_request from Facebook and decodes user_id', () => {
      const payload = { user_id: 'fb-user-12345', algorithm: 'HMAC-SHA256', issued_at: 1730000000 };
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.createHmac('sha256', testSecret).update(payloadB64).digest('base64url');
      const signedRequest = `${sig}.${payloadB64}`;

      const res = parseFacebookDeletionSignedRequest(signedRequest, testSecret);
      expect(res.isValid).toBe(true);
      expect(res.userId).toBe('fb-user-12345');
    });

    it('rejects tampered or forged signed_request', () => {
      const payload = { user_id: 'fb-user-12345', algorithm: 'HMAC-SHA256' };
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const invalidSig = 'invalidsignaturefake123';
      const signedRequest = `${invalidSig}.${payloadB64}`;

      const res = parseFacebookDeletionSignedRequest(signedRequest, testSecret);
      expect(res.isValid).toBe(false);
      expect(res.userId).toBeUndefined();
    });
  });

  describe('Public Static Compliance Pages (Unauthenticated Access)', () => {
    it('serves /privacy policy publicly without authentication', async () => {
      const res = await fetch(`${baseUrl}/privacy`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Privacy Policy');
      expect(text).toContain('FB Auto 247');
      expect(text).toContain('Chandan Biswas');
      expect(text).toContain('pages_show_list');
      expect(text).toContain('AES-256-GCM');
    });

    it('serves /terms of service publicly without authentication', async () => {
      const res = await fetch(`${baseUrl}/terms`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Terms of Service');
      expect(text).toContain('FB Auto 247');
      expect(text).toContain('Chandan Biswas');
      expect(text).toContain('Meta Developer Terms');
    });

    it('serves /data-deletion instructions publicly without authentication', async () => {
      const res = await fetch(`${baseUrl}/data-deletion`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Facebook User Data Deletion Instructions');
      expect(text).toContain('Option 1: Direct Deletion via Dashboard');
    });

    it('displays deletion status if confirmation id is passed to /data-deletion?id=...', async () => {
      const res = await fetch(`${baseUrl}/data-deletion?id=del_abc123xyz`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Data Deletion Request Processed');
      expect(text).toContain('del_abc123xyz');
    });

    it('handles POST /api/auth/facebook/data-deletion callback according to Meta spec', async () => {
      const res = await fetch(`${baseUrl}/api/auth/facebook/data-deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'signed_request=mock_sig.eyJ1c2VyX2lkIjoiMTIzNDU2In0',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.url).toBeDefined();
      expect(data.confirmation_code).toBeDefined();
      expect(data.confirmation_code).toMatch(/^del_/);
      expect(data.url).toContain('/data-deletion?id=del_');
    });
  });

  describe('Facebook OAuth Initiation & CSRF State Security', () => {
    it('initiates OAuth flow with GET /api/auth/facebook and sets secure state cookie', async () => {
      const origAppId = process.env.FACEBOOK_APP_ID;
      const origConfigId = process.env.FACEBOOK_LOGIN_CONFIG_ID;
      process.env.FACEBOOK_APP_ID = '987654321098765';
      process.env.FACEBOOK_LOGIN_CONFIG_ID = 'test-config-id-888';

      try {
        const res = await fetch(`${baseUrl}/api/auth/facebook`, {
          redirect: 'manual',
        });

        expect(res.status).toBe(302);
        const location = res.headers.get('location');
        expect(location).toBeDefined();
        expect(location).toContain('https://www.facebook.com/v21.0/dialog/oauth');
        expect(location).toContain('client_id=987654321098765');
        expect(location).toContain('config_id=test-config-id-888');

        const setCookie = res.headers.get('set-cookie');
        expect(setCookie).toBeDefined();
        expect(setCookie).toContain('fb_oauth_state=');
        expect(setCookie).toContain('HttpOnly');
      } finally {
        process.env.FACEBOOK_APP_ID = origAppId;
        process.env.FACEBOOK_LOGIN_CONFIG_ID = origConfigId;
      }
    });

    it('rejects /api/auth/facebook/callback when OAuth state is invalid or missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/facebook/callback?code=mock_code&state=fake_state`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('error=');
      expect(decodeURIComponent(location)).toContain('OAuth state verification failed');
    });

    it('handles Facebook user declined authorization gracefully', async () => {
      const res = await fetch(
        `${baseUrl}/api/auth/facebook/callback?error=access_denied&error_description=Permissions+declined`,
        { redirect: 'manual' }
      );

      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('error=');
      expect(decodeURIComponent(location)).toContain('Facebook authorization declined');
    });
  });

  describe('Encrypted Page & Account Token Vault Ingestion', () => {
    it('upserts Facebook account and page with AES-256-GCM encrypted tokens', async () => {
      const testUserId = `fb-user-${Date.now()}`;
      const rawUserToken = 'EAAB_test_user_token_1234567890';
      const rawPageToken = 'EAAB_test_page_token_9876543210';

      // 1. Upsert Account
      const account = await store.upsertAccount({
        account_name: 'Chandan Biswas (Test)',
        fb_user_id: testUserId,
        email: 'chandan.test@example.com',
        user_access_token: rawUserToken,
        notes: 'Test business account',
      });

      expect(account.id).toBeDefined();
      expect(account.fb_user_id).toBe(testUserId);
      expect(account.token_status).toBe('valid');

      // Verify token is encrypted in DB and decryptable
      expect(account.user_access_token).not.toBe(rawUserToken);
      expect(decryptPageToken(account.user_access_token!)).toBe(rawUserToken);

      // 2. Upsert Page from Facebook
      const testPageId = `fb-page-${Date.now()}`;
      const page = await store.upsertPageFromFacebook({
        fb_account_id: account.id,
        name: 'Autonomous FB AI Page',
        fb_page_id: testPageId,
        fb_page_token: rawPageToken,
      });

      expect(page.id).toBeDefined();
      expect(page.fb_page_id).toBe(testPageId);
      expect(page.token_status).toBe('valid');
      expect(page.fb_page_token).not.toBe(rawPageToken);
      expect(decryptPageToken(page.fb_page_token)).toBe(rawPageToken);

      // 3. Clean up
      await store.deletePage(page.id);
      await store.deleteAccount(account.id);
    });
  });
});
