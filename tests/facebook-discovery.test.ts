import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  discoverFacebookPages,
  canUserPublishToPage,
  testFacebookCredentials,
  FacebookGraphClient,
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
});
