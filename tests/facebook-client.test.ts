import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FacebookGraphClient,
  FacebookGraphError,
  encryptPageToken,
  decryptPageToken,
  maskFacebookToken,
  exchangeForLongLivedUserToken,
  fetchManagedPages,
} from '../packages/core/src/index.js';

describe('Facebook Graph API Client & Token Management (Step 9.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('FacebookGraphClient Requests & Error Handling', () => {
    it('constructs correct URL with API version and sends Bearer token', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: '12345', name: 'Test Page' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      );

      const client = new FacebookGraphClient({
        apiVersion: 'v21.0',
        fetchFn: mockFetch,
      });

      const result = await client.get<{ id: string; name: string }>('12345', 'EAABtestToken123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://graph.facebook.com/v21.0/12345');
      expect(calledInit.headers['Authorization']).toBe('Bearer EAABtestToken123');
      expect(result.name).toBe('Test Page');
    });

    it('classifies OAuth token expiration error (code 190, subcode 463) as auth error', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: 'Error validating access token: Session has expired.',
                type: 'OAuthException',
                code: 190,
                error_subcode: 463,
                fbtrace_id: 'abc123trace',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch });

      await expect(client.get('me', 'expiredToken')).rejects.toThrowError(FacebookGraphError);

      try {
        await client.get('me', 'expiredToken');
      } catch (err: any) {
        expect(err.code).toBe(190);
        expect(err.subcode).toBe(463);
        expect(err.isAuthError).toBe(true);
        expect(err.isRetryable).toBe(false);
      }

      // Should not retry auth errors
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('identifies rate limit errors (code 4 or 17)', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: 'Application request limit reached',
                type: 'OAuthException',
                code: 4,
              },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch, maxRetries: 0 });

      try {
        await client.get('123/feed', 'token');
      } catch (err: any) {
        expect(err.code).toBe(4);
        expect(err.isRateLimit).toBe(true);
        expect(err.isRetryable).toBe(true);
      }
    });

    it('retries on transient 500 error and returns successful response on retry', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  message: 'An unexpected error has occurred. Please retry your request later.',
                  type: 'OAuthException',
                  code: 2,
                },
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      const client = new FacebookGraphClient({ fetchFn: mockFetch, maxRetries: 2 });
      const res = await client.post<{ success: boolean }>('123/photos', 'token', { caption: 'Hi' });

      expect(res.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Token Inspection & Health Checks', () => {
    it('verifies valid never-expiring page token with required scopes', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                app_id: '987654321',
                type: 'PAGE',
                application: 'Content Publisher',
                expires_at: 0, // 0 = never expires
                is_valid: true,
                scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch, appAccessToken: 'appSecretToken' });
      const result = await client.inspectTokenHealth('pageAccessSecret');

      expect(result.valid).toBe(true);
      expect(result.status).toBe('valid');
      expect(result.isNeverExpiring).toBe(true);
      expect(result.missingRequiredScopes).toHaveLength(0);
    });

    it('flags expired token when expires_at timestamp is in the past', async () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                app_id: '987654321',
                type: 'USER',
                application: 'Content Publisher',
                expires_at: pastTimestamp,
                is_valid: true,
                scopes: ['pages_show_list', 'pages_manage_posts'],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch, appAccessToken: 'appSecretToken' });
      const result = await client.inspectTokenHealth('userToken');

      expect(result.valid).toBe(false);
      expect(result.status).toBe('expired');
      expect(result.error).toContain('Token has expired');
    });

    it('flags insufficient permissions when required scopes are missing', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                app_id: '987654321',
                type: 'PAGE',
                application: 'Content Publisher',
                expires_at: 0,
                is_valid: true,
                scopes: ['pages_show_list'], // Missing pages_manage_posts and pages_read_engagement
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch, appAccessToken: 'appSecretToken' });
      const result = await client.inspectTokenHealth('pageAccessSecret');

      expect(result.valid).toBe(false);
      expect(result.status).toBe('insufficient_permissions');
      expect(result.missingRequiredScopes).toContain('pages_manage_posts');
      expect(result.missingRequiredScopes).toContain('pages_read_engagement');
    });
  });

  describe('Page Administrative Permissions Verification', () => {
    it('verifies that Page token has CREATE_CONTENT and MANAGE tasks', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'page123',
              name: 'Space Enthusiasts',
              tasks: ['ANALYZE', 'ADVERTISE', 'CREATE_CONTENT', 'MANAGE'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const result = await client.verifyPagePermissions('page123', 'pageToken');

      expect(result.valid).toBe(true);
      expect(result.canPost).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects Page token without CREATE_CONTENT or MANAGE permissions', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'page123',
              name: 'Space Enthusiasts',
              tasks: ['ANALYZE'], // Read-only analytics task
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const result = await client.verifyPagePermissions('page123', 'pageToken');

      expect(result.valid).toBe(false);
      expect(result.canPost).toBe(false);
      expect(result.issues[0]).toContain('CREATE_CONTENT or MANAGE');
    });
  });

  describe('Token Encryption, Masking & Exchange Helpers', () => {
    it('encrypts and decrypts Page access tokens using AES-256-GCM', () => {
      const rawToken = 'EAABcde1234567890abcdefghijklmnopqrstuvwxyz';
      const encrypted = encryptPageToken(rawToken);

      expect(encrypted).not.toBe(rawToken);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptPageToken(encrypted);
      expect(decrypted).toBe(rawToken);
    });

    it('masks Facebook tokens safely', () => {
      const token = 'EAABcdef1234567890xyz';
      expect(maskFacebookToken(token)).toBe('EAABcd...0xyz');
    });

    it('exchanges short-lived token for long-lived token', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'EAABlongLivedToken12345',
              token_type: 'bearer',
              expires_in: 5184000,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const exchanged = await exchangeForLongLivedUserToken('shortToken', 'app123', 'secret456', client);

      expect(exchanged.accessToken).toBe('EAABlongLivedToken12345');
      expect(exchanged.expiresIn).toBe(5184000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fetches managed pages list with permanent page tokens', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'page_science_101',
                  name: 'Science Today',
                  access_token: 'EAAB_page_token_1',
                  category: 'Science & Tech',
                  tasks: ['CREATE_CONTENT', 'MANAGE'],
                },
                {
                  id: 'page_cars_202',
                  name: 'Vintage Cars Club',
                  access_token: 'EAAB_page_token_2',
                  category: 'Automotive',
                  tasks: ['CREATE_CONTENT'],
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const pages = await fetchManagedPages('userToken', client);

      expect(pages).toHaveLength(2);
      expect(pages[0].id).toBe('page_science_101');
      expect(pages[0].access_token).toBe('EAAB_page_token_1');
      expect(pages[1].id).toBe('page_cars_202');
    });
  });
});

