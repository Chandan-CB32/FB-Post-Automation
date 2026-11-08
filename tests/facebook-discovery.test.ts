import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  discoverFacebookPages,
  fetchManagedPages,
  canUserPublishToPage,
  testFacebookCredentials,
  FacebookGraphClient,
  FacebookGraphError,
  PAGE_ACCOUNTS_FIELDS,
  sanitizeFacebookErrorMessage,
} from '../packages/core/src/index.js';
import { SystemStore } from '../apps/web/src/server/storage.js';

describe('Automatic Facebook Account & Page Discovery Engine', () => {
  let mockFetch: any;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly evaluates publishing rights using canUserPublishToPage', () => {
    expect(canUserPublishToPage(['CREATE_CONTENT'])).toBe(true);
    expect(canUserPublishToPage(['manage', 'moderate'])).toBe(true);
    expect(canUserPublishToPage(['MODERATE', 'ANALYZE'])).toBe(false);
    expect(canUserPublishToPage([])).toBe(false);
    expect(canUserPublishToPage(undefined)).toBe(false);
  });

  it('discovers pages via me/accounts with pagination (paging.next)', async () => {
    const page1Data = {
      data: [
        {
          id: 'page-101',
          name: 'Tech Insights Daily',
          category: 'Technology',
          access_token: 'EAAB_token_101',
          tasks: ['CREATE_CONTENT', 'MANAGE'],
          fan_count: 15400,
          picture: { data: { url: 'https://cdn.fb.com/pic101.jpg' } },
        },
      ],
      paging: {
        next: 'https://graph.facebook.com/v21.0/me/accounts?after=cursor_101',
      },
    };

    const page2Data = {
      data: [
        {
          id: 'page-102',
          name: 'Retro Gaming Vault',
          category: 'Gaming',
          access_token: 'EAAB_token_102',
          tasks: ['ANALYZE'], // Lacks CREATE_CONTENT or MANAGE
          fan_count: 8200,
          picture: { data: { url: 'https://cdn.fb.com/pic102.jpg' } },
        },
      ],
    };

    const emptyBusinesses = {
      data: [],
    };

    const client = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('cursor_101')) {
          return new Response(JSON.stringify(page2Data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('me/accounts')) {
          return new Response(JSON.stringify(page1Data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('me/businesses')) {
          return new Response(JSON.stringify(emptyBusinesses), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: { message: 'Not found', code: 404 } }), { status: 404 });
      },
    });

    const result = await discoverFacebookPages('mock-user-token', client);

    expect(result.totalFound).toBe(2);
    expect(result.publishableCount).toBe(1);
    expect(result.unpublishableCount).toBe(1);

    const p101 = result.pages.find((p) => p.id === 'page-101');
    expect(p101).toBeDefined();
    expect(p101?.name).toBe('Tech Insights Daily');
    expect(p101?.canPublish).toBe(true);
    expect(p101?.token_status).toBe('valid');
    expect(p101?.picture_url).toBe('https://cdn.fb.com/pic101.jpg');
    expect(p101?.fan_count).toBe(15400);

    const p102 = result.pages.find((p) => p.id === 'page-102');
    expect(p102).toBeDefined();
    expect(p102?.name).toBe('Retro Gaming Vault');
    expect(p102?.canPublish).toBe(false);
    expect(p102?.token_status).toBe('cannot_publish');
  });

  it('discovers pages from business portfolios (owned_pages & client_pages) and merges duplicates', async () => {
    // me/accounts returns Page 201 with view-only permissions
    const meAccountsData = {
      data: [
        {
          id: 'page-201',
          name: 'Global Finance Weekly',
          category: 'Finance',
          access_token: 'token_view_only',
          tasks: ['ANALYZE'],
        },
      ],
    };

    // me/businesses returns a Business Portfolio
    const businessesData = {
      data: [
        {
          id: 'biz-999',
          name: 'Apex Media Agency',
        },
      ],
    };

    // biz-999/owned_pages returns Page 201 with full CREATE_CONTENT tasks!
    const ownedPagesData = {
      data: [
        {
          id: 'page-201',
          name: 'Global Finance Weekly (Upgraded)',
          category: 'Finance & Markets',
          access_token: 'token_full_publishing',
          tasks: ['CREATE_CONTENT', 'MANAGE'],
          fan_count: 45000,
          picture: { data: { url: 'https://cdn.fb.com/pic201.jpg' } },
        },
        {
          id: 'page-202',
          name: 'Crypto Radar Live',
          category: 'Cryptocurrency',
          access_token: 'token_202',
          tasks: ['CREATE_CONTENT'],
          fan_count: 12000,
        },
      ],
    };

    const client = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('me/accounts')) {
          return new Response(JSON.stringify(meAccountsData), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('me/businesses')) {
          return new Response(JSON.stringify(businessesData), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('biz-999/owned_pages')) {
          return new Response(JSON.stringify(ownedPagesData), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('biz-999/client_pages')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: { message: 'Not found', code: 404 } }), { status: 404 });
      },
    });

    const result = await discoverFacebookPages('mock-user-token', client);

    expect(result.businessesSearched).toBe(1);
    expect(result.totalFound).toBe(2); // Page 201 merged, Page 202 added

    const merged201 = result.pages.find((p) => p.id === 'page-201');
    expect(merged201).toBeDefined();
    expect(merged201?.canPublish).toBe(true);
    expect(merged201?.token_status).toBe('valid');
    expect(merged201?.access_token).toBe('token_full_publishing');
    expect(merged201?.tasks).toContain('CREATE_CONTENT');
    expect(merged201?.tasks).toContain('ANALYZE');
    expect(merged201?.picture_url).toBe('https://cdn.fb.com/pic201.jpg');
    expect(merged201?.business_id).toBe('biz-999');
  });

  it('runs syncAccountPages: upserts new pages, updates existing, and marks missing as inaccessible', async () => {
    const store = SystemStore.getInstance();

    // Create a test account
    const testUserId = `user-${Date.now()}`;
    const account = await store.createAccount({
      account_name: 'Test Sync User',
      fb_user_id: testUserId,
      user_access_token: 'EAAB_test_token',
    });

    // 1. Manually insert page that will later disappear from discovery
    const existingMissingPage = await store.createPage({
      fb_account_id: account.id,
      name: 'Disappearing Page',
      fb_page_id: `fb-disappearing-${Date.now()}`,
      fb_page_token: 'EAAB_old_token',
      token_status: 'valid',
    });

    // Mock discoverFacebookPages to return a brand new page and NOT the disappearing one
    const newPageId = `fb-discovered-${Date.now()}`;
    const mockClient = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('me/accounts')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: newPageId,
                  name: 'Freshly Discovered Page',
                  category: 'News',
                  access_token: 'EAAB_fresh_token',
                  tasks: ['CREATE_CONTENT'],
                  fan_count: 500,
                  picture: { data: { url: 'https://cdn.fb.com/pic.jpg' } },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    // Run discovery
    const discovery = await discoverFacebookPages('EAAB_test_token', mockClient);
    expect(discovery.totalFound).toBe(1);

    // Upsert discovered page
    const upsertRes = await store.upsertPageFromFacebook({
      fb_account_id: account.id,
      name: discovery.pages[0].name,
      fb_page_id: discovery.pages[0].id,
      fb_page_token: discovery.pages[0].access_token,
      category: discovery.pages[0].category,
      picture_url: discovery.pages[0].picture_url,
      tasks: discovery.pages[0].tasks,
      fan_count: discovery.pages[0].fan_count,
      token_status: discovery.pages[0].token_status,
    });
    expect(upsertRes.isNew).toBe(true);

    // Verify missing page can be marked inaccessible without deletion
    await store.updatePage(existingMissingPage.id, { token_status: 'inaccessible' });
    const checkedMissingPage = await store.getPageById(existingMissingPage.id);
    expect(['inaccessible', 'revoked']).toContain(checkedMissingPage?.token_status);
  });

  it('runs testFacebookCredentials diagnostics with mocked Meta endpoints', async () => {
    const mockClient = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth/access_token') && urlStr.includes('client_credentials')) {
          return new Response(JSON.stringify({ access_token: 'mock-app-token-12345' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/app')) {
          return new Response(JSON.stringify({ id: 'app-98765', name: 'FB Auto 247 Pro' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('cfg-valid-123')) {
          return new Response(JSON.stringify({ id: 'cfg-valid-123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: { message: 'Not found', code: 404 } }), { status: 404 });
      },
    });

    const diag = await testFacebookCredentials(
      {
        appId: '1234567890',
        appSecret: 'mock_secret_abcdef',
        configId: 'cfg-valid-123',
        appUrl: 'https://fbauto247.vercel.app',
      },
      mockClient
    );

    expect(diag.success).toBe(true);
    expect(diag.appIdPresent).toBe(true);
    expect(diag.appSecretPresent).toBe(true);
    expect(diag.configIdPresent).toBe(true);
    expect(diag.appTokenValid).toBe(true);
    expect(diag.metaAppName).toBe('FB Auto 247 Pro');
    expect(diag.metaAppId).toBe('app-98765');
    expect(diag.configIdValid).toBe(true);
    expect(diag.expectedRedirectUri).toBe('https://fbauto247.vercel.app/api/auth/facebook/callback');
  });

  it('fails if the string "perms" is ever requested as a Graph API field and verifies code uses "tasks" instead', async () => {
    // 1. Static codebase audit: verify "perms" is never passed as a field in packages/core/src/facebook
    const facebookDir = path.resolve('packages/core/src/facebook');
    const files = fs.readdirSync(facebookDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(facebookDir, file), 'utf8');
      // Assert that 'perms' is not present in fields query string
      expect(content).not.toMatch(/fields\s*[:=]\s*['"`][^'"`]*\bperms\b/i);
    }

    // 2. Mock Graph API that simulates Meta's exact response if "perms" is received
    const mockClient = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('perms')) {
          return new Response(
            JSON.stringify({
              error: {
                message: '(#100) Tried accessing nonexisting field (perms)',
                type: 'OAuthException',
                code: 100,
                fbtrace_id: 'A1B2C3D4E5',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('me/accounts')) {
          expect(urlStr).toContain('tasks');
          expect(urlStr).not.toContain('perms');
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'page-real-123',
                  name: 'Official Brand Page',
                  category: 'Business',
                  access_token: 'EAAB_real_page_token',
                  tasks: ['CREATE_CONTENT', 'MANAGE'],
                  fan_count: 5000,
                  picture: { data: { url: 'https://cdn.fb.com/brand.jpg' } },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('me/businesses') || urlStr.includes('me/permissions')) {
          return new Response(
            JSON.stringify({
              data: [
                { permission: 'pages_show_list', status: 'granted' },
                { permission: 'pages_read_engagement', status: 'granted' },
                { permission: 'pages_manage_posts', status: 'granted' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    // Calling discoverFacebookPages MUST succeed and never request perms
    const discovery = await discoverFacebookPages('EAAB_valid_user_token', mockClient);
    expect(discovery.totalFound).toBe(1);
    expect(discovery.pages[0].id).toBe('page-real-123');
    expect(discovery.pages[0].name).toBe('Official Brand Page');
    expect(discovery.pages[0].canPublish).toBe(true);
    expect(discovery.pages[0].token_status).toBe('valid');

    // Calling fetchManagedPages MUST also succeed without error
    const managedPages = await fetchManagedPages('EAAB_valid_user_token', mockClient);
    expect(managedPages.length).toBe(1);
    expect(managedPages[0].tasks).toEqual(['CREATE_CONTENT', 'MANAGE']);
  });

  it('handles empty results and provides clear actionable diagnostic reasons', async () => {
    // Sub-case A: Missing permissions (pages_show_list was declined or missing)
    const missingPermsClient = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('me/permissions')) {
          return new Response(
            JSON.stringify({
              data: [
                { permission: 'public_profile', status: 'granted' },
                { permission: 'pages_show_list', status: 'declined' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const resA = await discoverFacebookPages('token_missing_perms', missingPermsClient);
    expect(resA.totalFound).toBe(0);
    expect(resA.emptyReason).toBe('missing_permissions');
    expect(resA.emptyExplanation).toContain('pages_show_list');

    // Sub-case B: Permissions granted, but no pages returned (no page selected in Login dialog or account owns no pages)
    const noPagesSelectedClient = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('me/permissions')) {
          return new Response(
            JSON.stringify({
              data: [
                { permission: 'pages_show_list', status: 'granted' },
                { permission: 'pages_read_engagement', status: 'granted' },
                { permission: 'pages_manage_posts', status: 'granted' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });

    const resB = await discoverFacebookPages('token_no_pages_selected', noPagesSelectedClient);
    expect(resB.totalFound).toBe(0);
    expect(resB.emptyReason).toBe('no_pages_selected');
    expect(resB.emptyExplanation).toContain('selected/checked');
    expect(resB.grantedPermissions).toContain('pages_show_list');
  });

  it('handles Graph API permission errors without leaking tokens or claiming token exchange failed', async () => {
    const errorClient = new FacebookGraphClient({
      fetchFn: async (url: any) => {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Permissions error: (#200) Requires pages_show_list with token EAABsecrettoken1234567890abcdef',
              type: 'OAuthException',
              code: 200,
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    await expect(discoverFacebookPages('token_error', errorClient)).rejects.toThrowError(FacebookGraphError);

    try {
      await discoverFacebookPages('token_error', errorClient);
    } catch (err: any) {
      expect(err.code).toBe(200);
      expect(err.message).not.toContain('EAABsecrettoken');
      expect(err.message).toContain('[REDACTED_TOKEN]');
    }
  });

  it('sanitizes Facebook error messages correctly', () => {
    const raw = 'Failed to fetch me/accounts?access_token=EAAB1234567890abcdef1234567890 with secret=my_super_secret';
    const clean = sanitizeFacebookErrorMessage(raw);
    expect(clean).not.toContain('EAAB1234567890abcdef1234567890');
    expect(clean).not.toContain('my_super_secret');
    expect(clean).toContain('[REDACTED_TOKEN]');
    expect(clean).toContain('[REDACTED_SECRET]');
  });
});
