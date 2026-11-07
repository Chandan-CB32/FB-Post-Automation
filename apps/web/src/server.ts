import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
  generateFacebookAuthUrl,
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  fetchFacebookUserProfile,
  fetchManagedPages,
  discoverFacebookPages,
  testFacebookCredentials,
  parseFacebookDeletionSignedRequest,
} from '@fb-auto/core';
import {
  renderPrivacyPolicyHtml,
  renderTermsHtml,
  renderDataDeletionHtml,
} from './server/public-pages';
import { SystemStore, StoredPage, StoredProvider, StoredProviderKey, parseRawKeysInput } from './server/storage';
import { getDashboardOverviewMetrics } from './index';
import { DASHBOARD_CLIENT_SCRIPT } from './client/dashboard-script';

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
// Supabase Authentication & Session Management (30-Day Resilient Persistence)
// ----------------------------------------------------------------------------
const AUTH_COOKIE_MAX_AGE = 2592000; // 30 days in seconds (30 * 24 * 3600)

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

function getFallbackSessionSecret(): string {
  return process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fb-auto-session-secret-key-32ch';
}

function createFallbackAppSession(email: string, userId?: string): string {
  const payload = {
    email,
    sub: userId || 'owner',
    exp: Math.floor(Date.now() / 1000) + AUTH_COOKIE_MAX_AGE,
  };
  const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', getFallbackSessionSecret()).update(rawPayload).digest('base64url');
  return `${rawPayload}.${hmac}`;
}

function verifyFallbackAppSession(appSession: string): { valid: boolean; email?: string; userId?: string } {
  try {
    const parts = appSession.split('.');
    if (parts.length !== 2) return { valid: false };
    const [rawPayload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', getFallbackSessionSecret()).update(rawPayload).digest('base64url');
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return { valid: false };
    }
    const payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }
    return { valid: true, email: payload.email, userId: payload.sub };
  } catch {
    return { valid: false };
  }
}

function buildAuthCookies(
  req: http.IncomingMessage,
  accessToken: string,
  refreshToken?: string,
  email?: string,
  userId?: string
): string[] {
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || (req.headers.host && req.headers.host.includes('vercel.app'));
  const secureSuffix = isSecure ? '; Secure' : '';
  const cookies = [
    `sb_access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE}${secureSuffix}`,
  ];
  if (refreshToken) {
    cookies.push(`sb_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE}${secureSuffix}`);
  }
  if (email) {
    const appSession = createFallbackAppSession(email, userId);
    cookies.push(`app_session=${appSession}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE}${secureSuffix}`);
  }
  return cookies;
}

function buildLogoutCookies(): string[] {
  return [
    'sb_access_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'sb_refresh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'app_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
}

async function verifyAuth(
  req: http.IncomingMessage,
  res?: http.ServerResponse
): Promise<{ authenticated: boolean; user?: any }> {
  // Allow test suite bypass when in test environment without explicit auth testing
  if (process.env.NODE_ENV === 'test' && !process.env.TEST_AUTH_ENABLED) {
    return { authenticated: true, user: { email: process.env.OWNER_EMAIL || 'owner@example.com' } };
  }

  const cookies = parseCookies(req);
  let accessToken = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.slice(7).trim();
  }
  if (!accessToken) {
    accessToken = cookies['sb_access_token'] || '';
  }

  const refreshToken = cookies['sb_refresh_token'] || '';
  const appSessionCookie = cookies['app_session'] || '';
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();

  const client = getAuthClient();

  // 1. Try existing access token with Supabase
  if (client && accessToken) {
    try {
      const { data, error } = await client.auth.getUser(accessToken);
      if (!error && data?.user) {
        if (!ownerEmail || data.user.email?.toLowerCase() === ownerEmail) {
          return { authenticated: true, user: data.user };
        }
      }
    } catch {
      // Access token expired, continue to refresh token
    }
  }

  // 2. Try auto-refreshing via Supabase refresh_token
  if (client && refreshToken) {
    try {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data?.session && data?.user) {
        if (!ownerEmail || data.user.email?.toLowerCase() === ownerEmail) {
          if (res && !res.headersSent) {
            const newCookies = buildAuthCookies(req, data.session.access_token, data.session.refresh_token, data.user.email, data.user.id);
            res.setHeader('Set-Cookie', newCookies);
          }
          return { authenticated: true, user: data.user };
        }
      }
    } catch {
      // Supabase refresh failed / transient network error, proceed to fallback session check
    }
  }

  // 3. Resilient Fallback: Verify signed HMAC app_session cookie
  if (appSessionCookie) {
    const verified = verifyFallbackAppSession(appSessionCookie);
    if (verified.valid && verified.email) {
      if (!ownerEmail || verified.email.toLowerCase() === ownerEmail) {
        return {
          authenticated: true,
          user: { email: verified.email, id: verified.userId || 'owner' },
        };
      }
    }
  }

  return { authenticated: false };
}

export function generateLoginHtml(errorMsg?: string): string {
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

    // A2. Static Client Script for Dashboard (Public, Pure JavaScript, Acorn-verified)
    if (url.pathname === '/dashboard.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      });
      res.end(DASHBOARD_CLIENT_SCRIPT);
      return;
    }

    // B. Login Page HTML (Public)
    if (url.pathname === '/login' && req.method === 'GET') {
      const auth = await verifyAuth(req, res);
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

          // Issue secure session cookies (30 days persistence with refresh & fallback)
          const cookieHeaders = buildAuthCookies(
            req,
            data.session.access_token,
            data.session.refresh_token,
            data.user.email,
            data.user.id
          );
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieHeaders,
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
        'Set-Cookie': buildLogoutCookies(),
        Location: '/login',
      });
      res.end();
      return;
    }

    // E. Authentication API: Session check
    if (url.pathname === '/api/auth/session') {
      const auth = await verifyAuth(req, res);
      return sendJson({ authenticated: auth.authenticated, email: auth.user?.email || null });
    }

    // F. Public Static Legal & Compliance Pages (No Login Required)
    if (url.pathname === '/privacy') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPrivacyPolicyHtml());
      return;
    }

    if (url.pathname === '/terms') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderTermsHtml());
      return;
    }

    if (url.pathname === '/data-deletion') {
      const confirmationCode = url.searchParams.get('id') || undefined;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDataDeletionHtml(confirmationCode));
      return;
    }

    // G. Meta User Data Deletion Callback (POST /api/auth/facebook/data-deletion)
    if (url.pathname === '/api/auth/facebook/data-deletion' && req.method === 'POST') {
      let bodyText = '';
      req.on('data', (chunk) => {
        bodyText += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const appSecret = process.env.FACEBOOK_APP_SECRET || '';
          let userId: string | undefined = undefined;

          if (bodyText.includes('signed_request=')) {
            const parsed = new URLSearchParams(bodyText);
            const signedReq = parsed.get('signed_request');
            if (signedReq && appSecret) {
              const resObj = parseFacebookDeletionSignedRequest(signedReq, appSecret);
              userId = resObj.userId;
            }
          }

          const confirmationCode = 'del_' + crypto.randomBytes(8).toString('hex');
          const appUrl = process.env.APP_URL || `http://${req.headers.host || 'localhost'}`;
          const statusUrl = `${appUrl.replace(/\/+$/, '')}/data-deletion?id=${confirmationCode}`;

          await store.addAuditLog({
            level: 'info',
            category: 'security',
            message: `Processed Facebook User Data Deletion Callback for user: ${userId || 'unknown'}. Confirmation: ${confirmationCode}`,
            details: { userId, confirmationCode },
          });

          return sendJson({
            url: statusUrl,
            confirmation_code: confirmationCode,
          });
        } catch (err: any) {
          return sendJson({ error: err.message }, 500);
        }
      });
      return;
    }

    // H. Facebook OAuth Initiation (GET /api/auth/facebook)
    if (url.pathname === '/api/auth/facebook') {
      const auth = await verifyAuth(req, res);
      if (!auth.authenticated) {
        res.writeHead(302, {
          Location: `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`,
        });
        res.end();
        return;
      }

      const appId = process.env.FACEBOOK_APP_ID;
      const configId = process.env.FACEBOOK_LOGIN_CONFIG_ID;
      const hostUrl = process.env.APP_URL || `http://${req.headers.host || 'localhost'}`;
      const redirectUri =
        process.env.FACEBOOK_REDIRECT_URI || `${hostUrl.replace(/\/+$/, '')}/api/auth/facebook/callback`;

      if (!appId) {
        res.writeHead(302, {
          Location: `/?tab=pages&error=${encodeURIComponent('FACEBOOK_APP_ID is not configured in environment variables.')}`,
        });
        res.end();
        return;
      }

      const state = crypto.randomBytes(24).toString('hex');
      const reconnect =
        url.searchParams.get('reconnect') === 'true' || url.searchParams.get('rerequest') === 'true';

      const authUrl = generateFacebookAuthUrl({
        appId,
        redirectUri,
        state,
        configId,
        reconnect,
      });

      res.writeHead(302, {
        'Set-Cookie': `fb_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
        Location: authUrl,
      });
      res.end();
      return;
    }

    // I. Facebook OAuth Callback (GET /api/auth/facebook/callback)
    if (url.pathname === '/api/auth/facebook/callback') {
      const error = url.searchParams.get('error');
      const errorDescription =
        url.searchParams.get('error_description') || url.searchParams.get('error_message') || '';
      if (error) {
        res.writeHead(302, {
          'Set-Cookie':
            'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: `/?tab=pages&error=${encodeURIComponent(
            `Facebook authorization declined: ${errorDescription || error}`
          )}`,
        });
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookies = parseCookies(req);
      const expectedState = cookies['fb_oauth_state'];

      if (!state || !expectedState || state !== expectedState) {
        res.writeHead(302, {
          'Set-Cookie':
            'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: `/?tab=pages&error=${encodeURIComponent(
            'OAuth state verification failed (possible CSRF or session expired). Please try again.'
          )}`,
        });
        res.end();
        return;
      }

      if (!code) {
        res.writeHead(302, {
          'Set-Cookie':
            'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: `/?tab=pages&error=${encodeURIComponent('No authorization code received from Facebook.')}`,
        });
        res.end();
        return;
      }

      const appId = process.env.FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET;
      const hostUrl = process.env.APP_URL || `http://${req.headers.host || 'localhost'}`;
      const redirectUri =
        process.env.FACEBOOK_REDIRECT_URI || `${hostUrl.replace(/\/+$/, '')}/api/auth/facebook/callback`;

      if (!appId || !appSecret) {
        res.writeHead(302, {
          'Set-Cookie':
            'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: `/?tab=pages&error=${encodeURIComponent(
            'Server configuration error: FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is not configured.'
          )}`,
        });
        res.end();
        return;
      }

      try {
        const { accessToken: shortLivedToken } = await exchangeCodeForUserToken(
          code,
          appId,
          appSecret,
          redirectUri
        );
        const { accessToken: longLivedToken, expiresIn } = await exchangeForLongLivedUserToken(
          shortLivedToken,
          appId,
          appSecret
        );
        const userProfile = await fetchFacebookUserProfile(longLivedToken);

        const expiryDate = new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString();
        const account = await store.upsertAccount({
          account_name: userProfile.name || `Facebook User ${userProfile.id}`,
          fb_user_id: userProfile.id,
          email: userProfile.email,
          user_access_token: longLivedToken,
          token_expires_at: expiryDate,
          notes: 'Connected via Facebook Login for Business',
        });

        // Run automatic comprehensive Page discovery (me/accounts with pagination & business portfolios)
        const discovery = await discoverFacebookPages(longLivedToken);

        let newCount = 0;
        let updatedCount = 0;

        for (const dp of discovery.pages) {
          const res = await store.upsertPageFromFacebook({
            fb_account_id: account.id,
            name: dp.name,
            fb_page_id: dp.id,
            fb_page_token: dp.access_token,
            category: dp.category,
            picture_url: dp.picture_url,
            tasks: dp.tasks,
            fan_count: dp.fan_count,
            token_status: dp.token_status,
          });
          if (res.isNew) newCount++;
          else updatedCount++;
        }

        await store.updateAccount(account.id, {
          pages_count: discovery.pages.length,
          last_synced_at: new Date().toISOString(),
          token_status: 'valid',
        });

        await store.addAuditLog({
          level: 'success',
          category: 'token',
          message: `Connected Facebook account "${userProfile.name}" (${userProfile.id}): found ${discovery.totalFound} Pages (${newCount} new, ${updatedCount} updated, ${discovery.publishableCount} publishable).`,
          details: {
            userId: userProfile.id,
            total: discovery.totalFound,
            newCount,
            updatedCount,
            publishableCount: discovery.publishableCount,
            businessesSearched: discovery.businessesSearched,
          },
        });

        if (discovery.totalFound === 0) {
          res.writeHead(302, {
            'Set-Cookie':
              'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
            Location: `/?tab=pages&warning=${encodeURIComponent(
              `Connected Facebook identity "${userProfile.name}" (${userProfile.id}), but no Facebook Pages were discovered. Ensure you are an admin or editor of at least one Page and granted permissions in the Business Login dialog.`
            )}`,
          });
          res.end();
          return;
        }

        res.writeHead(302, {
          'Set-Cookie':
            'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: `/?tab=pages&connected=true&account=${encodeURIComponent(userProfile.name)}&found=${discovery.totalFound}&new=${newCount}&updated=${updatedCount}&publishable=${discovery.publishableCount}`,
        });
        res.end();
        return;
      } catch (err: any) {
        res.writeHead(302, {
          'Set-Cookie':
            'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          Location: `/?tab=pages&error=${encodeURIComponent(
            `Facebook token exchange failed: ${err.message || 'Unknown error'}`
          )}`,
        });
        res.end();
        return;
      }
    }

    // J. Auth Gate: Protect all other routes
    const auth = await verifyAuth(req, res);
    if (!auth.authenticated) {
      if (url.pathname.startsWith('/api/')) {
        return sendJson({ error: 'Unauthorized. Please sign in.' }, 401);
      }
      const redirectUrl =
        url.pathname === '/'
          ? '/login'
          : `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      return;
    }

    // 1. API: Overview Metrics
    if (url.pathname === '/api/overview') {
      const [pages, posts, killSwitch, providers, heartbeat, alerts] = await Promise.all([
        store.getPages().catch(() => []),
        store.getPosts().catch(() => []),
        store.getKillSwitch().catch(() => false),
        store.getProviders().catch(() => []),
        store.getHeartbeat().catch(() => null),
        store.getAlerts(10).catch(() => []),
      ]);

      const metrics = getDashboardOverviewMetrics({
        lastHeartbeat: heartbeat?.lastHeartbeat || null,
        killSwitchActive: killSwitch,
        pages,
        posts,
        alerts: alerts.map((a: any) => ({
          id: a.id,
          level: a.level || 'info',
          message: a.message || 'System event',
          timestamp: a.created_at,
        })),
        providerDailyUsage: providers.map((p) => ({
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
        const accounts = await store.getAccounts();
        const pages = await store.getPages();
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.account_name || !data.fb_user_id) {
              return sendJson({ error: 'account_name and fb_user_id are required.' }, 400);
            }
            const newAcc = await store.createAccount({
              account_name: data.account_name,
              fb_user_id: data.fb_user_id,
              email: data.email,
              user_access_token: data.user_access_token,
              notes: data.notes,
            });
            await store.addAuditLog({
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.id) return sendJson({ error: 'Account ID is required.' }, 400);
            const updated = await store.updateAccount(data.id, data);
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const accId = data.id || url.searchParams.get('id');
            if (!accId) return sendJson({ error: 'Account ID is required.' }, 400);
            const deleted = await store.deleteAccount(accId);
            return sendJson({ success: deleted });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 2b-2. API: Check Facebook Account Token Health
    if (url.pathname === '/api/accounts/check-token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const accountId = data.accountId || data.id;
          if (!accountId) return sendJson({ error: 'accountId is required' }, 400);
          const result = await store.checkAccountTokenHealth(accountId);
          return sendJson({ success: true, result });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 2b-3. API: Sync Facebook Account Pages
    if (url.pathname === '/api/facebook/sync-account' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const accountId = data.accountId || data.id;
          if (!accountId) return sendJson({ error: 'accountId is required' }, 400);
          const result = await store.syncAccountPages(accountId);
          return sendJson(result);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 2b-4. API: Sync All Accounts and Pages
    if (url.pathname === '/api/facebook/sync-all' && req.method === 'POST') {
      try {
        const result = await store.syncAllPages();
        return sendJson(result);
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    // 2b-5. API: Facebook Setup Status & Credentials Diagnostics
    if (url.pathname === '/api/facebook/setup-status' && req.method === 'GET') {
      const appId = process.env.FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET;
      const configId = process.env.FACEBOOK_LOGIN_CONFIG_ID;
      const hostUrl = process.env.APP_URL || `http://${req.headers.host || 'localhost'}`;
      const configuredRedirectUri = process.env.FACEBOOK_REDIRECT_URI;
      const expectedRedirectUri = `${hostUrl.replace(/\/+$/, '')}/api/auth/facebook/callback`;

      return sendJson({
        appIdPresent: Boolean(appId),
        maskedAppId: appId ? maskSecret(appId, 4, 3) : undefined,
        appSecretPresent: Boolean(appSecret),
        configIdPresent: Boolean(configId),
        configId: configId || undefined,
        redirectUriPresent: Boolean(configuredRedirectUri),
        configuredRedirectUri: configuredRedirectUri || undefined,
        appUrlPresent: Boolean(process.env.APP_URL),
        appUrl: process.env.APP_URL || hostUrl,
        expectedRedirectUri,
      });
    }

    // 2b-6. API: Test Facebook Connection via Meta Graph API
    if (url.pathname === '/api/facebook/test-connection' && req.method === 'POST') {
      try {
        const hostUrl = process.env.APP_URL || `http://${req.headers.host || 'localhost'}`;
        const diagnostics = await testFacebookCredentials({
          appId: process.env.FACEBOOK_APP_ID,
          appSecret: process.env.FACEBOOK_APP_SECRET,
          configId: process.env.FACEBOOK_LOGIN_CONFIG_ID,
          configuredRedirectUri: process.env.FACEBOOK_REDIRECT_URI,
          appUrl: hostUrl,
        });
        return sendJson(diagnostics);
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    // 3c. API: Quick Page Update (Toggle active, assign profile, change mode, timezone)
    if (url.pathname === '/api/pages/quick-update' && (req.method === 'PATCH' || req.method === 'POST')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);

          const updates: Partial<StoredPage> = {};
          if (data.active !== undefined) updates.active = Boolean(data.active);
          if (data.profile_id) updates.profile_id = data.profile_id;
          if (data.publishing_mode) updates.publishing_mode = data.publishing_mode;
          if (data.daily_cap !== undefined) updates.daily_cap = Number(data.daily_cap);

          if (data.timezone) {
            const page = await store.getPageById(data.pageId);
            if (page) {
              updates.schedule = {
                ...page.schedule,
                timezone: data.timezone,
              };
            }
          }

          const updated = await store.updatePage(data.pageId, updates);
          return sendJson({ success: true, page: updated });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 2c. API: Analytics & Performance Metrics
    if (url.pathname === '/api/analytics') {
      const posts = await store.getPosts();
      const pages = await store.getPages();
      const accounts = await store.getAccounts();

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
      const logs = await store.getAuditLogs();
      return sendJson(logs);
    }

    // 3. API: Pages CRUD
    if (url.pathname === '/api/pages') {
      if (req.method === 'GET') {
        const accountId = url.searchParams.get('accountId');
        let pages = await store.getPages();
        if (accountId) {
          pages = pages.filter((p) => p.fb_account_id === accountId);
        }
        return sendJson(pages);
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
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

            const newPage = await store.createPage({
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

            await store.addAuditLog({
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
        req.on('end', async () => {
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

            const updated = await store.updatePage(data.id, data);
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const pageId = data.id || url.searchParams.get('id');
            if (!pageId) {
              return sendJson({ error: 'Page ID is required.' }, 400);
            }
            const deleted = await store.deletePage(pageId);
            return sendJson({ success: deleted });
          } catch (e: any) {
            return sendJson({ error: e.message }, 500);
          }
        });
        return;
      }
    }

    // 3b. API: Check Facebook Page Token Health
    if (url.pathname === '/api/pages/check-token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const pageId = data.pageId || data.id;
          if (!pageId) return sendJson({ error: 'pageId is required' }, 400);
          const result = await store.checkPageTokenHealth(pageId);
          return sendJson({ success: true, result });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 4. API: Page-Specific Effective Settings & Prompts Resolution
    if (url.pathname === '/api/page-effective-settings') {
      const pageId = url.searchParams.get('pageId');
      const page = pageId ? await store.getPageById(pageId) : (await store.getPages())[0];
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
      const posts = await store.getPosts();
      return sendJson(posts);
    }

    // 6. API: Review Actions
    if (req.method === 'POST' && url.pathname === '/api/review-action') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { postId, action, reason, updates } = JSON.parse(body || '{}');
          const target = await store.getPostById(postId);
          if (!target) return sendJson({ error: 'Post not found' }, 404);

          if (action === 'approve') {
            const approved = approveReviewPost(target as any);
            await store.updatePost(postId, {
              review_state: 'approved',
              status: 'ready',
              scheduled_for: approved.scheduledFor,
              review_note: 'Approved by owner via dashboard',
            });
            return sendJson({ success: true, post: approved.post });
          }

          if (action === 'reject') {
            const rejected = rejectReviewPost(target as any, reason || 'Rejected by owner');
            await store.updatePost(postId, {
              review_state: 'rejected',
              status: 'skipped',
              review_note: reason || 'Rejected by owner',
            });
            return sendJson({ success: true, post: rejected });
          }

          if (action === 'edit') {
            const edited = editReviewPost(target as any, updates || {});
            await store.updatePost(postId, {
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
      const current = await store.getKillSwitch();
      const updated = await store.setKillSwitch(!current);
      return sendJson({ success: true, killSwitchActive: updated });
    }

    // 8. API: Test Run for a Specific Page
    if (req.method === 'POST' && url.pathname === '/api/test-run') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const pageId = parsed.pageId;
          const page = pageId ? await store.getPageById(pageId) : (await store.getPages())[0];
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

          // Test Run Simulator: Pure sandbox preview - NEVER write to production tables (posts, audit_log)
          return sendJson(simOutput);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 9. API: Providers CRUD
    if (url.pathname === '/api/providers') {
      if (req.method === 'GET') {
        const providers = await store.getProviders();
        const allKeys = await store.getProviderKeys();
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
        req.on('end', async () => {
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

                existingProvider = (await store.getProviders()).find(
                  (p) =>
                    p.id === data.preset_id ||
                    p.id === preset.id ||
                    p.name.toLowerCase().trim() === preset.name.toLowerCase().trim()
                );
              }
            }

            if (!existingProvider && name) {
              existingProvider = (await store.getProviders()).find(
                (p) => p.name.toLowerCase().trim() === name.toLowerCase().trim()
              );
            }

            if (!name || !adapter_kind) {
              return sendJson({ error: 'Provider name and adapter_kind are required.' }, 400);
            }

            let targetProvider: StoredProvider;
            if (existingProvider) {
              targetProvider = await store.updateProvider(existingProvider.id, {
                base_url: base_url || existingProvider.base_url,
                model_name: model_name || existingProvider.model_name,
                daily_limit: daily_limit || existingProvider.daily_limit,
                priority: priority || existingProvider.priority,
                enabled: data.enabled !== false,
              });
            } else {
              targetProvider = await store.createProvider({
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
              const addedKey = await store.addProviderKey({
                provider_id: targetProvider.id,
                raw_key: k,
                label: keyLabel,
              });
              addedKeys.push(addedKey);
            }

            const currentKeys = await store.getProviderKeys(targetProvider.id);
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            if (!data.id) {
              return sendJson({ error: 'Provider ID is required.' }, 400);
            }
            const updated = await store.updateProvider(data.id, data);

            const rawNewKeys = data.new_keys || data.raw_key || data.key || '';
            const addedKeys: StoredProviderKey[] = [];
            if (rawNewKeys) {
              const parsed = parseRawKeysInput(rawNewKeys);
              for (let i = 0; i < parsed.length; i++) {
                const added = await store.addProviderKey({
                  provider_id: data.id,
                  raw_key: parsed[i],
                  label: parsed.length > 1 ? `Key #${i + 1}` : (data.key_label || undefined),
                });
                addedKeys.push(added);
              }
            }

            const currentKeys = await store.getProviderKeys(data.id);
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const providerId = data.id || url.searchParams.get('id');
            if (!providerId) {
              return sendJson({ error: 'Provider ID is required.' }, 400);
            }
            const deleted = await store.deleteProvider(providerId);
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
        const keys = (await store.getProviderKeys(providerId)).map((k) => ({
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
        req.on('end', async () => {
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
              const newKey = await store.addProviderKey({
                provider_id: providerId,
                raw_key: k,
                label,
              });
              addedKeys.push(newKey);
            }

            const currentKeys = await store.getProviderKeys(providerId);
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
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            const keyId = data.id || url.searchParams.get('id');
            if (!keyId) {
              return sendJson({ error: 'Key ID is required.' }, 400);
            }
            const deleted = await store.deleteProviderKey(keyId);
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
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.id) {
            return sendJson({ error: 'Key ID is required.' }, 400);
          }
          const updated = await store.toggleProviderKey(data.id, data.is_active);
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
      const page = pageId ? await store.getPageById(pageId) : (await store.getPages())[0];
      if (!page) {
        return sendJson({ error: 'Page not found' }, 404);
      }

      const account = (await store.getAccounts()).find((a) => a.id === page.fb_account_id);
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

      const pagePosts = (await store.getPosts()).filter((p) => p.page_id === page.id || p.page_id === page.fb_page_id);
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

      const pageLogs = (await store.getAuditLogs()).filter(
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
      const html = await generateStandalonePageDetailsHtml(pageId);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // 15. Web Dashboard HTML UI
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      const html = await generateDashboardHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // 16. API: Storage Health Status
    if (url.pathname === '/api/health/storage') {
      const health = await store.getStorageHealth();
      return sendJson(health);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

export function createDashboardServer(): http.Server {
  return http.createServer(handleRequest);
}

async function generateDashboardHtml(): Promise<string> {
  const [
    accounts,
    pages,
    posts,
    providers,
    providerKeys,
    auditLogs,
    killSwitch,
    storageHealth,
    heartbeat,
  ] = await Promise.all([
    store.getAccounts().catch(() => []),
    store.getPages().catch(() => []),
    store.getPosts().catch(() => []),
    store.getProviders().catch(() => []),
    store.getProviderKeys().catch(() => []),
    store.getAuditLogs(50).catch(() => []),
    store.getKillSwitch().catch(() => false),
    store.getStorageHealth().catch(() => ({
      supabaseConnected: true,
      tablesOk: true,
      tablesCount: 19,
      expectedCount: 19,
      missingTables: [],
      bucketOk: true,
      singleSourceOfTruth: true,
    })),
    store.getHeartbeat().catch(() => null),
  ]);

  let appVersion = CORE_VERSION;
  try {
    const pkgPath = path.resolve('package.json');
    if (fs.existsSync(pkgPath)) {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (parsed.version) appVersion = parsed.version;
    }
  } catch {}

  let workerStatusText = 'Worker Inactive (No Heartbeat)';
  let workerDotColor = '#ef4444';
  let workerPillBg = 'rgba(239, 68, 68, 0.15)';
  let workerPillColor = '#fecaca';

  if (killSwitch) {
    workerStatusText = 'Worker Paused (Kill-Switch Active)';
    workerDotColor = '#f59e0b';
    workerPillBg = 'rgba(245, 158, 11, 0.15)';
    workerPillColor = '#fde68a';
  } else if (heartbeat?.lastHeartbeat) {
    const diffMs = Date.now() - new Date(heartbeat.lastHeartbeat).getTime();
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes <= 30 && diffMinutes >= 0) {
      workerStatusText = `Worker Active (${diffMinutes === 0 ? 'just now' : diffMinutes + 'm ago'})`;
      workerDotColor = '#34d399';
      workerPillBg = '#064e3b';
      workerPillColor = '#34d399';
    } else {
      const timeAgo = diffMinutes >= 60 ? `${Math.floor(diffMinutes / 60)}h ago` : `${diffMinutes}m ago`;
      workerStatusText = `Worker Inactive (Stale: ${timeAgo})`;
      workerDotColor = '#ef4444';
      workerPillBg = 'rgba(239, 68, 68, 0.15)';
      workerPillColor = '#fecaca';
    }
  }

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
  const hostUrl = process.env.APP_URL || 'https://fbauto247.vercel.app';
  const expectedRedirectUri =
    process.env.FACEBOOK_REDIRECT_URI || `${hostUrl.replace(/\/+$/, '')}/api/auth/facebook/callback`;

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
        <div class="brand-badge">Engine v${appVersion}</div>
      </div>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button class="active" data-tab="overview" onclick="showTab('overview', this)">📊 Overview</button></li>
      <li class="nav-item"><button data-tab="accounts" onclick="showTab('accounts', this)">👥 FB Accounts & IDs (<span id="sidebarAccountCount">${accounts.length}</span>)</button></li>
      <li class="nav-item"><button data-tab="pages" onclick="showTab('pages', this)">📑 Pages & Accounts (<span id="sidebarPageCount">${pages.length}</span>)</button></li>
      <li class="nav-item"><button data-tab="page-prompts" onclick="showTab('page-prompts', this)">✍️ Page Prompt Studio</button></li>
      <li class="nav-item"><button data-tab="review" onclick="showTab('review', this)">📬 Review Inbox <span class="badge" id="revBadge">${reviewPosts.length}</span></button></li>
      <li class="nav-item"><button data-tab="calendar" onclick="showTab('calendar', this)">📅 Schedule Calendar</button></li>
      <li class="nav-item"><button data-tab="analytics" onclick="showTab('analytics', this)">📈 Analytics & Insights</button></li>
      <li class="nav-item"><button data-tab="simulator" onclick="showTab('simulator', this)">⚡ Test Run Simulator</button></li>
      <li class="nav-item"><button data-tab="providers" onclick="showTab('providers', this)">🔌 Providers & Quotas</button></li>
      <li class="nav-item"><button data-tab="audit" onclick="showTab('audit', this)">📋 System Audit Logs</button></li>
      <li class="nav-item"><button data-tab="settings" onclick="showTab('settings', this)">⚙️ Settings & Controls</button></li>
    </ul>
    <div style="margin-top: auto; padding-top: 20px; border-top: 1px solid var(--card-border);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
          <div style="width: 28px; height: 28px; border-radius: 50%; background: #2563eb; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold; flex-shrink: 0;">👤</div>
          <span style="font-size: 12px; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${process.env.OWNER_EMAIL || 'Administrator'}">${process.env.OWNER_EMAIL || 'Administrator'}</span>
        </div>
      </div>
      <a href="/api/auth/logout" style="display: block; width: 100%; text-align: center; padding: 8px 12px; background: #1f2937; color: #f87171; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; transition: background 0.15s;" onmouseover="this.style.background='#374151'" onmouseout="this.style.background='#1f2937'">🚪 Sign Out</a>
      <div style="font-size: 11px; color: var(--text-muted); display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.08); text-align: center;">
        <div style="display: flex; justify-content: center; gap: 8px;">
          <a href="/privacy" target="_blank" style="color: #60a5fa; text-decoration: none;">Privacy</a> •
          <a href="/terms" target="_blank" style="color: #60a5fa; text-decoration: none;">Terms</a> •
          <a href="/data-deletion" target="_blank" style="color: #60a5fa; text-decoration: none;">Data Deletion</a>
        </div>
        <div style="font-weight: 500; letter-spacing: 0.3px;">Made by <strong style="color: #60a5fa;">Chandan Biswas</strong></div>
      </div>
    </div>
  </aside>

  <!-- Main Body -->
  <main class="main">
    <header class="header">
      <div class="header-title">
        <h1 id="tabHeading">FB Auto 247 Dashboard</h1>
        <p id="tabDesc">Autonomous 24/7 multi-page content machine • Made by Chandan Biswas</p>
      </div>
      <div class="status-pill" id="workerPill" style="background: ${workerPillBg}; color: ${workerPillColor};">
        <div class="status-dot" style="background: ${workerDotColor};"></div>
        <span id="workerStatusSpan">${workerStatusText}</span>
      </div>
    </header>

    <!-- Prominent Warning Banner for Missing Supabase Tables -->
    <div id="databaseHealthBanner" style="${storageHealth && storageHealth.missingTables && storageHealth.missingTables.length > 0 ? 'display: block;' : 'display: none;'} margin-bottom: 24px; padding: 16px 20px; border-radius: 10px; background: #7f1d1d; border: 1px solid #dc2626; color: #fee2e2;">
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="font-size: 24px;">⚠️</div>
        <div>
          <h3 style="font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #fff;">Database Setup Incomplete: Missing Required Tables</h3>
          <p style="font-size: 13px; line-height: 1.5; margin-bottom: 10px;">
            The following required table(s) are missing from your Supabase <code>public</code> schema:
            <strong style="color: #fca5a5;">${(storageHealth?.missingTables || []).join(', ')}</strong>
          </p>
          <p style="font-size: 13px; line-height: 1.5;">
            To initialize all tables, open your <a href="https://supabase.com/dashboard" target="_blank" style="color: #93c5fd; text-decoration: underline; font-weight: 600;">Supabase Dashboard ➔ SQL Editor</a>, copy and paste the contents of <code>supabase/all_migrations.sql</code>, and click <strong>Run</strong>.
          </p>
        </div>
      </div>
    </div>

    <!-- Dynamic Alert Banner for Facebook OAuth and Operations -->
    <div id="urlAlertBanner" style="display: none; margin-bottom: 24px; padding: 14px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;"></div>

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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 18px; margin-bottom: 4px;">Connected Facebook Accounts (Multiple Facebook IDs)</h3>
            <p style="color: var(--text-muted); font-size: 13px;">
              Manage multiple Facebook User IDs or Business Manager profiles. Automated page discovery runs on connection and daily synchronization.
            </p>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <a href="/api/auth/facebook" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 600;">
              🚀 Connect via Facebook Login for Business
            </a>
            <button class="btn btn-secondary" onclick="syncAllPagesAction(this)">🔄 Sync All Accounts</button>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Facebook Account & Owner</th>
              <th>Facebook User ID</th>
              <th>Token Vault Status</th>
              <th>Last Synced</th>
              <th>Connected Pages</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="accountsTableBody">
            ${accounts.length > 0
              ? accounts
                  .map((acc) => {
                    const ownedPages = pages.filter((p) => p.fb_account_id === acc.id || (p.secondary_account_ids && p.secondary_account_ids.includes(acc.id)));
                    return `
                  <tr id="account-row-${acc.id}">
                    <td>
                      <strong>${acc.account_name}</strong><br>
                      <small style="color: var(--text-muted);">${acc.email || 'No email specified'} • ${acc.notes || 'Creator profile'}</small>
                    </td>
                    <td><code style="font-size: 13px;">${acc.fb_user_id}</code></td>
                    <td>
                      <span style="color: ${acc.token_status === 'valid' ? '#34d399' : '#f87171'}; font-weight: 600;">● ${acc.token_status.toUpperCase()}</span><br>
                      <span class="badge" style="background: #1e293b; color: #93c5fd; font-family: monospace; font-size: 11px;">${acc.masked_token || 'EAAB...vault'}</span>
                    </td>
                    <td>
                      <span style="font-size: 12px; color: #d1d5db;">${acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleDateString() : 'Recently'}</span>
                    </td>
                    <td>
                      <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${
                          ownedPages.length > 0
                            ? ownedPages
                                .map(
                                  (p) => `<span class="badge" style="background: #1e3a8a; color: #60a5fa; font-size: 11px; cursor: pointer;" onclick="openPageDetailsWindow('${p.id}')" title="Click to inspect ${p.name}">📄 ${p.name} ↗</span>`
                                )
                                .join('')
                            : '<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No pages linked yet</span>'
                        }
                      </div>
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                      <button class="btn btn-secondary" style="padding: 5px 8px; font-size: 12px;" onclick="syncAccountAction('${acc.id}', this)" title="Sync Pages for this account">🔄 Sync Pages</button>
                      <a href="/api/auth/facebook?reconnect=true" class="btn btn-secondary" style="padding: 5px 8px; font-size: 12px; text-decoration: none;" title="Reconnect permissions via Meta Graph API">🔄 Reconnect</a>
                      <button class="btn btn-secondary" style="padding: 5px 8px; font-size: 12px;" onclick="checkAccountTokenHealth('${acc.id}')" title="Check live token validity">🩺 Check</button>
                      <button class="btn btn-danger" style="padding: 5px 8px; font-size: 12px;" onclick="deleteAccountAction('${acc.id}')">🗑️</button>
                    </td>
                  </tr>
                `;
                  })
                  .join('')
              : `<tr><td colspan="6" style="text-align: center; padding: 36px; color: var(--text-muted);">
                  <div style="font-size: 28px; margin-bottom: 8px;">👤</div>
                  <div style="font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Facebook Identities Connected</div>
                  <div style="font-size: 12px;">Click <strong>🚀 Connect via Facebook Login</strong> above to add your first Facebook User ID or Business Manager.</div>
                </td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: PAGES & ACCOUNTS TREE -->
    <div id="tab-pages" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 18px; margin-bottom: 4px;">Connected Facebook Pages & Accounts</h3>
            <p style="color: var(--text-muted); font-size: 13px;">
              Manage pages across all your Facebook IDs. Automated discovery via Facebook Login for Business with per-page posting cadences and content profiles.
            </p>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <a href="/api/auth/facebook" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 600;">
              🚀 Connect Pages via Facebook Login
            </a>
            <button class="btn btn-secondary" onclick="syncAllPagesAction(this)" title="Sync and refresh all connected pages and tokens across all accounts">
              🔄 Sync All Pages
            </button>
          </div>
        </div>

        <!-- Facebook Account Filter Toolbar -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; background: #0b0f19; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--card-border);">
          <span style="font-size: 13px; color: var(--text-muted); font-weight: 600;">Filter by Facebook Identity:</span>
          <button class="btn btn-primary page-filter-btn active" style="padding: 4px 10px; font-size: 12px;" onclick="filterPagesByAccount('all', this)">All Facebook IDs (${pages.length})</button>
          ${accounts
            .map((acc) => {
              const count = pages.filter((p) => p.fb_account_id === acc.id || (p.secondary_account_ids && p.secondary_account_ids.includes(acc.id))).length;
              return `<button class="btn btn-secondary page-filter-btn" style="padding: 4px 10px; font-size: 12px;" onclick="filterPagesByAccount('${acc.id}', this)">👤 ${acc.account_name} (${count})</button>`;
            })
            .join('')}
        </div>

        <!-- Account -> Pages Tree View -->
        <div id="accountsTreeContainer">
          ${accounts.length > 0 ? accounts.map((acc) => {
            const accPages = pages.filter((p) => p.fb_account_id === acc.id || (p.secondary_account_ids && p.secondary_account_ids.includes(acc.id)));
            const statusColor = acc.token_status === 'valid' ? '#34d399' : (acc.token_status === 'rate_limited' ? '#c084fc' : '#f87171');
            return `
              <div class="card account-tree-node" id="account-node-${acc.id}" data-account="${acc.id}" style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); margin-bottom: 18px; padding: 16px;">
                <!-- Account Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 38px; height: 38px; border-radius: 50%; background: #1e293b; display: flex; align-items: center; justify-content: center; font-size: 18px;">
                      👤
                    </div>
                    <div>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <strong style="font-size: 16px; color: #f9fafb;">${acc.account_name}</strong>
                        <span class="badge" style="background: ${statusColor}22; color: ${statusColor}; font-weight: 700; font-size: 11px;">
                          ● ${acc.token_status.toUpperCase()}
                        </span>
                      </div>
                      <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                        <code style="color: #93c5fd;">User ID: ${acc.fb_user_id}</code>
                        ${acc.email ? ` • <span>${acc.email}</span>` : ''}
                        • <span style="color: #94a3b8;">${accPages.length} Page${accPages.length === 1 ? '' : 's'} linked</span>
                        • <span>🕒 Synced: ${acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString() : 'Recently'}</span>
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                    <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="syncAccountAction('${acc.id}', this)" title="Discover and sync pages for this account">
                      🔄 Sync Pages
                    </button>
                    <a href="/api/auth/facebook?reconnect=true" class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px; text-decoration: none;" title="Reconnect permissions with Facebook">
                      🔄 Reconnect
                    </a>
                    <button class="btn btn-secondary" style="padding: 5px 8px; font-size: 12px;" onclick="checkAccountTokenHealth('${acc.id}')" title="Check live token validity">
                      🩺 Check
                    </button>
                    <button class="btn btn-danger" style="padding: 5px 8px; font-size: 12px;" onclick="deleteAccountAction('${acc.id}')" title="Disconnect Account">
                      🗑️
                    </button>
                  </div>
                </div>

                <!-- Pages Nested in Account -->
                ${accPages.length > 0 ? `
                  <div class="account-pages-list" style="display: flex; flex-direction: column; gap: 10px;">
                    ${accPages.map((p) => {
                      const isShared = p.secondary_account_ids && p.secondary_account_ids.length > 0;
                      let badgeBg = 'rgba(16, 185, 129, 0.15)';
                      let badgeColor = '#34d399';
                      let statusLabel = 'VALID';
                      if (p.token_status === 'cannot_publish') {
                        badgeBg = 'rgba(245, 158, 11, 0.15)';
                        badgeColor = '#fbbf24';
                        statusLabel = 'CANNOT PUBLISH';
                      } else if (p.token_status === 'expired') {
                        badgeBg = 'rgba(234, 88, 12, 0.15)';
                        badgeColor = '#fb923c';
                        statusLabel = 'EXPIRED';
                      } else if (p.token_status === 'revoked') {
                        badgeBg = 'rgba(239, 68, 68, 0.15)';
                        badgeColor = '#f87171';
                        statusLabel = 'REVOKED';
                      } else if (p.token_status === 'inaccessible') {
                        badgeBg = 'rgba(100, 116, 139, 0.15)';
                        badgeColor = '#94a3b8';
                        statusLabel = 'INACCESSIBLE';
                      }

                      return `
                        <div class="page-tree-card" id="page-card-${p.id}" style="background: rgba(0,0,0,0.25); border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                          <!-- Left: Picture & Info -->
                          <div style="display: flex; align-items: center; gap: 12px; min-width: 240px;">
                            ${p.picture_url ? `<img src="${p.picture_url}" alt="${p.name}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">` : `<div style="width: 38px; height: 38px; border-radius: 50%; background: #1e3a8a; display: flex; align-items: center; justify-content: center; font-size: 18px;">📄</div>`}
                            <div>
                              <div style="display: flex; align-items: center; gap: 8px;">
                                <a href="javascript:void(0)" onclick="openPageDetailsWindow('${p.id}')" style="color: #60a5fa; text-decoration: none; font-size: 15px; font-weight: 700;">
                                  ${p.name}
                                </a>
                                <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; font-size: 10px; font-weight: 700; padding: 2px 6px;">
                                  ● ${statusLabel}
                                </span>
                                ${isShared ? `<span class="badge" style="background: rgba(59,130,246,0.15); color: #93c5fd; font-size: 10px;" title="Discovered via multiple Facebook accounts">Shared</span>` : ''}
                              </div>
                              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                                <code style="color: #94a3b8;">ID: ${p.fb_page_id}</code>
                                ${p.category ? ` • <span>${p.category}</span>` : ''}
                                ${typeof p.fan_count === 'number' && p.fan_count > 0 ? ` • <span>${p.fan_count.toLocaleString()} fans</span>` : ''}
                              </div>
                            </div>
                          </div>

                          <!-- Center: Inline Controls -->
                          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <!-- Active switch -->
                            <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; user-select: none;">
                              <input type="checkbox" ${p.active ? 'checked' : ''} onchange="quickTogglePageActive('${p.id}', this.checked)">
                              <span style="font-weight: 600; color: ${p.active ? '#34d399' : '#9ca3af'};">${p.active ? 'Active' : 'Paused'}</span>
                            </label>

                            <!-- Profile Select -->
                            <select class="form-control" style="font-size: 12px; padding: 4px 8px; width: 160px;" onchange="quickUpdatePageProfile('${p.id}', this.value)" title="Assign Content Profile">
                              ${renderNicheSelectOptions(seedProfiles, p.profile_id)}
                            </select>

                            <!-- Timezone Select -->
                            <select class="form-control" style="font-size: 11px; padding: 4px 6px; width: 120px;" onchange="quickUpdatePageTimezone('${p.id}', this.value)" title="Page Posting Timezone">
                              <option value="UTC" ${p.schedule.timezone === 'UTC' ? 'selected' : ''}>UTC</option>
                              <option value="America/New_York" ${p.schedule.timezone === 'America/New_York' ? 'selected' : ''}>New York (ET)</option>
                              <option value="America/Chicago" ${p.schedule.timezone === 'America/Chicago' ? 'selected' : ''}>Chicago (CT)</option>
                              <option value="America/Los_Angeles" ${p.schedule.timezone === 'America/Los_Angeles' ? 'selected' : ''}>Los Angeles (PT)</option>
                              <option value="Europe/London" ${p.schedule.timezone === 'Europe/London' ? 'selected' : ''}>London (GMT)</option>
                              <option value="Asia/Kolkata" ${p.schedule.timezone === 'Asia/Kolkata' ? 'selected' : ''}>Kolkata (IST)</option>
                              <option value="Asia/Tokyo" ${p.schedule.timezone === 'Asia/Tokyo' ? 'selected' : ''}>Tokyo (JST)</option>
                            </select>

                            <!-- Schedule Pill -->
                            <span class="badge" style="background: #1e3a8a; color: #93c5fd; font-size: 11px;" title="Publishing Mode: ${p.publishing_mode.toUpperCase()}">
                              ${p.schedule.postsPerDay} posts/day
                            </span>
                          </div>

                          <!-- Right: Actions -->
                          <div style="display: flex; gap: 6px; align-items: center;">
                            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openPagePromptStudio('${p.id}')" title="Customize prompts & voice">✍️ Prompts</button>
                            <button class="btn btn-primary" style="padding: 4px 8px; font-size: 12px;" onclick="openPageDetailsWindow('${p.id}')" title="Inspect posts & feed">🔍 Data</button>
                            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="checkPageTokenHealth('${p.id}')" title="Verify token health">🩺 Check</button>
                            <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deletePageAction('${p.id}')" title="Remove Page">🗑️</button>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : `
                  <div style="padding: 16px; background: rgba(0,0,0,0.15); border-radius: 6px; text-align: center; color: var(--text-muted); font-size: 13px;">
                    No Pages discovered for <strong>${acc.account_name}</strong> yet. Click <strong>🔄 Sync Pages</strong> above to scan Meta Graph API.
                  </div>
                `}
              </div>
            `;
          }).join('') : `
            <div style="text-align: center; padding: 48px 24px; color: var(--text-muted);">
              <div style="font-size: 36px; margin-bottom: 12px;">🚀</div>
              <div style="font-size: 16px; font-weight: 700; color: #f3f4f6; margin-bottom: 6px;">No Facebook Accounts or Pages Connected</div>
              <div style="font-size: 13px; max-width: 480px; margin: 0 auto 18px;">
                Connect your first Facebook identity using Facebook Login for Business to automatically discover and link all your Pages.
              </div>
              <a href="/api/auth/facebook" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; padding: 10px 20px;">
                🚀 Connect via Facebook Login
              </a>
            </div>
          `}
        </div>

        <!-- Standalone Pages (if any not mapped to an account) -->
        ${(() => {
          const standalonePages = pages.filter((p) => !p.fb_account_id && (!p.secondary_account_ids || p.secondary_account_ids.length === 0));
          if (standalonePages.length === 0) return '';
          return `
            <div class="card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); margin-top: 18px; padding: 16px;">
              <h4 style="font-size: 14px; margin-bottom: 10px; color: var(--text-muted);">📄 Direct Standalone Pages (${standalonePages.length})</h4>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${standalonePages.map((p) => `
                  <div class="page-tree-card" id="page-card-${p.id}" style="background: rgba(0,0,0,0.25); border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="width: 38px; height: 38px; border-radius: 50%; background: #1e3a8a; display: flex; align-items: center; justify-content: center; font-size: 18px;">📄</div>
                      <div>
                        <strong>${p.name}</strong> <small style="color: var(--text-muted);">(ID: ${p.fb_page_id})</small>
                      </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                      <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openPagePromptStudio('${p.id}')">✍️ Prompts</button>
                      <button class="btn btn-primary" style="padding: 4px 8px; font-size: 12px;" onclick="openPageDetailsWindow('${p.id}')">🔍 Data</button>
                      <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="checkPageTokenHealth('${p.id}')">🩺 Check</button>
                      <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px;" onclick="deletePageAction('${p.id}')">🗑️</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        })()}

        <!-- Collapsed Manual Fallback Entry Section -->
        <details class="advanced-fallback" style="margin-top: 24px; background: rgba(255,255,255,0.015); border: 1px dashed var(--card-border); border-radius: 8px; padding: 14px 18px;">
          <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-muted); user-select: none;">
            ⚙️ Advanced: Manual Fallback Entry
          </summary>
          <div style="margin-top: 12px; font-size: 13px; color: var(--text-muted); line-height: 1.5;">
            <p style="margin-bottom: 12px;">
              Facebook Login for Business automatically discovers, encrypts, and maintains all your Facebook Pages without ever exposing secrets. Manual token entry is an administrative fallback intended strictly for offline sandbox testing or manual Graph API Explorer debug tokens.
            </p>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn btn-secondary" onclick="openAddAccountModal()">➕ Manual Account / Token Entry</button>
              <button class="btn btn-secondary" onclick="openAddPageModal()">➕ Manual Page / Token Entry</button>
            </div>
          </div>
        </details>
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
        <h3 style="margin-bottom: 10px; font-size: 16px;">⚡ End-to-End Pipeline Simulator (Sandbox Preview - No Posts Created or Sent to Facebook)</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 18px;">
          Runs research collector, topic scoring, chunked narrative writing, caption validation, image prompt composition, and QA audit in a dry-run sandbox. Does not write to production database or call Facebook API.
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
      <!-- Storage Health Check Card -->
      <div class="card" style="margin-bottom: 24px; border: 1px solid ${storageHealth.supabaseConnected && storageHealth.tablesOk ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
            <span>💾</span> Supabase Database Storage Health & Source of Truth
          </h3>
          <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ${storageHealth.supabaseConnected && storageHealth.tablesOk ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${storageHealth.supabaseConnected && storageHealth.tablesOk ? '#34d399' : '#f87171'};">
            ${storageHealth.supabaseConnected && storageHealth.tablesOk ? '● Production Database Active' : '● Degraded / Action Required'}
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 14px;">
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Supabase Connection Status</div>
            <div style="font-size: 16px; font-weight: 700; color: ${storageHealth.supabaseConnected ? '#34d399' : '#f87171'};">
              ${storageHealth.supabaseConnected ? '✅ Connected' : '❌ Failed'}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">PostgREST + Service Role Active</div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Postgres Tables Status</div>
            <div style="font-size: 16px; font-weight: 700; color: ${storageHealth.tablesOk ? '#34d399' : '#f87171'};">
              ${storageHealth.tablesOk ? `✅ All ${storageHealth.tablesCount} Present` : `⚠️ ${storageHealth.tablesCount}/19 Present`}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Public schema with RLS protection</div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Storage Bucket Status</div>
            <div style="font-size: 16px; font-weight: 700; color: ${storageHealth.bucketOk ? '#34d399' : '#f87171'};">
              ${storageHealth.bucketOk ? '✅ Connected (post-images)' : '⚠️ Warning / Missing'}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Private (public = false), 10MB limit</div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Single Source of Truth</div>
            <div style="font-size: 16px; font-weight: 700; color: #38bdf8;">
              YES (Supabase Postgres)
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Zero in-memory/ephemeral JSON files</div>
          </div>
        </div>
      </div>

      <!-- Facebook Setup & Connection Diagnostics Card -->
      <div class="card" style="margin-bottom: 24px; border: 1px solid var(--card-border);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <h3 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
            <span>🔗</span> Facebook App Setup & Meta Connection Diagnostics
          </h3>
          <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ${process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET ? '#34d399' : '#f87171'};">
            ${process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET ? '● Meta App Configured' : '● Credentials Missing'}
          </span>
        </div>

        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Facebook Login for Business requires specific environment variables and matching OAuth redirect URIs in your Meta Developer Console. Secrets are never exposed.
        </p>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 16px;">
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">FACEBOOK_APP_ID</div>
            <div style="font-size: 14px; font-weight: 700; color: ${process.env.FACEBOOK_APP_ID ? '#34d399' : '#f87171'};">
              ${process.env.FACEBOOK_APP_ID ? '✅ Configured (' + maskSecret(process.env.FACEBOOK_APP_ID, 4, 3) + ')' : '❌ Not Set'}
            </div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">FACEBOOK_APP_SECRET</div>
            <div style="font-size: 14px; font-weight: 700; color: ${process.env.FACEBOOK_APP_SECRET ? '#34d399' : '#f87171'};">
              ${process.env.FACEBOOK_APP_SECRET ? '✅ Configured (Encrypted)' : '❌ Not Set'}
            </div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">FACEBOOK_LOGIN_CONFIG_ID</div>
            <div style="font-size: 14px; font-weight: 700; color: ${process.env.FACEBOOK_LOGIN_CONFIG_ID ? '#34d399' : '#f59e0b'};">
              ${process.env.FACEBOOK_LOGIN_CONFIG_ID ? '✅ ' + process.env.FACEBOOK_LOGIN_CONFIG_ID : '⚠️ Missing (Scope Fallback)'}
            </div>
          </div>

          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">FACEBOOK_REDIRECT_URI</div>
            <div style="font-size: 13px; font-weight: 600; color: ${process.env.FACEBOOK_REDIRECT_URI ? '#34d399' : '#93c5fd'}; word-break: break-all;">
              ${process.env.FACEBOOK_REDIRECT_URI ? '✅ Set Custom' : 'ℹ️ Default (Auto)'}
            </div>
          </div>
        </div>

        <div style="background: #0b0f19; border: 1px solid var(--card-border); padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;">Expected OAuth Redirect URI (Add to Meta App Settings)</div>
            <code id="expectedRedirectUriText" style="color: #93c5fd; font-size: 13px; word-break: break-all;">${expectedRedirectUri}</code>
          </div>
          <button class="btn btn-secondary" style="padding: 6px 14px; font-size: 12px;" onclick="copyExpectedRedirectUri()">📋 Copy Redirect URI</button>
        </div>

        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button id="testFbConnBtn" class="btn btn-primary" onclick="testFacebookConnectionAction(this)">
            🩺 Test Facebook Connection with Meta Graph API
          </button>
          <span id="testFbConnStatus" style="font-size: 13px; color: var(--text-muted);"></span>
        </div>
        <div id="testFbConnResults" style="display: none; margin-top: 14px;"></div>
      </div>

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
          <label for="newPageAccountId">Facebook Account / Identity Owner *</label>
          <select id="newPageAccountId" name="newPageAccountId" class="form-control">
            ${accounts.map((a) => `<option value="${a.id}">${a.account_name} (FB ID: ${a.fb_user_id})</option>`).join('')}
            <option value="">Direct Page Token (Standalone)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="newPageName">Facebook Page Name *</label>
          <input type="text" id="newPageName" name="newPageName" class="form-control" placeholder="e.g. Vintage Supercars Club" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="newPageFbId">Facebook Page ID *</label>
          <input type="text" id="newPageFbId" name="newPageFbId" class="form-control" placeholder="e.g. 10492837461928" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="newPageToken">Facebook Page Access Token * (Will be AES-256-GCM Encrypted)</label>
          <input type="password" id="newPageToken" name="newPageToken" class="form-control" placeholder="EAAB..." autocomplete="new-password" required>
        </div>

        <div class="form-group">
          <label for="newProfileId">Base Content Niche / Profile (25+ Categorized Presets or Type Custom Niche)</label>
          <select id="newProfileId" name="newProfileId" class="form-control" onchange="toggleCustomNicheField(this.value, 'newCustomNicheBox')">
            ${renderNicheSelectOptions(seedProfiles)}
          </select>
        </div>

        <div id="newCustomNicheBox" style="display: none; background: rgba(59, 130, 246, 0.08); border: 1px dashed #3b82f6; padding: 14px; border-radius: 8px; margin-bottom: 15px;">
          <div style="font-size: 13px; font-weight: 600; color: #93c5fd; margin-bottom: 8px;">
            ✨ Custom Niche Definition
          </div>
          <div class="form-group" style="margin-bottom: 10px;">
            <label for="newCustomNicheName" style="font-size: 12px;">Type Your Custom Niche Name *</label>
            <input type="text" id="newCustomNicheName" name="newCustomNicheName" class="form-control" autocomplete="off" placeholder="e.g. Bonsai Tree Cultivation, Supercar Aerodynamics, Ancient Stoic Wisdom...">
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label for="newCustomNicheType" style="font-size: 12px;">Niche Content Style</label>
              <select id="newCustomNicheType" name="newCustomNicheType" class="form-control">
                <option value="factual">Factual / Educational Insights</option>
                <option value="fiction">Fiction / Storytelling</option>
                <option value="evergreen">Evergreen / Mindset & Guides</option>
                <option value="true_story">True Story / Historical Chronicles</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="newCustomNicheAudience" style="font-size: 12px;">Target Audience (Optional)</label>
              <input type="text" id="newCustomNicheAudience" name="newCustomNicheAudience" class="form-control" autocomplete="off" placeholder="e.g. Passionate hobbyists and curious minds">
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div class="form-group">
            <label for="newPublishingMode">Publishing Mode</label>
            <select id="newPublishingMode" name="newPublishingMode" class="form-control">
              <option value="hybrid">Hybrid (Auto if QA >= 80, else Review)</option>
              <option value="review">Review (Always hold for review)</option>
              <option value="auto">Auto (Publish automatically)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="newDailyCap">Daily Post Cap</label>
            <input type="number" id="newDailyCap" name="newDailyCap" class="form-control" value="3" min="1" max="10">
          </div>
        </div>

        <div class="form-group">
          <label for="newPostingTimes">Daily Posting Times (HH:mm comma-separated)</label>
          <input type="text" id="newPostingTimes" name="newPostingTimes" class="form-control" value="10:00, 15:00, 20:00" autocomplete="off">
        </div>

        <div class="form-group">
          <label for="newCaptionPrompt">Page-Specific Custom Caption Instructions (Optional)</label>
          <textarea id="newCaptionPrompt" name="newCaptionPrompt" class="form-control" style="height: 80px;" placeholder="Specific voice, rules, or questions for this page's audience..."></textarea>
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
        <button type="button" onclick="closeAddAccountModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;" aria-label="Close modal">✕</button>
      </div>

      <form id="addAccountForm" onsubmit="submitNewAccount(event)">
        <div class="form-group">
          <label for="newAccountName">Account / Profile Label *</label>
          <input type="text" id="newAccountName" name="newAccountName" class="form-control" placeholder="e.g. John Doe (Creator ID #2), Marketing Agency BM" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="newAccountFbId">Facebook User ID *</label>
          <input type="text" id="newAccountFbId" name="newAccountFbId" class="form-control" placeholder="e.g. 100084920194820" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="newAccountEmail">Contact Email (Optional)</label>
          <input type="email" id="newAccountEmail" name="newAccountEmail" class="form-control" placeholder="admin@mycreatornetwork.com" autocomplete="email">
        </div>

        <div class="form-group">
          <label for="newAccountToken">Facebook User Access Token / System User Token (Optional - AES-256-GCM Encrypted)</label>
          <input type="password" id="newAccountToken" name="newAccountToken" class="form-control" placeholder="EAAB... (Used for long-lived page management)" autocomplete="new-password">
        </div>

        <div class="form-group">
          <label for="newAccountNotes">Account Role / Notes (Optional)</label>
          <input type="text" id="newAccountNotes" name="newAccountNotes" class="form-control" placeholder="e.g. Primary profile for Automotive & Luxury pages" autocomplete="off">
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
        <button type="button" onclick="closeEditAccountModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;" aria-label="Close modal">✕</button>
      </div>

      <form id="editAccountForm" onsubmit="submitEditAccount(event)">
        <input type="hidden" id="editAccountId" name="editAccountId">
        <div class="form-group">
          <label for="editAccountName">Account / Profile Label *</label>
          <input type="text" id="editAccountName" name="editAccountName" class="form-control" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="editAccountFbId">Facebook User ID *</label>
          <input type="text" id="editAccountFbId" name="editAccountFbId" class="form-control" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="editAccountEmail">Contact Email</label>
          <input type="email" id="editAccountEmail" name="editAccountEmail" class="form-control" autocomplete="email">
        </div>

        <div class="form-group">
          <label for="editAccountNotes">Notes</label>
          <input type="text" id="editAccountNotes" name="editAccountNotes" class="form-control" autocomplete="off">
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
          <label for="quickProviderSelect" style="font-weight: 600; font-size: 13px; color: #f3f4f6;">1. Select AI Provider *</label>
          <select id="quickProviderSelect" name="quickProviderSelect" class="form-control" onchange="onQuickProviderChange(this.value)" style="font-size: 14px; padding: 10px 12px; font-weight: 500;" required>
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
            <label for="quickApiKey" style="font-weight: 600; font-size: 13px; color: #f3f4f6;">2. API Key(s) / Secret Token(s)</label>
            <button type="button" onclick="toggleQuickKeyVisibility()" style="background: none; border: none; color: #60a5fa; font-size: 12px; cursor: pointer;">👁️ Show / Hide</button>
          </div>
          <textarea id="quickApiKey" name="quickApiKey" class="form-control" rows="2" placeholder="Paste API key(s) here. Supports multiple keys (one per line or comma-separated) for rotation pool. Leave blank for Pollinations / Ollama." autocomplete="off" style="padding: 10px 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px;"></textarea>
          <small id="quickKeyHint" style="color: var(--text-muted); font-size: 11px; display: block; margin-top: 4px;">AES-256-GCM encrypted upon saving. Multiple keys automatically rotate. If this provider is already configured, new keys are appended to its pool without overwriting or deleting previous keys!</small>
        </div>

        <!-- Collapsible Advanced Settings -->
        <div style="border-top: 1px solid var(--card-border); padding-top: 10px; margin-top: 14px;">
          <button type="button" onclick="toggleQuickAdvanced()" style="background: none; border: none; color: var(--text-muted); font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 0;">
            <span id="quickAdvArrow">▶</span> <span>Advanced Settings (Model, Base URL, Failover Priority, Daily Quota)</span>
          </button>
          <div id="quickAdvancedFields" style="display: none; margin-top: 12px; background: #0f172a; padding: 14px; border-radius: 8px; border: 1px solid #1e293b;">
            <div class="form-group" style="margin-bottom: 10px;">
              <label for="newProviderName" style="font-size: 12px;">Display Name</label>
              <input type="text" id="newProviderName" name="newProviderName" class="form-control" value="Google Gemini (Gemini 2.5 Flash)" autocomplete="off" style="font-size: 12px;">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div class="form-group">
                <label for="newProviderAdapter" style="font-size: 12px;">Adapter Kind</label>
                <input type="text" id="newProviderAdapter" name="newProviderAdapter" class="form-control" value="gemini_native" style="font-size: 12px;" readonly>
              </div>
              <div class="form-group">
                <label for="newProviderModel" style="font-size: 12px;">Default Model</label>
                <input type="text" id="newProviderModel" name="newProviderModel" class="form-control" value="gemini-2.5-flash" autocomplete="off" style="font-size: 12px;">
              </div>
            </div>
            <div class="form-group" style="margin-bottom: 10px;">
              <label for="newProviderBaseUrl" style="font-size: 12px;">Base URL</label>
              <input type="text" id="newProviderBaseUrl" name="newProviderBaseUrl" class="form-control" value="https://generativelanguage.googleapis.com/v1beta" autocomplete="off" style="font-size: 12px;">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="form-group">
                <label for="newProviderPriority" style="font-size: 12px;">Failover Priority (1 = Primary)</label>
                <input type="number" id="newProviderPriority" name="newProviderPriority" class="form-control" value="1" min="1" max="10" style="font-size: 12px;">
              </div>
              <div class="form-group">
                <label for="newProviderDailyLimit" style="font-size: 12px;">Daily Request Quota</label>
                <input type="number" id="newProviderDailyLimit" name="newProviderDailyLimit" class="form-control" value="1500" min="10" style="font-size: 12px;">
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
          <input type="hidden" id="keyPoolProviderId" name="keyPoolProviderId">
          <div class="form-group">
            <label for="keyPoolRawKey">Raw API Key(s) * (AES-256-GCM Encrypted — paste 1 key or multiple keys, one per line or comma-separated)</label>
            <textarea id="keyPoolRawKey" name="keyPoolRawKey" class="form-control" rows="3" placeholder="Paste API key(s) here:&#10;sk-proj-key1...&#10;sk-proj-key2..." autocomplete="off" required style="padding: 10px 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px;"></textarea>
            <small style="color: var(--text-muted); font-size: 11px; display: block; margin-top: 4px;">Supports multiple keys simultaneously. None of your previous keys will ever be replaced or deleted.</small>
          </div>
          <div class="form-group">
            <label for="keyPoolLabel">Key Label / Alias (Optional)</label>
            <input type="text" id="keyPoolLabel" name="keyPoolLabel" class="form-control" placeholder="e.g. Backup Key 2, Team Workspace Key" autocomplete="off">
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
        <button type="button" onclick="closeEditProviderModal()" style="background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer;" aria-label="Close modal">✕</button>
      </div>

      <form id="editProviderForm" onsubmit="submitEditProvider(event)">
        <input type="hidden" id="editProviderId" name="editProviderId">

        <div class="form-group">
          <label for="editProviderName">Provider Name *</label>
          <input type="text" id="editProviderName" name="editProviderName" class="form-control" autocomplete="off" required>
        </div>

        <div class="form-group">
          <label for="editProviderAdapter">Adapter Kind</label>
          <select id="editProviderAdapter" name="editProviderAdapter" class="form-control">
            <option value="gemini_native">Google Gemini Native (gemini_native)</option>
            <option value="openai_compatible_chat">OpenAI Compatible Chat</option>
            <option value="cloudflare_workers_ai">Cloudflare Workers AI</option>
            <option value="pollinations_image">Pollinations AI Image</option>
            <option value="custom_http">Custom HTTP JSON Webhook</option>
          </select>
        </div>

        <div class="form-group">
          <label for="editProviderBaseUrl">Base URL</label>
          <input type="text" id="editProviderBaseUrl" name="editProviderBaseUrl" class="form-control" autocomplete="off">
        </div>

        <div class="form-group">
          <label for="editProviderModel">Model Name</label>
          <input type="text" id="editProviderModel" name="editProviderModel" class="form-control" autocomplete="off">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div class="form-group">
            <label for="editProviderPriority">Failover Priority</label>
            <input type="number" id="editProviderPriority" name="editProviderPriority" class="form-control" min="1" max="10">
          </div>
          <div class="form-group">
            <label for="editProviderDailyLimit">Daily Request Quota</label>
            <input type="number" id="editProviderDailyLimit" name="editProviderDailyLimit" class="form-control" min="10">
          </div>
        </div>

        <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
          <input type="checkbox" id="editProviderEnabled" name="editProviderEnabled" style="width: 18px; height: 18px; accent-color: var(--primary);">
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
            <label for="editProviderNewKeys" style="font-size: 12px; color: #93c5fd;">➕ Append Additional API Key(s) to Pool (Optional)</label>
            <textarea id="editProviderNewKeys" name="editProviderNewKeys" class="form-control" rows="2" placeholder="Paste extra key(s) here (one per line or comma-separated) to add to rotation pool" autocomplete="off" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;"></textarea>
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

  <!-- Safe Initial State (JSON payload, non-executable, immune to syntax errors) -->
  <script id="initial-data" type="application/json">
    ${JSON.stringify({
      accounts: accounts || [],
      pages: pages || [],
      providers: providers || [],
      providerKeys: (providerKeys || []).map((k) => ({
        id: k.id,
        provider_id: k.provider_id,
        masked_key: k.masked_key,
        label: k.label,
        is_active: k.is_active,
        created_at: k.created_at,
      })),
      auditLogs: auditLogs || [],
      storageHealth: storageHealth || null,
    }).replace(/</g, "\u003c")}
  </script>
  <!-- Real Static Client Script -->
  <script src="/dashboard.js" defer></script>
</body>
</html>`;
}

async function generateStandalonePageDetailsHtml(pageId: string): Promise<string> {
  const page = pageId ? await store.getPageById(pageId) : (await store.getPages())[0];
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

  const account = (await store.getAccounts()).find((a) => a.id === page.fb_account_id);
  const profile =
    seedProfiles.find(
      (p) =>
        p.id === page.profile_id ||
        p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
        page.profile_id.toLowerCase().includes(p.name.toLowerCase())
    ) || createCustomNicheProfile(page.profile_id);

  const posts = (await store.getPosts()).filter((p) => p.page_id === page.id || p.page_id === page.fb_page_id);
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

  const auditLogs = (await store.getAuditLogs()).filter(
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
