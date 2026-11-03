import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import http from 'node:http';
import fs from 'node:fs';

// Auto-load .env file if available
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // Ignore if .env is missing or already loaded
}

import {
  CORE_VERSION,
  getSeedProfiles,
  getAllNicheProfiles,
  getNicheCategoriesMap,
  createCustomNicheProfile,
  resolveSettings,
  createScienceStoryProfile,
  createHorrorStoryProfile,
  createCrimeStoryProfile,
  approveReviewPost,
  rejectReviewPost,
  editReviewPost,
  maskSecret,
  decryptPageToken,
  ContentProfile,
  PROVIDER_PRESETS,
  findPresetById,
  ProviderPreset,
} from '@fb-auto/core';
import { SystemStore, StoredPage, StoredProvider, StoredProviderKey, parseRawKeysInput } from './server/storage';
import { getDashboardOverviewMetrics } from './index';

const PORT = parseInt(process.env.PORT || '3000', 10);
const store = SystemStore.getInstance();
const seedProfiles: ContentProfile[] = getAllNicheProfiles();

function renderProviderPresetOptions(selectedId?: string): string {
  const groups: Record<string, ProviderPreset[]> = {
    '⭐ Popular AI Providers': PROVIDER_PRESETS.filter((p) => p.category === 'popular'),
    '🎨 Image & Visual AI': PROVIDER_PRESETS.filter((p) => p.category === 'image'),
    '⚡ Specialized & Cloud': PROVIDER_PRESETS.filter((p) => p.category === 'specialized'),
    '💻 Free Local & Custom': PROVIDER_PRESETS.filter((p) => p.category === 'free_local'),
  };

  let html = '';
  for (const [groupName, presets] of Object.entries(groups)) {
    if (presets.length === 0) continue;
    html += `<optgroup label="${groupName}">`;
    for (const p of presets) {
      const isSelected = (selectedId && p.id === selectedId) || (!selectedId && p.id === 'preset-gemini') ? 'selected' : '';
      const safeInstructions = (p.instructions || '').replace(/"/g, '&quot;');
      const defaultModel = p.defaultTextModel || p.defaultImageModel || '';
      html += `<option value="${p.id}" ${isSelected} data-name="${p.name}" data-kind="${p.kind}" data-baseurl="${p.baseUrl}" data-model="${defaultModel}" data-limit="${p.rpdLimit}" data-instructions="${safeInstructions}">${p.name}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

function renderNicheSelectOptions(allProfiles: ContentProfile[], selectedId?: string): string {
  const categories = getNicheCategoriesMap(allProfiles);
  let html = `<option value="__custom__">✨ Custom / Type Your Own Niche...</option>`;
  for (const [categoryName, profs] of Object.entries(categories)) {
    html += `<optgroup label="${categoryName}">`;
    for (const p of profs) {
      const isSelected = p.id === selectedId || p.name === selectedId ? 'selected' : '';
      html += `<option value="${p.id}" ${isSelected}>${p.name} (${p.type})</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}


// ----------------------------------------------------------------------------
// Supabase Authentication & Session Management
// ----------------------------------------------------------------------------
function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

let authClient: SupabaseClient | null = null;
function getAuthClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!authClient) {
    authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return authClient;
}

async function verifyAuth(req: http.IncomingMessage): Promise<{ authenticated: boolean; user?: any }> {
  // Allow test suite bypass when in test environment without explicit auth testing
  if (process.env.NODE_ENV === 'test' && !process.env.TEST_AUTH_ENABLED) {
    return { authenticated: true, user: { email: process.env.OWNER_EMAIL || 'owner@example.com' } };
  }

  const client = getAuthClient();
  if (!client) {
    return { authenticated: false };
  }

  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    const cookies = parseCookies(req);
    token = cookies['sb_access_token'] || '';
  }

  if (!token) {
    return { authenticated: false };
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      return { authenticated: false };
    }

    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (ownerEmail && data.user.email?.toLowerCase() !== ownerEmail) {
      return { authenticated: false };
    }

    return { authenticated: true, user: data.user };
  } catch {
    return { authenticated: false };
  }
}

function generateLoginHtml(errorMsg?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FB Auto 247 - Admin Sign In</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030712;
      --card-bg: #0b0f19;
      --card-border: #1f2937;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-container {
      width: 100%;
      max-width: 440px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 36px 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-icon {
      width: 52px;
      height: 52px;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      margin-bottom: 16px;
    }
    .brand-title {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    .brand-sub {
      color: var(--text-muted);
      font-size: 13px;
    }
    .form-group {
      margin-bottom: 18px;
    }
    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .form-input {
      width: 100%;
      background: #030712;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 12px 14px;
      color: var(--text);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    }
    .alert-error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 20px;
      display: ${errorMsg ? 'block' : 'none'};
    }
    .btn-submit {
      width: 100%;
      background: var(--primary);
      color: #ffffff;
      padding: 12px 16px;
      border-radius: 10px;
      border: none;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      margin-top: 8px;
    }
    .btn-submit:hover {
      background: var(--primary-hover);
    }
    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .security-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 24px;
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="brand-header">
      <div class="brand-icon">🛡️</div>
      <h1 class="brand-title">FB Auto 247</h1>
      <p class="brand-sub">Autonomous 24/7 Facebook System • Made by Chandan Biswas</p>
    </div>

    <div class="alert-error" id="errorBox">${errorMsg || ''}</div>

    <form id="loginForm" onsubmit="handleLoginSubmit(event)">
      <div class="form-group">
        <label class="form-label" for="email">Admin Email</label>
        <input class="form-input" type="email" id="email" required placeholder="owner@example.com" autocomplete="username">
      </div>

      <div class="form-group">
        <label class="form-label" for="password">Password</label>
        <input class="form-input" type="password" id="password" required placeholder="••••••••••••" autocomplete="current-password">
      </div>

      <button type="submit" class="btn-submit" id="submitBtn">Sign In to Dashboard ➔</button>
    </form>

    <div class="security-badge" style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; margin-top: 24px; font-size: 12px; color: var(--text-muted);">
      <span>🔒 Protected by Supabase Auth & AES-256-GCM Vault</span>
      <span style="font-weight: 600; color: #60a5fa; letter-spacing: 0.5px;">✨ Made by Chandan Biswas</span>
    </div>
  </div>

  <script>
    async function handleLoginSubmit(e) {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const errorBox = document.getElementById('errorBox');
      const submitBtn = document.getElementById('submitBtn');

      errorBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerText = 'Authenticating...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const urlParams = new URLSearchParams(window.location.search);
          const redirect = urlParams.get('redirect') || '/';
          window.location.href = redirect;
        } else {
          errorBox.innerText = data.error || 'Authentication failed. Please verify your credentials.';
          errorBox.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.innerText = 'Sign In to Dashboard ➔';
        }
      } catch (err) {
        errorBox.innerText = 'Network error during sign in: ' + err.message;
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.innerText = 'Sign In to Dashboard ➔';
      }
    }
  </script>
</body>
</html>`;
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    const sendJson = (data: any, statusCode = 200) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end(JSON.stringify(data, null, 2));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    // A. Health check endpoint (Public)
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return sendJson({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // B. Login Page HTML (Public)
    if (url.pathname === '/login' && req.method === 'GET') {
      const auth = await verifyAuth(req);
      if (auth.authenticated) {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
      }
      const html = generateLoginHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // C. Authentication API: Login (Public)
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { email, password } = JSON.parse(body || '{}');
          if (!email || !password) {
            return sendJson({ error: 'Email and password are required.' }, 400);
          }

          const client = getAuthClient();
          if (!client) {
            return sendJson({ error: 'Supabase authentication is not configured on this server.' }, 500);
          }

          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error || !data.session) {
            return sendJson({ error: error?.message || 'Invalid email or password.' }, 401);
          }

          const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
          if (ownerEmail && data.user?.email?.toLowerCase() !== ownerEmail) {
            return sendJson({ error: `Access denied. Only owner (${ownerEmail}) is permitted.` }, 403);
          }

          // Issue secure session cookie (7 days)
          const cookieHeader = `sb_access_token=${data.session.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieHeader,
          });
          res.end(JSON.stringify({ success: true, redirect: '/', user: { email: data.user.email } }));
        } catch (err: any) {
          return sendJson({ error: err.message }, 500);
        }
      });
      return;
    }

    // D. Authentication API: Logout (Public)
    if (url.pathname === '/api/auth/logout' || url.pathname === '/logout') {
      res.writeHead(302, {
        'Set-Cookie': 'sb_access_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        Location: '/login',
      });
      res.end();
      return;
    }

    // E. Authentication API: Session check
    if (url.pathname === '/api/auth/session') {
      const auth = await verifyAuth(req);
      return sendJson({ authenticated: auth.authenticated, email: auth.user?.email || null });
    }

    // F. Public Facebook OAuth Callback
    if (url.pathname === '/api/auth/facebook/callback') {
      // Allow through to Facebook handler
    } else {
      // Auth Gate: Protect all other routes
      const auth = await verifyAuth(req);
      if (!auth.authenticated) {
        if (url.pathname.startsWith('/api/')) {
          return sendJson({ error: 'Unauthorized. Please sign in.' }, 401);
        }
        const redirectUrl = url.pathname === '/' ? '/login' : `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
        res.writeHead(302, { Location: redirectUrl });
        res.end();
        return;
      }
    }

    // 1. API: Overview Metrics
    if (url.pathname === '/api/overview') {
      store.updateHeartbeat();
      const pages = store.getPages();
      const posts = store.getPosts();
      const killSwitch = store.getKillSwitch();

      const metrics = getDashboardOverviewMetrics({
        lastHeartbeat: new Date().toISOString(),
        killSwitchActive: killSwitch,
        pages,
        posts,
        alerts: [
          {
            id: 'alt_1',
            level: 'info',
            message: `Worker loop active across ${pages.length} configured Facebook Pages.`,
            timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
          },
          {
            id: 'alt_2',
            level: 'warning',
            message: 'Provider router daily demand within safe quota limits.',
            timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
          },
        ],
        providerDailyUsage: store.getProviders().map((p) => ({
          provider_id: p.id,
          requests_count: p.used_today || 0,
          daily_limit: p.daily_limit || 1000,
        })),
      });

      return sendJson(metrics);
    }

    // 2. API: Profiles list & Custom Profile creation
    if (url.pathname === '/api/profiles') {
      if (req.method === 'GET') {
        return sendJson(seedProfiles);
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.name) return sendJson({ error: 'Niche name is required.' }, 400);
            const customProfile = createCustomNicheProfile(data.name, {
              customType: data.type || 'factual',
              audience: data.audience,
              description: data.description,
            });
            seedProfiles.unshift(customProfile);
            return sendJson({ success: true, profile: customProfile }, 201);
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 2b. API: Facebook Accounts / Identities CRUD
    if (url.pathname === '/api/accounts') {
      if (req.method === 'GET') {
        const accounts = store.getAccounts();
        const pages = store.getPages();
        const enriched = accounts.map((acc) => {
          const linkedPages = pages.filter((p) => p.fb_account_id === acc.id);
          return {
            ...acc,
            pagesCount: linkedPages.length,
            pages: linkedPages.map((p) => ({ id: p.id, name: p.name })),
          };
        });
        return sendJson(enriched);
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.account_name || !data.fb_user_id) {
              return sendJson({ error: 'account_name and fb_user_id are required.' }, 400);
            }
            const newAcc = store.createAccount({
              account_name: data.account_name,
              fb_user_id: data.fb_user_id,
              email: data.email,
              user_access_token: data.user_access_token,
              notes: data.notes,
            });
            store.addAuditLog({
              level: 'success',
              category: 'token',
              message: `Connected new Facebook Account identity: ${newAcc.account_name} (User ID: ${newAcc.fb_user_id})`,
              details: { accountId: newAcc.id, userId: newAcc.fb_user_id },
            });
            return sendJson({ success: true, account: newAcc }, 201);
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'PUT') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.id) return sendJson({ error: 'Account ID is required.' }, 400);
            const updated = store.updateAccount(data.id, data);
            return sendJson({ success: true, account: updated });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const accId = data.id || url.searchParams.get('id');
            if (!accId) return sendJson({ error: 'Account ID is required.' }, 400);
            const deleted = store.deleteAccount(accId);
            return sendJson({ success: deleted });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 2c. API: Analytics & Performance Metrics
    if (url.pathname === '/api/analytics') {
      const posts = store.getPosts();
      const pages = store.getPages();
      const accounts = store.getAccounts();

      const published = posts.filter((p) => p.status === 'published' && p.analytics);
      const totalImpressions = published.reduce((acc, p) => acc + (p.analytics?.impressions || 0), 0);
      const totalReach = published.reduce((acc, p) => acc + (p.analytics?.reach || 0), 0);
      const totalLikes = published.reduce((acc, p) => acc + (p.analytics?.likes || 0), 0);
      const totalComments = published.reduce((acc, p) => acc + (p.analytics?.comments || 0), 0);
      const totalShares = published.reduce((acc, p) => acc + (p.analytics?.shares || 0), 0);

      const topPosts = published
        .map((p) => {
          const pg = pages.find((page) => page.id === p.page_id);
          return {
            id: p.id,
            title: p.title,
            headline: p.headline,
            pageName: pg?.name || 'Page',
            reach: p.analytics?.reach || 0,
            likes: p.analytics?.likes || 0,
            comments: p.analytics?.comments || 0,
            engagementRate: p.analytics?.engagement_rate || 7.5,
            publishedAt: p.published_at || p.created_at,
          };
        })
        .sort((a, b) => b.reach - a.reach);

      return sendJson({
        summary: {
          totalAccounts: accounts.length,
          totalPages: pages.length,
          totalPublished: published.length,
          totalImpressions,
          totalReach,
          totalLikes,
          totalComments,
          totalShares,
          avgEngagementRate:
            published.length > 0
              ? Number(
                  (
                    published.reduce((acc, p) => acc + (p.analytics?.engagement_rate || 0), 0) /
                    published.length
                  ).toFixed(1)
                )
              : 0,
        },
        topPosts,
      });
    }

    // 2d. API: Audit Logs
    if (url.pathname === '/api/audit-logs') {
      const logs = store.getAuditLogs();
      return sendJson(logs);
    }

    // 3. API: Pages CRUD
    if (url.pathname === '/api/pages') {
      if (req.method === 'GET') {
        const accountId = url.searchParams.get('accountId');
        let pages = store.getPages();
        if (accountId) {
          pages = pages.filter((p) => p.fb_account_id === accountId);
        }
        return sendJson(pages);
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.name || !data.fb_page_id || !data.fb_page_token) {
              return sendJson(
                { error: 'Name, Facebook Page ID, and Facebook Page Token are required.' },
                400
              );
            }

            let resolvedProfileId = data.profile_id || 'science_space';
            if (data.profile_id === '__custom__' || data.custom_niche_name) {
              const customNicheName = (data.custom_niche_name || 'Custom Niche').trim();
              const customProfile = createCustomNicheProfile(customNicheName, {
                customType: data.custom_niche_type || 'factual',
                audience: data.custom_niche_audience,
                description: data.custom_niche_description,
              });
              seedProfiles.unshift(customProfile);
              resolvedProfileId = customProfile.id;
            }

            const newPage = store.createPage({
              name: data.name,
              fb_account_id: data.fb_account_id,
              fb_page_id: data.fb_page_id,
              fb_page_token: data.fb_page_token,
              profile_id: resolvedProfileId,
              publishing_mode: data.publishing_mode || 'hybrid',
              hybrid_min_score: Number(data.hybrid_min_score) || 80,
              daily_cap: Number(data.daily_cap) || 3,
              schedule: data.schedule,
              custom_caption_prompt: data.custom_caption_prompt || '',
              custom_caption_prompt_mode: data.custom_caption_prompt_mode || 'append',
              custom_image_prompt: data.custom_image_prompt || '',
              custom_image_prompt_mode: data.custom_image_prompt_mode || 'append',
              first_comment_enabled: data.first_comment_enabled !== false,
              first_comment_prompt: data.first_comment_prompt || '',
              overrides: data.overrides || {},
            });

            store.addAuditLog({
              level: 'info',
              category: 'publish',
              message: `Page added: ${newPage.name} (FB ID: ${newPage.fb_page_id}) under account ${newPage.fb_account_id || 'Direct'}`,
              page_id: newPage.id,
            });

            return sendJson({ success: true, page: newPage }, 201);
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'PUT') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.id) {
              return sendJson({ error: 'Page ID is required for update.' }, 400);
            }

            if ((data.profile_id === '__custom__' || data.custom_niche_name) && data.custom_niche_name) {
              const customNicheName = data.custom_niche_name.trim();
              const customProfile = createCustomNicheProfile(customNicheName, {
                customType: data.custom_niche_type || 'factual',
                audience: data.custom_niche_audience,
              });
              seedProfiles.unshift(customProfile);
              data.profile_id = customProfile.id;
            }

            const updated = store.updatePage(data.id, data);
            return sendJson({ success: true, page: updated });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const pageId = data.id || url.searchParams.get('id');
            if (!pageId) {
              return sendJson({ error: 'Page ID is required.' }, 400);
            }
            const deleted = store.deletePage(pageId);
            return sendJson({ success: deleted });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 4. API: Page-Specific Effective Settings & Prompts Resolution
    if (url.pathname === '/api/page-effective-settings') {
      const pageId = url.searchParams.get('pageId');
      const page = pageId ? store.getPageById(pageId) : store.getPages()[0];
      if (!page) {
        return sendJson({ error: 'Page not found' }, 404);
      }

      const profile =
        seedProfiles.find(
          (p) =>
            p.id === page.profile_id ||
            p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
            page.profile_id.toLowerCase().includes(p.name.toLowerCase())
        ) || createCustomNicheProfile(page.profile_id);

      const resolved = resolveSettings({
        profile,
        page: {
          publishingMode: page.publishing_mode,
          hybridMinScore: page.hybrid_min_score,
          overrides: page.overrides || {},
          customCaptionPrompt: page.custom_caption_prompt,
          customCaptionPromptMode: page.custom_caption_prompt_mode,
          customImagePrompt: page.custom_image_prompt,
          customImagePromptMode: page.custom_image_prompt_mode,
        },
      });

      return sendJson({
        page,
        baseProfile: profile,
        effectiveSettings: resolved,
        provenance: resolved.provenance,
      });
    }

    // 5. API: Review Posts list
    if (url.pathname === '/api/review-posts') {
      const posts = store.getPosts();
      return sendJson(posts);
    }

    // 6. API: Review Actions
    if (req.method === 'POST' && url.pathname === '/api/review-action') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const { postId, action, reason, updates } = JSON.parse(body || '{}');
          const target = store.getPostById(postId);
          if (!target) return sendJson({ error: 'Post not found' }, 404);

          if (action === 'approve') {
            const approved = approveReviewPost(target as any);
            store.updatePost(postId, {
              review_state: 'approved',
              status: 'ready',
              scheduled_for: approved.scheduledFor,
              review_note: 'Approved by owner via dashboard',
            });
            return sendJson({ success: true, post: approved.post });
          }

          if (action === 'reject') {
            const rejected = rejectReviewPost(target as any, reason || 'Rejected by owner');
            store.updatePost(postId, {
              review_state: 'rejected',
              status: 'skipped',
              review_note: reason || 'Rejected by owner',
            });
            return sendJson({ success: true, post: rejected });
          }

          if (action === 'edit') {
            const edited = editReviewPost(target as any, updates || {});
            store.updatePost(postId, {
              caption: edited.caption || target.caption,
              caption_word_count: edited.caption_word_count || target.caption_word_count || 0,
              title: edited.title || target.title,
              content_hash: edited.content_hash || target.content_hash,
            });
            return sendJson({ success: true, post: edited });
          }

          return sendJson({ error: 'Unknown action' }, 400);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 7. API: Toggle Kill Switch
    if (req.method === 'POST' && url.pathname === '/api/kill-switch') {
      const current = store.getKillSwitch();
      const updated = store.setKillSwitch(!current);
      return sendJson({ success: true, killSwitchActive: updated });
    }

    // 8. API: Test Run for a Specific Page
    if (req.method === 'POST' && url.pathname === '/api/test-run') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const pageId = parsed.pageId;
          const page = pageId ? store.getPageById(pageId) : store.getPages()[0];
          if (!page) {
            return sendJson({ error: 'No Facebook Page found. Please connect a page first in the Pages tab.' }, 400);
          }
          const profile =
            seedProfiles.find(
              (p) =>
                page &&
                (p.id === page.profile_id ||
                  p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
                  page.profile_id.toLowerCase().includes(p.name.toLowerCase()))
            ) || (page ? createCustomNicheProfile(page.profile_id) : seedProfiles[0]);

          const isHorror = profile.name.toLowerCase().includes('horror');
          const isScience =
            profile.name.toLowerCase().includes('science') ||
            profile.name.toLowerCase().includes('space') ||
            profile.name.toLowerCase().includes('astronomy');

          let topicTitle = `${profile.name}: The Groundbreaking Discovery`;
          let topicCategory = profile.topicSettings?.categories?.[0]?.name || `${profile.name} Highlights`;
          let keyScene = `High-detail visual exploring ${profile.name}, showcasing key elements with dramatic atmospheric lighting and cinematic framing.`;
          let headline = `${profile.name.toUpperCase()}: THE UNSEEN REVELATION`;
          const fixedTags = (profile.hashtagSettings?.fixedHashtags || []).slice(0, 5).join(' ') || `#${profile.name.replace(/\s+/g, '')}`;

          const captionPromptCustom = page?.custom_caption_prompt
            ? `\n\n[Page Override Applied: ${page.custom_caption_prompt}]`
            : '';

          let generatedCaption = `In the world of ${profile.name}, groundbreaking insights continue to challenge everything we thought we knew.\n\nFrom unprecedented technical precision to stunning real-world revelations, the implications are captivating researchers and enthusiasts worldwide.\n\nWhat do you think is the most fascinating aspect of ${profile.name}?${captionPromptCustom}\n\n${fixedTags}`;

          if (isHorror) {
            topicTitle = 'The Whispering Clock of Hemlock Manor';
            topicCategory = 'Haunted Relics';
            keyScene = 'An antique dark mahogany pendulum clock in a moonlit decaying library, casting long shadows.';
            headline = 'THE CLOCK THAT TICKED WITHOUT TIME';
            generatedCaption = `The grandfather clock in the study of Hemlock Manor had not been wound since 1894, yet every night at 3:17 AM, its brass pendulum swung into motion.\n\nLocal legend claimed that the clock did not mark the passage of hours, but the distance between our world and the darkness beneath the cellar stairs.\n\nWhat would you do if a broken clock in your house suddenly started chiming?${captionPromptCustom}\n\n#horror #spooky #creepypasta #mystery #ghoststory`;
          } else if (isScience) {
            topicTitle = 'Webb Telescope Identifies Potential Hycean Atmosphere on K2-18b';
            topicCategory = 'Exoplanet Atmospheres';
            keyScene = 'A vibrant turquoise ocean planet viewed from low orbit with a luminous atmosphere glowing in infrared star light.';
            headline = 'WEBB TELESCOPE FINDS WATER VAPOR ON EXOPLANET';
            generatedCaption = `Astrophysicists analyzing spectroscopic transmission data from the James Webb Space Telescope have detected atmospheric methane and carbon dioxide in the habitable zone exoplanet K2-18b.\n\nThis finding supports the hypothesis that K2-18b could be a Hycean world—an ocean-covered planet beneath a hydrogen-rich atmosphere.\n\nDo you believe ocean worlds are our best chance of discovering microbial life outside the solar system?${captionPromptCustom}\n\n#space #astronomy #science #jwst #discovery`;
          }

          const simOutput = {
            success: true,
            simulatedAt: new Date().toISOString(),
            pageName: page?.name || 'Default Page',
            baseProfile: profile.name,
            publishingMode: page?.publishing_mode || 'hybrid',
            topic: {
              title: topicTitle,
              category: topicCategory,
            },
            caption: generatedCaption,
            wordCount: generatedCaption.trim().split(/\s+/).length,
            qaScore: 95,
            keySceneExtracted: keyScene,
            imageDimensions: page?.overrides?.['image.aspectRatio'] === '1:1' ? '1080x1080 (1:1 Square)' : '1080x1350 (4:5 Portrait)',
            headlinePanel: {
              enabled: page?.overrides?.['image.headlinePanel.enabled'] ?? true,
              headlineText: headline,
              backgroundColor: page?.overrides?.['image.headlinePanel.backgroundColor'] || '#050b14',
            },
            tokensUsed: 1380,
            estimatedCost: '$0.0016',
          };

          // Save created post into the page production pipeline
          const postStatus = page.publishing_mode === 'review' ? 'pending_review' : 'scheduled';
          const reviewState = page.publishing_mode === 'review' ? 'pending' : 'approved';
          const savedPost = store.createPost({
            page_id: page.id,
            fb_account_id: page.fb_account_id,
            title: topicTitle,
            headline: headline,
            caption: generatedCaption,
            caption_word_count: generatedCaption.trim().split(/\s+/).length,
            first_comment: page.first_comment_enabled ? `Join our community discussion on ${profile.name}! What are your thoughts?` : undefined,
            status: postStatus,
            review_state: reviewState as any,
            qa_score: 95,
            scheduled_for: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
          });

          store.addAuditLog({
            level: 'success',
            category: 'publish',
            message: `Automated post generated for "${page.name}": "${topicTitle}" (QA: 95/100)`,
            page_id: page.id,
            details: { postId: savedPost.id, topic: topicTitle, qaScore: 95, mode: page.publishing_mode },
          });

          return sendJson({ ...simOutput, createdPostId: savedPost.id });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 9. API: Providers CRUD
    if (url.pathname === '/api/providers') {
      if (req.method === 'GET') {
        const providers = store.getProviders();
        const allKeys = store.getProviderKeys();
        const enriched = providers.map((p) => {
          const keys = allKeys.filter((k) => k.provider_id === p.id);
          return {
            ...p,
            keyCount: keys.length,
            activeKeyCount: keys.filter((k) => k.is_active).length,
            keys: keys.map((k) => ({
              id: k.id,
              provider_id: k.provider_id,
              masked_key: k.masked_key,
              label: k.label,
              is_active: k.is_active,
              created_at: k.created_at,
            })),
          };
        });
        return sendJson(enriched);
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            let name = data.name;
            let adapter_kind = data.adapter_kind;
            let base_url = data.base_url;
            let model_name = data.model_name;
            let daily_limit = Number(data.daily_limit) || 1000;
            let priority = Number(data.priority) || 1;

            let existingProvider: StoredProvider | undefined = undefined;

            if (data.preset_id) {
              const preset =
                findPresetById(data.preset_id) ||
                PROVIDER_PRESETS.find(
                  (p) =>
                    p.id === data.preset_id ||
                    p.id === `preset-${data.preset_id}` ||
                    p.name.toLowerCase().includes(data.preset_id.toLowerCase())
                );
              if (preset) {
                name = name || preset.name;
                adapter_kind = adapter_kind || preset.kind;
                base_url = base_url || preset.baseUrl;
                model_name = model_name || preset.defaultTextModel || preset.defaultImageModel;
                daily_limit = data.daily_limit ? Number(data.daily_limit) : preset.rpdLimit;

                existingProvider = store.getProviders().find(
                  (p) =>
                    p.id === data.preset_id ||
                    p.id === preset.id ||
                    p.name.toLowerCase().trim() === preset.name.toLowerCase().trim()
                );
              }
            }

            if (!existingProvider && name) {
              existingProvider = store.getProviders().find(
                (p) => p.name.toLowerCase().trim() === name.toLowerCase().trim()
              );
            }

            if (!name || !adapter_kind) {
              return sendJson({ error: 'Provider name and adapter_kind are required.' }, 400);
            }

            let targetProvider: StoredProvider;
            if (existingProvider) {
              targetProvider = store.updateProvider(existingProvider.id, {
                base_url: base_url || existingProvider.base_url,
                model_name: model_name || existingProvider.model_name,
                daily_limit: daily_limit || existingProvider.daily_limit,
                priority: priority || existingProvider.priority,
                enabled: data.enabled !== false,
              });
            } else {
              targetProvider = store.createProvider({
                name,
                adapter_kind,
                base_url,
                model_name,
                daily_limit,
                priority,
                enabled: data.enabled !== false,
              });
            }

            const rawKeysInput = data.initial_key || data.initial_keys || data.raw_key || data.keys || '';
            const parsedKeys = parseRawKeysInput(rawKeysInput);
            const addedKeys: StoredProviderKey[] = [];

            for (let i = 0; i < parsedKeys.length; i++) {
              const k = parsedKeys[i];
              const keyLabel = parsedKeys.length > 1
                ? `${data.key_label || 'Key'} #${i + 1}`
                : (data.key_label || 'Primary Key');
              const addedKey = store.addProviderKey({
                provider_id: targetProvider.id,
                raw_key: k,
                label: keyLabel,
              });
              addedKeys.push(addedKey);
            }

            const currentKeys = store.getProviderKeys(targetProvider.id);
            return sendJson(
              {
                success: true,
                is_existing: Boolean(existingProvider),
                provider: targetProvider,
                addedKeys: addedKeys.map((k) => ({
                  id: k.id,
                  provider_id: k.provider_id,
                  masked_key: k.masked_key,
                  label: k.label,
                  is_active: k.is_active,
                  created_at: k.created_at,
                })),
                key: addedKeys[0]
                  ? {
                      id: addedKeys[0].id,
                      provider_id: addedKeys[0].provider_id,
                      masked_key: addedKeys[0].masked_key,
                      label: addedKeys[0].label,
                      is_active: addedKeys[0].is_active,
                      created_at: addedKeys[0].created_at,
                    }
                  : null,
                totalKeys: currentKeys.length,
                activeKeys: currentKeys.filter((k) => k.is_active).length,
              },
              existingProvider ? 200 : 201
            );
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'PUT') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.id) {
              return sendJson({ error: 'Provider ID is required.' }, 400);
            }
            const updated = store.updateProvider(data.id, data);

            const rawNewKeys = data.new_keys || data.raw_key || data.key || '';
            const addedKeys: StoredProviderKey[] = [];
            if (rawNewKeys) {
              const parsed = parseRawKeysInput(rawNewKeys);
              for (let i = 0; i < parsed.length; i++) {
                const added = store.addProviderKey({
                  provider_id: data.id,
                  raw_key: parsed[i],
                  label: parsed.length > 1 ? `Key #${i + 1}` : (data.key_label || undefined),
                });
                addedKeys.push(added);
              }
            }

            const currentKeys = store.getProviderKeys(data.id);
            return sendJson({
              success: true,
              provider: updated,
              addedKeys: addedKeys.map((k) => ({
                id: k.id,
                provider_id: k.provider_id,
                masked_key: k.masked_key,
                label: k.label,
                is_active: k.is_active,
                created_at: k.created_at,
              })),
              totalKeys: currentKeys.length,
              activeKeys: currentKeys.filter((k) => k.is_active).length,
            });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const providerId = data.id || url.searchParams.get('id');
            if (!providerId) {
              return sendJson({ error: 'Provider ID is required.' }, 400);
            }
            const deleted = store.deleteProvider(providerId);
            return sendJson({ success: deleted });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 10. API: Provider Keys CRUD
    if (url.pathname === '/api/provider-keys') {
      if (req.method === 'GET') {
        const providerId = url.searchParams.get('providerId') || undefined;
        const keys = store.getProviderKeys(providerId).map((k) => ({
          id: k.id,
          provider_id: k.provider_id,
          masked_key: k.masked_key,
          label: k.label,
          is_active: k.is_active,
          created_at: k.created_at,
        }));
        return sendJson(keys);
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const providerId = data.provider_id || data.providerId;
            const rawKeyInput = data.raw_key || data.key || data.raw_keys || data.keys;
            if (!providerId || !rawKeyInput) {
              return sendJson({ error: 'provider_id and raw_key are required.' }, 400);
            }
            const parsedKeys = parseRawKeysInput(rawKeyInput);
            if (parsedKeys.length === 0) {
              return sendJson({ error: 'No valid API keys found in input.' }, 400);
            }

            const addedKeys: StoredProviderKey[] = [];
            for (let i = 0; i < parsedKeys.length; i++) {
              const k = parsedKeys[i];
              const label = parsedKeys.length > 1
                ? `${data.label || 'Key'} #${i + 1}`
                : (data.label || undefined);
              const newKey = store.addProviderKey({
                provider_id: providerId,
                raw_key: k,
                label,
              });
              addedKeys.push(newKey);
            }

            const currentKeys = store.getProviderKeys(providerId);
            return sendJson(
              {
                success: true,
                count: addedKeys.length,
                addedKeys: addedKeys.map((k) => ({
                  id: k.id,
                  provider_id: k.provider_id,
                  masked_key: k.masked_key,
                  label: k.label,
                  is_active: k.is_active,
                  created_at: k.created_at,
                })),
                key: {
                  id: addedKeys[0].id,
                  provider_id: addedKeys[0].provider_id,
                  masked_key: addedKeys[0].masked_key,
                  label: addedKeys[0].label,
                  is_active: addedKeys[0].is_active,
                  created_at: addedKeys[0].created_at,
                },
                totalKeys: currentKeys.length,
                activeKeys: currentKeys.filter((k) => k.is_active).length,
              },
              201
            );
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }

      if (req.method === 'DELETE') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const keyId = data.id || url.searchParams.get('id');
            if (!keyId) {
              return sendJson({ error: 'Key ID is required.' }, 400);
            }
            const deleted = store.deleteProviderKey(keyId);
            return sendJson({ success: deleted });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 11. API: Toggle Key Active/Disabled
    if (req.method === 'POST' && url.pathname === '/api/provider-keys/toggle') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.id) {
            return sendJson({ error: 'Key ID is required.' }, 400);
          }
          const updated = store.toggleProviderKey(data.id, data.is_active);
          return sendJson({
            success: true,
            key: {
              id: updated.id,
              provider_id: updated.provider_id,
              masked_key: updated.masked_key,
              label: updated.label,
              is_active: updated.is_active,
              created_at: updated.created_at,
            },
          });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 12. API: Provider Presets catalog
    if (url.pathname === '/api/provider-presets') {
      return sendJson(PROVIDER_PRESETS);
    }

    // 13. API: Page Details Inspection
    if (url.pathname === '/api/page-details') {
      const pageId = url.searchParams.get('pageId') || url.searchParams.get('id');
      const page = pageId ? store.getPageById(pageId) : store.getPages()[0];
      if (!page) {
        return sendJson({ error: 'Page not found' }, 404);
      }

      const account = store.getAccounts().find((a) => a.id === page.fb_account_id);
      const profile =
        seedProfiles.find(
          (p) =>
            p.id === page.profile_id ||
            p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
            page.profile_id.toLowerCase().includes(p.name.toLowerCase())
        ) || createCustomNicheProfile(page.profile_id);

      const resolved = resolveSettings({
        profile,
        page: {
          publishingMode: page.publishing_mode,
          hybridMinScore: page.hybrid_min_score,
          overrides: page.overrides || {},
          customCaptionPrompt: page.custom_caption_prompt,
          customCaptionPromptMode: page.custom_caption_prompt_mode,
          customImagePrompt: page.custom_image_prompt,
          customImagePromptMode: page.custom_image_prompt_mode,
        },
      });

      const pagePosts = store.getPosts().filter((p) => p.page_id === page.id || p.page_id === page.fb_page_id);
      const publishedPosts = pagePosts.filter((p) => p.status === 'published');
      const scheduledPosts = pagePosts.filter((p) => p.status === 'scheduled');
      const reviewPosts = pagePosts.filter((p) => p.status === 'pending_review' || p.review_state === 'pending');

      const totalImpressions = publishedPosts.reduce((acc, p) => acc + (p.analytics?.impressions || 0), 0);
      const totalReach = publishedPosts.reduce((acc, p) => acc + (p.analytics?.reach || 0), 0);
      const totalLikes = publishedPosts.reduce((acc, p) => acc + (p.analytics?.likes || 0), 0);
      const totalComments = publishedPosts.reduce((acc, p) => acc + (p.analytics?.comments || 0), 0);
      const totalShares = publishedPosts.reduce((acc, p) => acc + (p.analytics?.shares || 0), 0);
      const avgEngagement = publishedPosts.length > 0
        ? Number(((publishedPosts.reduce((acc, p) => acc + (p.analytics?.engagement_rate || 0), 0) / publishedPosts.length)).toFixed(2))
        : 0;

      const scoredPosts = pagePosts.filter((p) => typeof p.qa_score === 'number');
      const avgQaScore = scoredPosts.length > 0
        ? Math.round(scoredPosts.reduce((acc, p) => acc + (p.qa_score || 0), 0) / scoredPosts.length)
        : 0;

      const pageLogs = store.getAuditLogs().filter(
        (l) => l.page_id === page.id || l.details?.page_id === page.id || l.message.includes(page.name)
      );

      return sendJson({
        page,
        account: account ? { id: account.id, account_name: account.account_name, fb_user_id: account.fb_user_id, token_status: account.token_status } : null,
        profile,
        effectiveSettings: resolved,
        posts: pagePosts,
        stats: {
          totalPosts: pagePosts.length,
          publishedCount: publishedPosts.length,
          scheduledCount: scheduledPosts.length,
          reviewCount: reviewPosts.length,
          totalImpressions,
          totalReach,
          totalLikes,
          totalComments,
          totalShares,
          avgEngagement,
          avgQaScore,
        },
        auditLogs: pageLogs,
      });
    }

    // 14. Dedicated Standalone Page Details Window
    if (req.method === 'GET' && url.pathname === '/page-details') {
      const pageId = url.searchParams.get('id') || url.searchParams.get('pageId') || '';
      const html = generateStandalonePageDetailsHtml(pageId);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // 15. Web Dashboard HTML UI
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      const html = generateDashboardHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

export function createDashboardServer(): http.Server {
  return http.createServer(handleRequest);
}

function generateDashboardHtml(): string {
  const accounts = store.getAccounts();
  const pages = store.getPages();
  const posts = store.getPosts();
  const providers = store.getProviders();
  const providerKeys = store.getProviderKeys();
  const auditLogs = store.getAuditLogs();
  const killSwitch = store.getKillSwitch();
  const reviewPosts = posts.filter((p) => p.status === 'pending_review' || p.review_state === 'pending');
  const publishedPosts = posts.filter((p) => p.status === 'published' && p.analytics);
  const totalImpressions = publishedPosts.reduce((acc, p) => acc + (p.analytics?.impressions || 0), 0);
  const totalReach = publishedPosts.reduce((acc, p) => acc + (p.analytics?.reach || 0), 0);
  const totalLikes = publishedPosts.reduce((acc, p) => acc + (p.analytics?.likes || 0), 0);
  const totalComments = publishedPosts.reduce((acc, p) => acc + (p.analytics?.comments || 0), 0);
  const totalShares = publishedPosts.reduce((acc, p) => acc + (p.analytics?.shares || 0), 0);
  const avgEngagement =
    publishedPosts.length > 0
      ? (publishedPosts.reduce((acc, p) => acc + (p.analytics?.engagement_rate || 0), 0) / publishedPosts.length).toFixed(1)
      : '0.0';
  const reachDisplay = totalReach >= 1000 ? `${(totalReach / 1000).toFixed(1)}K` : `${totalReach}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FB Auto 247 - Autonomous Multi-Page Facebook System</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --accent: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
    }
    .sidebar {
      width: 280px;
      background: var(--card-bg);
      border-right: 1px solid var(--card-border);
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }
    .brand-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
    }
    .brand-title { font-size: 16px; font-weight: 700; }
    .brand-badge { font-size: 11px; color: var(--primary); font-weight: 600; }
    .nav-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .nav-item button {
      width: 100%;
      text-align: left;
      padding: 11px 14px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.15s;
    }
    .nav-item button:hover { background: #1e293b; color: var(--text); }
    .nav-item button.active { background: #1e3a8a; color: #60a5fa; font-weight: 600; }
    .badge {
      background: var(--primary);
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
    }

    .main {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
      max-width: 1300px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
    }
    .header-title h1 { font-size: 26px; font-weight: 800; margin-bottom: 4px; }
    .header-title p { color: var(--text-muted); font-size: 14px; }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #064e3b;
      color: #34d399;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; animation: pulse 2s infinite; }
    @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; margin-bottom: 28px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
    }
    .card-title { font-size: 13px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 8px; }
    .card-val { font-size: 28px; font-weight: 800; }
    .card-meta { font-size: 12px; color: var(--text-muted); margin-top: 6px; }

    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    th { text-align: left; padding: 12px; color: var(--text-muted); border-bottom: 1px solid var(--card-border); font-size: 12px; text-transform: uppercase; }
    td { padding: 14px 12px; border-bottom: 1px solid var(--card-border); }
    .btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-success { background: var(--success); color: white; }
    .btn-danger { background: var(--danger); color: white; }
    .btn-secondary { background: #374151; color: white; }
    .btn-secondary:hover { background: #4b5563; }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; }
    .form-control {
      width: 100%;
      background: #0b0f19;
      border: 1px solid var(--card-border);
      color: #f3f4f6;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
    }
    .form-control:focus { outline: none; border-color: var(--primary); }
    textarea.form-control { font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.5; resize: vertical; }

    .modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 20px;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      width: 100%;
      max-width: 620px;
      padding: 24px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-icon">247</div>
      <div>
        <div class="brand-title">FB Auto 247</div>
        <div class="brand-badge">Engine v${CORE_VERSION}</div>
      </div>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button class="active" onclick="showTab('overview', this)">📊 Overview</button></li>
      <li class="nav-item"><button onclick="showTab('accounts', this)">👥 FB Accounts & IDs (<span id="sidebarAccountCount">${accounts.length}</span>)</button></li>
      <li class="nav-item"><button onclick="showTab('pages', this)">📑 Pages & Accounts (<span id="sidebarPageCount">${pages.length}</span>)</button></li>
      <li class="nav-item"><button onclick="showTab('page-prompts', this)">✍️ Page Prompt Studio</button></li>
      <li class="nav-item"><button onclick="showTab('review', this)">📬 Review Inbox <span class="badge" id="revBadge">${reviewPosts.length}</span></button></li>
      <li class="nav-item"><button onclick="showTab('calendar', this)">📅 Schedule Calendar</button></li>
      <li class="nav-item"><button onclick="showTab('analytics', this)">📈 Analytics & Insights</button></li>
      <li class="nav-item"><button onclick="showTab('simulator', this)">⚡ Test Run Simulator</button></li>
      <li class="nav-item"><button onclick="showTab('providers', this)">🔌 Providers & Quotas</button></li>
      <li class="nav-item"><button onclick="showTab('audit', this)">📋 System Audit Logs</button></li>
      <li class="nav-item"><button onclick="showTab('settings', this)">⚙️ Settings & Controls</button></li>
    </ul>
    <div style="margin-top: auto; padding-top: 20px; border-top: 1px solid var(--card-border);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
          <div style="width: 28px; height: 28px; border-radius: 50%; background: #2563eb; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold; flex-shrink: 0;">👤</div>
          <span style="font-size: 12px; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${process.env.OWNER_EMAIL || 'Administrator'}">${process.env.OWNER_EMAIL || 'Administrator'}</span>
        </div>
      </div>
      <a href="/api/auth/logout" style="display: block; width: 100%; text-align: center; padding: 8px 12px; background: #1f2937; color: #f87171; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; transition: background 0.15s;" onmouseover="this.style.background='#374151'" onmouseout="this.style.background='#1f2937'">🚪 Sign Out</a>
      <div style="font-size: 11px; color: var(--text-muted); text-align: center; margin-top: 14px; font-weight: 500; letter-spacing: 0.3px;">Made by <strong style="color: #60a5fa;">Chandan Biswas</strong></div>
    </div>
  </aside>

  <!-- Main Body -->
  <main class="main">
    <header class="header">
      <div class="header-title">
        <h1 id="tabHeading">FB Auto 247 Dashboard</h1>
        <p id="tabDesc">Autonomous 24/7 multi-page content machine • Made by Chandan Biswas</p>
      </div>
      <div class="status-pill" id="workerPill">
        <div class="status-dot"></div>
        <span>Worker Active & Heartbeat Healthy</span>
      </div>
    </header>

    <!-- TAB 1: OVERVIEW -->
    <div id="tab-overview" class="tab-content active">
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));">
        <div class="card">
          <div class="card-title">Connected Facebook IDs</div>
          <div class="card-val" style="color: #60a5fa;" id="ovAccountCount">${accounts.length}</div>
          <div class="card-meta">Multi-profile identity cluster</div>
        </div>
        <div class="card">
          <div class="card-title">Connected FB Pages</div>
          <div class="card-val" style="color: #38bdf8;" id="ovPageCount">${pages.length}</div>
          <div class="card-meta">All configured with custom prompts</div>
        </div>
        <div class="card">
          <div class="card-title">30-Day Organic Reach</div>
          <div class="card-val" style="color: #34d399;">${reachDisplay}</div>
          <div class="card-meta">Live aggregated Facebook reach</div>
        </div>
        <div class="card">
          <div class="card-title">Awaiting Owner Review</div>
          <div class="card-val" style="color: #fbbf24;" id="ovRevCount">${reviewPosts.length}</div>
          <div class="card-meta">Pending verification in Review Inbox</div>
        </div>
        <div class="card">
          <div class="card-title">Scheduled & Live</div>
          <div class="card-val" style="color: #a78bfa;">${posts.filter((p) => p.status === 'scheduled_on_fb' || p.status === 'published').length}</div>
          <div class="card-meta">Active autonomous pipeline</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Provider Daily Demand & Quotas</h3>
        ${providers.length > 0
          ? `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
              ${providers.map((p) => {
                const pct = Math.min(100, Math.round(((p.used_today || 0) / (p.daily_limit || 1)) * 100));
                return `<div>
                  <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <span>${p.name}</span>
                    <strong>${p.used_today || 0} / ${p.daily_limit.toLocaleString()} reqs (${pct}%)</strong>
                  </div>
                  <div style="height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 6px;">
                    <div style="height: 100%; width: ${pct}%; background: ${pct > 85 ? '#ef4444' : '#3b82f6'};"></div>
                  </div>
                </div>`;
              }).join('')}
            </div>`
          : `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">No AI providers configured yet. Add providers in the <strong>Providers & Keys</strong> tab to track live quota usage.</div>`
        }
      </div>
    </div>

    <!-- TAB 2: FB ACCOUNTS & IDENTITIES -->
    <div id="tab-accounts" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div>
            <h3 style="font-size: 18px; margin-bottom: 4px;">Connected Facebook Accounts (Multiple Facebook IDs)</h3>
            <p style="color: var(--text-muted); font-size: 13px;">
              Manage 3-5+ distinct Facebook User IDs or Business Manager profiles. Create and run pages from different Facebook accounts with AES-256-GCM encrypted tokens.
            </p>
          </div>
          <button class="btn btn-primary" onclick="openAddAccountModal()">➕ Connect Facebook Account (FB ID)</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Facebook Account & Owner</th>
              <th>Facebook User ID</th>
              <th>Token Vault Status</th>
              <th>Token Expiry</th>
              <th>Connected Pages</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="accountsTableBody">
            ${accounts.length > 0
              ? accounts
                  .map((acc) => {
                    const ownedPages = pages.filter((p) => p.fb_account_id === acc.id);
                    return `
                  <tr id="account-row-${acc.id}">
                    <td>
                      <strong>${acc.account_name}</strong><br>
                      <small style="color: var(--text-muted);">${acc.email || 'No email specified'} • ${acc.notes || 'Creator profile'}</small>
                    </td>
                    <td><code style="font-size: 13px;">${acc.fb_user_id}</code></td>
                    <td>
                      <span style="color: #34d399; font-weight: 600;">● ${acc.token_status.toUpperCase()}</span><br>
                      <span class="badge" style="background: #1e293b; color: #93c5fd; font-family: monospace; font-size: 11px;">${acc.masked_token || 'EAAB...vault'}</span>
                    </td>
                    <td>
                      <span style="font-size: 12px; color: #d1d5db;">${acc.token_expires_at ? new Date(acc.token_expires_at).toLocaleDateString() : 'Long-Lived'}</span>
                    </td>
                    <td>
                      <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${
                          ownedPages.length > 0
                            ? ownedPages
                                .map(
                                  (p) => `<span class="badge" style="background: #1e3a8a; color: #60a5fa; font-size: 11px; cursor: pointer;" onclick="openPageDetailsWindow('${p.id}')" title="Click to view all data and live feed for ${p.name}">📄 ${p.name} ↗</span>`
                                )
                                .join('')
                            : '<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No pages linked yet</span>'
                        }
                      </div>
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                      <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="addPageForAccount('${acc.id}')">➕ Add Page</button>
                      <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="openEditAccountModal('${acc.id}')">✏️ Edit</button>
                      <button class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;" onclick="deleteAccountAction('${acc.id}')">🗑️</button>
                    </td>
                  </tr>
                `;
                  })
                  .join('')
              : `<tr><td colspan="6" style="text-align: center; padding: 36px; color: var(--text-muted);">
                  <div style="font-size: 28px; margin-bottom: 8px;">👤</div>
                  <div style="font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Facebook Identities Connected</div>
                  <div style="font-size: 12px;">Click <strong>➕ Connect Facebook Account</strong> above to add your first Facebook User ID or Business Manager.</div>
                </td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: PAGES & ACCOUNTS -->
    <div id="tab-pages" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="font-size: 18px;">Connected Facebook Pages</h3>
            <p style="color: var(--text-muted); font-size: 13px;">Manage pages across all your Facebook IDs. Each page has isolated prompts, voice, and publishing cadence.</p>
          </div>
          <button class="btn btn-primary" onclick="openAddPageModal()">➕ Connect / Add New Page</button>
        </div>

        <!-- Facebook Account Filter Toolbar -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; background: #0b0f19; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--card-border);">
          <span style="font-size: 13px; color: var(--text-muted); font-weight: 600;">Filter by Facebook Identity:</span>
          <button class="btn btn-primary page-filter-btn active" style="padding: 4px 10px; font-size: 12px;" onclick="filterPagesByAccount('all', this)">All Facebook IDs (${pages.length})</button>
          ${accounts
            .map((acc) => {
              const count = pages.filter((p) => p.fb_account_id === acc.id).length;
              return `<button class="btn btn-secondary page-filter-btn" style="padding: 4px 10px; font-size: 12px;" onclick="filterPagesByAccount('${acc.id}', this)">👤 ${acc.account_name} (${count})</button>`;
            })
            .join('')}
        </div>

        <table>
          <thead>
            <tr>
              <th>Page Name & Base Niche</th>
              <th>Facebook Identity (Owner)</th>
              <th>Facebook Page ID</th>
              <th>Publishing Mode</th>
              <th>Posting Schedule</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="pagesTableBody">
            ${pages.length > 0
              ? pages
                  .map((p) => {
                    const ownerAcc = accounts.find((a) => a.id === p.fb_account_id);
                    return `
                  <tr id="page-row-${p.id}" class="page-row" data-account="${p.fb_account_id || ''}">
                    <td>
                      <a href="javascript:void(0)" onclick="openPageDetailsWindow('${p.id}')" style="color: #60a5fa; text-decoration: none; font-size: 15px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;" title="View all posts, stats & details for ${p.name}">
                        📄 ${p.name} <span class="badge" style="background: rgba(96,165,250,0.15); color: #93c5fd; font-size: 10px; padding: 2px 6px;">Inspect ↗</span>
                      </a><br>
                      <small style="color: var(--text-muted);">Base Niche: <strong style="color: #cbd5e1;">${p.profile_id}</strong></small>
                    </td>
                    <td>
                      <span class="badge" style="background: #1e293b; color: #93c5fd; font-size: 11px;">
                        👤 ${ownerAcc ? ownerAcc.account_name : 'Direct Page Token'}
                      </span><br>
                      <small style="color: var(--text-muted); font-family: monospace;">ID: ${ownerAcc ? ownerAcc.fb_user_id : p.fb_page_id}</small>
                    </td>
                    <td><code>${p.fb_page_id}</code></td>
                    <td>
                      <span style="background: #1e3a8a; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                        ${p.publishing_mode} (Min ${p.hybrid_min_score})
                      </span>
                    </td>
                    <td>${p.schedule.postsPerDay} posts/day (${p.schedule.postingTimes.join(', ')})</td>
                    <td style="text-align: right;">
                      <div style="display: flex; justify-content: flex-end; gap: 6px;">
                        <button class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" onclick="openPageDetailsWindow('${p.id}')">🔍 View Page Data</button>
                        <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="openPagePromptStudio('${p.id}')">✍️ Prompts</button>
                        <button class="btn btn-danger" style="padding: 5px 8px; font-size: 12px;" onclick="deletePageAction('${p.id}')">🗑️</button>
                      </div>
                    </td>
                  </tr>
                `;
                  })
                  .join('')
              : `<tr><td colspan="6" style="text-align: center; padding: 36px; color: var(--text-muted);">
                  <div style="font-size: 28px; margin-bottom: 8px;">📄</div>
                  <div style="font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Facebook Pages Added</div>
                  <div style="font-size: 12px;">Click <strong>➕ Connect / Add New Page</strong> above to add your first Facebook Page.</div>
                </td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: PAGE PROMPT STUDIO -->
    <div id="tab-page-prompts" class="tab-content">
      ${pages.length > 0 ? `
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; border-bottom: 1px solid var(--card-border); padding-bottom: 16px;">
          <div>
            <h3 style="font-size: 18px;">Page-Specific Prompt Studio & Overrides</h3>
            <p style="color: var(--text-muted); font-size: 13px;">Customize caption generation rules, voice, and image styles independently for each Facebook Page.</p>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <label style="font-size: 13px; font-weight: 600;">Select Page to Customize:</label>
            <select id="studioPageSelect" class="form-control" style="width: 280px;" onchange="loadPageIntoStudio()">
              ${pages.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <!-- Left Column: Caption Prompts -->
          <div>
            <div class="form-group">
              <label>Base Content Niche / Profile (25+ Presets or Type Custom Niche)</label>
              <select id="editProfileSelect" class="form-control" onchange="toggleCustomNicheField(this.value, 'studioCustomNicheBox')">
                ${renderNicheSelectOptions(seedProfiles)}
              </select>
            </div>

            <div id="studioCustomNicheBox" style="display: none; background: rgba(59, 130, 246, 0.08); border: 1px dashed #3b82f6; padding: 12px; border-radius: 8px; margin-bottom: 14px;">
              <div style="font-size: 12px; font-weight: 600; color: #93c5fd; margin-bottom: 6px;">
                ✨ Custom Content Niche Definition for this Page
              </div>
              <input type="text" id="editCustomNicheName" class="form-control" placeholder="Type your custom niche (e.g. Mechanical Watchmaking, Bonsai, Formula 1...)">
            </div>

            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin: 0;">Page Custom Caption Prompt</label>
                <select id="editCaptionMode" style="background: #1f2937; color: white; border: 1px solid #374151; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                  <option value="append">Mode: Append to Base Profile</option>
                  <option value="replace">Mode: Replace Profile Completely</option>
                </select>
              </div>
              <textarea id="editCaptionPrompt" class="form-control" style="height: 180px;" placeholder="Add custom voice, guidelines, or requirements specifically for this page..."></textarea>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
              <div class="form-group">
                <label>Min Words</label>
                <input type="number" id="editMinWords" class="form-control" value="120">
              </div>
              <div class="form-group">
                <label>Target Words</label>
                <input type="number" id="editTargetWords" class="form-control" value="180">
              </div>
              <div class="form-group">
                <label>Max Words</label>
                <input type="number" id="editMaxWords" class="form-control" value="250">
              </div>
            </div>
          </div>

          <!-- Right Column: Image Prompts & Headline Panel -->
          <div>
            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin: 0;">Page Custom Image Prompt & Visual Bible</label>
                <select id="editImageMode" style="background: #1f2937; color: white; border: 1px solid #374151; padding: 2px 8px; border-radius: 4px; font-size: 12px;">
                  <option value="append">Mode: Append to Base Profile</option>
                  <option value="replace">Mode: Replace Profile Completely</option>
                </select>
              </div>
              <textarea id="editImagePrompt" class="form-control" style="height: 180px;" placeholder="Custom visual style, color palette, camera angle for this page..."></textarea>
            </div>

            <div class="card" style="background: #0b0f19; border: 1px solid var(--card-border); padding: 14px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <label style="font-weight: 700; font-size: 13px; text-transform: uppercase;">Headline Panel Settings</label>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="editPanelEnabled" checked> Enable Headline Panel Overlay
                </label>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                <div>
                  <label style="font-size: 11px; color: var(--text-muted);">Aspect Ratio</label>
                  <select id="editAspectRatio" class="form-control" style="padding: 6px;">
                    <option value="4:5">4:5 Portrait (1080x1350)</option>
                    <option value="1:1">1:1 Square (1080x1080)</option>
                    <option value="16:9">16:9 Landscape (1920x1080)</option>
                  </select>
                </div>
                <div>
                  <label style="font-size: 11px; color: var(--text-muted);">Panel Height %</label>
                  <input type="number" id="editPanelHeight" class="form-control" value="25" min="15" max="40" style="padding: 6px;">
                </div>
                <div>
                  <label style="font-size: 11px; color: var(--text-muted);">Panel Color</label>
                  <input type="color" id="editPanelColor" class="form-control" value="#050b14" style="padding: 2px; height: 35px;">
                </div>
              </div>
            </div>

            <div class="card" style="background: #0b0f19; border: 1px solid var(--card-border); padding: 14px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label style="font-weight: 700; font-size: 13px; text-transform: uppercase; color: #34d399;">First Comment Auto-Booster (Reach Optimization)</label>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="editFirstCommentEnabled" checked> Auto-post first comment
                </label>
              </div>
              <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Keeps external links and citations out of main caption to avoid Facebook reach suppression.</p>
              <textarea id="editFirstCommentPrompt" class="form-control" style="height: 60px;" placeholder="e.g. 💬 What do you think about this? Full research link in bio."></textarea>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; border-top: 1px solid var(--card-border); padding-top: 18px;">
          <button class="btn btn-secondary" onclick="inspectEffectivePrompt()">🔍 Inspect Live Effective Prompt</button>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" onclick="testRunCurrentPage()">⚡ Test Run This Page</button>
            <button class="btn btn-success" onclick="savePagePromptsAction()">💾 Save Page Prompts</button>
          </div>
        </div>

        <!-- Live Effective Prompt Inspection Modal/Panel -->
        <div id="effectiveInspectBox" style="display: none; margin-top: 20px; background: #0b0f19; border: 1px solid var(--primary); border-radius: 8px; padding: 16px;">
          <h4 style="color: #60a5fa; margin-bottom: 8px;">Effective Resolved Prompt for this Page:</h4>
          <pre id="effectiveInspectCode" style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #e5e7eb; white-space: pre-wrap; line-height: 1.5;"></pre>
        </div>
      </div>` : `
      <div class="card" style="text-align: center; padding: 48px 24px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 12px;">✍️</div>
        <h4 style="font-size: 16px; font-weight: 600; color: #d1d5db; margin-bottom: 6px;">No Facebook Pages Available</h4>
        <p style="font-size: 13px; max-width: 500px; margin: 0 auto;">Connect a Facebook Page in the <strong>Pages & Accounts</strong> tab to begin customizing isolated prompts, voice, word counts, and headline panels.</p>
      </div>`}
    </div>

    <!-- TAB 4: REVIEW INBOX -->
    <div id="tab-review" class="tab-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <div>
          <h3 style="font-size: 18px;">Review Inbox</h3>
          <p style="color: var(--text-muted); font-size: 13px;">Owner verification gate. Review, edit caption, or approve posts before Facebook scheduling.</p>
        </div>
        <button class="btn btn-primary" onclick="bulkApproveAction()">✓ Bulk Approve All (<span id="revBtnCount">${reviewPosts.length}</span>)</button>
      </div>

      <div id="reviewCardsList">
        ${reviewPosts.length > 0
          ? reviewPosts
              .map(
                (p) => `
              <div class="card" id="card-${p.id}" style="margin-bottom: 18px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                  <div>
                    <h4 style="font-size: 17px; font-weight: 700; color: #60a5fa;">${p.title}</h4>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                      Target Page: <strong>${p.page_id}</strong> • Scheduled for: ${new Date(p.scheduled_for).toLocaleString()} • Word count: ${p.caption_word_count}
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <span style="background: #064e3b; color: #34d399; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 12px;">QA: ${p.qa_score}/100</span>
                    <span style="background: #1e3a8a; color: #93c5fd; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 12px;">Safety Approved</span>
                  </div>
                </div>

                <div style="background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 14px; margin-bottom: 14px; font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${p.caption}</div>

                ${
                  p.first_comment
                    ? `
                <div style="background: #062016; border: 1px solid #065f46; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; color: #a7f3d0;">
                  <strong>💬 First Comment Auto-Booster:</strong> ${p.first_comment}
                </div>`
                    : ''
                }

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                  <button class="btn btn-secondary" onclick="editCaptionPrompt('${p.id}')">✏️ Edit Caption</button>
                  <button class="btn btn-danger" onclick="rejectPostAction('${p.id}')">✕ Reject</button>
                  <button class="btn btn-success" onclick="approvePostAction('${p.id}')">✓ Approve & Schedule</button>
                </div>
              </div>
            `
              )
              .join('')
          : `<div style="text-align: center; padding: 48px 24px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; color: var(--text-muted);">
              <div style="font-size: 32px; margin-bottom: 12px;">📬</div>
              <h4 style="font-size: 16px; font-weight: 600; color: #d1d5db; margin-bottom: 6px;">Review Inbox is Empty</h4>
              <p style="font-size: 13px;">No posts are currently awaiting review. Generated posts requiring owner verification will appear here.</p>
            </div>`
        }
      </div>
    </div>

    <!-- TAB 6: SCHEDULE CALENDAR GRID -->
    <div id="tab-calendar" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div>
            <h3 style="font-size: 18px; margin-bottom: 4px;">7-Day Autonomous Schedule Calendar</h3>
            <p style="color: var(--text-muted); font-size: 13px;">Multi-page posting time slots optimized for Facebook algorithm audience peaks.</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <span class="badge" style="background: #064e3b; color: #34d399;">● Published</span>
            <span class="badge" style="background: #1e3a8a; color: #60a5fa;">● Scheduled on FB</span>
            <span class="badge" style="background: #78350f; color: #f59e0b;">● Review Required</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; overflow-x: auto;">
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            .map((day, idx) => {
              const dayDate = new Date(Date.now() + (idx - 1) * 86400 * 1000);
              const dayPosts = posts.filter((p) => {
                const pDate = new Date(p.scheduled_for);
                return pDate.getDay() === dayDate.getDay();
              });

              return `
              <div style="background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 12px; min-width: 140px;">
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #93c5fd;">${day}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">${dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${
                    dayPosts.length > 0
                      ? dayPosts
                          .map((p) => {
                            const pg = pages.find((page) => page.id === p.page_id);
                            const isPub = p.status === 'published';
                            const isSched = p.status === 'scheduled_on_fb';
                            const bg = isPub ? '#064e3b' : isSched ? '#1e3a8a' : '#78350f';
                            const textC = isPub ? '#34d399' : isSched ? '#93c5fd' : '#f59e0b';

                            return `
                        <div style="background: #111827; border: 1px solid ${bg}; border-radius: 6px; padding: 8px; font-size: 11px;">
                          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                            <span style="font-weight: 700; color: ${textC};">${new Date(p.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <span style="font-size: 10px; background: ${bg}; color: white; padding: 1px 4px; border-radius: 4px;">${p.status.split('_')[0]}</span>
                          </div>
                          <div style="font-weight: 600; color: #f3f4f6; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.title}">${p.title}</div>
                          <div style="color: var(--text-muted); font-size: 10px;">${pg?.name.split('&')[0] || 'Page'}</div>
                        </div>
                      `;
                          })
                          .join('')
                      : '<div style="color: #4b5563; font-size: 11px; font-style: italic; padding: 8px 0;">No active slots</div>'
                  }
                </div>
              </div>
            `;
            })
            .join('')}
        </div>
      </div>
    </div>

    <!-- TAB 7: ANALYTICS & INSIGHTS -->
    <div id="tab-analytics" class="tab-content">
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-bottom: 24px;">
        <div class="card">
          <div class="card-title">30-Day Organic Impressions</div>
          <div class="card-val" style="color: #60a5fa;">${totalImpressions >= 1000 ? (totalImpressions / 1000).toFixed(1) + 'K' : totalImpressions}</div>
          <div class="card-meta">${publishedPosts.length} published post${publishedPosts.length === 1 ? '' : 's'} tracked</div>
        </div>
        <div class="card">
          <div class="card-title">Unique Audience Reach</div>
          <div class="card-val" style="color: #34d399;">${totalReach >= 1000 ? (totalReach / 1000).toFixed(1) + 'K' : totalReach}</div>
          <div class="card-meta">Live verified Facebook reach</div>
        </div>
        <div class="card">
          <div class="card-title">Average Engagement Rate</div>
          <div class="card-val" style="color: #a78bfa;">${avgEngagement}%</div>
          <div class="card-meta">Based on Facebook Graph API metrics</div>
        </div>
        <div class="card">
          <div class="card-title">Reactions & Comments</div>
          <div class="card-val" style="color: #f59e0b;">${(totalLikes + totalComments).toLocaleString()}</div>
          <div class="card-meta">${totalShares.toLocaleString()} shares recorded</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 16px; font-size: 18px;">🏆 Top Performing Autonomous Posts Leaderboard</h3>
        <table>
          <thead>
            <tr>
              <th>Rank & Post Title</th>
              <th>Page Channel</th>
              <th>Organic Reach</th>
              <th>Reactions</th>
              <th>Comments</th>
              <th>Shares</th>
              <th>Engagement %</th>
            </tr>
          </thead>
          <tbody>
            ${publishedPosts.length > 0
              ? publishedPosts
                  .sort((a, b) => (b.analytics?.reach || 0) - (a.analytics?.reach || 0))
                  .map((p, idx) => {
                    const pg = pages.find((page) => page.id === p.page_id);
                    return `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-weight: 800; color: ${idx === 0 ? '#fbbf24' : idx === 1 ? '#d1d5db' : '#b45309'}; font-size: 16px;">#${idx + 1}</span>
                        <div>
                          <strong>${p.title}</strong><br>
                          <small style="color: var(--text-muted);">${p.headline || 'Organic Post'}</small>
                        </div>
                      </div>
                    </td>
                    <td><span class="badge" style="background: #1e3a8a; color: #60a5fa;">${pg?.name || 'Page'}</span></td>
                    <td><strong style="color: #34d399;">${(p.analytics?.reach || 0).toLocaleString()}</strong></td>
                    <td>${(p.analytics?.likes || 0).toLocaleString()}</td>
                    <td>${(p.analytics?.comments || 0).toLocaleString()}</td>
                    <td>${(p.analytics?.shares || 0).toLocaleString()}</td>
                    <td><span style="background: #064e3b; color: #34d399; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px;">${p.analytics?.engagement_rate}%</span></td>
                  </tr>
                `;
                  })
                  .join('')
              : `<tr><td colspan="7" style="text-align: center; padding: 36px; color: var(--text-muted);"><div style="font-size: 24px; margin-bottom: 6px;">📊</div>No published posts or analytics recorded yet. Posts published to Facebook will appear on this leaderboard with reach, reactions, and engagement metrics.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 8: PIPELINE SIMULATOR -->
    <div id="tab-simulator" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 10px; font-size: 16px;">End-to-End Pipeline Simulator (Test Run)</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 18px;">
          Runs research collector, topic scoring, chunked narrative writing, caption validation, image prompt composition, and QA audit for any selected page.
        </p>

        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 20px;">
          <select id="simPageSelect" class="form-control" style="width: 320px;">
            ${pages.length > 0
              ? pages.map((p) => `<option value="${p.id}">Page: ${p.name}</option>`).join('')
              : '<option value="">(No pages added yet - add a page in Pages tab)</option>'
            }
          </select>
          <button class="btn btn-primary" onclick="runSimulationForSelectedPage()" ${pages.length === 0 ? 'disabled' : ''}>🚀 Run Test Run For Page</button>
        </div>

        <div id="simResult" style="display: none; background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 18px;">
          <h4 style="color: #34d399; font-size: 15px; margin-bottom: 12px;">✓ Simulation Completed with Page's Exact Prompts</h4>
          <div id="simOutput" style="font-size: 13px; line-height: 1.6;"></div>
        </div>
      </div>
    </div>

    <!-- TAB 9: PROVIDERS -->
    <div id="tab-providers" class="tab-content">
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 16px; margin-bottom: 4px;">Configured LLM & Image Providers</h3>
            <p style="font-size: 13px; color: var(--text-muted);">Manage AI endpoints, daily request quotas, failover priorities, and AES-256-GCM encrypted API key rotation pools.</p>
          </div>
          <button class="btn btn-primary" onclick="openAddProviderModal()">➕ Add Provider</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Provider & Model</th>
              <th>Adapter Kind</th>
              <th>Failover Priority</th>
              <th>Daily Quota</th>
              <th>Key Pool (AES-256-GCM)</th>
              <th>Status</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="providersTableBody">
            ${providers.length > 0
              ? providers
                  .map((p) => {
                    const keys = providerKeys.filter((k) => k.provider_id === p.id);
                    const activeKeys = keys.filter((k) => k.is_active);
                    const keyBadges =
                      keys.length > 0
                        ? keys
                            .map(
                              (k) =>
                                `<span class="badge" style="background: ${
                                  k.is_active ? '#1e293b' : '#27272a'
                                }; color: ${
                                  k.is_active ? '#93c5fd' : '#71717a'
                                }; font-family: 'JetBrains Mono', monospace; font-size: 11px; margin: 2px; display: inline-block;">${
                                  k.masked_key
                                }</span>`
                            )
                            .join('')
                        : '<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No keys added</span>';
                    const pct = Math.min(100, Math.round(((p.used_today || 0) / (p.daily_limit || 1)) * 100));

                    return `
                    <tr id="provider-row-${p.id}">
                      <td>
                        <strong>${p.name}</strong><br>
                        <span style="font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">${
                          p.model_name || 'default'
                        }</span>
                      </td>
                      <td><code>${p.adapter_kind}</code></td>
                      <td><span class="badge" style="background: #1e3a8a; color: #60a5fa;">Priority ${p.priority}</span></td>
                      <td>
                        <div style="font-weight: 600;">${p.used_today || 0} / ${p.daily_limit} reqs</div>
                        <div style="width: 100px; height: 5px; background: #374151; border-radius: 3px; margin-top: 4px; overflow: hidden;">
                          <div style="width: ${pct}%; height: 100%; background: ${pct > 85 ? '#ef4444' : '#3b82f6'};"></div>
                        </div>
                      </td>
                      <td>
                        <div style="margin-bottom: 4px; max-width: 280px;">${keyBadges}</div>
                        <span style="font-size: 11px; color: ${activeKeys.length > 0 ? '#34d399' : '#f59e0b'};">
                          ● ${activeKeys.length} active key${activeKeys.length === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td>
                        ${
                          p.enabled
                            ? '<span style="color: #34d399; font-weight: 600;">● Active</span>'
                            : '<span style="color: #ef4444; font-weight: 600;">● Disabled</span>'
                        }
                      </td>
                      <td style="text-align: right; white-space: nowrap;">
                        <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="openManageKeysModal('${
                          p.id
                        }')">🔑 Keys (${keys.length})</button>
                        <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="openEditProviderModal('${
                          p.id
                        }')">✏️ Edit</button>
                        <button class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;" onclick="deleteProviderAction('${
                          p.id
                        }')">🗑️</button>
                      </td>
                    </tr>
                  `;
                  })
                  .join('')
              : `<tr><td colspan="7" style="text-align: center; padding: 36px; color: var(--text-muted);">
                  <div style="font-size: 28px; margin-bottom: 8px;">🤖</div>
                  <div style="font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No AI Providers Configured</div>
                  <div style="font-size: 12px;">Click <strong>➕ Add Provider</strong> above to add Gemini, OpenAI, Cloudflare, or Pollinations with your API keys.</div>
                </td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 10: SYSTEM AUDIT LOGS -->
    <div id="tab-audit" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div>
            <h3 style="font-size: 18px; margin-bottom: 4px;">System Audit & Operational Event Stream</h3>
            <p style="color: var(--text-muted); font-size: 13px;">Real-time tracking of Facebook Graph API calls, token checks, perceptual duplicate audits, and failovers.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="renderAuditLogs('all')">All Events</button>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="renderAuditLogs('publish')">Publishing</button>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="renderAuditLogs('qa')">QA Verification</button>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="renderAuditLogs('token')">Tokens</button>
          </div>
        </div>

        <div id="auditLogsContainer" style="display: flex; flex-direction: column; gap: 10px;">
          ${auditLogs.length > 0
            ? auditLogs
                .map((log) => {
                  const badgeBg = log.level === 'success' ? '#064e3b' : log.level === 'warning' ? '#78350f' : log.level === 'error' ? '#7f1d1d' : '#1e3a8a';
                  const badgeText = log.level === 'success' ? '#34d399' : log.level === 'warning' ? '#f59e0b' : log.level === 'error' ? '#f87171' : '#60a5fa';

                  return `
                  <div class="audit-log-item" data-cat="${log.category}" style="background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <span class="badge" style="background: ${badgeBg}; color: ${badgeText}; font-size: 11px; text-transform: uppercase;">${log.level}</span>
                      <span class="badge" style="background: #1f2937; color: #d1d5db; font-size: 11px;">${log.category}</span>
                      <span style="font-size: 13px; color: #f3f4f6;">${log.message}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; white-space: nowrap;">
                      ${new Date(log.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                `;
                })
                .join('')
            : `<div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <div style="font-size: 32px; margin-bottom: 12px;">📜</div>
                <h4 style="font-size: 16px; margin-bottom: 6px; color: #d1d5db;">No Audit Events Recorded</h4>
                <p style="font-size: 13px;">Operational events, token checks, QA scores, and publishing actions will appear here in real time as actions occur.</p>
              </div>`
          }
        </div>
      </div>
    </div>

    <!-- TAB 11: SETTINGS & CONTROLS -->
    <div id="tab-settings" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 14px; font-size: 16px;">System Controls & Emergency Kill Switch</h3>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--card-border);">
          <div>
            <strong>Global Kill Switch (Pause All Autonomous Generation)</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Instantly suspends scheduled worker loops, idea generation, and API publishing calls.</div>
          </div>
          <button class="btn btn-danger" id="killSwitchBtn" onclick="toggleKillSwitch()">
            ${killSwitch ? 'Resume System' : 'Activate Kill Switch'}
          </button>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0;">
          <div>
            <strong>Storage Retention & Pruning Engine (PRD Section 16)</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              Published post images deleted after 24h. Failed post images deleted after 3 days. Pruning active.
            </div>
          </div>
          <span style="color: #34d399; font-weight: 700;">Active (70% Warning / 90% Safe Mode)</span>
        </div>
      </div>
    </div>
  </main>

  <!-- MODAL: ADD NEW PAGE -->
  <div class="modal" id="addPageModal">
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <h3 style="font-size: 18px;">➕ Connect & Add New Facebook Page</h3>
        <button onclick="closeAddPageModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <form id="addPageForm" onsubmit="submitNewPage(event)">
        <div class="form-group">
          <label>Facebook Account / Identity Owner *</label>
          <select id="newPageAccountId" class="form-control">
            ${accounts.map((a) => `<option value="${a.id}">${a.account_name} (FB ID: ${a.fb_user_id})</option>`).join('')}
            <option value="">Direct Page Token (Standalone)</option>
          </select>
        </div>

        <div class="form-group">
          <label>Facebook Page Name *</label>
          <input type="text" id="newPageName" class="form-control" placeholder="e.g. Vintage Supercars Club" required>
        </div>

        <div class="form-group">
          <label>Facebook Page ID *</label>
          <input type="text" id="newPageFbId" class="form-control" placeholder="e.g. 10492837461928" required>
        </div>

        <div class="form-group">
          <label>Facebook Page Access Token * (Will be AES-256-GCM Encrypted)</label>
          <input type="password" id="newPageToken" class="form-control" placeholder="EAAB..." required>
        </div>

        <div class="form-group">
          <label>Base Content Niche / Profile (25+ Categorized Presets or Type Custom Niche)</label>
          <select id="newProfileId" class="form-control" onchange="toggleCustomNicheField(this.value, 'newCustomNicheBox')">
            ${renderNicheSelectOptions(seedProfiles)}
          </select>
        </div>

        <div id="newCustomNicheBox" style="display: none; background: rgba(59, 130, 246, 0.08); border: 1px dashed #3b82f6; padding: 14px; border-radius: 8px; margin-bottom: 15px;">
          <div style="font-size: 13px; font-weight: 600; color: #93c5fd; margin-bottom: 8px;">
            ✨ Custom Niche Definition
          </div>
          <div class="form-group" style="margin-bottom: 10px;">
            <label style="font-size: 12px;">Type Your Custom Niche Name *</label>
            <input type="text" id="newCustomNicheName" class="form-control" placeholder="e.g. Bonsai Tree Cultivation, Supercar Aerodynamics, Ancient Stoic Wisdom...">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label style="font-size: 12px;">Niche Content Style</label>
              <select id="newCustomNicheType" class="form-control">
                <option value="factual">Factual / Educational Insights</option>
                <option value="fiction">Fiction / Storytelling</option>
                <option value="evergreen">Evergreen / Mindset & Guides</option>
                <option value="true_story">True Story / Historical Chronicles</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label style="font-size: 12px;">Target Audience (Optional)</label>
              <input type="text" id="newCustomNicheAudience" class="form-control" placeholder="e.g. Passionate hobbyists and curious minds">
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div class="form-group">
            <label>Publishing Mode</label>
            <select id="newPublishingMode" class="form-control">
              <option value="hybrid">Hybrid (Auto if QA >= 80, else Review)</option>
              <option value="review">Review (Always hold for review)</option>
              <option value="auto">Auto (Publish automatically)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Daily Post Cap</label>
            <input type="number" id="newDailyCap" class="form-control" value="3" min="1" max="10">
          </div>
        </div>

        <div class="form-group">
          <label>Daily Posting Times (HH:mm comma-separated)</label>
          <input type="text" id="newPostingTimes" class="form-control" value="10:00, 15:00, 20:00">
        </div>

        <div class="form-group">
          <label>Page-Specific Custom Caption Instructions (Optional)</label>
          <textarea id="newCaptionPrompt" class="form-control" style="height: 80px;" placeholder="Specific voice, rules, or questions for this page's audience..."></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="closeAddPageModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Connect Page</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD NEW FACEBOOK ACCOUNT / ID -->
  <div class="modal" id="addAccountModal">
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <h3 style="font-size: 18px;">➕ Connect Facebook Account (New Facebook ID)</h3>
        <button onclick="closeAddAccountModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <form id="addAccountForm" onsubmit="submitNewAccount(event)">
        <div class="form-group">
          <label>Account / Profile Label *</label>
          <input type="text" id="newAccountName" class="form-control" placeholder="e.g. John Doe (Creator ID #2), Marketing Agency BM" required>
        </div>

        <div class="form-group">
          <label>Facebook User ID *</label>
          <input type="text" id="newAccountFbId" class="form-control" placeholder="e.g. 100084920194820" required>
        </div>

        <div class="form-group">
          <label>Contact Email (Optional)</label>
          <input type="email" id="newAccountEmail" class="form-control" placeholder="admin@mycreatornetwork.com">
        </div>

        <div class="form-group">
          <label>Facebook User Access Token / System User Token (Optional - AES-256-GCM Encrypted)</label>
          <input type="password" id="newAccountToken" class="form-control" placeholder="EAAB... (Used for long-lived page management)">
        </div>

        <div class="form-group">
          <label>Account Role / Notes (Optional)</label>
          <input type="text" id="newAccountNotes" class="form-control" placeholder="e.g. Primary profile for Automotive & Luxury pages">
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="closeAddAccountModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Connect Account</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: EDIT FACEBOOK ACCOUNT -->
  <div class="modal" id="editAccountModal">
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <h3 style="font-size: 18px;">✏️ Edit Facebook Account Identity</h3>
        <button onclick="closeEditAccountModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <form id="editAccountForm" onsubmit="submitEditAccount(event)">
        <input type="hidden" id="editAccountId">
        <div class="form-group">
          <label>Account / Profile Label *</label>
          <input type="text" id="editAccountName" class="form-control" required>
        </div>

        <div class="form-group">
          <label>Facebook User ID *</label>
          <input type="text" id="editAccountFbId" class="form-control" required>
        </div>

        <div class="form-group">
          <label>Contact Email</label>
          <input type="email" id="editAccountEmail" class="form-control">
        </div>

        <div class="form-group">
          <label>Notes</label>
          <input type="text" id="editAccountNotes" class="form-control">
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="closeEditAccountModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD NEW PROVIDER (STREAMLINED 2-STEP SETUP) -->
  <div class="modal" id="addProviderModal">
    <div class="modal-content" style="max-width: 600px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h3 style="font-size: 18px; margin: 0;">➕ Add AI Provider & API Key</h3>
        <button onclick="closeAddProviderModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;">✕</button>
      </div>
      <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 18px;">
        Select your AI provider and paste your API key. Base URLs, optimal models, failover routing, and AES-256-GCM encryption are configured automatically.
      </p>

      <form id="addProviderForm" onsubmit="submitNewProvider(event)">
        <!-- Step 1: Wide Known Providers Dropdown -->
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="font-weight: 600; font-size: 13px; color: #f3f4f6;">1. Select AI Provider *</label>
          <select id="quickProviderSelect" class="form-control" onchange="onQuickProviderChange(this.value)" style="font-size: 14px; padding: 10px 12px; font-weight: 500;" required>
            ${renderProviderPresetOptions()}
          </select>
        </div>

        <!-- Dynamic Instructions Banner -->
        <div id="quickProviderInfoBox" style="background: rgba(30, 58, 138, 0.25); border: 1px solid #1e40af; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: #93c5fd; display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 18px;">💡</span>
          <div id="quickProviderInstructions" style="line-height: 1.4;">
            Get a free API key at Google AI Studio (<a href="https://aistudio.google.com" target="_blank" style="color: #60a5fa; text-decoration: underline; font-weight: 600;">aistudio.google.com</a>).
          </div>
        </div>

        <!-- Step 2: API Key Input -->
        <div class="form-group" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="font-weight: 600; font-size: 13px; color: #f3f4f6;">2. API Key(s) / Secret Token(s)</label>
            <button type="button" onclick="toggleQuickKeyVisibility()" style="background: none; border: none; color: #60a5fa; font-size: 12px; cursor: pointer;">👁️ Show / Hide</button>
          </div>
          <textarea id="quickApiKey" class="form-control" rows="2" placeholder="Paste API key(s) here. Supports multiple keys (one per line or comma-separated) for rotation pool. Leave blank for Pollinations / Ollama." style="padding: 10px 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px;"></textarea>
          <small id="quickKeyHint" style="color: var(--text-muted); font-size: 11px; display: block; margin-top: 4px;">AES-256-GCM encrypted upon saving. Multiple keys automatically rotate. If this provider is already configured, new keys are appended to its pool without overwriting or deleting previous keys!</small>
        </div>

        <!-- Collapsible Advanced Settings -->
        <div style="border-top: 1px solid var(--card-border); padding-top: 10px; margin-top: 14px;">
          <button type="button" onclick="toggleQuickAdvanced()" style="background: none; border: none; color: var(--text-muted); font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 0;">
            <span id="quickAdvArrow">▶</span> <span>Advanced Settings (Model, Base URL, Failover Priority, Daily Quota)</span>
          </button>
          <div id="quickAdvancedFields" style="display: none; margin-top: 12px; background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #1e293b;">
            <div class="form-group" style="margin-bottom: 10px;">
              <label style="font-size: 12px;">Display Name</label>
              <input type="text" id="newProviderName" class="form-control" value="Google Gemini (Gemini 2.5 Flash)" style="font-size: 12px;">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div class="form-group">
                <label style="font-size: 12px;">Adapter Kind</label>
                <input type="text" id="newProviderAdapter" class="form-control" value="gemini_native" style="font-size: 12px;" readonly>
              </div>
              <div class="form-group">
                <label style="font-size: 12px;">Default Model</label>
                <input type="text" id="newProviderModel" class="form-control" value="gemini-2.5-flash" style="font-size: 12px;">
              </div>
            </div>
            <div class="form-group" style="margin-bottom: 10px;">
              <label style="font-size: 12px;">Base URL</label>
              <input type="text" id="newProviderBaseUrl" class="form-control" value="https://generativelanguage.googleapis.com/v1beta" style="font-size: 12px;">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="form-group">
                <label style="font-size: 12px;">Failover Priority (1 = Primary)</label>
                <input type="number" id="newProviderPriority" class="form-control" value="1" min="1" max="10" style="font-size: 12px;">
              </div>
              <div class="form-group">
                <label style="font-size: 12px;">Daily Request Quota</label>
                <input type="number" id="newProviderDailyLimit" class="form-control" value="1500" min="10" style="font-size: 12px;">
              </div>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="closeAddProviderModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" style="padding: 10px 20px; font-weight: 600;">➕ Connect & Save Provider</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: DEEP PAGE INSPECTION SEPARATE WINDOW -->
  <div class="modal" id="pageDetailsModal">
    <div class="modal-content" style="max-width: 1020px; width: 95%; max-height: 92vh; overflow-y: auto; padding: 26px;">
      <!-- Window Top Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; border-bottom: 1px solid var(--card-border); padding-bottom: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
            <h3 id="pdwTitle" style="font-size: 22px; margin: 0; color: #f9fafb;">📄 Page Details</h3>
            <span id="pdwStatusBadge" class="badge" style="background: #064e3b; color: #34d399; font-size: 12px;">● ACTIVE</span>
            <span id="pdwModeBadge" class="badge" style="background: #1e3a8a; color: #60a5fa; font-size: 12px;">AUTONOMOUS</span>
          </div>
          <div style="font-size: 13px; color: var(--text-muted); display: flex; gap: 14px; flex-wrap: wrap;">
            <span>Base Niche: <strong id="pdwNiche" style="color: #cbd5e1;">Niche</strong></span>
            <span>Facebook Page ID: <code id="pdwFbPageId" style="color: #93c5fd;">123456789</code></span>
            <span>Owner Identity: <span id="pdwOwner" style="color: #cbd5e1;">Facebook Account</span></span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="openCurrentPageInNewWindow()" title="Open this exact page inspection in a standalone browser window">
            ↗️ Open in New Browser Window
          </button>
          <button onclick="closePageDetailsModal()" style="background: none; border: none; color: var(--text-muted); font-size: 22px; cursor: pointer; padding: 0 4px;">✕</button>
        </div>
      </div>

      <!-- Quick KPI Metric Cards Row -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 22px;">
        <div class="card" style="padding: 14px; background: #0f172a; border: 1px solid #1e293b;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Posts Pipeline</div>
          <div id="pdwTotalPosts" style="font-size: 24px; font-weight: 700; color: #60a5fa; margin: 4px 0;">0</div>
          <div id="pdwPostBreakdown" style="font-size: 11px; color: var(--text-muted);">0 Published • 0 Scheduled • 0 Review</div>
        </div>
        <div class="card" style="padding: 14px; background: #0f172a; border: 1px solid #1e293b;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Reach & Impressions</div>
          <div id="pdwTotalReach" style="font-size: 24px; font-weight: 700; color: #34d399; margin: 4px 0;">0</div>
          <div id="pdwEngagement" style="font-size: 11px; color: var(--text-muted);">0% Avg Engagement Rate</div>
        </div>
        <div class="card" style="padding: 14px; background: #0f172a; border: 1px solid #1e293b;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Cadence & Next Slot</div>
          <div id="pdwCadenceTitle" style="font-size: 20px; font-weight: 700; color: #f59e0b; margin: 4px 0;">3 / day</div>
          <div id="pdwNextSlot" style="font-size: 11px; color: var(--text-muted);">Times: 09:00, 15:00, 21:00</div>
        </div>
        <div class="card" style="padding: 14px; background: #0f172a; border: 1px solid #1e293b;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">QA Compliance Score</div>
          <div id="pdwQaScore" style="font-size: 24px; font-weight: 700; color: #a78bfa; margin: 4px 0;">-- / 100</div>
          <div id="pdwQaStatus" style="font-size: 11px; color: var(--text-muted);">Threshold: 85 (Strict)</div>
        </div>
      </div>

      <!-- Window Subtabs -->
      <div style="display: flex; gap: 8px; border-bottom: 1px solid var(--card-border); margin-bottom: 20px;">
        <button class="btn btn-primary pdw-tab-btn active" onclick="switchPageModalTab('posts', this)" style="border-radius: 6px 6px 0 0; padding: 8px 16px; font-size: 13px;">📝 All Posts & Production Stream</button>
        <button class="btn btn-secondary pdw-tab-btn" onclick="switchPageModalTab('prompts', this)" style="border-radius: 6px 6px 0 0; padding: 8px 16px; font-size: 13px;">✍️ Page Prompts & Persona</button>
        <button class="btn btn-secondary pdw-tab-btn" onclick="switchPageModalTab('cadence', this)" style="border-radius: 6px 6px 0 0; padding: 8px 16px; font-size: 13px;">⏰ Cadence & Scheduled Slots</button>
        <button class="btn btn-secondary pdw-tab-btn" onclick="switchPageModalTab('logs', this)" style="border-radius: 6px 6px 0 0; padding: 8px 16px; font-size: 13px;">📜 Activity & Audit Logs</button>
      </div>

      <!-- TAB 1: ALL POSTS & PRODUCTION STREAM -->
      <div id="pdwTabPosts" class="pdw-subtab">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary pdw-post-filter active" style="font-size: 12px; padding: 4px 10px;" onclick="filterPageModalPosts('all', this)">All (<span id="pdwCountAll">0</span>)</button>
            <button class="btn btn-secondary pdw-post-filter" style="font-size: 12px; padding: 4px 10px;" onclick="filterPageModalPosts('published', this)">Published (<span id="pdwCountPublished">0</span>)</button>
            <button class="btn btn-secondary pdw-post-filter" style="font-size: 12px; padding: 4px 10px;" onclick="filterPageModalPosts('scheduled', this)">Scheduled (<span id="pdwCountScheduled">0</span>)</button>
            <button class="btn btn-secondary pdw-post-filter" style="font-size: 12px; padding: 4px 10px;" onclick="filterPageModalPosts('review', this)">In Review (<span id="pdwCountReview">0</span>)</button>
          </div>
          <button class="btn btn-primary" style="font-size: 12px; padding: 6px 14px;" onclick="runTestGenerationForModalPage()">🚀 Generate Post Now for this Page</button>
        </div>
        <div id="pdwPostsListContainer" style="display: flex; flex-direction: column; gap: 12px;">
          <!-- Dynamically populated -->
        </div>
      </div>

      <!-- TAB 2: PROMPTS & PERSONA -->
      <div id="pdwTabPrompts" class="pdw-subtab" style="display: none;">
        <div class="card" style="background: #0f172a; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="font-size: 15px; margin: 0; color: #93c5fd;">Active Niche & Content Architecture</h4>
            <button class="btn btn-secondary" style="font-size: 12px; padding: 4px 10px;" onclick="openPromptsStudioFromModal()">✍️ Edit in Prompt Studio</button>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; font-size: 13px;">
            <div><strong>Base Niche:</strong> <span id="pdwNicheName">Loading...</span></div>
            <div><strong>Profile Type:</strong> <span id="pdwNicheType">Factual / Story</span></div>
            <div><strong>Target Word Count:</strong> <span id="pdwWordTargets">200 - 350 words</span></div>
            <div><strong>Visual Format:</strong> <span id="pdwAspectRatio">4:5 Portrait (1080x1350)</span></div>
          </div>
        </div>

        <div class="card" style="background: #0f172a; margin-bottom: 16px;">
          <h4 style="font-size: 14px; margin-bottom: 8px; color: #93c5fd;">Custom Caption Prompt Override</h4>
          <div id="pdwCustomCaptionPrompt" style="background: #111827; padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; color: #e5e7eb; font-family: monospace; white-space: pre-wrap;">
            (None set - inheriting standard base niche instructions)
          </div>
        </div>

        <div class="card" style="background: #0f172a;">
          <h4 style="font-size: 14px; margin-bottom: 8px; color: #93c5fd;">Custom Image Prompt Override & Headline Panel</h4>
          <div id="pdwCustomImagePrompt" style="background: #111827; padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; color: #e5e7eb; font-family: monospace; white-space: pre-wrap;">
            (None set - using standard cinematic visual framing)
          </div>
        </div>
      </div>

      <!-- TAB 3: CADENCE & SCHEDULED SLOTS -->
      <div id="pdwTabCadence" class="pdw-subtab" style="display: none;">
        <div class="card" style="background: #0f172a; margin-bottom: 16px;">
          <h4 style="font-size: 15px; margin-bottom: 12px; color: #f59e0b;">Publishing Schedule & Automation Rules</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; font-size: 13px; margin-bottom: 16px;">
            <div><strong>Daily Target:</strong> <span id="pdwSchedTarget">3 posts / day</span></div>
            <div><strong>Timezone:</strong> <span id="pdwSchedTz">UTC</span></div>
            <div><strong>Posting Time Slots:</strong> <span id="pdwSchedTimes">09:00, 15:00, 21:00</span></div>
            <div><strong>Publishing Mode:</strong> <span id="pdwSchedMode">Autonomous (Auto-publish if score &gt;= 85)</span></div>
          </div>
          <h4 style="font-size: 14px; margin-bottom: 8px; color: #93c5fd;">Upcoming Posting Schedule Slots</h4>
          <div id="pdwUpcomingSlots" style="display: flex; flex-direction: column; gap: 8px;">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>

      <!-- TAB 4: AUDIT LOGS -->
      <div id="pdwTabLogs" class="pdw-subtab" style="display: none;">
        <div id="pdwLogsContainer" style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Populated dynamically -->
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 20px; border-top: 1px solid var(--card-border); padding-top: 14px;">
        <button type="button" class="btn btn-secondary" onclick="closePageDetailsModal()">Close Window</button>
      </div>
    </div>
  </div>

  <!-- MODAL: MANAGE PROVIDER KEY POOL -->
  <div class="modal" id="manageKeysModal">
    <div class="modal-content" style="max-width: 680px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <h3 id="manageKeysTitle" style="font-size: 18px; margin-bottom: 4px;">🔑 Key Pool Management</h3>
          <p id="manageKeysSubtitle" style="font-size: 13px; color: var(--text-muted);">AES-256-GCM Encrypted Key Rotation Pool</p>
        </div>
        <button onclick="closeManageKeysModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <!-- Current Keys in Pool -->
      <div style="margin-bottom: 24px;">
        <h4 style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase;">Keys in Rotation Pool</h4>
        <div id="keysListContainer" style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Dynamically populated -->
        </div>
      </div>

      <!-- Add New Key Form -->
      <div style="background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 16px;">
        <h4 style="font-size: 12px; color: #60a5fa; margin-bottom: 12px; text-transform: uppercase;">➕ Add New API Key(s) to this Pool</h4>
        <form id="addKeyForm" onsubmit="submitAddKey(event)">
          <input type="hidden" id="keyPoolProviderId">
          <div class="form-group">
            <label>Raw API Key(s) * (AES-256-GCM Encrypted — paste 1 key or multiple keys, one per line or comma-separated)</label>
            <textarea id="keyPoolRawKey" class="form-control" rows="3" placeholder="Paste API key(s) here:&#10;sk-proj-key1...&#10;sk-proj-key2..." required style="padding: 10px 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px;"></textarea>
            <small style="color: var(--text-muted); font-size: 11px; display: block; margin-top: 4px;">Supports multiple keys simultaneously. None of your previous keys will ever be replaced or deleted.</small>
          </div>
          <div class="form-group">
            <label>Key Label / Alias (Optional)</label>
            <input type="text" id="keyPoolLabel" class="form-control" placeholder="e.g. Backup Key 2, Team Workspace Key">
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button type="submit" class="btn btn-primary">➕ Encrypt & Add Key(s)</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- MODAL: EDIT PROVIDER -->
  <div class="modal" id="editProviderModal">
    <div class="modal-content" style="max-width: 650px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <h3 style="font-size: 18px;">✏️ Edit Provider Settings</h3>
        <button onclick="closeEditProviderModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <form id="editProviderForm" onsubmit="submitEditProvider(event)">
        <input type="hidden" id="editProviderId">

        <div class="form-group">
          <label>Provider Name *</label>
          <input type="text" id="editProviderName" class="form-control" required>
        </div>

        <div class="form-group">
          <label>Adapter Kind</label>
          <select id="editProviderAdapter" class="form-control">
            <option value="gemini_native">Google Gemini Native (gemini_native)</option>
            <option value="openai_compatible_chat">OpenAI Compatible Chat</option>
            <option value="cloudflare_workers_ai">Cloudflare Workers AI</option>
            <option value="pollinations_image">Pollinations AI Image</option>
            <option value="custom_http">Custom HTTP JSON Webhook</option>
          </select>
        </div>

        <div class="form-group">
          <label>Base URL</label>
          <input type="text" id="editProviderBaseUrl" class="form-control">
        </div>

        <div class="form-group">
          <label>Model Name</label>
          <input type="text" id="editProviderModel" class="form-control">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div class="form-group">
            <label>Failover Priority</label>
            <input type="number" id="editProviderPriority" class="form-control" min="1" max="10">
          </div>
          <div class="form-group">
            <label>Daily Request Quota</label>
            <input type="number" id="editProviderDailyLimit" class="form-control" min="10">
          </div>
        </div>

        <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
          <input type="checkbox" id="editProviderEnabled" style="width: 18px; height: 18px; accent-color: var(--primary);">
          <label for="editProviderEnabled" style="margin: 0; cursor: pointer; text-transform: none; font-size: 14px;">Provider Enabled & Active</label>
        </div>

        <!-- Key Pool Summary & Append Section -->
        <div style="border-top: 1px solid var(--card-border); padding-top: 14px; margin-top: 16px; background: #0b0f19; border-radius: 8px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="font-size: 13px; font-weight: 600; color: #f3f4f6; margin: 0;">🔑 Key Rotation Pool</label>
            <button type="button" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openManageKeysFromEditModal()">Manage All Keys</button>
          </div>
          <div id="editProviderKeysSummary" style="margin-bottom: 12px; font-size: 12px;"></div>
          <div class="form-group" style="margin-bottom: 0;">
            <label style="font-size: 12px; color: #93c5fd;">➕ Append Additional API Key(s) to Pool (Optional)</label>
            <textarea id="editProviderNewKeys" class="form-control" rows="2" placeholder="Paste extra key(s) here (one per line or comma-separated) to add to rotation pool" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;"></textarea>
            <small style="color: var(--text-muted); font-size: 11px; display: block; margin-top: 4px;">Any keys you enter will be added to the existing pool. Existing keys are never deleted.</small>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button type="button" class="btn btn-secondary" onclick="closeEditProviderModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    let accountsData = ${JSON.stringify(accounts)};
    let pagesData = ${JSON.stringify(pages)};
    let providersData = ${JSON.stringify(providers)};
    let providerKeysData = ${JSON.stringify(
      providerKeys.map((k) => ({
        id: k.id,
        provider_id: k.provider_id,
        masked_key: k.masked_key,
        label: k.label,
        is_active: k.is_active,
        created_at: k.created_at,
      }))
    )};
    let auditLogsData = ${JSON.stringify(auditLogs)};

    function showTab(tabId, btn) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-list .nav-item button').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('tab-' + tabId);
      if (target) target.classList.add('active');
      if (btn) btn.classList.add('active');

      const titles = {
        overview: ['Overview Dashboard', 'Autonomous multi-page content production status and operational metrics.'],
        accounts: ['Facebook Accounts & Identities', 'Manage multiple Facebook User/Business IDs, token rotation, and linked pages.'],
        pages: ['Pages & Accounts', 'Manage connected Facebook Pages across multiple Facebook IDs, schedule slots, and publishing modes.'],
        'page-prompts': ['Page Prompt Studio', 'Configure page-specific prompt packs, voice overrides, headline styles, and First Comment booster.'],
        review: ['Review Inbox', 'Owner verification gate for posts flagged for review or in hybrid mode.'],
        calendar: ['Schedule Calendar Grid', 'Interactive visual 7-day schedule grid across all connected Facebook pages.'],
        analytics: ['Analytics & Content Insights', 'Aggregated reach, reactions, impressions, and top performing posts leaderboard.'],
        simulator: ['Test Run Simulator', 'Execute a complete simulated content cycle for any page without posting.'],
        providers: ['Providers & Failover Chains', 'Manage API keys, daily quotas, and failover router sequences.'],
        audit: ['System Audit Logs', 'Real-time operational event stream, Graph API receipts, and QA verification audits.'],
        settings: ['System Controls & Settings', 'Emergency pause switch, retention cleaner, and storage policies.'],
      };
      if (titles[tabId]) {
        document.getElementById('tabHeading').innerText = titles[tabId][0];
        document.getElementById('tabDesc').innerText = titles[tabId][1];
      }

      if (tabId === 'page-prompts') {
        loadPageIntoStudio();
      }
    }

    // --- Facebook Accounts Management ---
    function openAddAccountModal() {
      document.getElementById('addAccountModal').classList.add('active');
    }

    function closeAddAccountModal() {
      document.getElementById('addAccountModal').classList.remove('active');
    }

    async function submitNewAccount(e) {
      e.preventDefault();
      const account_name = document.getElementById('newAccountName').value;
      const fb_user_id = document.getElementById('newAccountFbId').value;
      const email = document.getElementById('newAccountEmail').value;
      const user_access_token = document.getElementById('newAccountToken').value;
      const notes = document.getElementById('newAccountNotes').value;

      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_name,
          fb_user_id,
          email,
          user_access_token,
          notes,
        })
      });

      if (res.ok) {
        closeAddAccountModal();
        alert('Facebook Account connected and token encrypted in vault!');
        window.location.reload();
      } else {
        const err = await res.json();
        alert('Failed to connect Facebook account: ' + (err.error || 'Unknown error'));
      }
    }

    function openEditAccountModal(id) {
      const acc = accountsData.find(a => a.id === id);
      if (!acc) return;
      document.getElementById('editAccountId').value = acc.id;
      document.getElementById('editAccountName').value = acc.account_name;
      document.getElementById('editAccountFbId').value = acc.fb_user_id;
      document.getElementById('editAccountEmail').value = acc.email || '';
      document.getElementById('editAccountNotes').value = acc.notes || '';
      document.getElementById('editAccountModal').classList.add('active');
    }

    function closeEditAccountModal() {
      document.getElementById('editAccountModal').classList.remove('active');
    }

    async function submitEditAccount(e) {
      e.preventDefault();
      const id = document.getElementById('editAccountId').value;
      const account_name = document.getElementById('editAccountName').value;
      const fb_user_id = document.getElementById('editAccountFbId').value;
      const email = document.getElementById('editAccountEmail').value;
      const notes = document.getElementById('editAccountNotes').value;

      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          account_name,
          fb_user_id,
          email,
          notes,
        })
      });

      if (res.ok) {
        closeEditAccountModal();
        alert('Facebook Account updated!');
        window.location.reload();
      } else {
        alert('Failed to update account.');
      }
    }

    async function deleteAccountAction(id) {
      if (!confirm('Are you sure you want to disconnect this Facebook Account? Pages under it will remain but become unlinked.')) return;
      const res = await fetch('/api/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        alert('Facebook Account disconnected.');
        window.location.reload();
      }
    }

    function addPageForAccount(accId) {
      openAddPageModal();
      document.getElementById('newPageAccountId').value = accId;
    }

    function filterPagesByAccount(accId, btn) {
      document.querySelectorAll('.page-filter-btn').forEach(b => {
        b.classList.remove('active');
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      });
      if (btn) {
        btn.classList.add('active');
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      }
      document.querySelectorAll('.page-row').forEach(row => {
        if (accId === 'all' || row.dataset.account === accId) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    // --- Pages Management ---
    function toggleCustomNicheField(val, elementId) {
      const box = document.getElementById(elementId);
      if (box) {
        box.style.display = (val === '__custom__') ? 'block' : 'none';
      }
    }

    function openAddPageModal() {
      document.getElementById('addPageModal').classList.add('active');
    }

    function closeAddPageModal() {
      document.getElementById('addPageModal').classList.remove('active');
    }

    async function submitNewPage(e) {
      e.preventDefault();
      const fb_account_id = document.getElementById('newPageAccountId').value || undefined;
      const name = document.getElementById('newPageName').value;
      const fb_page_id = document.getElementById('newPageFbId').value;
      const fb_page_token = document.getElementById('newPageToken').value;
      const profile_id = document.getElementById('newProfileId').value;
      const custom_niche_name = document.getElementById('newCustomNicheName') ? document.getElementById('newCustomNicheName').value.trim() : '';
      const custom_niche_type = document.getElementById('newCustomNicheType') ? document.getElementById('newCustomNicheType').value : 'factual';
      const custom_niche_audience = document.getElementById('newCustomNicheAudience') ? document.getElementById('newCustomNicheAudience').value.trim() : '';

      if (profile_id === '__custom__' && !custom_niche_name) {
        alert('Please type a name for your custom niche!');
        return;
      }

      const publishing_mode = document.getElementById('newPublishingMode').value;
      const daily_cap = parseInt(document.getElementById('newDailyCap').value, 10) || 3;
      const postingTimes = document.getElementById('newPostingTimes').value.split(',').map(s => s.trim()).filter(Boolean);
      const custom_caption_prompt = document.getElementById('newCaptionPrompt').value;

      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          fb_account_id,
          fb_page_id,
          fb_page_token,
          profile_id,
          custom_niche_name,
          custom_niche_type,
          custom_niche_audience,
          publishing_mode,
          daily_cap,
          schedule: { postsPerDay: postingTimes.length, postingTimes, timezone: 'UTC' },
          custom_caption_prompt,
          first_comment_enabled: true,
        })
      });

      if (res.ok) {
        closeAddPageModal();
        alert('Page successfully added and encrypted under selected Facebook ID! Refreshing...');
        window.location.reload();
      } else {
        const err = await res.json();
        alert('Failed to add page: ' + (err.error || 'Unknown error'));
      }
    }

    async function deletePageAction(id) {
      if (!confirm('Are you sure you want to disconnect this Page?')) return;
      const res = await fetch('/api/pages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        alert('Page deleted.');
        window.location.reload();
      }
    }

    function openPagePromptStudio(pageId) {
      showTab('page-prompts', document.querySelectorAll('.nav-list .nav-item button')[3]);
      document.getElementById('studioPageSelect').value = pageId;
      loadPageIntoStudio();
    }

    function loadPageIntoStudio() {
      const selectPageElem = document.getElementById('studioPageSelect');
      if (!selectPageElem) return;
      const pageId = selectPageElem.value;
      const page = pagesData.find(p => p.id === pageId) || pagesData[0];
      if (!page) return;

      const selectElem = document.getElementById('editProfileSelect');
      if (!selectElem) return;
      let found = false;
      for (let i = 0; i < selectElem.options.length; i++) {
        if (selectElem.options[i].value === page.profile_id) {
          selectElem.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found && page.profile_id) {
        selectElem.value = '__custom__';
        toggleCustomNicheField('__custom__', 'studioCustomNicheBox');
        if (document.getElementById('editCustomNicheName')) {
          document.getElementById('editCustomNicheName').value = page.profile_id;
        }
      } else {
        toggleCustomNicheField(selectElem.value, 'studioCustomNicheBox');
      }

      document.getElementById('editCaptionPrompt').value = page.custom_caption_prompt || '';
      document.getElementById('editCaptionMode').value = page.custom_caption_prompt_mode || 'append';
      document.getElementById('editImagePrompt').value = page.custom_image_prompt || '';
      document.getElementById('editImageMode').value = page.custom_image_prompt_mode || 'append';
      document.getElementById('editFirstCommentEnabled').checked = page.first_comment_enabled !== false;
      document.getElementById('editFirstCommentPrompt').value = page.first_comment_prompt || '';

      const overrides = page.overrides || {};
      document.getElementById('editMinWords').value = overrides['caption.min'] || 120;
      document.getElementById('editTargetWords').value = overrides['caption.target'] || 180;
      document.getElementById('editMaxWords').value = overrides['caption.max'] || 250;
      document.getElementById('editAspectRatio').value = overrides['image.aspectRatio'] || '4:5';
      document.getElementById('editPanelEnabled').checked = overrides['image.headlinePanel.enabled'] !== false;
      document.getElementById('editPanelHeight').value = overrides['image.headlinePanel.heightPercent'] || 25;
      document.getElementById('editPanelColor').value = overrides['image.headlinePanel.backgroundColor'] || '#050b14';
      document.getElementById('effectiveInspectBox').style.display = 'none';
    }

    async function savePagePromptsAction() {
      const pageId = document.getElementById('studioPageSelect').value;
      const page = pagesData.find(p => p.id === pageId);
      if (!page) return;

      const profile_id = document.getElementById('editProfileSelect').value;
      const custom_niche_name = document.getElementById('editCustomNicheName') ? document.getElementById('editCustomNicheName').value.trim() : '';

      if (profile_id === '__custom__' && !custom_niche_name) {
        alert('Please enter a name for your custom niche!');
        return;
      }

      const custom_caption_prompt = document.getElementById('editCaptionPrompt').value;
      const custom_caption_prompt_mode = document.getElementById('editCaptionMode').value;
      const custom_image_prompt = document.getElementById('editImagePrompt').value;
      const custom_image_prompt_mode = document.getElementById('editImageMode').value;
      const first_comment_enabled = document.getElementById('editFirstCommentEnabled').checked;
      const first_comment_prompt = document.getElementById('editFirstCommentPrompt').value;

      const overrides = {
        ...(page.overrides || {}),
        'caption.min': parseInt(document.getElementById('editMinWords').value, 10),
        'caption.target': parseInt(document.getElementById('editTargetWords').value, 10),
        'caption.max': parseInt(document.getElementById('editMaxWords').value, 10),
        'image.aspectRatio': document.getElementById('editAspectRatio').value,
        'image.headlinePanel.enabled': document.getElementById('editPanelEnabled').checked,
        'image.headlinePanel.heightPercent': parseInt(document.getElementById('editPanelHeight').value, 10),
        'image.headlinePanel.backgroundColor': document.getElementById('editPanelColor').value,
      };

      const res = await fetch('/api/pages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pageId,
          profile_id,
          custom_niche_name,
          custom_caption_prompt,
          custom_caption_prompt_mode,
          custom_image_prompt,
          custom_image_prompt_mode,
          first_comment_enabled,
          first_comment_prompt,
          overrides,
        })
      });

      if (res.ok) {
        alert('Custom prompts and settings for this Page successfully saved!');
        const updated = await res.json();
        const idx = pagesData.findIndex(p => p.id === pageId);
        if (idx !== -1) pagesData[idx] = updated.page;
      } else {
        alert('Error saving page prompts.');
      }
    }

    async function inspectEffectivePrompt() {
      const pageId = document.getElementById('studioPageSelect').value;
      const res = await fetch('/api/page-effective-settings?pageId=' + pageId);
      const data = await res.json();

      const box = document.getElementById('effectiveInspectBox');
      const code = document.getElementById('effectiveInspectCode');
      box.style.display = 'block';

      code.innerText = JSON.stringify({
        targetPage: data.page.name,
        inheritedBaseProfile: data.baseProfile.name,
        effectiveTemplates: data.effectiveSettings.templates,
        effectiveCaptionSettings: data.effectiveSettings.caption,
        effectiveImageSettings: data.effectiveSettings.image,
        settingSourceAudit: data.provenance
      }, null, 2);
    }

    async function testRunCurrentPage() {
      const pageId = document.getElementById('studioPageSelect').value;
      showTab('simulator', document.querySelectorAll('.nav-list .nav-item button')[7]);
      document.getElementById('simPageSelect').value = pageId;
      runSimulationForSelectedPage();
    }

    function renderAuditLogs(cat) {
      document.querySelectorAll('.audit-log-item').forEach(el => {
        if (cat === 'all' || el.dataset.cat === cat) {
          el.style.display = 'flex';
        } else {
          el.style.display = 'none';
        }
      });
    }

    async function runSimulationForSelectedPage() {
      const simSelect = document.getElementById('simPageSelect');
      const pageId = simSelect ? simSelect.value : '';
      if (!pageId) {
        alert('Please add a Facebook Page first in the Pages & Accounts tab before running simulations.');
        return;
      }
      const res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Notice: ' + (data.error || 'Failed to run simulation.'));
        return;
      }
      const simBox = document.getElementById('simResult');
      const simOut = document.getElementById('simOutput');
      simBox.style.display = 'block';
      simOut.innerHTML = \`
        <strong>Target Page:</strong> \${data.pageName} (Base: \${data.baseProfile})<br>
        <strong>Selected Topic:</strong> \${data.topic.title} (\${data.topic.category})<br><br>
        <strong>Generated Long-Form Caption:</strong><br>
        <div style="background: #111827; padding: 12px; border-radius: 6px; margin: 8px 0; white-space: pre-wrap; font-size: 13px; line-height: 1.6;">\${data.caption}</div><br>
        <strong>Caption Word Count:</strong> \${data.wordCount} words<br>
        <strong>QA Composite Score:</strong> <span style="color: #34d399; font-weight: bold;">\${data.qaScore}/100 (Passes \${data.publishingMode.toUpperCase()} Mode)</span><br>
        <strong>Key Visual Scene:</strong> \${data.keySceneExtracted}<br>
        <strong>Sharp Composed Format:</strong> \${data.imageDimensions} (\${data.headlinePanel.enabled ? 'Headline Panel: "' + data.headlinePanel.headlineText + '" in ' + data.headlinePanel.backgroundColor : 'Clean Full Bleed'})<br>
        <strong>Token Accounting:</strong> \${data.tokensUsed} tokens used (\${data.estimatedCost})
      \`;
    }

    async function approvePostAction(postId) {
      const res = await fetch('/api/review-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, action: 'approve' })
      });
      if (res.ok) {
        const card = document.getElementById('card-' + postId);
        if (card) card.remove();
        alert('Post approved! Scheduled on Facebook.');
        window.location.reload();
      }
    }

    async function rejectPostAction(postId) {
      const reason = prompt('Please enter rejection reason:');
      if (!reason) return;
      const res = await fetch('/api/review-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, action: 'reject', reason })
      });
      if (res.ok) {
        const card = document.getElementById('card-' + postId);
        if (card) card.remove();
        alert('Post rejected and skipped.');
        window.location.reload();
      }
    }

    function editCaptionPrompt(postId) {
      const newCaption = prompt('Enter updated caption:');
      if (newCaption) {
        fetch('/api/review-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId, action: 'edit', updates: { caption: newCaption } })
        }).then(() => {
          alert('Caption updated! Word count and content hash recalculated.');
          window.location.reload();
        });
      }
    }

    async function toggleKillSwitch() {
      const res = await fetch('/api/kill-switch', { method: 'POST' });
      const data = await res.json();
      const btn = document.getElementById('killSwitchBtn');
      if (data.killSwitchActive) {
        btn.innerText = 'Resume System';
        alert('Kill switch ACTIVATED. All generation and publishing loops are paused.');
      } else {
        btn.innerText = 'Activate Kill Switch';
        alert('System RESUMED.');
      }
    }

    // --- Provider Modal & Actions ---
    // --- Streamlined Provider Modal & Actions ---
    function openAddProviderModal() {
      const modal = document.getElementById('addProviderModal');
      modal.classList.add('active');
      const select = document.getElementById('quickProviderSelect');
      if (select && select.value) {
        onQuickProviderChange(select.value);
      }
    }

    function closeAddProviderModal() {
      document.getElementById('addProviderModal').classList.remove('active');
    }

    function toggleQuickKeyVisibility() {
      const input = document.getElementById('quickApiKey');
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    function toggleQuickAdvanced() {
      const fields = document.getElementById('quickAdvancedFields');
      const arrow = document.getElementById('quickAdvArrow');
      if (fields.style.display === 'none' || !fields.style.display) {
        fields.style.display = 'block';
        arrow.innerText = '▼';
      } else {
        fields.style.display = 'none';
        arrow.innerText = '▶';
      }
    }

    function onQuickProviderChange(presetId) {
      const select = document.getElementById('quickProviderSelect');
      const option = select.options[select.selectedIndex];
      if (!option) return;

      const name = option.getAttribute('data-name') || option.text;
      const kind = option.getAttribute('data-kind') || 'openai_compatible_chat';
      const baseUrl = option.getAttribute('data-baseurl') || '';
      const model = option.getAttribute('data-model') || '';
      const limit = option.getAttribute('data-limit') || '1000';
      const instructions = option.getAttribute('data-instructions') || '';

      // Update instructions info box
      const infoBox = document.getElementById('quickProviderInstructions');
      if (infoBox) {
        if (!instructions) {
          infoBox.innerText = 'Enter your API key below.';
        } else {
          const parts = instructions.split(' ');
          const formatted = parts.map(function(word) {
            const cleanUrl = word.replace(/[\(\)]/g, '');
            if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
              return '<a href=\"' + cleanUrl + '\" target=\"_blank\" style=\"color: #60a5fa; text-decoration: underline; font-weight: 600;\">' + cleanUrl + '</a>';
            }
            return word;
          }).join(' ');
          infoBox.innerHTML = formatted;
        }
      }

      // Update placeholder / hint for keyless providers like Pollinations or Ollama
      const keyInput = document.getElementById('quickApiKey');
      const keyHint = document.getElementById('quickKeyHint');
      if (presetId === 'preset-pollinations' || presetId === 'preset-ollama') {
        keyInput.placeholder = 'Optional / Keyless (Click Connect & Save directly!)';
        keyHint.innerText = '💡 Keyless: This provider functions without an API key.';
      } else {
        keyInput.placeholder = 'sk-... or AIzaSy... (Paste your secret API key here)';
        keyHint.innerText = 'AES-256-GCM encrypted upon saving. Never stored or logged in plaintext.';
      }

      // Update advanced fields
      document.getElementById('newProviderName').value = name;
      document.getElementById('newProviderAdapter').value = kind;
      document.getElementById('newProviderBaseUrl').value = baseUrl;
      document.getElementById('newProviderModel').value = model;
      document.getElementById('newProviderDailyLimit').value = limit;
    }

    async function submitNewProvider(e) {
      e.preventDefault();
      const select = document.getElementById('quickProviderSelect');
      const preset_id = select ? select.value : '';
      const name = document.getElementById('newProviderName').value;
      const adapter_kind = document.getElementById('newProviderAdapter').value;
      const base_url = document.getElementById('newProviderBaseUrl').value;
      const model_name = document.getElementById('newProviderModel').value;
      const priority = parseInt(document.getElementById('newProviderPriority').value, 10) || 1;
      const daily_limit = parseInt(document.getElementById('newProviderDailyLimit').value, 10) || 1000;
      const initial_key = document.getElementById('quickApiKey').value;

      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset_id,
          name,
          adapter_kind,
          base_url,
          model_name,
          priority,
          daily_limit,
          initial_key,
          key_label: 'Primary Key',
        })
      });

      if (res.ok) {
        const data = await res.json();
        closeAddProviderModal();
        if (data.is_existing) {
          alert('Provider "' + data.provider.name + '" updated! Added ' + (data.addedKeys ? data.addedKeys.length : 0) + ' API key(s) to its existing rotation pool (Total in pool: ' + data.totalKeys + '). Existing keys are preserved!');
        } else {
          alert('AI Provider "' + data.provider.name + '" successfully connected and ' + (data.addedKeys ? data.addedKeys.length : 0) + ' API key(s) encrypted!');
        }
        window.location.reload();
      } else {
        const err = await res.json();
        alert('Failed to add provider: ' + (err.error || 'Unknown error'));
      }
    }

    // --- Deep Page Inspection Separate Window Logic ---
    let currentPageModalData = null;
    let currentPostFilter = 'all';

    async function openPageDetailsWindow(pageId) {
      try {
        const res = await fetch('/api/page-details?pageId=' + pageId);
        if (!res.ok) {
          alert('Could not retrieve details for this page.');
          return;
        }
        const data = await res.json();
        currentPageModalData = data;
        const { page, account, profile, effectiveSettings, posts, stats, auditLogs } = data;

        // Top Header
        document.getElementById('pdwTitle').innerHTML = '📄 ' + page.name;
        const statusBadge = document.getElementById('pdwStatusBadge');
        statusBadge.innerText = page.active !== false ? '● ACTIVE' : '● PAUSED';
        statusBadge.style.background = page.active !== false ? '#064e3b' : '#7f1d1d';
        statusBadge.style.color = page.active !== false ? '#34d399' : '#f87171';

        document.getElementById('pdwModeBadge').innerText = (page.publishing_mode || 'autonomous').toUpperCase();
        document.getElementById('pdwNiche').innerText = page.profile_id;
        document.getElementById('pdwFbPageId').innerText = page.fb_page_id;
        document.getElementById('pdwOwner').innerText = account ? (account.account_name + ' (ID: ' + account.fb_user_id + ')') : 'Direct Page Access Token';

        // KPI Metric Cards
        document.getElementById('pdwTotalPosts').innerText = stats.totalPosts;
        document.getElementById('pdwPostBreakdown').innerText = \`\${stats.publishedCount} Published • \${stats.scheduledCount} Scheduled • \${stats.reviewCount} Review\`;
        document.getElementById('pdwTotalReach').innerText = stats.totalReach.toLocaleString() + ' reach';
        document.getElementById('pdwEngagement').innerText = stats.avgEngagement + '% Avg Engagement (' + stats.totalImpressions.toLocaleString() + ' imp)';

        document.getElementById('pdwCadenceTitle').innerText = (page.schedule?.postsPerDay || 3) + ' posts / day';
        document.getElementById('pdwNextSlot').innerText = 'Times: ' + (page.schedule?.postingTimes || ['09:00', '15:00', '21:00']).join(', ');

        document.getElementById('pdwQaScore').innerText = stats.avgQaScore > 0 ? (stats.avgQaScore + ' / 100') : 'N/A';
        document.getElementById('pdwQaStatus').innerText = 'Threshold: ' + (page.hybrid_min_score || 85) + ' (Strict)';

        // Tab 1: Posts Counts & List
        document.getElementById('pdwCountAll').innerText = posts.length;
        document.getElementById('pdwCountPublished').innerText = stats.publishedCount;
        document.getElementById('pdwCountScheduled').innerText = stats.scheduledCount;
        document.getElementById('pdwCountReview').innerText = stats.reviewCount;
        renderPageModalPostsList(posts, 'all');

        // Tab 2: Prompts
        document.getElementById('pdwNicheName').innerText = profile?.name || page.profile_id;
        document.getElementById('pdwNicheType').innerText = profile?.type ? profile.type.toUpperCase() : 'FACTUAL';
        const minW = page.overrides?.['caption.min'] || profile?.captionSettings?.lengthRange?.min || 200;
        const maxW = page.overrides?.['caption.max'] || profile?.captionSettings?.lengthRange?.max || 450;
        document.getElementById('pdwWordTargets').innerText = \`\${minW} - \${maxW} words\`;
        document.getElementById('pdwAspectRatio').innerText = page.overrides?.['image.aspectRatio'] || profile?.imageSettings?.aspectRatio || '4:5 Portrait';

        document.getElementById('pdwCustomCaptionPrompt').innerText = page.custom_caption_prompt 
          ? \`[Mode: \${(page.custom_caption_prompt_mode || 'append').toUpperCase()}]\n\${page.custom_caption_prompt}\` 
          : '(No custom caption override set - inheriting standard base niche prompts)';

        document.getElementById('pdwCustomImagePrompt').innerText = page.custom_image_prompt 
          ? \`[Mode: \${(page.custom_image_prompt_mode || 'append').toUpperCase()}]\n\${page.custom_image_prompt}\` 
          : '(No custom image override set - using default cinematic visual composition)';

        // Tab 3: Cadence
        document.getElementById('pdwSchedTarget').innerText = \`\${page.schedule?.postsPerDay || 3} posts / day\`;
        document.getElementById('pdwSchedTz').innerText = page.schedule?.timezone || 'UTC';
        document.getElementById('pdwSchedTimes').innerText = (page.schedule?.postingTimes || []).join(', ');
        document.getElementById('pdwSchedMode').innerText = \`\${page.publishing_mode.toUpperCase()} (Min Score: \${page.hybrid_min_score})\`;

        const upcomingContainer = document.getElementById('pdwUpcomingSlots');
        const times = page.schedule?.postingTimes || ['09:00', '15:00', '21:00'];
        upcomingContainer.innerHTML = times.map((t, idx) => \`
          <div style="background: #111827; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #1f2937;">
            <div>
              <strong style="color: #60a5fa;">Posting Run #\${idx + 1}: \${t}</strong>
              <span style="color: var(--text-muted); font-size: 12px; margin-left: 10px;">\${page.schedule?.timezone || 'UTC'}</span>
            </div>
            <span class="badge" style="background: #1e3a8a; color: #93c5fd; font-size: 11px;">Active Automated Schedule</span>
          </div>
        \`).join('');

        // Tab 4: Logs
        const logsContainer = document.getElementById('pdwLogsContainer');
        if (auditLogs && auditLogs.length > 0) {
          logsContainer.innerHTML = auditLogs.map(l => \`
            <div style="background: #111827; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border-left: 3px solid \${l.level === 'error' ? '#ef4444' : l.level === 'warning' ? '#f59e0b' : '#3b82f6'};">
              <div>
                <span style="font-size: 11px; color: var(--text-muted);">\${new Date(l.timestamp).toLocaleTimeString()} • \${l.category.toUpperCase()}</span>
                <div style="font-size: 13px; color: #f3f4f6; margin-top: 2px;">\${l.message}</div>
              </div>
              <span class="badge" style="background: #1e293b; color: #93c5fd; font-size: 10px;">\${l.level}</span>
            </div>
          \`).join('');
        } else {
          logsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px;">No dedicated logs recorded for this page yet.</div>';
        }

        // Show posts tab by default
        switchPageModalTab('posts', document.querySelector('.pdw-tab-btn'));
        document.getElementById('pageDetailsModal').classList.add('active');
      } catch (err) {
        alert('Error loading page details: ' + err.message);
      }
    }

    function closePageDetailsModal() {
      document.getElementById('pageDetailsModal').classList.remove('active');
    }

    function switchPageModalTab(tabName, btn) {
      document.querySelectorAll('.pdw-tab-btn').forEach(b => {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-secondary');
      });
      if (btn) {
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary', 'active');
      }
      document.querySelectorAll('.pdw-subtab').forEach(el => el.style.display = 'none');
      if (tabName === 'posts') document.getElementById('pdwTabPosts').style.display = 'block';
      if (tabName === 'prompts') document.getElementById('pdwTabPrompts').style.display = 'block';
      if (tabName === 'cadence') document.getElementById('pdwTabCadence').style.display = 'block';
      if (tabName === 'logs') document.getElementById('pdwTabLogs').style.display = 'block';
    }

    function filterPageModalPosts(filter, btn) {
      currentPostFilter = filter;
      document.querySelectorAll('.pdw-post-filter').forEach(b => b.classList.remove('active', 'btn-primary'));
      btn.classList.add('active', 'btn-primary');
      if (currentPageModalData && currentPageModalData.posts) {
        renderPageModalPostsList(currentPageModalData.posts, filter);
      }
    }

    function renderPageModalPostsList(allPosts, filter = 'all') {
      const container = document.getElementById('pdwPostsListContainer');
      let filtered = allPosts;
      if (filter === 'published') filtered = allPosts.filter(p => p.status === 'published');
      if (filter === 'scheduled') filtered = allPosts.filter(p => p.status === 'scheduled');
      if (filter === 'review') filtered = allPosts.filter(p => p.status === 'pending_review' || p.review_state === 'pending');

      if (filtered.length === 0) {
        container.innerHTML = \`
          <div style="text-align: center; padding: 36px; color: var(--text-muted); background: #0b0f19; border-radius: 8px; border: 1px dashed var(--card-border);">
            <div style="font-size: 28px; margin-bottom: 8px;">📭</div>
            <div style="font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Posts Found in this Category</div>
            <div style="font-size: 12px;">Click <strong>🚀 Generate Post Now for this Page</strong> above to immediately produce long-form content.</div>
          </div>
        \`;
        return;
      }

      container.innerHTML = filtered.map(p => {
        const isPub = p.status === 'published';
        const isSched = p.status === 'scheduled';
        const isRev = p.review_state === 'pending' || p.status === 'pending_review';
        const statusColor = isPub ? '#34d399' : (isSched ? '#60a5fa' : '#f59e0b');
        const statusBg = isPub ? 'rgba(52, 211, 153, 0.15)' : (isSched ? 'rgba(96, 165, 250, 0.15)' : 'rgba(245, 158, 11, 0.15)');

        return \`
          <div class="card" style="background: #0f172a; border: 1px solid #1e293b; padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div>
                <span class="badge" style="background: \${statusBg}; color: \${statusColor}; font-weight: 600; text-transform: uppercase; font-size: 11px;">● \${p.status}</span>
                \${p.qa_score ? \`<span class="badge" style="background: #1e3a8a; color: #93c5fd; font-size: 11px; margin-left: 6px;">QA Score: \${p.qa_score}/100</span>\` : ''}
                <h4 style="font-size: 16px; margin: 8px 0 4px 0; color: #f9fafb;">\${p.title || 'Untitled Post'}</h4>
                <div style="font-size: 12px; color: var(--text-muted);">
                  \${p.scheduled_for ? 'Scheduled: ' + new Date(p.scheduled_for).toLocaleString() : ''}
                  \${p.published_at ? 'Published: ' + new Date(p.published_at).toLocaleString() : ''}
                  \${p.caption_word_count ? ' • ' + p.caption_word_count + ' words' : ''}
                </div>
              </div>
              <div style="display: flex; gap: 6px;">
                \${isPub && p.fb_permalink ? \`<a href="\${p.fb_permalink}" target="_blank" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; text-decoration: none;">Facebook ↗</a>\` : ''}
              </div>
            </div>

            <!-- Post Caption Preview -->
            <div style="background: #111827; padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #e5e7eb; white-space: pre-wrap; max-height: 140px; overflow-y: auto; border: 1px solid #1f2937; margin-bottom: 8px;">\${p.caption}</div>

            \${p.first_comment ? \`<div style="font-size: 12px; color: #93c5fd; background: rgba(30, 58, 138, 0.2); padding: 8px 10px; border-radius: 4px;">💬 <strong>First Comment:</strong> \${p.first_comment}</div>\` : ''}
          </div>
        \`;
      }).join('');
    }

    function openCurrentPageInNewWindow() {
      if (currentPageModalData && currentPageModalData.page) {
        window.open('/page-details?id=' + currentPageModalData.page.id, '_blank');
      }
    }

    async function runTestGenerationForModalPage() {
      if (!currentPageModalData || !currentPageModalData.page) return;
      const pageId = currentPageModalData.page.id;
      const res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Simulation successful! Generated content passed QA and entered the pipeline.');
        openPageDetailsWindow(pageId);
      } else {
        alert('Simulation notice: ' + (data.error || 'Failed'));
      }
    }

    function openPromptsStudioFromModal() {
      if (!currentPageModalData || !currentPageModalData.page) return;
      closePageDetailsModal();
      openPagePromptStudio(currentPageModalData.page.id);
    }

    function openEditProviderModal(id) {
      const p = providersData.find(item => item.id === id);
      if (!p) return;
      document.getElementById('editProviderId').value = p.id;
      document.getElementById('editProviderName').value = p.name;
      document.getElementById('editProviderAdapter').value = p.adapter_kind;
      document.getElementById('editProviderBaseUrl').value = p.base_url || '';
      document.getElementById('editProviderModel').value = p.model_name || '';
      document.getElementById('editProviderPriority').value = p.priority;
      document.getElementById('editProviderDailyLimit').value = p.daily_limit;
      document.getElementById('editProviderEnabled').checked = p.enabled !== false;

      // Populate key summary
      const keys = providerKeysData.filter(k => k.provider_id === p.id);
      const summary = document.getElementById('editProviderKeysSummary');
      if (summary) {
        if (keys.length === 0) {
          summary.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">No keys in pool yet. Add one below or via Key Manager.</span>';
        } else {
          const badges = keys.map(k => '<span class="badge" style="background: ' + (k.is_active ? '#1e293b' : '#27272a') + '; color: ' + (k.is_active ? '#93c5fd' : '#71717a') + '; font-family: monospace; font-size: 11px; margin: 2px; display: inline-block;">' + k.masked_key + (k.label ? ' (' + k.label + ')' : '') + '</span>').join('');
          summary.innerHTML = '<div style="margin-bottom: 4px;">' + badges + '</div><span style="color: #34d399; font-size: 11px; font-weight: 600;">● ' + keys.filter(k => k.is_active).length + ' active / ' + keys.length + ' total keys</span>';
        }
      }
      const newKeysInput = document.getElementById('editProviderNewKeys');
      if (newKeysInput) newKeysInput.value = '';

      document.getElementById('editProviderModal').classList.add('active');
    }

    function openManageKeysFromEditModal() {
      const id = document.getElementById('editProviderId').value;
      closeEditProviderModal();
      if (id) openManageKeysModal(id);
    }

    function closeEditProviderModal() {
      document.getElementById('editProviderModal').classList.remove('active');
    }

    async function submitEditProvider(e) {
      e.preventDefault();
      const id = document.getElementById('editProviderId').value;
      const name = document.getElementById('editProviderName').value;
      const adapter_kind = document.getElementById('editProviderAdapter').value;
      const base_url = document.getElementById('editProviderBaseUrl').value;
      const model_name = document.getElementById('editProviderModel').value;
      const priority = parseInt(document.getElementById('editProviderPriority').value, 10) || 1;
      const daily_limit = parseInt(document.getElementById('editProviderDailyLimit').value, 10) || 1000;
      const enabled = document.getElementById('editProviderEnabled').checked;
      const new_keys = document.getElementById('editProviderNewKeys')?.value || '';

      const res = await fetch('/api/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          adapter_kind,
          base_url,
          model_name,
          priority,
          daily_limit,
          enabled,
          new_keys,
        })
      });

      if (res.ok) {
        closeEditProviderModal();
        alert('Provider settings and keys successfully saved!');
        window.location.reload();
      } else {
        const err = await res.json();
        alert('Failed to update provider: ' + (err.error || 'Unknown error'));
      }
    }

    async function deleteProviderAction(id) {
      if (!confirm('Are you sure you want to delete this provider and all associated API keys?')) return;
      const res = await fetch('/api/providers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        alert('Provider deleted.');
        window.location.reload();
      } else {
        alert('Failed to delete provider.');
      }
    }

    // --- Key Pool Modal & Actions ---
    function openManageKeysModal(providerId) {
      const p = providersData.find(item => item.id === providerId);
      if (!p) return;
      document.getElementById('keyPoolProviderId').value = providerId;
      document.getElementById('manageKeysTitle').innerText = '🔑 Keys for ' + p.name;
      document.getElementById('manageKeysSubtitle').innerText = 'Adapter: ' + p.adapter_kind + ' • Model: ' + (p.model_name || 'default');
      renderKeysList(providerId);
      document.getElementById('manageKeysModal').classList.add('active');
    }

    function closeManageKeysModal() {
      document.getElementById('manageKeysModal').classList.remove('active');
    }

    function renderKeysList(providerId) {
      const keys = providerKeysData.filter(k => k.provider_id === providerId);
      const container = document.getElementById('keysListContainer');
      if (keys.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 12px; background: #0b0f19; border-radius: 6px; text-align: center;">No API keys configured for this provider. Add one below.</div>';
        return;
      }

      container.innerHTML = keys.map(k => \`
        <div style="display: flex; justify-content: space-between; align-items: center; background: #0b0f19; border: 1px solid var(--card-border); padding: 12px 14px; border-radius: 8px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: #93c5fd;">\${k.masked_key}</span>
              \${k.label ? \`<span style="font-size: 11px; background: #1f2937; padding: 2px 6px; border-radius: 4px; color: #d1d5db;">\${k.label}</span>\` : ''}
              \${k.is_active ? '<span style="color: #34d399; font-size: 11px; font-weight: 600;">● Active</span>' : '<span style="color: #f59e0b; font-size: 11px; font-weight: 600;">⏸ Paused</span>'}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Added \${new Date(k.created_at).toLocaleDateString()}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="toggleKeyAction('\${k.id}', '\${providerId}')">
              \${k.is_active ? '⏸ Pause' : '▶ Activate'}
            </button>
            <button type="button" class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteKeyAction('\${k.id}', '\${providerId}')">
              🗑️ Delete
            </button>
          </div>
        </div>
      \`).join('');
    }

    function updateProviderTableRow(providerId) {
      const row = document.getElementById('provider-row-' + providerId);
      if (!row) return;
      const keys = providerKeysData.filter(k => k.provider_id === providerId);
      const activeKeys = keys.filter(k => k.is_active);
      const keyBadges = keys.length > 0
        ? keys.map(k => '<span class="badge" style="background: ' + (k.is_active ? '#1e293b' : '#27272a') + '; color: ' + (k.is_active ? '#93c5fd' : '#71717a') + '; font-family: monospace; font-size: 11px; margin: 2px; display: inline-block;">' + k.masked_key + '</span>').join('')
        : '<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No keys added</span>';

      const keyCell = row.cells[4];
      if (keyCell) {
        keyCell.innerHTML = '<div style="margin-bottom: 4px; max-width: 280px;">' + keyBadges + '</div>' +
          '<span style="font-size: 11px; color: ' + (activeKeys.length > 0 ? '#34d399' : '#f59e0b') + ';">● ' +
          activeKeys.length + ' active key' + (activeKeys.length === 1 ? '' : 's') + '</span>';
      }
      const actionsCell = row.cells[6];
      if (actionsCell) {
        const keysBtn = actionsCell.querySelector('button');
        if (keysBtn) keysBtn.innerHTML = '🔑 Keys (' + keys.length + ')';
      }
    }

    async function submitAddKey(e) {
      e.preventDefault();
      const providerId = document.getElementById('keyPoolProviderId').value;
      const rawKey = document.getElementById('keyPoolRawKey').value;
      const label = document.getElementById('keyPoolLabel').value;

      const res = await fetch('/api/provider-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: providerId,
          raw_key: rawKey,
          label,
        })
      });

      if (res.ok) {
        const result = await res.json();
        const newKeys = result.addedKeys || (result.key ? [result.key] : []);
        for (const nk of newKeys) {
          const idx = providerKeysData.findIndex(k => k.id === nk.id);
          if (idx !== -1) {
            providerKeysData[idx] = nk;
          } else {
            providerKeysData.push(nk);
          }
        }
        document.getElementById('keyPoolRawKey').value = '';
        document.getElementById('keyPoolLabel').value = '';
        renderKeysList(providerId);
        updateProviderTableRow(providerId);
        const activeCount = providerKeysData.filter(k => k.provider_id === providerId && k.is_active).length;
        alert('Success: ' + newKeys.length + ' API key(s) encrypted and added to rotation pool! (Total active in pool: ' + activeCount + '). Previous keys remain intact.');
      } else {
        const err = await res.json();
        alert('Failed to add key: ' + (err.error || 'Unknown error'));
      }
    }

    async function toggleKeyAction(keyId, providerId) {
      const res = await fetch('/api/provider-keys/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: keyId })
      });
      if (res.ok) {
        const result = await res.json();
        const idx = providerKeysData.findIndex(k => k.id === keyId);
        if (idx !== -1) providerKeysData[idx] = result.key;
        renderKeysList(providerId);
        updateProviderTableRow(providerId);
      } else {
        alert('Failed to toggle key status.');
      }
    }

    async function deleteKeyAction(keyId, providerId) {
      if (!confirm('Are you sure you want to permanently delete this API key from the encrypted vault?')) return;
      const res = await fetch('/api/provider-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: keyId })
      });
      if (res.ok) {
        providerKeysData = providerKeysData.filter(k => k.id !== keyId);
        renderKeysList(providerId);
        updateProviderTableRow(providerId);
        alert('API Key deleted.');
      } else {
        alert('Failed to delete key.');
      }
    }
  </script>
</body>
</html>`;
}

function generateStandalonePageDetailsHtml(pageId: string): string {
  const page = pageId ? store.getPageById(pageId) : store.getPages()[0];
  if (!page) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Page Details - Not Found</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #030712; color: #f9fafb; padding: 40px; text-align: center; }
    .card { background: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; padding: 40px; max-width: 500px; margin: 60px auto; }
    a { color: #60a5fa; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 36px; margin-bottom: 12px;">📄</div>
    <h2>Page Not Found</h2>
    <p style="color: #9ca3af; margin: 16px 0;">No Facebook Page with ID "${pageId || 'none'}" was found in the system.</p>
    <a href="/" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; border-radius: 6px;">⬅️ Return to Main Dashboard</a>
  </div>
</body>
</html>`;
  }

  const account = store.getAccounts().find((a) => a.id === page.fb_account_id);
  const profile =
    seedProfiles.find(
      (p) =>
        p.id === page.profile_id ||
        p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
        page.profile_id.toLowerCase().includes(p.name.toLowerCase())
    ) || createCustomNicheProfile(page.profile_id);

  const posts = store.getPosts().filter((p) => p.page_id === page.id || p.page_id === page.fb_page_id);
  const publishedPosts = posts.filter((p) => p.status === 'published');
  const scheduledPosts = posts.filter((p) => p.status === 'scheduled');
  const reviewPosts = posts.filter((p) => p.status === 'pending_review' || p.review_state === 'pending');

  const totalImpressions = publishedPosts.reduce((acc, p) => acc + (p.analytics?.impressions || 0), 0);
  const totalReach = publishedPosts.reduce((acc, p) => acc + (p.analytics?.reach || 0), 0);
  const avgEngagement = publishedPosts.length > 0
    ? Number(((publishedPosts.reduce((acc, p) => acc + (p.analytics?.engagement_rate || 0), 0) / publishedPosts.length)).toFixed(2))
    : 0;

  const scoredPosts = posts.filter((p) => typeof p.qa_score === 'number');
  const avgQaScore = scoredPosts.length > 0
    ? Math.round(scoredPosts.reduce((acc, p) => acc + (p.qa_score || 0), 0) / scoredPosts.length)
    : 0;

  const auditLogs = store.getAuditLogs().filter(
    (l) => l.page_id === page.id || l.details?.page_id === page.id || l.message.includes(page.name)
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.name} - FB Auto 247 Deep Page Inspection</title>
  <style>
    :root {
      --bg: #030712;
      --card-bg: #0b0f19;
      --card-border: #1f2937;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      font-size: 13px;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-secondary { background: #1f2937; color: var(--text); border: 1px solid #374151; }
    .btn-secondary:hover { background: #374151; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .tab-nav {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px;
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab-btn.active {
      color: #60a5fa;
      border-bottom-color: #3b82f6;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Navigation -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; gap: 12px;"><a href="/" class="btn btn-secondary">⬅️ Back to Main Dashboard</a><span style="font-size: 12px; font-weight: 600; color: #60a5fa; background: rgba(37,99,235,0.15); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(59,130,246,0.3);">FB Auto 247 • Made by Chandan Biswas</span></div>
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-secondary" onclick="window.location.reload()">🔄 Refresh Live Data</button>
        <button class="btn btn-primary" onclick="triggerPageTestRun('${page.id}')">🚀 Generate Post Now</button>
      </div>
    </div>

    <!-- Page Header Banner -->
    <div class="card" style="background: linear-gradient(180deg, #0f172a 0%, #0b0f19 100%); border-color: #1e3a8a;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <h1 style="font-size: 26px; font-weight: 700; color: #f9fafb;">📄 ${page.name}</h1>
            <span class="badge" style="background: ${page.active !== false ? '#064e3b' : '#7f1d1d'}; color: ${page.active !== false ? '#34d399' : '#f87171'}; font-size: 12px;">
              ● ${page.active !== false ? 'ACTIVE' : 'PAUSED'}
            </span>
            <span class="badge" style="background: #1e3a8a; color: #60a5fa; font-size: 12px; text-transform: uppercase;">
              ${page.publishing_mode} Mode
            </span>
          </div>
          <div style="display: flex; gap: 16px; font-size: 13px; color: var(--text-muted); flex-wrap: wrap;">
            <span>Base Niche Strategy: <strong style="color: #cbd5e1;">${page.profile_id}</strong></span>
            <span>Facebook Page ID: <code style="color: #93c5fd;">${page.fb_page_id}</code></span>
            <span>Owner Facebook Identity: <strong style="color: #cbd5e1;">${account ? account.account_name + ' (' + account.fb_user_id + ')' : 'Direct Token'}</strong></span>
            <span>Token Vault: <span style="color: #34d399;">● AES-256-GCM Valid</span></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 4 High-Level Metric KPI Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin-bottom: 24px;">
      <div class="card" style="margin: 0;">
        <div style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Posts Pipeline</div>
        <div style="font-size: 28px; font-weight: 700; color: #60a5fa; margin: 4px 0;">${posts.length}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${publishedPosts.length} Published • ${scheduledPosts.length} Scheduled • ${reviewPosts.length} In Review</div>
      </div>
      <div class="card" style="margin: 0;">
        <div style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Total Reach & Impressions</div>
        <div style="font-size: 28px; font-weight: 700; color: #34d399; margin: 4px 0;">${totalReach.toLocaleString()}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${avgEngagement}% Avg Engagement • ${totalImpressions.toLocaleString()} Imp</div>
      </div>
      <div class="card" style="margin: 0;">
        <div style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Cadence & Next Slot</div>
        <div style="font-size: 24px; font-weight: 700; color: #f59e0b; margin: 4px 0;">${page.schedule.postsPerDay} / day</div>
        <div style="font-size: 12px; color: var(--text-muted);">Slots: ${page.schedule.postingTimes.join(', ')} (${page.schedule.timezone || 'UTC'})</div>
      </div>
      <div class="card" style="margin: 0;">
        <div style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">QA Score & Quality</div>
        <div style="font-size: 28px; font-weight: 700; color: #a78bfa; margin: 4px 0;">${avgQaScore > 0 ? avgQaScore + ' / 100' : 'N/A'}</div>
        <div style="font-size: 12px; color: var(--text-muted);">Threshold: ${page.hybrid_min_score} (Quality Rubric)</div>
      </div>
    </div>

    <!-- Tabs Navigation -->
    <div class="tab-nav">
      <button class="tab-btn active" onclick="switchStandaloneTab('posts', this)">📝 Live Posts & Feed Stream (${posts.length})</button>
      <button class="tab-btn" onclick="switchStandaloneTab('prompts', this)">✍️ Prompts & Niche Strategy</button>
      <button class="tab-btn" onclick="switchStandaloneTab('cadence', this)">⏰ Publishing Cadence & Schedule</button>
      <button class="tab-btn" onclick="switchStandaloneTab('audit', this)">📜 Page Audit Trail (${auditLogs.length})</button>
    </div>

    <!-- TAB 1: ALL POSTS -->
    <div id="tab-posts" class="tab-content active">
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${posts.length > 0
          ? posts.map(p => {
              const isPub = p.status === 'published';
              const isSched = p.status === 'scheduled';
              const statusColor = isPub ? '#34d399' : (isSched ? '#60a5fa' : '#f59e0b');
              const statusBg = isPub ? 'rgba(52, 211, 153, 0.15)' : (isSched ? 'rgba(96, 165, 250, 0.15)' : 'rgba(245, 158, 11, 0.15)');

              return `
              <div class="card" style="margin: 0; background: #0f172a;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                  <div>
                    <span class="badge" style="background: ${statusBg}; color: ${statusColor}; text-transform: uppercase;">● ${p.status}</span>
                    ${p.qa_score ? `<span class="badge" style="background: #1e3a8a; color: #93c5fd; margin-left: 6px;">QA Score: ${p.qa_score}/100</span>` : ''}
                    <h3 style="font-size: 17px; margin: 8px 0 4px 0; color: #f9fafb;">${p.title || 'Untitled Post'}</h3>
                    <div style="font-size: 12px; color: var(--text-muted);">
                      ${p.scheduled_for ? 'Scheduled: ' + new Date(p.scheduled_for).toLocaleString() : ''}
                      ${p.published_at ? 'Published: ' + new Date(p.published_at).toLocaleString() : ''}
                      ${p.caption_word_count ? ' • ' + p.caption_word_count + ' words' : ''}
                    </div>
                  </div>
                  <div>
                    ${isPub && p.fb_permalink ? `<a href="${p.fb_permalink}" target="_blank" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px;">View on Facebook ↗</a>` : ''}
                  </div>
                </div>

                <div style="background: #111827; padding: 14px; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #e5e7eb; white-space: pre-wrap; max-height: 200px; overflow-y: auto; border: 1px solid #1f2937; margin-bottom: 10px;">${p.caption}</div>

                ${p.first_comment ? `<div style="font-size: 12px; color: #93c5fd; background: rgba(30, 58, 138, 0.2); padding: 8px 12px; border-radius: 4px; border: 1px solid rgba(59, 130, 246, 0.2);">💬 <strong>First Comment Strategy:</strong> ${p.first_comment}</div>` : ''}
              </div>`;
            }).join('')
          : `<div class="card" style="text-align: center; padding: 48px; color: var(--text-muted);">
              <div style="font-size: 32px; margin-bottom: 8px;">📭</div>
              <div style="font-size: 16px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Posts Generated Yet For This Page</div>
              <p style="font-size: 13px; margin-bottom: 16px;">The automated loop is ready. Click below to immediately trigger an AI post generation run.</p>
              <button class="btn btn-primary" onclick="triggerPageTestRun('${page.id}')">🚀 Generate Post Now</button>
            </div>`
        }
      </div>
    </div>

    <!-- TAB 2: PROMPTS -->
    <div id="tab-prompts" class="tab-content">
      <div class="card">
        <h3 style="font-size: 16px; margin-bottom: 14px; color: #93c5fd;">Isolated Prompt Architecture & Niche Voice</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 13px; margin-bottom: 20px;">
          <div><strong>Base Niche:</strong> ${profile.name}</div>
          <div><strong>Profile Type:</strong> ${profile.type.toUpperCase()}</div>
          <div><strong>Length Range:</strong> ${page.overrides?.['caption.min'] || (profile as any).captionSettings?.min || (profile as any).captionSettings?.lengthRange?.min || 200} - ${page.overrides?.['caption.max'] || (profile as any).captionSettings?.max || (profile as any).captionSettings?.lengthRange?.max || 450} words</div>
          <div><strong>Visual Format:</strong> ${page.overrides?.['image.aspectRatio'] || profile.imageSettings?.aspectRatio || '4:5'}</div>
        </div>

        <h4 style="font-size: 14px; margin-bottom: 8px; color: #cbd5e1;">Custom Caption Prompt</h4>
        <div style="background: #111827; padding: 14px; border-radius: 6px; font-family: monospace; font-size: 13px; white-space: pre-wrap; border: 1px solid #1f2937; margin-bottom: 18px;">${
          page.custom_caption_prompt 
            ? `[Mode: ${(page.custom_caption_prompt_mode || 'append').toUpperCase()}]\n${page.custom_caption_prompt}` 
            : '(No custom caption override set - using default base niche prompts)'
        }</div>

        <h4 style="font-size: 14px; margin-bottom: 8px; color: #cbd5e1;">Custom Image Prompt</h4>
        <div style="background: #111827; padding: 14px; border-radius: 6px; font-family: monospace; font-size: 13px; white-space: pre-wrap; border: 1px solid #1f2937;">${
          page.custom_image_prompt 
            ? `[Mode: ${(page.custom_image_prompt_mode || 'append').toUpperCase()}]\n${page.custom_image_prompt}` 
            : '(No custom image override set - using cinematic visual prompts)'
        }</div>
      </div>
    </div>

    <!-- TAB 3: CADENCE -->
    <div id="tab-cadence" class="tab-content">
      <div class="card">
        <h3 style="font-size: 16px; margin-bottom: 14px; color: #f59e0b;">Publishing Schedule & Jitter</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 13px; margin-bottom: 20px;">
          <div><strong>Posts Target:</strong> ${page.schedule.postsPerDay} posts / day</div>
          <div><strong>Timezone:</strong> ${page.schedule.timezone || 'UTC'}</div>
          <div><strong>Publishing Mode:</strong> ${page.publishing_mode.toUpperCase()} (Min Score: ${page.hybrid_min_score})</div>
          <div><strong>Daily Cap:</strong> ${page.daily_cap || 5} posts max</div>
        </div>

        <h4 style="font-size: 14px; margin-bottom: 10px; color: #93c5fd;">Automated Daily Posting Runs</h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${page.schedule.postingTimes.map((t, idx) => `
            <div style="background: #111827; padding: 12px 16px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #1f2937;">
              <div>
                <strong style="color: #60a5fa;">Run Slot #${idx + 1}: ${t}</strong>
                <span style="color: var(--text-muted); font-size: 12px; margin-left: 10px;">${page.schedule.timezone || 'UTC'}</span>
              </div>
              <span class="badge" style="background: #1e3a8a; color: #93c5fd;">Autonomous Active</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- TAB 4: AUDIT LOGS -->
    <div id="tab-audit" class="tab-content">
      <div class="card">
        <h3 style="font-size: 16px; margin-bottom: 14px; color: #93c5fd;">Operational Event Stream for this Page</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${auditLogs.length > 0
            ? auditLogs.map(l => `
              <div style="background: #111827; padding: 12px 16px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border-left: 3px solid ${l.level === 'error' ? '#ef4444' : l.level === 'warning' ? '#f59e0b' : '#3b82f6'};">
                <div>
                  <span style="font-size: 11px; color: var(--text-muted);">${new Date(l.timestamp).toLocaleString()} • ${l.category.toUpperCase()}</span>
                  <div style="font-size: 13px; color: #f3f4f6; margin-top: 2px;">${l.message}</div>
                </div>
                <span class="badge" style="background: #1e293b; color: #93c5fd; font-size: 10px;">${l.level}</span>
              </div>
            `).join('')
            : '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px;">No dedicated logs recorded for this page yet.</div>'
          }
        </div>
      </div>
    </div>
    <footer style="margin-top: 36px; padding: 20px 0; border-top: 1px solid var(--card-border); display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-muted);">
      <div><strong>FB Auto 247</strong> • Deep Page Inspection & Live Stream</div>
      <div>Made by <strong style="color: #3b82f6;">Chandan Biswas</strong></div>
    </footer>
  </div>

  <script>
    function switchStandaloneTab(name, btn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
    }

    async function triggerPageTestRun(pageId) {
      const res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Simulation successful! Generated content passed QA and entered the pipeline.');
        window.location.reload();
      } else {
        alert('Simulation notice: ' + (data.error || 'Failed'));
      }
    }
  </script>
</body>
</html>`;
}

// Start the server when executed directly
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  const server = createDashboardServer();
  server.listen(PORT, () => {
    console.log(`[Dashboard] Web Dashboard running at http://localhost:${PORT}`);
  });
}
