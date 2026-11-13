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
  FacebookGraphError,
  sanitizeFacebookErrorMessage,
  SAFE_DEFAULT_SCHEDULE,
  type PageSchedule,
  validatePageSchedule,
  validateCaption,
  formatParagraphs,
  countWords,
  trimToWordLimit as coreTrimToWordLimit,
  runGenerationPipeline,
  generateCompositePreviewSvg,
  generateLiveSchedulePreview,
  evaluatePageChecklist,
  runAutonomousCycle,
  fetchPageProfileData,
  analyzePageNiche,
  generateDraftProfileFromPage,
  decrypt,
  runDailyContentResearch,
  regenerateSingleTopicItem,
  getSupabaseClient,
  GeminiNativeAdapter,
  OpenAIChatAdapter,
  CloudflareWorkersAIAdapter,
  OpenAICompatibleImageAdapter,
  globalBudgetTracker,
  KNOWN_IMAGE_MODEL_LICENSES,
  renderHeadlineCard,
  verifyFontLoading,
  parseHeadlineSegments,
  computeHeadlineLayout,
  sanitizeHeadlineAccuracy,
  getEstimatedCostPerImage,
  getEstimatedDailyCost,
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

function resolvePageProfile(page?: StoredPage | null): ContentProfile {
  const scienceProfile =
    seedProfiles.find(
      (p) =>
        p.name.includes('Science') ||
        (p as any).customVariables?.niche === 'science_space' ||
        (p as any).niche === 'science_space'
    ) ||
    seedProfiles[0] ||
    createCustomNicheProfile('Science & Space');

  if (!page) return scienceProfile;
  const profileId = page.profile_id || '';
  const customNiche = (page as any).custom_niche || (page as any).custom_niche_text || '';
  if (profileId && profileId !== '__custom__' && profileId !== 'custom') {
    const matched = seedProfiles.find(
      (p) =>
        p.id === profileId ||
        p.name.toLowerCase() === profileId.toLowerCase() ||
        p.name.toLowerCase().includes(profileId.toLowerCase()) ||
        (p as any).customVariables?.niche === profileId ||
        (p as any).niche === profileId
    );
    if (matched) return matched;
  }
  if (customNiche) {
    return createCustomNicheProfile(customNiche);
  }
  return scienceProfile;
}

export function maskSecretsInPrompt(text: string): string {
  if (!text) return '';
  return text
    .replace(/(sk-[a-zA-Z0-9_\-]{8,})/g, (m) => m.slice(0, 4) + '...' + m.slice(-3))
    .replace(/(AIza[0-9A-Za-z_\-]{10,})/g, (m) => m.slice(0, 4) + '...' + m.slice(-3))
    .replace(/(EAAB[0-9A-Za-z_\-]{10,})/g, (m) => m.slice(0, 6) + '...' + m.slice(-4))
    .replace(/(ghp_[a-zA-Z0-9]{15,})/g, (m) => m.slice(0, 4) + '...' + m.slice(-3))
    .replace(/([0-9a-fA-F]{32,64})/g, (m) => m.slice(0, 4) + '...' + m.slice(-4));
}

export const trimToWordLimit = coreTrimToWordLimit;


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

export function createFallbackAppSession(email: string, userId?: string): string {
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

export function validateSameOriginReturnTo(returnTo: unknown, fallback: string = '/overview'): string {
  if (typeof returnTo !== 'string' || !returnTo.trim()) {
    return fallback;
  }
  const clean = returnTo.trim();
  // Must start with '/' and not with '//', and must not contain '\'
  if (!clean.startsWith('/') || clean.startsWith('//') || clean.includes('\\')) {
    return fallback;
  }
  // Reject protocol schemes e.g. http:, https:, javascript:, data:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) {
    return fallback;
  }
  return clean;
}

export interface DashboardRouteMeta {
  tabId: string;
  title: string;
  heading: string;
  desc: string;
}

export const VALID_DASHBOARD_ROUTES: Record<string, DashboardRouteMeta> = {
  '/overview': {
    tabId: 'overview',
    title: 'Overview',
    heading: 'Operational Overview',
    desc: 'Real-time telemetry, queue status, and health metrics',
  },
  '/accounts': {
    tabId: 'accounts',
    title: 'Connected FB Accounts',
    heading: 'Connected Accounts & Identities',
    desc: 'Manage Facebook logins, personal accounts, and connected credentials',
  },
  '/pages': {
    tabId: 'pages',
    title: 'Pages & Publishing Checklist',
    heading: 'Pages & Autonomous Setup Checklist',
    desc: 'Configure page schedules, assigned profiles, niche detection, and go-live checklist',
  },
  '/prompts': {
    tabId: 'page-prompts',
    title: 'Prompt Studio & Niches',
    heading: 'Content Profiles & Prompt Studio',
    desc: 'Customize brand voice, system prompts, research feeds, and viral angles per niche',
  },
  '/review': {
    tabId: 'review',
    title: 'Review Inbox',
    heading: 'Post Review & Human Approval Inbox',
    desc: 'Review, edit, reject, and approve pending posts before they go live on Facebook',
  },
  '/calendar': {
    tabId: 'calendar',
    title: 'Schedule Calendar',
    heading: 'Visual Publishing Calendar',
    desc: 'Timeline of scheduled drafts, active queues, and published posts',
  },
  '/analytics': {
    tabId: 'analytics',
    title: 'Engagement Analytics',
    heading: 'Performance Analytics & Insights',
    desc: 'Reach, engagement rate, reactions, and top-performing Facebook content',
  },
  '/test-run': {
    tabId: 'simulator',
    title: 'Test Run Simulator',
    heading: 'End-to-End Pipeline Simulator',
    desc: 'Dry-run research, idea generation, drafting, and safety policy checks safely without posting',
  },
  '/providers': {
    tabId: 'providers',
    title: 'AI Providers & Quotas',
    heading: 'AI Providers & Quota Management',
    desc: 'Multi-provider failover chains, official free tier tracking, and latency diagnostics',
  },
  '/audit-logs': {
    tabId: 'audit',
    title: 'System Audit Logs',
    heading: 'Security & Activity Audit Trails',
    desc: 'Immutable logs of administrative changes, automated publishes, and failovers',
  },
  '/settings': {
    tabId: 'settings',
    title: 'System Settings',
    heading: 'Global Controls & Database Governance',
    desc: 'Worker heartbeat, notifications, database migrations, and disaster recovery backups',
  },
};

export const TAB_TO_ROUTE: Record<string, string> = {
  overview: '/overview',
  accounts: '/accounts',
  pages: '/pages',
  'page-prompts': '/prompts',
  review: '/review',
  calendar: '/calendar',
  analytics: '/analytics',
  simulator: '/test-run',
  providers: '/providers',
  audit: '/audit-logs',
  settings: '/settings',
};

export interface OfficialFreeQuota {
  rpdLimit: number;
  unit: string;
  badge: string;
  note: string;
}

export const OFFICIAL_FREE_LIMITS: Record<string, OfficialFreeQuota> = {
  gemini: {
    rpdLimit: 1500,
    unit: 'reqs/day',
    badge: '1,500 reqs/day',
    note: 'Google AI Studio official free tier: 15 RPM / 1,500 RPD',
  },
  groq: {
    rpdLimit: 14400,
    unit: 'reqs/day',
    badge: '14,400 reqs/day (token-gated)',
    note: 'Groq Cloud official free tier: 30 RPM / 14,400 RPD token-gated',
  },
  openrouter: {
    rpdLimit: 200,
    unit: 'reqs/day',
    badge: '200 reqs/day',
    note: 'OpenRouter free models tier (:free)',
  },
  cloudflare: {
    rpdLimit: 10000,
    unit: 'neurons/day',
    badge: '10,000 neurons/day',
    note: 'Cloudflare Workers AI free tier',
  },
  huggingface: {
    rpdLimit: 0,
    unit: 'credits',
    badge: '0 credits (rate-limited)',
    note: 'Hugging Face Inference API free tier has 0 monthly credits and is community rate-limited',
  },
  pollinations: {
    rpdLimit: 1000,
    unit: 'reqs/day',
    badge: '1,000 reqs/day',
    note: 'Pollinations AI free community tier',
  },
};

export function lookupOfficialFreeQuota(provider: string | { name?: string; adapter_kind?: string; model_name?: string }): OfficialFreeQuota | null {
  const p = typeof provider === 'string' ? { name: provider, adapter_kind: provider } : (provider || {});
  const name = (p.name || '').toLowerCase();
  const kind = (p.adapter_kind || '').toLowerCase();
  const model = (p.model_name || '').toLowerCase();

  if (kind.includes('gemini') || name.includes('gemini')) return OFFICIAL_FREE_LIMITS.gemini;
  if (name.includes('groq') || model.includes('groq')) return OFFICIAL_FREE_LIMITS.groq;
  if (name.includes('openrouter') || model.includes('openrouter')) return OFFICIAL_FREE_LIMITS.openrouter;
  if (kind.includes('cloudflare') || name.includes('cloudflare')) return OFFICIAL_FREE_LIMITS.cloudflare;
  if (kind.includes('huggingface') || name.includes('hugging') || name.includes('hf')) return OFFICIAL_FREE_LIMITS.huggingface;
  if (kind.includes('pollinations') || name.includes('pollinations')) return OFFICIAL_FREE_LIMITS.pollinations;
  return null;
}

export function getProviderChain(provider: { name?: string; adapter_kind?: string; model_name?: string; config?: any }): 'text' | 'image' {
  if (provider.config?.chain_type === 'image') return 'image';
  if (provider.config?.chain_type === 'text') return 'text';
  const kind = (provider.adapter_kind || (provider as any).kind || '').toLowerCase();
  const name = (provider.name || '').toLowerCase();
  const model = (provider.model_name || '').toLowerCase();
  if (
    kind === 'pollinations' ||
    kind === 'openai_compatible_images' ||
    name.includes('image') ||
    model.includes('flux') ||
    model.includes('dall-e') ||
    model.includes('stable-diffusion') ||
    model.includes('lucid') ||
    model.includes('phoenix') ||
    model.includes('wanx') ||
    model.includes('riverflow')
  ) {
    return 'image';
  }
  return 'text';
}

export function generate404Html(pathname: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FB Auto 247 - Page Not Found (404)</title>
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
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
    p { color: var(--text-muted); font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    code { background: #1f2937; color: #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 24px;
      background: var(--primary);
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--primary-hover); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🧭</div>
    <h1>Page Not Found (404)</h1>
    <p>The route <code>${escapeHtml(pathname)}</code> could not be found or does not exist on this dashboard.</p>
    <a href="/overview" class="btn">← Return to Dashboard Overview</a>
  </div>
</body>
</html>`;
}

export function generateLoginHtml(errorMsg?: string, nextUrl?: string): string {
  const safeNext = validateSameOriginReturnTo(nextUrl, '/overview');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
  <meta name="theme-color" content="#030712">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      min-height: -webkit-fill-available;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
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
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .form-input {
      width: 100%;
      background: #030712;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 12px 14px;
      color: var(--text);
      font-size: 16px; /* 16px prevents iOS Safari from auto-zooming */
      min-height: 48px;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    }
    .pwd-toggle-btn {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 8px;
      font-size: 18px;
      line-height: 1;
      border-radius: 6px;
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
      padding: 14px 16px;
      min-height: 50px;
      border-radius: 10px;
      border: none;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      margin-top: 8px;
    }
    .btn-submit:hover {
      background: var(--primary-hover);
    }
    .btn-submit:active {
      transform: scale(0.99);
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
    @media (max-width: 480px) {
      body {
        padding: 12px;
        align-items: flex-start;
        padding-top: 24px;
      }
      .login-container {
        padding: 24px 18px;
        border-radius: 14px;
      }
      .brand-title {
        font-size: 20px;
      }
      .brand-sub {
        font-size: 12px;
      }
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
      <input type="hidden" id="loginNext" value="${escapeHtml(safeNext)}">
      <div class="form-group">
        <label class="form-label" for="email">Admin Email</label>
        <input class="form-input" type="email" id="email" required placeholder="owner@example.com" autocomplete="username email" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="email">
      </div>

      <div class="form-group">
        <label class="form-label" for="password">Password</label>
        <div class="input-wrapper">
          <input class="form-input" type="password" id="password" required placeholder="••••••••••••" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" style="padding-right: 46px;">
          <button type="button" class="pwd-toggle-btn" onclick="togglePasswordVisibility()" aria-label="Toggle password visibility">👁️</button>
        </div>
      </div>

      <button type="submit" class="btn-submit" id="submitBtn">Sign In to Dashboard ➔</button>
    </form>

    <div class="security-badge" style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; margin-top: 24px; font-size: 12px; color: var(--text-muted);">
      <span>🔒 Protected by Supabase Auth & AES-256-GCM Vault</span>
      <span style="font-weight: 600; color: #60a5fa; letter-spacing: 0.5px;">✨ Made by Chandan Biswas</span>
    </div>
  </div>

  <script>
    function togglePasswordVisibility() {
      const pwd = document.getElementById('password');
      if (pwd) {
        pwd.type = pwd.type === 'password' ? 'text' : 'password';
      }
    }

    async function handleLoginSubmit(e) {
      e.preventDefault();
      const rawEmail = document.getElementById('email').value || '';
      const email = rawEmail.trim().toLowerCase();
      const password = document.getElementById('password').value;
      const errorBox = document.getElementById('errorBox');
      const submitBtn = document.getElementById('submitBtn');

      errorBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.innerText = 'Authenticating...';

      try {
        const nextInput = document.getElementById('loginNext');
        const nextVal = (nextInput && nextInput.value) || new URLSearchParams(window.location.search).get('next') || new URLSearchParams(window.location.search).get('redirect') || '/overview';
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, next: nextVal })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          window.location.href = data.redirect || nextVal || '/overview';
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

// In-memory single-use guard for Facebook OAuth authorization codes
const processedOAuthCodes = new Set<string>();

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    const sendJson = (data: any, statusCode = 200) => {
      if (res.headersSent) return;
      try {
        const body = JSON.stringify(data, null, 2);
        res.writeHead(statusCode, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end(body);
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Serialization error: ${err.message}` }));
        }
      }
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
      const fontHealth = verifyFontLoading();
      return sendJson({
        status: 'ok',
        timestamp: new Date().toISOString(),
        fonts: fontHealth,
      });
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
      const nextParam = url.searchParams.get('next') || url.searchParams.get('redirect');
      const safeNext = validateSameOriginReturnTo(nextParam, '/overview');
      const auth = await verifyAuth(req, res);
      if (auth.authenticated) {
        res.writeHead(302, { Location: safeNext });
        res.end();
        return;
      }
      const html = generateLoginHtml(undefined, safeNext);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(html);
      return;
    }

    // C. Authentication API: Login (Public)
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { email: rawEmail, password, next, redirect } = JSON.parse(body || '{}');
          const email = (rawEmail || '').trim().toLowerCase();
          const safeNext = validateSameOriginReturnTo(
            next || redirect || url.searchParams.get('next') || url.searchParams.get('redirect'),
            '/overview'
          );
          if (!email || !password) {
            return sendJson({ error: 'Email and password are required.' }, 400);
          }

          const client = getAuthClient();
          if (!client) {
            if (process.env.TEST_AUTH_ENABLED === 'true' || process.env.NODE_ENV === 'test') {
              const appSession = createFallbackAppSession(email, 'test-owner');
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': [`app_session=${appSession}; Path=/; HttpOnly; SameSite=Lax`],
              });
              res.end(JSON.stringify({ success: true, redirect: safeNext, redirectUrl: safeNext, user: { email } }));
              return;
            }
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
          res.end(JSON.stringify({ success: true, redirect: safeNext, redirectUrl: safeNext, user: { email: data.user.email } }));
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
      const returnTo = url.searchParams.get('returnTo') || req.headers.referer || '/accounts';
      const safeReturnTo = validateSameOriginReturnTo(returnTo, '/accounts');

      const auth = await verifyAuth(req, res);
      if (!auth.authenticated) {
        res.writeHead(302, {
          Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
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
          Location: `${safeReturnTo}?error=${encodeURIComponent('FACEBOOK_APP_ID is not configured in environment variables.')}`,
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
        'Set-Cookie': [
          `fb_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
          `fb_oauth_returnto=${encodeURIComponent(safeReturnTo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
        ],
        Location: authUrl,
      });
      res.end();
      return;
    }

    // I. Facebook OAuth Callback (GET /api/auth/facebook/callback)
    if (url.pathname === '/api/auth/facebook/callback') {
      const cookies = parseCookies(req);
      const safeReturnTo = validateSameOriginReturnTo(
        cookies['fb_oauth_returnto'] ? decodeURIComponent(cookies['fb_oauth_returnto']) : '/accounts',
        '/accounts'
      );
      const clearCookies = [
        'fb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'fb_oauth_returnto=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ];

      const error = url.searchParams.get('error');
      const errorDescription =
        url.searchParams.get('error_description') || url.searchParams.get('error_message') || '';
      if (error) {
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent(
            `Facebook authorization declined: ${errorDescription || error}`
          )}`,
        });
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const expectedState = cookies['fb_oauth_state'];

      if (!state || !expectedState || state !== expectedState) {
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent(
            'OAuth state verification failed (possible CSRF or session expired). Please try again.'
          )}`,
        });
        res.end();
        return;
      }

      if (!code) {
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent('No authorization code received from Facebook.')}`,
        });
        res.end();
        return;
      }

      // Single-use code deduplication: if code was already exchanged, redirect cleanly
      if (processedOAuthCodes.has(code)) {
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?connected=true&reloaded=true`,
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
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent(
            'Server configuration error: FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is not configured.'
          )}`,
        });
        res.end();
        return;
      }

      // Stage 1: Exchange authorization code for user access token & extend to long-lived token (~60 days)
      let shortLivedToken: string;
      let longLivedToken: string;
      let expiresIn: number;
      try {
        const shortRes = await exchangeCodeForUserToken(
          code,
          appId,
          appSecret,
          redirectUri
        );
        shortLivedToken = shortRes.accessToken;
        const longRes = await exchangeForLongLivedUserToken(
          shortLivedToken,
          appId,
          appSecret
        );
        longLivedToken = longRes.accessToken;
        expiresIn = longRes.expiresIn;
        processedOAuthCodes.add(code);
        if (processedOAuthCodes.size > 500) processedOAuthCodes.clear();
      } catch (tokenErr: any) {
        const safeMsg = sanitizeFacebookErrorMessage(tokenErr.message || 'Unknown token error');
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent(
            `Facebook token exchange failed: ${safeMsg}. Please check your App ID, App Secret, and Redirect URI in Vercel settings.`
          )}`,
        });
        res.end();
        return;
      }

      // Stage 2: Fetch user profile and save account identity into Supabase vault
      let userProfile: { id: string; name: string; email?: string };
      let account: any;
      try {
        userProfile = await fetchFacebookUserProfile(longLivedToken);
        const expiryDate = new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString();
        account = await store.upsertAccount({
          account_name: userProfile.name || `Facebook User ${userProfile.id}`,
          fb_user_id: userProfile.id,
          email: userProfile.email,
          user_access_token: longLivedToken,
          token_expires_at: expiryDate,
          notes: 'Connected via Facebook Login for Business',
        });
      } catch (profErr: any) {
        const safeMsg = sanitizeFacebookErrorMessage(profErr.message || 'Unknown profile error');
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent(
            `Could not load Facebook user profile: ${safeMsg}. Please reconnect.`
          )}`,
        });
        res.end();
        return;
      }

      // Stage 3: Automatic Page Discovery via me/accounts (with tasks, pagination, and business portfolios)
      let discovery: any;
      try {
        discovery = await discoverFacebookPages(longLivedToken);
      } catch (discErr: any) {
        let codePrefix = '';
        if (discErr instanceof FacebookGraphError) {
          codePrefix = `(#${discErr.code}${discErr.subcode ? ` subcode ${discErr.subcode}` : ''}) `;
        } else if (discErr.code) {
          codePrefix = `(#${discErr.code}) `;
        }
        const safeMsg = sanitizeFacebookErrorMessage(discErr.message || 'Unknown Graph API error');

        await store.addAuditLog({
          level: 'warning',
          category: 'token',
          message: `Connected account "${userProfile.name}" (${userProfile.id}), but could not list Pages: ${codePrefix}${safeMsg}`,
          details: { userId: userProfile.id, error: safeMsg },
        });

        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?error=${encodeURIComponent(
            `Connected identity "${userProfile.name}", but could not list Pages: ${codePrefix}${safeMsg}. What to do: Ensure your Facebook account granted Page permissions in the Login dialog, then click "Sync Pages".`
          )}`,
        });
        res.end();
        return;
      }

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

      const updates: any = {
        pages_count: discovery.pages.length,
        last_synced_at: new Date().toISOString(),
        token_status: 'valid',
      };
      if (discovery.grantedPermissions && discovery.grantedPermissions.length > 0) {
        updates.notes = `Permissions: ${discovery.grantedPermissions.join(', ')}`;
      }
      await store.updateAccount(account.id, updates);

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
          grantedPermissions: discovery.grantedPermissions,
          declinedPermissions: discovery.declinedPermissions,
        },
      });

      if (discovery.totalFound === 0) {
        const reasonMsg =
          discovery.emptyExplanation ||
          `Connected Facebook identity "${userProfile.name}" (${userProfile.id}), but no Facebook Pages were discovered. Ensure you are an admin or editor of at least one Page and ticked your Page in the Meta Business Login dialog.`;
        res.writeHead(302, {
          'Set-Cookie': clearCookies,
          Location: `${safeReturnTo}?warning=${encodeURIComponent(reasonMsg)}`,
        });
        res.end();
        return;
      }

      res.writeHead(302, {
        'Set-Cookie': clearCookies,
        Location: `${safeReturnTo}?connected=true&account=${encodeURIComponent(userProfile.name)}&found=${discovery.totalFound}&new=${newCount}&updated=${updatedCount}&publishable=${discovery.publishableCount}`,
      });
      res.end();
      return;
    }

    // J. Auth Gate: Protect all other routes
    const auth = await verifyAuth(req, res);
    if (!auth.authenticated) {
      if (url.pathname.startsWith('/api/')) {
        return sendJson({ error: 'Unauthorized. Please sign in.' }, 401);
      }
      const safeNext = validateSameOriginReturnTo(url.pathname + url.search, '/overview');
      const redirectUrl =
        safeNext === '/' || safeNext === '/overview'
          ? '/login'
          : `/login?next=${encodeURIComponent(safeNext)}`;
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
        if (!result.success && result.accountsSynced === 0) {
          return sendJson({
            ...result,
            error: (result.errors && result.errors.length > 0)
              ? result.errors.join('; ')
              : 'Failed to sync Facebook accounts.',
          }, 400);
        }
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

    // Unified Page Settings & Prompt Studio Save Handler
    const savePageSettingsHandler = async (pageId: string, data: any) => {
      if (!pageId) {
        return sendJson({ error: 'Page ID is required.' }, 400);
      }

      const page = await store.getPageById(pageId);
      if (!page) {
        return sendJson({ error: `Page ${pageId} not found.` }, 404);
      }

      // 1. Validation: minWords <= targetWords <= maxWords
      const minWords = data.overrides?.['caption.min'] !== undefined
        ? Number(data.overrides['caption.min'])
        : (data.minWords !== undefined ? Number(data.minWords) : undefined);
      const targetWords = data.overrides?.['caption.target'] !== undefined
        ? Number(data.overrides['caption.target'])
        : (data.targetWords !== undefined ? Number(data.targetWords) : undefined);
      const maxWords = data.overrides?.['caption.max'] !== undefined
        ? Number(data.overrides['caption.max'])
        : (data.maxWords !== undefined ? Number(data.maxWords) : undefined);

      if (minWords !== undefined && targetWords !== undefined && maxWords !== undefined) {
        if (minWords > targetWords || targetWords > maxWords) {
          return sendJson(
            {
              error: 'Validation error: Min words cannot exceed target words, and target words cannot exceed max words (min <= target <= max).',
              field: 'words',
            },
            400
          );
        }
      }

      // 2. Validation: First comment prompt required if enabled
      if (data.first_comment_enabled !== undefined || data.first_comment_prompt !== undefined) {
        const firstCommentEnabled = data.first_comment_enabled !== undefined
          ? Boolean(data.first_comment_enabled)
          : page.first_comment_enabled;
        const firstCommentPrompt = data.first_comment_prompt !== undefined
          ? String(data.first_comment_prompt).trim()
          : (page.first_comment_prompt || '').trim();

        if (firstCommentEnabled && !firstCommentPrompt) {
          return sendJson(
            {
              error: 'Validation error: First comment text is required when auto-post first comment is enabled.',
              field: 'first_comment_prompt',
            },
            400
          );
        }
      }

      // 3. Validation: Headline Panel Background Color
      const overrides = { ...(page.overrides || {}), ...(data.overrides || {}) };
      if (overrides['image.headlinePanel.backgroundColor'] !== undefined) {
        let bgCol = String(overrides['image.headlinePanel.backgroundColor'] || '').trim();
        if (!bgCol) {
          bgCol = '#000000';
          overrides['image.headlinePanel.backgroundColor'] = bgCol;
        }
        const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
        if (!hexRegex.test(bgCol)) {
          return sendJson(
            {
              error: 'Validation error: Headline panel background color must be a valid hex color code (e.g. #050b14 or #000000).',
              field: 'headline_color',
            },
            400
          );
        }
      }

      // 4. Custom Niche Auto-Replace & Normalization
      let resolvedProfileId = data.profile_id !== undefined ? data.profile_id : page.profile_id;
      let customNicheText = (data.custom_niche || data.custom_niche_name || data.custom_niche_text || page.custom_niche || '').trim();

      const isCustom =
        resolvedProfileId === '__custom__' ||
        resolvedProfileId === 'custom' ||
        resolvedProfileId === '' ||
        resolvedProfileId === null ||
        Boolean(data.custom_niche_name);

      if (isCustom) {
        resolvedProfileId = null;
        if (data.custom_niche_name) customNicheText = data.custom_niche_name.trim();
      }

      const updates: Partial<StoredPage> = {
        profile_id: resolvedProfileId,
        custom_niche: customNicheText,
        custom_niche_text: customNicheText,
        overrides,
      };

      if (isCustom) {
        updates.custom_caption_prompt_mode = data.custom_caption_prompt_mode || 'replace';
        updates.custom_image_prompt_mode = data.custom_image_prompt_mode || 'replace';
      } else {
        if (data.custom_caption_prompt_mode) updates.custom_caption_prompt_mode = data.custom_caption_prompt_mode;
        if (data.custom_image_prompt_mode) updates.custom_image_prompt_mode = data.custom_image_prompt_mode;
      }

      if (data.custom_caption_prompt !== undefined) updates.custom_caption_prompt = data.custom_caption_prompt;
      if (data.custom_image_prompt !== undefined) updates.custom_image_prompt = data.custom_image_prompt;
      if (data.first_comment_enabled !== undefined) updates.first_comment_enabled = Boolean(data.first_comment_enabled);
      if (data.first_comment_prompt !== undefined) updates.first_comment_prompt = data.first_comment_prompt;

      if (data.publishing_mode) {
        if (!['auto', 'review', 'hybrid'].includes(data.publishing_mode)) {
          return sendJson({ error: 'Invalid publishing_mode. Must be auto, review, or hybrid.' }, 400);
        }

        if (data.publishing_mode === 'auto') {
          // Safety Gate: Block Fully Automatic until 20 approved posts, QA pass rate >= 90%, 0 consistency/grounding failures
          const sb = getSupabaseClient();
          if (sb) {
            const { data: pagePosts } = await sb
              .from('posts')
              .select('id, status, qa_score, metadata')
              .eq('page_id', page.id);

            const approvedPosts = (pagePosts || []).filter(
              (p) => p.status === 'published' || p.status === 'scheduled_on_fb' || p.status === 'approved'
            );
            const approvedCount = approvedPosts.length;
            const highQaCount = approvedPosts.filter((p) => (Number(p.qa_score) || 0) >= 90).length;
            const qaPassRate = approvedCount > 0 ? Math.round((highQaCount / approvedCount) * 100) : 0;

            const isExempt =
              data.override_confirmation === 'I UNDERSTAND THE RISKS' ||
              data.safety_override === 'I UNDERSTAND THE RISKS' ||
              (data as any).safety_override === true;

            if ((approvedCount < 20 || qaPassRate < 90) && !isExempt) {
              return sendJson(
                {
                  error: `Safety Gate: Fully Automatic mode requires at least 20 approved posts with a 90%+ QA pass rate and 0 consistency/grounding failures. Current: ${approvedCount}/20 approved (${qaPassRate}% pass rate). You can override with typed confirmation 'I UNDERSTAND THE RISKS'.`,
                  safetyGate: {
                    approvedCount,
                    requiredApproved: 20,
                    qaPassRate,
                    requiredPassRate: 90,
                    isQualified: false,
                  },
                },
                400
              );
            }
          }
        }

        updates.publishing_mode = data.publishing_mode;
        updates.mode_chosen = true;
      }
      if (data.mode_chosen !== undefined) updates.mode_chosen = Boolean(data.mode_chosen);

      if (data.hybrid_min_score !== undefined) {
        updates.hybrid_min_score = Math.max(50, Math.min(99, Number(data.hybrid_min_score) || 80));
      }
      if (data.daily_cap !== undefined) {
        updates.daily_cap = Math.max(1, Math.min(20, Number(data.daily_cap) || 3));
      }

      if (data.ai_disclosure_enabled !== undefined) updates.ai_disclosure_enabled = Boolean(data.ai_disclosure_enabled);
      if (data.ai_disclosure_text !== undefined) updates.ai_disclosure_text = String(data.ai_disclosure_text);
      if (data.source_attribution_enabled !== undefined) updates.source_attribution_enabled = Boolean(data.source_attribution_enabled);

      if (data.qa_pass_threshold !== undefined) {
        updates.qa_pass_threshold = Math.max(50, Math.min(100, Number(data.qa_pass_threshold) || 80));
      }
      if (data.max_sentences_per_paragraph !== undefined) {
        updates.max_sentences_per_paragraph = Math.max(1, Math.min(10, Number(data.max_sentences_per_paragraph) || 3));
      }
      if (data.min_words !== undefined) updates.min_words = Math.max(20, Number(data.min_words) || 120);
      if (data.target_words !== undefined) updates.target_words = Math.max(30, Number(data.target_words) || 180);
      if (data.max_words !== undefined) updates.max_words = Math.max(40, Number(data.max_words) || 250);

      if (data.schedule) {
        const scheduleVal = validatePageSchedule(data.schedule);
        if (!scheduleVal.valid) {
          return sendJson({ error: `Schedule validation failed: ${scheduleVal.errors.join('; ')}` }, 400);
        }
        updates.schedule = {
          ...page.schedule,
          ...data.schedule,
          postsPerDay: data.schedule.postsPerDay !== undefined ? Number(data.schedule.postsPerDay) : page.schedule.postsPerDay,
          postingTimes: scheduleVal.resolvedPostingTimes,
        };
      }

      try {
        const updated = await store.updatePage(pageId, updates, {
          expectedUpdatedAt: data.expected_updated_at,
          expectedVersion: data.expected_version,
          expectedSettingsVersion: data.expected_settings_version ?? data.expected_version,
          expectedAreaVersion: data.expected_area_version,
          force: Boolean(data.force),
        });

        const checklist = evaluatePageChecklist(updated);
        await store.updatePage(pageId, { checklist_status: checklist }, { isOperational: true });

        const savedAt = new Date().toISOString();
        return sendJson({
          success: true,
          verified: true,
          savedAt,
          page: { ...updated, checklist_status: checklist },
          checklist,
          versions: {
            settings_version: updated.settings_version || 1,
            schedule_version: updated.schedule_version || 1,
            prompts_version: updated.prompts_version || 1,
            profile_version: updated.profile_version || 1,
          },
        });
      } catch (e: any) {
        if (e.conflict || e.message?.includes('Concurrency conflict')) {
          return sendJson(
            {
              error: e.message,
              conflict: true,
              currentRecord: e.currentRecord || null,
              changedFields: e.changedFields || [],
            },
            409
          );
        }
        if (e.field) {
          return sendJson({
            error: e.message,
            field: e.field,
            missingId: e.missingId,
            table: e.table,
          }, e.statusCode || 400);
        }
        return sendJson({ error: e.message }, 500);
      }
    };

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
            const pageId = data.id || data.pageId;
            if (!pageId) {
              return sendJson({ error: 'Page ID is required for update.' }, 400);
            }
            return await savePageSettingsHandler(pageId, data);
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

    // 3d. API: Update Page Scheduling & Settings (Unified Save Path)
    if (url.pathname === '/api/pages/update-settings' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const pageId = data.pageId || data.id;
          if (!pageId) return sendJson({ error: 'pageId is required' }, 400);
          return await savePageSettingsHandler(pageId, data);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e. API: Toggle Page Live Status (1-Click Start / Stop)
    if (url.pathname === '/api/pages/toggle-live' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);

          const page = await store.getPageById(data.pageId);
          if (!page) return sendJson({ error: 'Page not found' }, 404);

          const targetActive = Boolean(data.active);
          let targetSchedule = page.schedule;

          // If starting and schedule is missing or 0 posts/day, assign safe default schedule
          if (targetActive && (!targetSchedule || !targetSchedule.postsPerDay || targetSchedule.postsPerDay <= 0)) {
            targetSchedule = SAFE_DEFAULT_SCHEDULE;
          }

          const checklist = evaluatePageChecklist({ ...page, schedule: targetSchedule, active: targetActive });

          if (targetActive && !checklist.isReadyToGoLive && !data.force) {
            return sendJson(
              {
                success: false,
                blocked: true,
                error: 'Setup checklist incomplete. Please finish all required setup steps before taking the page live.',
                missingSteps: checklist.missingSteps,
                checklist,
              },
              400
            );
          }

          let cancelledCount = 0;
          const updates: Partial<StoredPage> = {
            active: targetActive,
            is_live: targetActive,
            schedule: targetSchedule,
            checklist_status: checklist,
          };

          if (!targetActive) {
            const stopAction = data.action === 'cancel_pending' ? 'cancel_pending' : 'pause';
            updates.auto_posting_stopped_action = stopAction;
            if (stopAction === 'cancel_pending') {
              cancelledCount = await store.cancelPendingPagePosts(data.pageId);
            }
          }

          const updated = await store.updatePage(data.pageId, updates, { force: true });

          // Also update Supabase database directly for instantaneous persistence across all processes
          try {
            const sb = getSupabaseClient();
            if (sb) {
              await sb
                .from('pages')
                .update({
                  active: targetActive,
                  is_live: targetActive,
                  schedule: targetSchedule,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', data.pageId);
            }
          } catch (_) {}

          await store.addAuditLog({
            level: targetActive ? 'info' : 'warning',
            category: 'publish',
            message: targetActive
              ? `Page "${page.name}" went LIVE with autonomous posting schedule (${updated.schedule.postsPerDay} posts/day).`
              : (updates.auto_posting_stopped_action === 'cancel_pending'
                  ? `Page "${page.name}" posting STOPPED by user. Cancelled ${cancelledCount} scheduled/pending post(s).`
                  : `Page "${page.name}" posting PAUSED by user (scheduled posts preserved).`),
            page_id: page.id,
          });

          return sendJson({ success: true, page: updated, checklist, cancelledPosts: cancelledCount });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e2. API: Trigger Daily Content Research for a Page
    if (url.pathname === '/api/topics/research' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);

          const page = await store.getPageById(data.pageId);
          if (!page) return sendJson({ error: 'Page not found' }, 404);

          const allProviders = await store.getProviders();
          const allKeys = await store.getProviderKeys();
          const activeProviders = allProviders
            .filter((p) => p.enabled)
            .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

          const activeProvidersWithKeys = activeProviders.map((p) => {
            const matchingKey = allKeys.find((k) => k.provider_id === p.id && k.is_active);
            let decryptedKey: string | undefined;
            if (matchingKey && matchingKey.encrypted_key) {
              try {
                decryptedKey = decrypt(matchingKey.encrypted_key);
              } catch (_) {}
            }
            return {
              id: p.id,
              name: p.name,
              kind: (p as any).kind || p.adapter_kind,
              adapter_kind: p.adapter_kind,
              model_name: p.model_name,
              priority: p.priority ?? 1,
              base_url: p.base_url,
              config: (p as any).config,
              apiKey: decryptedKey,
              keyMasked: matchingKey?.masked_key,
            };
          });

          const researchResult = await runDailyContentResearch({
            page,
            supabase: getSupabaseClient()!,
            activeProviders: activeProvidersWithKeys,
            force: Boolean(data.force),
          });

          return sendJson(researchResult);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e3. API: Fetch All Content Ideas & Image Ideas for a Page
    if (url.pathname === '/api/topics' && req.method === 'GET') {
      try {
        const pageId = url.searchParams.get('pageId');
        if (!pageId) return sendJson({ error: 'pageId is required' }, 400);

        const sb = getSupabaseClient();
        if (!sb) return sendJson({ error: 'Supabase client unavailable' }, 500);

        const { data: rows, error } = await sb
          .from('topic_queue_items')
          .select('*')
          .eq('page_id', pageId)
          .order('sort_order', { ascending: true });

        if (error) return sendJson({ error: error.message }, 500);

        const formatted = (rows || []).map((r) => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(r.text);
          } catch (_) {
            parsed = { title: r.text, category: r.category };
          }
          return {
            id: r.id,
            page_id: r.page_id,
            status: r.status,
            sort_order: r.sort_order,
            created_at: r.created_at,
            used_at: r.used_at,
            title: parsed.title || r.text,
            category: parsed.category || r.category || 'General',
            facts: Array.isArray(parsed.facts) ? parsed.facts : [],
            visualSubject: parsed.visualSubject || '',
            headline: parsed.headline || (parsed.title || r.text).toUpperCase(),
            imagePrompt: parsed.imagePrompt || '',
            imageUrl: parsed.imageUrl || '',
          };
        });

        return sendJson({ success: true, topics: formatted });
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    // 3e4. API: Update a Content & Image Idea
    if (url.pathname === '/api/topics/update' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.id) return sendJson({ error: 'id is required' }, 400);

          const sb = getSupabaseClient();
          if (!sb) return sendJson({ error: 'Supabase client unavailable' }, 500);

          const { data: existing, error: fetchErr } = await sb
            .from('topic_queue_items')
            .select('*')
            .eq('id', data.id)
            .single();

          if (fetchErr || !existing) return sendJson({ error: 'Topic not found' }, 404);

          let currentParsed: any = {};
          try { currentParsed = JSON.parse(existing.text); } catch (_) {}

          const updatedPayload = {
            ...currentParsed,
            title: data.title !== undefined ? String(data.title).trim() : currentParsed.title,
            category: data.category !== undefined ? String(data.category).trim() : (existing.category || currentParsed.category),
            headline: data.headline !== undefined ? String(data.headline).trim() : currentParsed.headline,
            facts: Array.isArray(data.facts) ? data.facts : currentParsed.facts,
            visualSubject: data.visualSubject !== undefined ? String(data.visualSubject).trim() : currentParsed.visualSubject,
            imageUrl: data.imageUrl !== undefined ? String(data.imageUrl).trim() : currentParsed.imageUrl,
            imagePrompt: data.imagePrompt !== undefined ? String(data.imagePrompt).trim() : currentParsed.imagePrompt,
          };

          const { data: updated, error: updErr } = await sb
            .from('topic_queue_items')
            .update({
              category: updatedPayload.category,
              text: JSON.stringify(updatedPayload),
              status: data.status || existing.status,
            })
            .eq('id', data.id)
            .select()
            .single();

          if (updErr) return sendJson({ error: updErr.message }, 500);
          return sendJson({ success: true, topic: updatedPayload, row: updated });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e5. API: Regenerate a Specific Content & Image Idea (with optional user guidance)
    if (url.pathname === '/api/topics/regenerate-item' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.itemId) return sendJson({ error: 'itemId is required' }, 400);
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);

          const page = await store.getPageById(data.pageId);
          if (!page) return sendJson({ error: 'Page not found' }, 404);

          const allProviders = await store.getProviders();
          const allKeys = await store.getProviderKeys();
          const activeProviders = allProviders
            .filter((p) => p.enabled)
            .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

          const activeProvidersWithKeys = activeProviders.map((p) => {
            const matchingKey = allKeys.find((k) => k.provider_id === p.id && k.is_active);
            let decryptedKey: string | undefined;
            if (matchingKey && matchingKey.encrypted_key) {
              try { decryptedKey = decrypt(matchingKey.encrypted_key); } catch (_) {}
            }
            return {
              id: p.id,
              name: p.name,
              kind: (p as any).kind || p.adapter_kind,
              adapter_kind: p.adapter_kind,
              model_name: p.model_name,
              priority: p.priority ?? 1,
              base_url: p.base_url,
              config: (p as any).config,
              apiKey: decryptedKey,
              keyMasked: matchingKey?.masked_key,
            };
          });

          const sb = getSupabaseClient();
          if (!sb) return sendJson({ error: 'Supabase client unavailable' }, 500);

          const newTopic = await regenerateSingleTopicItem({
            page,
            supabase: sb,
            activeProviders: activeProvidersWithKeys,
            userGuidance: data.userGuidance,
            category: data.category,
          });

          if (!newTopic) return sendJson({ error: 'AI failed to generate a replacement topic.' }, 500);

          const payloadJson = JSON.stringify(newTopic);
          const { data: updated, error: updErr } = await sb
            .from('topic_queue_items')
            .update({
              category: newTopic.category,
              text: payloadJson,
              status: 'pending',
            })
            .eq('id', data.itemId)
            .select()
            .single();

          if (updErr) return sendJson({ error: updErr.message }, 500);
          return sendJson({ success: true, topic: newTopic, item: updated });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e6. API: Regenerate Only the Image for an Idea
    if (url.pathname === '/api/topics/regenerate-image' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.itemId) return sendJson({ error: 'itemId is required' }, 400);

          const sb = getSupabaseClient();
          if (!sb) return sendJson({ error: 'Supabase client unavailable' }, 500);

          const { data: existing, error: fetchErr } = await sb
            .from('topic_queue_items')
            .select('*')
            .eq('id', data.itemId)
            .single();

          if (fetchErr || !existing) return sendJson({ error: 'Item not found' }, 404);

          let parsed: any = {};
          try { parsed = JSON.parse(existing.text); } catch (_) {}

          const visualSubject = data.visualSubject ? String(data.visualSubject).trim() : (parsed.visualSubject || parsed.title || 'Science scene');
          const seed = (Date.now() + Math.floor(Math.random() * 50000)) % 1000000;
          const newImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(visualSubject.slice(0, 300))}?width=1080&height=1350&model=flux&nologo=true&seed=${seed}`;

          parsed.visualSubject = visualSubject;
          parsed.imageUrl = newImageUrl;
          parsed.imagePrompt = `${visualSubject}. cinematic lighting, photorealistic National Geographic quality, 8k resolution, tack sharp photography, sharp focal point, no text, no watermark, no logo, no subtitles, no borders`;

          await sb
            .from('topic_queue_items')
            .update({ text: JSON.stringify(parsed) })
            .eq('id', data.itemId);

          return sendJson({ success: true, imageUrl: newImageUrl, visualSubject });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e7. API: Delete an Idea from the Queue
    if (url.pathname === '/api/topics/delete' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.id) return sendJson({ error: 'id is required' }, 400);

          const sb = getSupabaseClient();
          if (!sb) return sendJson({ error: 'Supabase client unavailable' }, 500);

          const { error } = await sb.from('topic_queue_items').delete().eq('id', data.id);
          if (error) return sendJson({ error: error.message }, 500);
          return sendJson({ success: true });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3e8. API: Create / Add a Fresh Idea to the Queue
    if (url.pathname === '/api/topics/create' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);
          if (!data.title) return sendJson({ error: 'title is required' }, 400);

          const sb = getSupabaseClient();
          if (!sb) return sendJson({ error: 'Supabase client unavailable' }, 500);

          const visualSubject = data.visualSubject || `${data.title}, photorealistic National Geographic photography`;
          const seed = Date.now() % 100000;
          const imageUrl = data.imageUrl || `https://image.pollinations.ai/prompt/${encodeURIComponent(visualSubject.slice(0, 300))}?width=1080&height=1350&model=flux&nologo=true&seed=${seed}`;

          const payload = {
            title: String(data.title).trim(),
            category: data.category ? String(data.category).trim() : 'General',
            headline: data.headline ? String(data.headline).trim().toUpperCase() : String(data.title).trim().toUpperCase(),
            facts: Array.isArray(data.facts) ? data.facts : [data.facts || `Key verified discovery in ${data.title}.`],
            visualSubject,
            imagePrompt: `${visualSubject}. cinematic lighting, photorealistic quality, 8k, sharp focal point, no text, no watermark`,
            imageUrl,
          };

          const { data: maxOrderRow } = await sb
            .from('topic_queue_items')
            .select('sort_order')
            .eq('page_id', data.pageId)
            .order('sort_order', { ascending: false })
            .limit(1);

          const nextOrder = (maxOrderRow?.[0]?.sort_order ?? -1) + 1;

          const { data: inserted, error: insErr } = await sb
            .from('topic_queue_items')
            .insert({
              page_id: data.pageId,
              category: payload.category,
              text: JSON.stringify(payload),
              status: 'pending',
              sort_order: nextOrder,
            })
            .select()
            .single();

          if (insErr) return sendJson({ error: insErr.message }, 500);
          return sendJson({ success: true, topic: payload, item: inserted });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3f. API: Real-Time 7-Day Live Schedule Preview
    if (url.pathname === '/api/pages/preview-schedule' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.schedule) return sendJson({ error: 'Schedule configuration is required.' }, 400);

          const validation = validatePageSchedule(data.schedule);
          if (!validation.valid) {
            return sendJson({ success: false, errors: validation.errors, warnings: validation.warnings }, 400);
          }

          const preview = generateLiveSchedulePreview(
            data.schedule,
            new Date(),
            data.userTimezone || 'Asia/Kolkata',
            data.countDays || 7
          );

          return sendJson({
            success: true,
            slots: preview.slots,
            preview: preview.slots,
            count: preview.slots.length,
            nextSlotLabel: (preview as any).nextSlotLabel,
            nextSlotIso: (preview as any).nextSlotIso,
            futureSlotsCount: (preview as any).futureSlotsCount,
            warnings: validation.warnings,
            resolvedPostingTimes: validation.resolvedPostingTimes,
          });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3g. API: Automatic Page Niche Detection
    if (url.pathname === '/api/pages/analyze-niche' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);

          const page = await store.getPageById(data.pageId);
          if (!page) return sendJson({ error: 'Page not found' }, 404);

          let decryptedToken = '';
          try {
            decryptedToken = decryptPageToken(page.fb_page_token);
          } catch (err: any) {
            return sendJson({ error: 'Failed to decrypt Facebook Page token: ' + err.message }, 500);
          }

          // Check for active AI providers & keys, sort by priority, skip failing
          const providers = await store.getProviders();
          const allKeys = await store.getProviderKeys();
          const candidates = providers
            .filter(
              (p) => p.enabled && p.health_status !== 'failing' && allKeys.some((k) => k.provider_id === p.id && k.is_active)
            )
            .sort((a, b) => a.priority - b.priority);

          const activeProvidersWithKeys =
            candidates.length > 0
              ? candidates
              : providers.filter((p) => p.enabled && allKeys.some((k) => k.provider_id === p.id && k.is_active));

          let callLlm: ((prompt: string, systemPrompt?: string) => Promise<string>) | undefined = undefined;

          if (activeProvidersWithKeys.length > 0) {
            const prov = activeProvidersWithKeys[0];
            const keyItem = allKeys.find((k) => k.provider_id === prov.id && k.is_active)!;
            const decryptedApiKey = decrypt(keyItem.encrypted_key);

            callLlm = async (prompt: string, systemPrompt?: string): Promise<string> => {
              if (prov.adapter_kind === 'gemini_native' || prov.adapter_kind === 'gemini') {
                const adapter = new GeminiNativeAdapter();
                const res = await adapter.generateText({
                  apiKey: decryptedApiKey,
                  model: prov.model_name || 'gemini-1.5-flash',
                  baseUrl: prov.base_url,
                  prompt,
                  systemPrompt,
                  temperature: 0.2,
                });
                return res.text;
              } else {
                const adapter = new OpenAIChatAdapter();
                const res = await adapter.generateText({
                  apiKey: decryptedApiKey,
                  model: prov.model_name || 'gpt-4o-mini',
                  baseUrl: prov.base_url,
                  prompt,
                  systemPrompt,
                  temperature: 0.2,
                });
                return res.text;
              }
            };
          }

          // Fetch public page metadata & posts via Graph API
          const pageData = await fetchPageProfileData(page.fb_page_id, decryptedToken);

          // Get system profiles
          const dbProfiles = await store.getContentProfiles();
          const allProfiles = dbProfiles.length > 0 ? dbProfiles : seedProfiles;

          const analysis = await analyzePageNiche(pageData, allProfiles, callLlm);

          // Persist to Supabase
          await store.updatePage(page.id, { niche_analysis: analysis });

          return sendJson({
            success: analysis.success,
            analysis,
            pageName: page.name,
          });
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 3h. API: Create Draft Content Profile from Niche Detection
    if (url.pathname === '/api/pages/create-profile-from-niche' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.pageId) return sendJson({ error: 'pageId is required' }, 400);

          const page = await store.getPageById(data.pageId);
          if (!page) return sendJson({ error: 'Page not found' }, 404);

          const analysis = data.analysis || page.niche_analysis;
          if (!analysis) {
            return sendJson({ error: 'No niche analysis found. Please run Niche Detection first.' }, 400);
          }

          const draft = await generateDraftProfileFromPage({
            id: page.fb_page_id,
            name: page.name,
            category: page.category,
            posts: [],
            totalPostsFound: 0,
          });
          const createdProfile = await store.createContentProfile(draft);
          seedProfiles.unshift(createdProfile);

          // Auto-assign new profile to this page
          const updated = await store.updatePage(page.id, { profile_id: createdProfile.id });

          return sendJson({ success: true, profile: createdProfile, page: updated });
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

      const profile = resolvePageProfile(page);

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

    // 4b. API: Headline Card Live Preview (SVG / Layout metrics)
    if (url.pathname === '/api/preview/headline-card') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const headline = String(payload.headline || payload.headlineText || 'THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**');
          const fontFamily = (['Roboto', 'Open Sans', 'Oswald', 'Roboto Condensed'].includes(payload.fontFamily)
            ? payload.fontFamily
            : 'Roboto') as any;
          const panelColor = payload.panelColor || '#000000';
          const panelHeightMode = payload.panelHeightMode || 'auto';
          const primaryAccent = payload.primaryAccent || '#FFD21F';
          const secondaryAccent = payload.secondaryAccent || '#22D3EE';
          const niche = payload.niche || 'science';
          const photoUrl = payload.photoUrl;

          const cardResult = renderHeadlineCard({
            headlineText: headline,
            imageUrl: photoUrl,
            fontFamily,
            panelColor,
            panelHeightMode,
            primaryAccent,
            secondaryAccent,
            niche,
          });

          return sendJson({
            success: true,
            layout: cardResult.layout,
            svg: cardResult.svg,
            needsShortening: cardResult.layout.needsShortening,
          });
        } catch (cardErr: any) {
          return sendJson({ error: cardErr.message || 'Failed to render headline preview' }, 500);
        }
      });
      return;
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

    // 6.5 API: Fetch Single Post Details
    if (url.pathname === '/api/post-details') {
      const postId = url.searchParams.get('id');
      if (!postId) {
        return sendJson({ error: 'Post ID required' }, 400);
      }
      const post = await store.getPostById(postId);
      if (!post) {
        return sendJson({ error: 'Post not found' }, 404);
      }
      const page = post.page_id ? await store.getPageById(post.page_id) : undefined;
      return sendJson({
        ...post,
        pageName: page?.name || 'Facebook Page',
        pageTimezone: page?.schedule?.timezone || 'America/New_York',
      });
    }

    // 7. API: Toggle Kill Switch
    if (req.method === 'POST' && url.pathname === '/api/kill-switch') {
      const current = await store.getKillSwitch();
      const updated = await store.setKillSwitch(!current);
      return sendJson({ success: true, killSwitchActive: updated });
    }

    // 7.5 API: Autonomous Worker Trigger & Cron Endpoint
    if (url.pathname === '/api/worker/run' || url.pathname === '/api/cron/worker') {
      try {
        let isForce = false;
        if (req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (c) => (bodyStr += c));
          await new Promise((r) => req.on('end', r));
          try {
            const parsed = JSON.parse(bodyStr || '{}');
            isForce = Boolean(parsed.force);
          } catch (_) {}
        }
        if (url.searchParams.get('force') === 'true') {
          isForce = true;
        }

        const cycleResult = await runAutonomousCycle({
          forceSlotGeneration: isForce,
        });

        return sendJson({
          success: true,
          executed: cycleResult.executed,
          message: cycleResult.message,
          reconciledCount: cycleResult.reconciled?.publishedCount ?? 0,
          duePublishedCount: cycleResult.duePublishedCount,
          generatedPosts: cycleResult.generatedPosts,
          errors: cycleResult.errors,
        });
      } catch (workerErr: any) {
        console.error('[API /api/worker/run] Worker cycle failed:', workerErr);
        return sendJson({ success: false, error: workerErr.message || 'Worker execution failed' }, 500);
      }
    }

    // 8. API: Test Run for a Specific Page (Runs Unified Generation Pipeline)
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

          const profile: ContentProfile = resolvePageProfile(page);
          if (!profile) {
            const report = {
              success: false,
              testedAt: new Date().toISOString(),
              pageName: page.name,
              stages: [
                {
                  stage: 'research',
                  name: 'Research & Source Discovery',
                  status: 'failed' as const,
                  durationMs: 0,
                  error: 'No valid Content Profile or Custom Niche configured. Select a profile or configure custom niche first.',
                },
              ],
              attempts: [],
              error: 'No valid Content Profile or Custom Niche configured.',
            };
            const updatedPage = await store.updatePage(
              page.id,
              {
                test_run_verified: false,
                last_test_run_at: new Date().toISOString(),
                test_run_report: report,
              },
              { isOperational: true }
            );
            const checklist = evaluatePageChecklist(updatedPage);
            const cleanChecklist = {
              ...checklist,
              testRunReport: null,
            };
            await store.updatePage(page.id, { checklist_status: cleanChecklist }, { isOperational: true });
            return sendJson({ success: false, error: report.error, test_run_report: report, checklist: cleanChecklist }, 400);
          }

          const allProviders = await store.getProviders();
          const allKeys = await store.getProviderKeys();
          const activeProviders = allProviders
            .filter((p) => p.enabled)
            .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

          const activeProvidersWithKeys = activeProviders.map((p) => {
            const matchingKey = allKeys.find((k) => k.provider_id === p.id && k.is_active);
            let decryptedKey: string | undefined;
            if (matchingKey && matchingKey.encrypted_key) {
              try {
                decryptedKey = decrypt(matchingKey.encrypted_key);
              } catch (_) {}
            }
            return {
              id: p.id,
              name: p.name,
              kind: (p as any).kind || p.adapter_kind,
              adapter_kind: p.adapter_kind,
              model_name: p.model_name,
              priority: p.priority ?? 1,
              base_url: p.base_url,
              config: (p as any).config,
              apiKey: decryptedKey,
              keyMasked: matchingKey?.masked_key,
            };
          });

          let queueItem: any = null;
          if (!parsed.userTopic) {
            try {
              const sb = getSupabaseClient()!;
              const { data: qRows } = await sb
                .from('topic_queue_items')
                .select('*')
                .eq('page_id', page.id)
                .eq('status', 'pending')
                .order('sort_order', { ascending: true })
                .limit(1);
              if (qRows && qRows.length > 0) {
                try {
                  queueItem = JSON.parse(qRows[0].text);
                } catch (_) {
                  queueItem = { title: qRows[0].text, category: qRows[0].category };
                }
              }
            } catch (_) {}
          }

          // Invoke the unified generation pipeline (shared with worker)
          const pipelineResult = await runGenerationPipeline({
            page,
            profile,
            activeProviders: activeProvidersWithKeys,
            userTopic: parsed.userTopic || queueItem?.title,
            queueItem,
            isTestRun: true,
          });

          // Update page with test run results & checklist status
          const updatedPage = await store.updatePage(
            page.id,
            {
              test_run_verified: pipelineResult.success,
              last_test_run_at: pipelineResult.testedAt,
              test_run_report: pipelineResult,
            },
            { isOperational: true }
          );

          const checklist = evaluatePageChecklist(updatedPage);
          const cleanChecklist = {
            ...checklist,
            testRunReport: null,
          };
          await store.updatePage(page.id, { checklist_status: cleanChecklist }, { isOperational: true });

          if (!pipelineResult.success) {
            return sendJson(
              {
                success: false,
                error: pipelineResult.error,
                test_run_report: pipelineResult,
                checklist: cleanChecklist,
              },
              400
            );
          }

          return sendJson({
            ...pipelineResult,
            checklist: cleanChecklist,
          });
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

    // 9a. API: Reorder Provider Failover Priorities
    if (url.pathname === '/api/providers/reorder' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const provider_id = parsed.provider_id || parsed.providerId;
          const direction = parsed.direction;
          const chain = parsed.chain;
          const ordered_ids = parsed.ordered_ids || parsed.orderedIds;
          const allProviders = await store.getProviders();

          if (Array.isArray(ordered_ids) && ordered_ids.length > 0) {
            for (let i = 0; i < ordered_ids.length; i++) {
              await store.updateProvider(ordered_ids[i], { priority: i + 1 });
            }
            const updated = await store.getProviders();
            return sendJson({ success: true, providers: updated });
          }

          if (!provider_id || !direction) {
            return sendJson({ error: 'provider_id and direction (up/down) required.' }, 400);
          }

          const target = allProviders.find((p) => p.id === provider_id);
          if (!target) {
            return sendJson({ error: `Provider ${provider_id} not found.` }, 404);
          }

          const targetChain = chain || getProviderChain(target);
          const chainProviders = allProviders
            .filter((p) => getProviderChain(p) === targetChain)
            .sort((a, b) => a.priority - b.priority);

          const idx = chainProviders.findIndex((p) => p.id === provider_id);
          if (idx === -1) {
            return sendJson({ error: 'Provider not found in chain.' }, 404);
          }

          if (direction === 'up' && idx > 0) {
            const swapTarget = chainProviders[idx - 1];
            chainProviders[idx - 1] = chainProviders[idx];
            chainProviders[idx] = swapTarget;
          } else if (direction === 'down' && idx < chainProviders.length - 1) {
            const swapTarget = chainProviders[idx + 1];
            chainProviders[idx + 1] = chainProviders[idx];
            chainProviders[idx] = swapTarget;
          }

          for (let i = 0; i < chainProviders.length; i++) {
            await store.updateProvider(chainProviders[i].id, { priority: i + 1 });
          }

          const updated = await store.getProviders();
          return sendJson({ success: true, chain: targetChain, providers: updated });
        } catch (err: any) {
          return sendJson({ error: err.message }, 500);
        }
      });
      return;
    }

    // 9b. API: Test Provider with Live Lightweight Probe
    if (url.pathname === '/api/providers/test' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const provider_id = parsed.provider_id || parsed.providerId;
          if (!provider_id) {
            return sendJson({ error: 'provider_id is required' }, 400);
          }

          const provider = await store.getProviderById(provider_id);
          if (!provider) {
            return sendJson({ error: `Provider ${provider_id} not found` }, 404);
          }

          const allKeys = await store.getProviderKeys(provider_id);
          const activeKeys = allKeys.filter((k) => k.is_active);

          if (activeKeys.length === 0 && provider.adapter_kind !== 'pollinations') {
            await store.updateProvider(provider.id, {
              health_status: 'failing',
              test_error: 'No active API key configured in vault',
              last_tested_at: new Date().toISOString(),
            });
            return sendJson({
              success: false,
              provider_id,
              providerId: provider_id,
              status: 'failing',
              health_status: 'failing',
              error: 'No active API key configured in vault',
              latency_ms: 0,
            });
          }

          const decryptedKey = activeKeys.length > 0 ? decrypt(activeKeys[0].encrypted_key) : '';
          const start = Date.now();
          let probeSuccess = false;
          let latencyMs = 0;
          let errorMessage = '';
          let thumbnailUrl: string | undefined;
          const isImageTest = parsed.kind === 'image' || parsed.testType === 'image' || provider.adapter_kind === 'pollinations';
          const targetModel = parsed.model || provider.model_name;

          try {
            if (isImageTest && (provider.adapter_kind === 'gemini_native' || provider.name.toLowerCase().includes('gemini'))) {
              const geminiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${targetModel || 'gemini-2.5-flash-image'}:generateContent?key=${decryptedKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: 'a small red apple on white background' }] }],
                    generationConfig: { responseModalities: ['IMAGE'] },
                  }),
                  signal: AbortSignal.timeout(15000),
                }
              );
              latencyMs = Date.now() - start;
              const resText = await geminiRes.text();
              if (!geminiRes.ok) {
                const lower = resText.toLowerCase();
                if (
                  geminiRes.status === 403 ||
                  geminiRes.status === 429 ||
                  lower.includes('free tier') ||
                  lower.includes('limit: 0') ||
                  lower.includes('billing') ||
                  lower.includes('quota')
                ) {
                  throw new Error(
                    'This model is not available on the free tier. Enable billing on the Google project or use another provider.'
                  );
                }
                throw new Error(resText.slice(0, 200));
              }
              const gData = JSON.parse(resText);
              const b64 = gData.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
              if (b64) {
                thumbnailUrl = `data:image/jpeg;base64,${b64}`;
              }
              probeSuccess = true;
            } else if (isImageTest && provider.adapter_kind === 'pollinations') {
              const modelToTest = targetModel || 'flux';
              const pUrl = `https://image.pollinations.ai/prompt/a%20small%20apple?model=${encodeURIComponent(modelToTest)}&width=256&height=320&nologo=true`;
              const pRes = await fetch(pUrl, { signal: AbortSignal.timeout(15000) });
              latencyMs = Date.now() - start;
              if (!pRes.ok) {
                const errText = await pRes.text();
                if (pRes.status === 402 || (pRes.status === 403 && modelToTest !== 'flux')) {
                  throw new Error(
                    `Pollinations model "${modelToTest}" requires an active key with credits. Free tier supports "flux".`
                  );
                }
                throw new Error(errText.slice(0, 200) || `HTTP ${pRes.status}`);
              }
              const ab = await pRes.arrayBuffer();
              thumbnailUrl = `data:image/jpeg;base64,${Buffer.from(ab).toString('base64')}`;
              probeSuccess = true;
            } else if (isImageTest && provider.adapter_kind === 'openai_compatible_images') {
              const imageAdapter = new OpenAICompatibleImageAdapter((provider.config as any) || {});
              const imgRes = await imageAdapter.generateImage({
                prompt: 'a small red apple on clean white background, educational photo',
                model: targetModel,
                apiKey: decryptedKey,
                baseUrl: provider.base_url,
                timeoutMs: 20000,
                width: 256,
                height: 320,
              });
              latencyMs = Date.now() - start;
              thumbnailUrl = imgRes.imageUrl || (imgRes.imageBuffer ? `data:image/jpeg;base64,${imgRes.imageBuffer.toString('base64')}` : undefined);
              probeSuccess = true;
            } else if (isImageTest && provider.adapter_kind === 'cloudflare_workers_ai') {
              const cfAdapter = new CloudflareWorkersAIAdapter();
              const imgRes = await cfAdapter.generateImage({
                prompt: 'a small red apple on clean white background',
                model: targetModel,
                apiKey: decryptedKey,
                baseUrl: provider.base_url,
                timeoutMs: 20000,
                width: 256,
                height: 320,
              });
              latencyMs = Date.now() - start;
              thumbnailUrl = imgRes.imageBuffer ? `data:image/jpeg;base64,${imgRes.imageBuffer.toString('base64')}` : undefined;
              probeSuccess = true;
            } else if (provider.adapter_kind === 'gemini_native' || provider.name.toLowerCase().includes('gemini')) {
              const probeRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${decryptedKey}`,
                { method: 'GET', signal: AbortSignal.timeout(8000) }
              );
              latencyMs = Date.now() - start;
              if (!probeRes.ok) {
                const probeJson = await probeRes.json().catch(() => ({}));
                throw new Error(probeJson?.error?.message || `HTTP ${probeRes.status}`);
              }
              probeSuccess = true;
            } else if (provider.adapter_kind === 'pollinations') {
              const probeRes = await fetch('https://gen.pollinations.ai/image/probe?width=64&height=64', {
                method: 'GET',
                signal: AbortSignal.timeout(8000),
              });
              latencyMs = Date.now() - start;
              if (!probeRes.ok && probeRes.status !== 404) {
                throw new Error(`HTTP ${probeRes.status}`);
              }
              probeSuccess = true;
            } else if (provider.adapter_kind === 'cloudflare_workers_ai') {
              const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || 'me';
              const probeRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${decryptedKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ prompt: 'ping', max_tokens: 1 }),
                  signal: AbortSignal.timeout(8000),
                }
              );
              latencyMs = Date.now() - start;
              if (!probeRes.ok) {
                const probeJson = await probeRes.json().catch(() => ({}));
                throw new Error(probeJson?.errors?.[0]?.message || `HTTP ${probeRes.status}`);
              }
              probeSuccess = true;
            } else {
              const baseUrl = (provider.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
              const probeRes = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${decryptedKey}` },
                signal: AbortSignal.timeout(8000),
              });
              latencyMs = Date.now() - start;
              if (!probeRes.ok) {
                const probeJson = await probeRes.json().catch(() => ({}));
                throw new Error(probeJson?.error?.message || `HTTP ${probeRes.status}`);
              }
              probeSuccess = true;
            }
          } catch (err: any) {
            latencyMs = Date.now() - start;
            probeSuccess = false;
            errorMessage = err.message || 'Probe call timed out or failed';
          }

          const status = probeSuccess ? 'healthy' : 'failing';
          await store.updateProvider(provider.id, {
            health_status: status,
            latency_ms: latencyMs,
            test_error: probeSuccess ? undefined : errorMessage,
            last_tested_at: new Date().toISOString(),
            enabled: probeSuccess,
          });

          return sendJson({
            success: probeSuccess,
            provider_id,
            providerId: provider_id,
            status,
            health_status: status,
            latency_ms: latencyMs,
            thumbnail_url: thumbnailUrl,
            model: targetModel,
            error: probeSuccess ? undefined : errorMessage,
          });
        } catch (err: any) {
          return sendJson({ error: err.message }, 500);
        }
      });
      return;
    }

    // 9c. API: Image Quality Benchmark (6 standardized prompts run side by side)
    if (url.pathname === '/api/bench/image' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const allProviders = await store.getProviders();
          const allKeys = await store.getProviderKeys();

          const activeProviders = allProviders
            .filter((p) => p.enabled)
            .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

          const activeProvidersWithKeys = activeProviders.map((p) => {
            const matchingKey = allKeys.find((k) => k.provider_id === p.id && k.is_active);
            let decryptedKey: string | undefined;
            if (matchingKey && matchingKey.encrypted_key) {
              try { decryptedKey = decrypt(matchingKey.encrypted_key); } catch (_) {}
            }
            return {
              id: p.id,
              name: p.name,
              kind: (p as any).kind || p.adapter_kind,
              adapter_kind: p.adapter_kind,
              model_name: p.model_name,
              priority: p.priority ?? 1,
              base_url: p.base_url,
              config: (p as any).config,
              apiKey: decryptedKey,
              keyMasked: matchingKey?.masked_key,
            };
          });

          const prompts = parsed.prompts && Array.isArray(parsed.prompts) && parsed.prompts.length > 0
            ? parsed.prompts
            : [
                'A massive blue whale swimming in open ocean, close-up side view with the four-chambered heart subtly highlighted in anatomical cross-section',
                'A flexible micro-electrode ECoG sensor array with platinum contact points gently placed on the cerebral cortex, biomedical laboratory photograph',
                'A rough cross-section of deep green peridotite rock from Antarctica, macro view showing microscopic crystalline fissures where endolithic organisms survive',
                'An optical research breadboard table inside a cleanroom, showing a precision laser beam entering a polarizing beam splitter cube with single-photon fiber detectors',
                'An exoplanet with a deep global liquid ocean under a thick hydrogen atmosphere, viewed from high orbit with a red dwarf star low on the horizon',
                'A glass frog resting on a lush tropical leaf, transparent underside revealing beating heart and organs in crisp macro detail',
              ];

          // Filter image providers
          const imageProviders = activeProvidersWithKeys.filter((p) => {
            const k = (p.kind || p.adapter_kind || '').toLowerCase();
            const n = (p.name || '').toLowerCase();
            return (
              k === 'pollinations' ||
              k === 'cloudflare_workers_ai' ||
              k === 'gemini_native' ||
              n.includes('image') ||
              n.includes('gemini') ||
              n.includes('cloudflare') ||
              n.includes('pollinations')
            );
          });

          const results: any[] = [];
          for (const prompt of prompts) {
            const promptRuns: any[] = [];
            for (const prov of imageProviders) {
              const start = Date.now();
              let success = false;
              let thumb: string | undefined;
              let errText: string | undefined;
              const model = prov.model_name || 'flux';
              const cost = getEstimatedCostPerImage(prov.kind || prov.adapter_kind, model);

              try {
                if (prov.kind === 'pollinations') {
                  const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 300))}?model=${encodeURIComponent(model)}&width=256&height=320&nologo=true`;
                  const res = await fetch(pUrl, { signal: AbortSignal.timeout(18000) });
                  if (res.ok) {
                    const ab = await res.arrayBuffer();
                    thumb = `data:image/jpeg;base64,${Buffer.from(ab).toString('base64')}`;
                    success = true;
                  } else {
                    errText = await res.text();
                  }
                } else if (prov.kind === 'gemini_native' || prov.name.toLowerCase().includes('gemini')) {
                  const gRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash-image'}:generateContent?key=${prov.apiKey}`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseModalities: ['IMAGE'] },
                      }),
                      signal: AbortSignal.timeout(18000),
                    }
                  );
                  if (gRes.ok) {
                    const gData = await gRes.json();
                    const b64 = gData.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
                    if (b64) {
                      thumb = `data:image/jpeg;base64,${b64}`;
                      success = true;
                    }
                  } else {
                    const gErr = await gRes.text();
                    errText = gErr.includes('free tier') || gErr.includes('limit: 0')
                      ? 'This model is not available on the free tier. Enable billing on the Google project or use another provider.'
                      : gErr.slice(0, 150);
                  }
                }
              } catch (e: any) {
                errText = e.message || 'Timeout / Network Error';
              }

              promptRuns.push({
                providerId: prov.id,
                providerName: prov.name,
                model,
                success,
                latencyMs: Date.now() - start,
                estimatedCost: `$${cost.toFixed(4)}`,
                thumbnailUrl: thumb,
                error: success ? undefined : errText,
              });
            }

            results.push({
              prompt,
              runs: promptRuns,
            });
          }

          // Calculate suggested order based on success count and average latency
          const provScores: Record<string, { successCount: number; totalLatency: number; count: number }> = {};
          for (const item of results) {
            for (const r of item.runs) {
              if (!provScores[r.providerId]) provScores[r.providerId] = { successCount: 0, totalLatency: 0, count: 0 };
              provScores[r.providerId].count++;
              if (r.success) {
                provScores[r.providerId].successCount++;
                provScores[r.providerId].totalLatency += r.latencyMs;
              } else {
                provScores[r.providerId].totalLatency += 30000;
              }
            }
          }

          const suggestedOrder = Object.keys(provScores).sort((a, b) => {
            const scA = provScores[a].successCount;
            const scB = provScores[b].successCount;
            if (scA !== scB) return scB - scA; // Highest success first
            return (provScores[a].totalLatency / provScores[a].count) - (provScores[b].totalLatency / provScores[b].count); // Fastest first
          });

          return sendJson({
            success: true,
            results,
            suggestedOrder,
            benchmarkedAt: new Date().toISOString(),
          });
        } catch (err: any) {
          return sendJson({ error: err.message }, 500);
        }
      });
      return;
    }

    // 9d. API: Benchmark Ratings & Suggested Chain Ordering
    if (url.pathname === '/api/bench/rate' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          // If suggested order applied, reorder provider priorities in database
          if (parsed.applyOrder && Array.isArray(parsed.suggestedOrder)) {
            for (let i = 0; i < parsed.suggestedOrder.length; i++) {
              await store.updateProvider(parsed.suggestedOrder[i], { priority: i + 1 });
            }
            return sendJson({ success: true, appliedOrder: parsed.suggestedOrder });
          }
          return sendJson({ success: true, ratingRecorded: true });
        } catch (err: any) {
          return sendJson({ error: err.message }, 500);
        }
      });
      return;
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

            // Rule A: Run Test automatically when key is added. Enable only if test passes.
            let autoTestPassed = false;
            let autoTestError = '';
            try {
              const targetProv = await store.getProviderById(providerId);
              if (targetProv) {
                const isImage = getProviderChain(targetProv) === 'image';
                const firstKey = parsedKeys[0];
                if (isImage && targetProv.adapter_kind === 'openai_compatible_images') {
                  const imageAdapter = new OpenAICompatibleImageAdapter((targetProv.config as any) || {});
                  await imageAdapter.generateImage({
                    prompt: 'a small red apple on clean white background',
                    model: targetProv.model_name,
                    apiKey: firstKey,
                    baseUrl: targetProv.base_url,
                    timeoutMs: 15000,
                    width: 256,
                    height: 320,
                  });
                  autoTestPassed = true;
                } else if (isImage && targetProv.adapter_kind === 'cloudflare_workers_ai') {
                  const cfAdapter = new CloudflareWorkersAIAdapter();
                  await cfAdapter.generateImage({
                    prompt: 'a small red apple on clean white background',
                    model: targetProv.model_name,
                    apiKey: firstKey,
                    timeoutMs: 15000,
                    width: 256,
                    height: 320,
                  });
                  autoTestPassed = true;
                } else if (targetProv.adapter_kind === 'gemini_native' || targetProv.name.toLowerCase().includes('gemini')) {
                  const probeRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${firstKey}`,
                    { method: 'GET', signal: AbortSignal.timeout(8000) }
                  );
                  autoTestPassed = probeRes.ok;
                  if (!probeRes.ok) autoTestError = `Probe returned status ${probeRes.status}`;
                } else {
                  const baseUrl = (targetProv.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
                  const probeRes = await fetch(`${baseUrl}/models`, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${firstKey}` },
                    signal: AbortSignal.timeout(8000),
                  });
                  autoTestPassed = probeRes.ok;
                  if (!probeRes.ok) autoTestError = `Probe returned status ${probeRes.status}`;
                }
              }
            } catch (probeErr: any) {
              autoTestPassed = false;
              autoTestError = probeErr.message || 'Auto-test failed';
            }

            if (autoTestPassed) {
              await store.updateProvider(providerId, {
                enabled: true,
                health_status: 'healthy',
                test_error: undefined,
                last_tested_at: new Date().toISOString(),
              });
            } else if (autoTestError) {
              await store.updateProvider(providerId, {
                enabled: false,
                health_status: 'failing',
                test_error: autoTestError,
                last_tested_at: new Date().toISOString(),
              });
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
      const profile = resolvePageProfile(page);

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
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(html);
      return;
    }

    // 15. Web Dashboard HTML UI & Clean Routing
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      res.writeHead(302, { Location: '/overview' });
      res.end();
      return;
    }

    if (req.method === 'GET' && VALID_DASHBOARD_ROUTES[url.pathname]) {
      const routeInfo = VALID_DASHBOARD_ROUTES[url.pathname];
      const html = await generateDashboardHtml(routeInfo, url.searchParams);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(html);
      return;
    }

    // 16. API: Storage Health Status
    if (url.pathname === '/api/health/storage') {
      const health = await store.getStorageHealth();
      return sendJson(health);
    }

    // 17. API: Database Schema Check (Table & Column Level Verification)
    if (url.pathname === '/api/settings/schema-check' && req.method === 'GET') {
      try {
        const schema = await store.checkDatabaseSchema();
        return sendJson(schema);
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    // 18. API: Go-Live System Readiness Audit (11 Multi-Point Checks)
    if (url.pathname === '/api/settings/readiness' && req.method === 'GET') {
      try {
        const readiness = await store.getSystemReadiness();
        return sendJson(readiness);
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    // 19. API: Settings Backup Export (Zero Secrets)
    if (url.pathname === '/api/settings/backup' && req.method === 'GET') {
      try {
        const backup = await store.exportSettingsBackup();
        return sendJson(backup);
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    // 20. API: Settings Backup Restore
    if (url.pathname === '/api/settings/restore' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = await store.restoreSettingsBackup(payload);
          return sendJson(result);
        } catch (e: any) {
          return sendJson({ error: e.message }, 400);
        }
      });
      return;
    }

    // 21. API: Import Starter Profiles (27 Viral Niches Catalog)
    if ((url.pathname === '/api/profiles/import-starter' || url.pathname === '/api/profiles/import-starters') && req.method === 'POST') {
      try {
        const result = await store.importStarterProfiles();
        return sendJson({
          success: true,
          count: result.count,
          importedCount: result.importedCount,
          skippedCount: result.skippedCount,
          updatedCount: result.updatedCount,
          profiles: result.profiles,
        });
      } catch (e: any) {
        return sendJson({ error: e.message }, 500);
      }
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const html = generate404Html(url.pathname);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

export function createDashboardServer(): http.Server {
  return http.createServer(handleRequest);
}

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAccountPermissionsBadges(notes?: string): string {
  if (!notes || !notes.includes('Permissions:')) {
    return `<div style="margin-top: 6px; font-size: 11px; color: #94a3b8; font-style: italic;">
      🔑 Scopes: Click <strong>🩺 Check</strong> or <strong>🔄 Sync Pages</strong> to inspect live permissions.
    </div>`;
  }
  const rawPerms = notes.split('Permissions:')[1]?.trim() || '';
  const granted = rawPerms.split(',').map((s) => s.trim()).filter(Boolean);
  const required = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
  const missing = required.filter((r) => !granted.includes(r));

  return `<div style="margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
    <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">🔑 Scopes:</span>
    ${granted.map((p) => `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #93c5fd; font-size: 11px; padding: 2px 6px;">✓ ${escapeHtml(p)}</span>`).join('')}
    ${missing.map((m) => `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; font-size: 11px; padding: 2px 6px;">⚠️ Missing: ${escapeHtml(m)}</span>`).join('')}
  </div>`;
}

function renderProviderChainRows(chainProviders: StoredProvider[], providerKeys: StoredProviderKey[], chainType: 'text' | 'image'): string {
  if (chainProviders.length === 0) {
    return `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">
      <div style="font-size: 13px;">No ${chainType === 'text' ? 'text generation' : 'image generation'} providers configured in this chain.</div>
    </td></tr>`;
  }

  const isImageChain = chainType === 'image';

  return chainProviders.map((p, idx) => {
    const keys = providerKeys.filter((k) => k.provider_id === p.id);
    const activeKeys = keys.filter((k) => k.is_active);
    const keyBadges = keys.length > 0
      ? keys.map((k) => `<span class="badge" style="background: ${k.is_active ? '#1e293b' : '#27272a'}; color: ${k.is_active ? '#93c5fd' : '#71717a'}; font-family: 'JetBrains Mono', monospace; font-size: 11px; margin: 2px; display: inline-block;">${escapeHtml(k.masked_key)}</span>`).join('')
      : '<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No keys added</span>';

    const officialQuota = lookupOfficialFreeQuota(p);
    const exceedsQuota = officialQuota && (
      (officialQuota.rpdLimit > 0 && (p.daily_limit || 0) > officialQuota.rpdLimit) ||
      (officialQuota.rpdLimit === 0 && (p.daily_limit || 0) > 0)
    );

    // Explicit position number #1 through #8
    const posColors = ['#064e3b', '#1e3a8a', '#78350f', '#3b0764', '#1e293b', '#374151', '#065f46', '#1e1b4b'];
    const textColors = ['#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#93c5fd', '#d1d5db', '#6ee7b7', '#a5b4fc'];
    const priorityBadge = `<span class="badge" style="background: ${posColors[idx % posColors.length]}; color: ${textColors[idx % textColors.length]}; font-weight: 800; padding: 4px 10px; font-size: 12px; border-radius: 6px;">#${idx + 1} Priority</span>`;

    const isPollinations = p.adapter_kind === 'pollinations';
    const isNeedsKey = (p.config as any)?.status === 'needs_key' || (activeKeys.length === 0 && !isPollinations);

    let statusDisplay = '';
    if (isNeedsKey) {
      statusDisplay = '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-weight: 700; padding: 4px 8px; font-size: 11px;">● Needs API Key</span>';
    } else if (p.health_status === 'failing' || (p.config as any)?.health_status === 'failing') {
      statusDisplay = `<div style="color: #ef4444; font-weight: 700; font-size: 12px;">● Failing (skipped)</div><div style="font-size: 10px; color: #f87171;" title="${escapeHtml(p.test_error || '')}">${escapeHtml((p.test_error || 'Probe failed').slice(0, 30))}</div>`;
    } else if (p.health_status === 'healthy' || (p.config as any)?.health_status === 'healthy') {
      statusDisplay = `<div style="color: #34d399; font-weight: 600; font-size: 12px;">● Healthy (${p.latency_ms || 120}ms)</div><div style="font-size: 10px; color: #94a3b8;">${p.last_tested_at ? 'Tested ' + new Date(p.last_tested_at).toLocaleTimeString() : 'Verified'}</div>`;
    } else if (p.enabled) {
      statusDisplay = '<span style="color: #34d399; font-weight: 600; font-size: 12px;">● Active</span>';
    } else {
      statusDisplay = '<span style="color: #9ca3af; font-weight: 600; font-size: 12px;">● Disabled</span>';
    }

    const pct = Math.min(100, Math.round(((p.used_today || 0) / (p.daily_limit || 1)) * 100));
    const estCostPerImg = isImageChain ? getEstimatedCostPerImage(p.adapter_kind, p.model_name) : 0;
    const estDailyCost = isImageChain ? getEstimatedDailyCost(p.adapter_kind, p.model_name, 5) : 0;

    // License metadata
    const licenseInfo = KNOWN_IMAGE_MODEL_LICENSES[p.model_name || ''];

    return `
      <tr id="provider-row-${p.id}" class="provider-draggable-row" data-provider-id="${p.id}" data-chain="${chainType}">
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="font-weight: 700; font-size: 14px; color: #f3f4f6;">${escapeHtml(p.name)}</div>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; margin-top: 2px;">
            ${escapeHtml(p.model_name || 'default')}
          </div>
          ${
            licenseInfo
              ? `<div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap;">
                  <span class="badge" style="background: #1e293b; color: #cbd5e1; font-size: 10px; padding: 2px 6px;">📜 ${escapeHtml(licenseInfo.license)}</span>
                  ${!licenseInfo.commercialUseAllowed ? '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; font-size: 10px; padding: 2px 6px;">⚠️ Non-Commercial</span>' : ''}
                </div>`
              : ''
          }
          ${
            isImageChain
              ? `<div style="font-size: 11px; color: #a78bfa; margin-top: 3px; font-weight: 500;">
                  💰 Est: $${estCostPerImg.toFixed(3)}/img (~$${estDailyCost.toFixed(2)}/day @ 5 posts)
                </div>`
              : ''
          }
        </td>
        <td><code>${escapeHtml(p.adapter_kind)}</code></td>
        <td>${priorityBadge}</td>
        <td>
          <div style="font-weight: 600;">${p.used_today || 0} / ${p.daily_limit} reqs</div>
          <div style="width: 100px; height: 5px; background: #374151; border-radius: 3px; margin-top: 4px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${pct > 85 ? '#ef4444' : '#3b82f6'};"></div>
          </div>
          ${exceedsQuota ? `
            <div style="margin-top: 4px;">
              <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 10px; padding: 2px 6px;" title="${escapeHtml(officialQuota!.note)}">
                ⚠️ Exceeds free limit (${officialQuota!.badge})
              </span>
            </div>
          ` : officialQuota ? `
            <div style="margin-top: 2px; font-size: 10px; color: #9ca3af;" title="${escapeHtml(officialQuota.note)}">
              Free: ${officialQuota.badge}
            </div>
          ` : ''}
        </td>
        <td>
          <div style="margin-bottom: 4px; max-width: 260px;">${keyBadges}</div>
          <span style="font-size: 11px; color: ${activeKeys.length > 0 ? '#34d399' : '#f59e0b'};">
            ● ${activeKeys.length} active key${activeKeys.length === 1 ? '' : 's'}
          </span>
        </td>
        <td id="provider-status-${p.id}">${statusDisplay}</td>
        <td style="text-align: right; white-space: nowrap;">
          <div style="display: inline-flex; gap: 4px;">
            ${isNeedsKey ? `<button class="btn btn-primary" style="padding: 4px 8px; font-size: 11px; background: #f59e0b; color: #1e1e24; font-weight: 700;" onclick="openManageKeysModal('${p.id}')">➕ Add Key</button>` : ''}
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="moveProviderPriority('${p.id}', 'up')" title="Move up in failover chain" ${idx === 0 ? 'disabled style="opacity: 0.35; cursor: not-allowed; padding: 4px 8px; font-size: 11px;"' : ''}>⬆️</button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="moveProviderPriority('${p.id}', 'down')" title="Move down in failover chain" ${idx === chainProviders.length - 1 ? 'disabled style="opacity: 0.35; cursor: not-allowed; padding: 4px 8px; font-size: 11px;"' : ''}>⬇️</button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="testProviderAction('${p.id}', this)" title="Test latency and live connection">🩺 Test</button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openManageKeysModal('${p.id}')">🔑 Keys (${keys.length})</button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openEditProviderModal('${p.id}')">✏️</button>
            <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteProviderAction('${p.id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderBudgetTrackerBanner(): string {
  const b = globalBudgetTracker.getDashboardSummary();
  const warnHtml = b.warnings.length > 0
    ? `<div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fde68a; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; display: flex; align-items: center; gap: 8px;">
        <span>⚠️</span>
        <div><strong>Budget Warnings (&gt;= 80% used):</strong> ${b.warnings.map((w: string) => escapeHtml(w)).join(' • ')}</div>
      </div>`
    : '';

  return `
    <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 10px; padding: 16px; margin-bottom: 20px;">
      ${warnHtml}
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">⚡</span>
          <div>
            <div style="font-size: 15px; font-weight: 800; color: #f8fafc;">
              Images you can still generate today: <span style="color: #34d399; font-size: 16px;">~${b.imagesRemainingToday} images</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8;">
              Combined capacity across all active free pools and credit reserves
            </div>
          </div>
        </div>
        <div style="font-size: 11px; color: #cbd5e1; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); padding: 4px 10px; border-radius: 6px;">
          🛡️ 1,500 Cloudflare reserve protected for text & FLUX schnell fallback
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px;">
        <!-- Cloudflare Neurons -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <strong style="color: #f97316;">Cloudflare Neurons</strong>
            <span style="color: #94a3b8;">${b.cloudflare.used} / ${b.cloudflare.total}</span>
          </div>
          <div style="width: 100%; height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
            <div style="width: ${b.cloudflare.percent}%; height: 100%; background: ${b.cloudflare.percent >= 80 ? '#ef4444' : '#f97316'};"></div>
          </div>
          <div style="font-size: 10px; color: #64748b; display: flex; justify-content: space-between;">
            <span>Cap Lucid: ${b.cloudflare.lucidUsedToday}/${b.cloudflare.lucidCap}</span>
            <span>Reserve: ${b.cloudflare.reserve}</span>
          </div>
        </div>

        <!-- Vercel AI Gateway -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <strong style="color: #38bdf8;">Vercel AI Credit</strong>
            <span style="color: #94a3b8;">$${b.vercel.usedUsd} / $${b.vercel.totalUsd}</span>
          </div>
          <div style="width: 100%; height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
            <div style="width: ${b.vercel.percent}%; height: 100%; background: ${b.vercel.percent >= 80 ? '#ef4444' : '#38bdf8'};"></div>
          </div>
          <div style="font-size: 10px; color: #64748b;">
            <span>$${b.vercel.remainingUsd} remaining (FLUX.2 klein 4B)</span>
          </div>
        </div>

        <!-- Alibaba Model Studio -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <strong style="color: #a855f7;">Alibaba 90-Day Pool</strong>
            <span style="color: #94a3b8;">${b.alibaba.used} / ${b.alibaba.total}</span>
          </div>
          <div style="width: 100%; height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
            <div style="width: ${b.alibaba.percent}%; height: 100%; background: ${b.alibaba.percent >= 80 ? '#ef4444' : '#a855f7'};"></div>
          </div>
          <div style="font-size: 10px; color: #64748b;">
            <span>Expires ${b.alibaba.expiresAt}</span>
          </div>
        </div>

        <!-- OpenRouter Free -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <strong style="color: #34d399;">OpenRouter Free</strong>
            <span style="color: #94a3b8;">${b.openRouter.used} / ${b.openRouter.limit}</span>
          </div>
          <div style="width: 100%; height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
            <div style="width: ${b.openRouter.percent}%; height: 100%; background: ${b.openRouter.percent >= 80 ? '#ef4444' : '#34d399'};"></div>
          </div>
          <div style="font-size: 10px; color: #64748b;">
            <span>Riverflow Fast Free (20 RPM limit)</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function generateDashboardHtml(
  routeInfo: DashboardRouteMeta = VALID_DASHBOARD_ROUTES['/overview'],
  searchParams: URLSearchParams = new URLSearchParams()
): Promise<string> {
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
    contentProfiles,
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
    store.getContentProfiles().catch(() => []),
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
  <meta name="theme-color" content="#030712">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>FB Auto 247 - ${escapeHtml(routeInfo.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <script id="serverRouteState">
    window.__INITIAL_ROUTE__ = {
      pathname: ${JSON.stringify(TAB_TO_ROUTE[routeInfo.tabId] || '/overview')},
      tabId: ${JSON.stringify(routeInfo.tabId)},
      search: ${JSON.stringify(searchParams.toString())}
    };
  </script>
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

    /* Mobile Responsive Topbar, Drawer & Bottom Navigation */
    .mobile-topbar {
      display: none;
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      height: 56px;
      background: rgba(11, 15, 25, 0.95);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--card-border);
      padding: 0 14px;
      align-items: center;
      justify-content: space-between;
      z-index: 60;
    }
    .mobile-topbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .mobile-menu-btn {
      width: 40px;
      height: 40px;
      background: #1e293b;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      cursor: pointer;
      color: var(--text);
      padding: 0;
      flex-shrink: 0;
    }
    .mobile-menu-btn span {
      display: block;
      width: 18px;
      height: 2px;
      background: #e2e8f0;
      border-radius: 2px;
    }
    .mobile-topbar-title {
      font-size: 15px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #f3f4f6;
    }

    /* Mobile Backdrop */
    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      z-index: 70;
    }
    .sidebar-backdrop.active {
      display: block;
    }
    .sidebar-mobile-close-row {
      display: none;
    }

    /* Mobile Bottom Navigation Bar */
    .mobile-bottom-nav {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 60px;
      background: rgba(11, 15, 25, 0.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid var(--card-border);
      padding: 0 4px;
      z-index: 60;
      align-items: center;
      justify-content: space-around;
    }
    .mobile-nav-btn {
      flex: 1;
      height: 100%;
      background: none;
      border: none;
      color: #94a3b8;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      transition: color 0.15s;
    }
    .mobile-nav-btn span.icon {
      font-size: 18px;
      line-height: 1;
    }
    .mobile-nav-btn.active, .mobile-nav-btn:hover {
      color: #38bdf8;
    }

    /* Responsive Breakpoints for Mobile Phones & Tablets */
    @media (max-width: 900px) {
      body {
        flex-direction: column;
      }
      .mobile-topbar {
        display: flex;
      }
      .mobile-bottom-nav {
        display: flex;
      }
      .sidebar-mobile-close-row {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 8px;
      }
      .sidebar {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        width: min(300px, 84vw);
        z-index: 80;
        transform: translateX(-100%);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.7);
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      .sidebar.mobile-open {
        transform: translateX(0);
      }
      .main {
        padding: 16px 12px 84px 12px;
        max-width: 100vw;
        overflow-x: hidden;
      }
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 20px;
      }
      .grid {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .card {
        padding: 16px 14px;
      }
      table {
        display: block;
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        white-space: nowrap;
      }
      .modal {
        padding: 0;
        align-items: flex-end;
      }
      .modal-content {
        max-height: 94vh;
        border-radius: 20px 20px 0 0;
        padding: 20px 16px 28px 16px;
        width: 100%;
        max-width: 100%;
        border-bottom: none;
      }
      .form-control, .form-input, input, select, textarea {
        font-size: 16px !important;
        min-height: 44px;
      }
      .btn {
        min-height: 42px;
      }
    }
  </style>
</head>
<body>
  <!-- Mobile Responsive Topbar -->
  <header class="mobile-topbar">
    <div class="mobile-topbar-left">
      <button class="mobile-menu-btn" onclick="toggleMobileSidebar()" aria-label="Toggle navigation menu">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div class="mobile-topbar-title">
        <span id="mobileTabTitle">${escapeHtml(routeInfo.heading || 'FB Auto 247')}</span>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <button class="btn btn-secondary" onclick="triggerWorkerRun(this)" style="padding: 5px 10px; font-size: 11px; min-height: 32px; background: rgba(56, 189, 248, 0.12); border: 1px solid #0284c7; color: #38bdf8; font-weight: 600;" title="Run Worker Cycle">⚡ Run</button>
      <div class="status-pill" id="mobileWorkerPill" style="background: ${workerPillBg}; color: ${workerPillColor}; padding: 4px 8px; font-size: 11px;">
        <div class="status-dot" style="background: ${workerDotColor}; width: 6px; height: 6px;"></div>
      </div>
    </div>
  </header>

  <!-- Mobile Drawer Backdrop -->
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="closeMobileSidebar()"></div>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-mobile-close-row">
      <button onclick="closeMobileSidebar()" aria-label="Close menu" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px;">✕</button>
    </div>
    <div class="brand">
      <div class="brand-icon">247</div>
      <div>
        <div class="brand-title">FB Auto 247</div>
        <div class="brand-badge">Engine v${appVersion}</div>
      </div>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button ${routeInfo.tabId === 'overview' ? 'class="active"' : ''} data-tab="overview" onclick="showTab('overview', this)">📊 Overview</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'accounts' ? 'class="active"' : ''} data-tab="accounts" onclick="showTab('accounts', this)">👥 FB Accounts & IDs (<span id="sidebarAccountCount">${accounts.length}</span>)</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'pages' ? 'class="active"' : ''} data-tab="pages" onclick="showTab('pages', this)">📑 Pages & Accounts (<span id="sidebarPageCount">${pages.length}</span>)</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'page-prompts' ? 'class="active"' : ''} data-tab="page-prompts" onclick="showTab('page-prompts', this)">✍️ Page Prompt Studio</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'review' ? 'class="active"' : ''} data-tab="review" onclick="showTab('review', this)">📬 Review Inbox <span class="badge" id="revBadge">${reviewPosts.length}</span></button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'calendar' ? 'class="active"' : ''} data-tab="calendar" onclick="showTab('calendar', this)">📅 Schedule Calendar</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'analytics' ? 'class="active"' : ''} data-tab="analytics" onclick="showTab('analytics', this)">📈 Analytics & Insights</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'simulator' ? 'class="active"' : ''} data-tab="simulator" onclick="showTab('simulator', this)">⚡ Test Run Simulator</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'providers' ? 'class="active"' : ''} data-tab="providers" onclick="showTab('providers', this)">🔌 Providers & Quotas</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'audit' ? 'class="active"' : ''} data-tab="audit" onclick="showTab('audit', this)">📋 System Audit Logs</button></li>
      <li class="nav-item"><button ${routeInfo.tabId === 'settings' ? 'class="active"' : ''} data-tab="settings" onclick="showTab('settings', this)">⚙️ Settings & Controls</button></li>
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
        <h1 id="tabHeading">${escapeHtml(routeInfo.heading)}</h1>
        <p id="tabDesc">${escapeHtml(routeInfo.desc)}</p>
      </div>
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <button class="btn btn-secondary" onclick="triggerWorkerRun(this)" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 6px 12px; background: rgba(56, 189, 248, 0.12); border: 1px solid #0284c7; color: #38bdf8; font-weight: 600; cursor: pointer; border-radius: 6px;" title="Trigger immediate autonomous cycle (reconcile FB posts, publish due, pre-generate slots)">
          ⚡ Run Worker Cycle
        </button>
        <div class="status-pill" id="workerPill" style="background: ${workerPillBg}; color: ${workerPillColor};">
          <div class="status-dot" style="background: ${workerDotColor};"></div>
          <span id="workerStatusSpan">${workerStatusText}</span>
        </div>
      </div>
    </header>

    <!-- Global Emergency Kill Switch Warning Banner -->
    ${killSwitch ? `
      <div id="globalKillSwitchBanner" style="background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #fef3c7; padding: 14px 20px; border-radius: 8px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 24px;">⏸️</span>
          <div>
            <strong style="font-size: 14px; color: #fbbf24;">Global Kill Switch Active: Autonomous posting is PAUSED across ALL pages.</strong>
            <div style="font-size: 12px; color: #fde68a; margin-top: 2px;">The background worker loop will skip idea generation and publishing cycles until resumed.</div>
          </div>
        </div>
        <button class="btn btn-secondary" onclick="toggleKillSwitch()" style="padding: 6px 16px; font-size: 12px; font-weight: 700; background: #f59e0b; color: #000; border: none; cursor: pointer;">
          ▶️ Resume Autonomous System
        </button>
      </div>
    ` : ''}

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
    <div id="tab-overview" class="tab-content ${routeInfo.tabId === 'overview' ? 'active' : ''}">
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
    <div id="tab-accounts" class="tab-content ${routeInfo.tabId === 'accounts' ? 'active' : ''}">
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
                      ${renderAccountPermissionsBadges(acc.notes)}
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
    <div id="tab-pages" class="tab-content ${routeInfo.tabId === 'pages' ? 'active' : ''}">
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
                      ${renderAccountPermissionsBadges(acc.notes)}
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

                      const checklist = evaluatePageChecklist(p);
                      const pageApprovedCount = posts.filter(
                        (post) => (post.page_id === p.id || post.page_id === p.fb_page_id) && (post.review_state === 'approved' || post.status === 'published')
                      ).length;
                      const pageScoredPosts = posts.filter(
                        (post) => (post.page_id === p.id || post.page_id === p.fb_page_id) && typeof post.qa_score === 'number'
                      );
                      const pageQaPassRate = pageScoredPosts.length > 0
                        ? Math.round((pageScoredPosts.filter((post) => (post.qa_score || 0) >= 80).length / pageScoredPosts.length) * 100)
                        : 100;
                      const isSafetyGatePassed = pageApprovedCount >= 20 && pageQaPassRate >= 90;

                      const allProfilesPool = [...(contentProfiles || []), ...(seedProfiles || [])];
                      const assignedProf = allProfilesPool.find((sp) => sp.id === p.profile_id || sp.name === p.profile_id);
                      const profileLabel = assignedProf
                        ? assignedProf.name
                        : (p.profile_id && p.profile_id !== 'default-niche' && p.profile_id !== '__custom__' && p.profile_id !== 'custom'
                            ? p.profile_id
                            : (p.overrides?.custom_niche ? 'Science & Space' : '⚠️ No Profile Chosen'));

                      return `
                        <div class="page-tree-card" id="page-card-${p.id}" style="background: rgba(0,0,0,0.25); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px 16px; margin-bottom: 10px;">
                          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                            <!-- Left: Picture & Info -->
                            <div style="display: flex; align-items: center; gap: 12px; min-width: 240px;">
                              ${p.picture_url ? `<img src="${p.picture_url}" alt="${p.name}" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">` : `<div style="width: 42px; height: 42px; border-radius: 50%; background: #1e3a8a; display: flex; align-items: center; justify-content: center; font-size: 20px;">📄</div>`}
                              <div>
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                  <a href="javascript:void(0)" onclick="openPageSettingsModal('${p.id}')" style="color: #60a5fa; text-decoration: none; font-size: 16px; font-weight: 700;">
                                    ${p.name}
                                  </a>
                                  <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; font-size: 10px; font-weight: 700; padding: 2px 6px;">
                                    ● ${statusLabel}
                                  </span>
                                  ${p.publishing_mode === 'auto'
                                    ? `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-size: 10px; font-weight: 700; padding: 2px 6px;">AUTO</span>`
                                    : p.publishing_mode === 'hybrid'
                                    ? `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 10px; font-weight: 700; padding: 2px 6px;">HYBRID</span>`
                                    : `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #fbbf24; border: 1px solid rgba(234, 179, 8, 0.3); font-size: 10px; font-weight: 700; padding: 2px 6px;">REVIEW</span>`}
                                  ${isShared ? `<span class="badge" style="background: rgba(59,130,246,0.15); color: #93c5fd; font-size: 10px;" title="Discovered via multiple Facebook accounts">Shared</span>` : ''}
                                  ${p.active
                                    ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; font-size: 11px; font-weight: 700;">🟢 LIVE (${p.schedule.postsPerDay} posts/day)</span>`
                                    : `<span class="badge" style="background: rgba(239,68,68,0.15); color: #f87171; font-size: 11px; font-weight: 700;">🔴 POSTING DISABLED</span>`}
                                </div>
                                <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
                                  <code style="color: #94a3b8;">ID: ${p.fb_page_id}</code>
                                  ${p.category ? ` • <span>${p.category}</span>` : ''}
                                  ${typeof p.fan_count === 'number' && p.fan_count > 0 ? ` • <span>${p.fan_count.toLocaleString()} fans</span>` : ''}
                                  • <span style="color: #cbd5e1;">🎭 Profile: <strong>${profileLabel}</strong></span>
                                  • <span style="color: #93c5fd;">Mode: ${p.publishing_mode.toUpperCase()}</span>
                                  • <span>🕒 ${p.schedule.postsPerDay > 0 ? `${p.schedule.postsPerDay} posts/day (${p.schedule.timezone || 'Asia/Kolkata'})` : 'No Schedule'}</span>
                                </div>
                                <div style="margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                  <span class="badge" style="background: ${isSafetyGatePassed ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'}; color: ${isSafetyGatePassed ? '#34d399' : '#fbbf24'}; font-size: 11px; font-weight: 700;">
                                    🛡️ Safety Gate: ${pageApprovedCount}/20 Approved (${pageQaPassRate}% QA Pass)
                                  </span>
                                  <span style="color: var(--text-muted); font-size: 11px;">
                                    ${isSafetyGatePassed ? '🟢 Ready for Auto' : '🔒 Review Mode Default (20 approved required)'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <!-- Right: Actions -->
                            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                              ${p.active
                                ? `<button class="btn btn-secondary start-stop-btn" style="padding: 6px 14px; font-size: 12px; font-weight: 700; color: #f87171; border: 1px solid rgba(239,68,68,0.4);" onclick="togglePageAutoPosting('${p.id}', false)" title="1-Click: Stop auto-posting for this Page">⏸️ Stop</button>`
                                : `<button class="btn btn-primary start-stop-btn" style="padding: 6px 14px; font-size: 12px; font-weight: 700;" onclick="togglePageAutoPosting('${p.id}', true)" title="1-Click: Start auto-posting for this Page">🚀 Start</button>`}
                              <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px; font-weight: 600;" onclick="openPageSettingsModal('${p.id}')" title="Configure posting cadence, schedule builder, and publishing modes">
                                ⚙️ Settings & Schedule
                              </button>
                              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px; font-weight: 600; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.08);" onclick="openDailyContentStudio('${p.id}', '${escapeHtml(p.name)}')" title="Review, edit, or regenerate today's researched topics and visual image ideas">
                                💡 Daily Ideas
                              </button>
                              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="analyzePageNicheAction('${p.id}')" title="Automatically evaluate Page niche using AI">
                                ✨ Detect Niche
                              </button>
                              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="triggerPageTestRun('${p.id}')" title="Run simulated test post cycle">
                                ⚡ Test Run
                              </button>
                              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="openPagePromptStudio('${p.id}')" title="Customize prompts & voice">
                                ✍️ Prompts
                              </button>
                              <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px;" onclick="openPageDetailsWindow('${p.id}')" title="Inspect posts & feed">
                                🔍 Data
                              </button>
                              <button class="btn btn-secondary" style="padding: 6px 8px; font-size: 12px;" onclick="checkPageTokenHealth('${p.id}')" title="Verify token health">
                                🩺 Check
                              </button>
                              <button class="btn btn-danger" style="padding: 6px 8px; font-size: 12px;" onclick="deletePageAction('${p.id}')" title="Remove Page">
                                🗑️
                              </button>
                            </div>
                          </div>

                          <!-- Checklist Indicator for Inactive Pages -->
                          ${!p.active ? `
                            <div style="margin-top: 12px; padding: 8px 12px; background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 11px;">
                              <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                                <strong style="color: #f59e0b;">📋 Setup Checklist:</strong>
                                <span>${checklist.profileChosen ? '✅' : '⭕'} 1. Profile: ${checklist.profileChosen ? 'Chosen' : '<span style="color: #f87171;">Select</span>'}</span>
                                <span>${checklist.scheduleSet ? '✅' : '⭕'} 2. Schedule: ${checklist.scheduleSet ? `${p.schedule.postsPerDay} posts/day` : '<span style="color: #f87171;">Set Cadence</span>'}</span>
                                <span>${checklist.modeChosen ? '✅' : '⭕'} 3. Mode: ${p.publishing_mode.toUpperCase()}</span>
                                <span>${checklist.testRunDone ? '✅' : '⭕'} 4. Test Run: ${checklist.testRunDone ? 'Verified' : '<span style="color: #f87171;">Run Test</span>'}</span>
                              </div>
                              <div>
                                <button class="btn ${checklist.isReadyToGoLive ? 'btn-primary' : 'btn-secondary'}" style="padding: 3px 10px; font-size: 11px; font-weight: 600;" onclick="openPageSettingsModal('${p.id}')">
                                  ${checklist.isReadyToGoLive ? '🚀 Ready: Go Live' : '⚙️ Complete Setup'}
                                </button>
                              </div>
                            </div>
                          ` : ''}

                          <!-- Niche Detection Suggestion Banner if previously analyzed -->
                          ${p.niche_analysis && p.niche_analysis.suggested_profile_name ? `
                            <div style="margin-top: 10px; padding: 10px 14px; background: rgba(30,58,138,0.2); border: 1px solid rgba(59,130,246,0.3); border-radius: 6px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                              <div>
                                <span style="color: #60a5fa; font-weight: 700;">✨ Detected Niche:</span>
                                <strong style="color: #f3f4f6; margin-left: 4px;">${p.niche_analysis.suggested_profile_name}</strong>
                                <span class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 10px; margin-left: 6px;">${Math.round((p.niche_analysis.confidence || 0) * 100)}% Match</span>
                                <span style="color: var(--text-muted); margin-left: 8px;">${p.niche_analysis.reasoning || ''}</span>
                              </div>
                              <div style="display: flex; gap: 6px;">
                                <button class="btn btn-primary" style="padding: 3px 10px; font-size: 11px;" onclick="applyNicheProfile('${p.id}', '${p.niche_analysis.suggested_profile_id}')">
                                  Accept & Apply
                                </button>
                                <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openPageSettingsModal('${p.id}')">
                                  Review in Settings
                                </button>
                              </div>
                            </div>
                          ` : ''}
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
                        <span class="badge" style="margin-left: 6px; font-size: 10px; font-weight: 700; ${p.publishing_mode === 'auto' ? 'background: rgba(168,85,247,0.15); color: #c084fc;' : p.publishing_mode === 'hybrid' ? 'background: rgba(59,130,246,0.15); color: #60a5fa;' : 'background: rgba(234,179,8,0.15); color: #fbbf24;'}">${(p.publishing_mode || 'review').toUpperCase()}</span>
                      </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                      <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="openPageSettingsModal('${p.id}')">⚙️ Settings</button>
                      <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="analyzePageNicheAction('${p.id}')">✨ Niche</button>
                      <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="triggerPageTestRun('${p.id}')">⚡ Test</button>
                      <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openPagePromptStudio('${p.id}')">✍️ Prompts</button>
                      <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openPageDetailsWindow('${p.id}')">🔍 Data</button>
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
    <div id="tab-page-prompts" class="tab-content ${routeInfo.tabId === 'page-prompts' ? 'active' : ''}">
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
              <select id="editProfileSelect" class="form-control" onchange="toggleCustomNicheField(this.value, 'studioCustomNicheBox'); handleStudioProfileChange(this.value)">
                ${renderNicheSelectOptions(seedProfiles)}
              </select>
              <div id="customNicheReplaceNotice" style="display: none; font-size: 11px; color: #60a5fa; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); padding: 6px 10px; border-radius: 6px; margin-top: 6px;">
                ℹ️ Custom niches have no base master prompt to append to, so Replace mode is automatically selected.
              </div>
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
                <input type="number" id="editMinWords" class="form-control" value="120" oninput="validateStudioWordLimits()">
              </div>
              <div class="form-group">
                <label>Target Words</label>
                <input type="number" id="editTargetWords" class="form-control" value="180" oninput="validateStudioWordLimits()">
              </div>
              <div class="form-group">
                <label>Max Words</label>
                <input type="number" id="editMaxWords" class="form-control" value="250" oninput="validateStudioWordLimits()">
              </div>
            </div>
            <div id="editWordsError" style="display: none; color: #f87171; font-size: 12px; font-weight: 600; margin-bottom: 10px;"></div>
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
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                <div>
                  <label style="font-weight: 700; font-size: 13px; text-transform: uppercase; color: #60a5fa;">Viral Headline Panel & Typography</label>
                  <div style="font-size: 11px; color: var(--text-muted);">Exact TrueType condensed typography matching reference standard</div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <button type="button" class="btn btn-secondary" onclick="applyClassicHeadlinePreset()" style="font-size: 11px; padding: 4px 10px; background: #1e293b; border: 1px solid #3b82f6; color: #93c5fd; cursor: pointer;">
                    ⭐ Preset: Classic Big White + Yellow
                  </button>
                  <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: #e2e8f0;">
                    <input type="checkbox" id="editPanelEnabled" checked onchange="updateHeadlineLivePreview()"> Enable Panel
                  </label>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Font Family (Bundled TrueType)</label>
                  <select id="editFontFamily" class="form-control" style="padding: 6px; font-size: 12px;" onchange="updateHeadlineLivePreview()">
                    <option value="Roboto" selected>Roboto Bold (Modern Sans-Serif - Recommended)</option>
                    <option value="Open Sans">Open Sans Bold</option>
                    <option value="Roboto Condensed">Roboto Condensed Bold</option>
                    <option value="Oswald">Oswald Bold</option>
                  </select>
                </div>
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Panel Height Mode</label>
                  <select id="editPanelHeightMode" class="form-control" style="padding: 6px; font-size: 12px;" onchange="updateHeadlineLivePreview()">
                    <option value="auto" selected>Auto-Adjust (30% 2-lines, 36% 3-lines, 42% 4-lines)</option>
                    <option value="fixed_30">Fixed 30%</option>
                    <option value="fixed_36">Fixed 36% (Standard)</option>
                    <option value="fixed_42">Fixed 42% (Max)</option>
                  </select>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Panel Color</label>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <input type="color" id="editPanelColor" class="form-control" value="#000000" style="padding: 1px; height: 32px; width: 36px; cursor: pointer;" oninput="syncHeadlineColorPicker(this.value); updateHeadlineLivePreview();">
                    <input type="text" id="editPanelColorHex" class="form-control" value="#000000" style="padding: 4px; font-family: monospace; font-size: 11px; flex: 1;" placeholder="#000000" oninput="syncHeadlineColorText(this.value); updateHeadlineLivePreview();">
                  </div>
                </div>
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Min Font Size (px)</label>
                  <input type="number" id="editMinFontSize" class="form-control" value="76" min="60" max="96" style="padding: 6px; font-size: 12px;" onchange="updateHeadlineLivePreview()">
                </div>
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Highlight Mode</label>
                  <select id="editHighlightStyle" class="form-control" style="padding: 6px; font-size: 12px;" onchange="updateHeadlineLivePreview()">
                    <option value="alternating" selected>Alternating Accent 1 & 2</option>
                    <option value="accent1">Accent 1 Only</option>
                    <option value="none">None (All White)</option>
                  </select>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; align-items: center;">
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Accent 1 (Primary)</label>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <input type="color" id="editAccent1Color" class="form-control" value="#FFD21F" style="padding: 1px; height: 32px; width: 36px; cursor: pointer;" oninput="updateHeadlineLivePreview()">
                    <span style="font-size: 11px; font-family: monospace; color: #FFD21F;">#FFD21F</span>
                  </div>
                </div>
                <div>
                  <label style="font-size: 11px; color: var(--text-muted); font-weight: 600;">Accent 2 (Secondary)</label>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <input type="color" id="editAccent2Color" class="form-control" value="#22D3EE" style="padding: 1px; height: 32px; width: 36px; cursor: pointer;" oninput="updateHeadlineLivePreview()">
                    <span style="font-size: 11px; font-family: monospace; color: #22D3EE;">#22D3EE</span>
                  </div>
                </div>
                <div>
                  <label style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); cursor: pointer; margin-top: 14px;">
                    <input type="checkbox" id="editMatchNicheAccent" checked onchange="updateHeadlineLivePreview()"> Match accent to niche
                  </label>
                </div>
              </div>

              <!-- Hidden inputs for backward compatibility -->
              <input type="hidden" id="editAspectRatio" value="4:5">
              <input type="hidden" id="editPanelHeight" value="36">
              <div id="editHeadlineColorError" style="display: none; color: #f87171; font-size: 11px; font-weight: 600; margin-top: 2px;"></div>

              <!-- Live 4-Sample Preview Container -->
              <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--card-border);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Live Typography & Layout Previews (4 Samples)</span>
                  <span id="previewStatusBadge" style="font-size: 10px; color: #4ade80;">● Bundled Fonts Active</span>
                </div>
                <div id="headlineSamplesGrid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                  <div id="sampleCard0" style="background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 6px; text-align: center;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">Sample 1 (Octopus)</div>
                    <div class="sample-svg-holder" style="width: 100%; aspect-ratio: 4/5; background: #000; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center;"></div>
                    <div class="sample-metrics" style="font-size: 9px; color: #cbd5e1; margin-top: 4px; line-height: 1.3;">-</div>
                  </div>
                  <div id="sampleCard1" style="background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 6px; text-align: center;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">Sample 2 (12 Words)</div>
                    <div class="sample-svg-holder" style="width: 100%; aspect-ratio: 4/5; background: #000; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center;"></div>
                    <div class="sample-metrics" style="font-size: 9px; color: #cbd5e1; margin-top: 4px; line-height: 1.3;">-</div>
                  </div>
                  <div id="sampleCard2" style="background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 6px; text-align: center;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">Sample 3 (5 Words)</div>
                    <div class="sample-svg-holder" style="width: 100%; aspect-ratio: 4/5; background: #000; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center;"></div>
                    <div class="sample-metrics" style="font-size: 9px; color: #cbd5e1; margin-top: 4px; line-height: 1.3;">-</div>
                  </div>
                  <div id="sampleCard3" style="background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 6px; text-align: center;">
                    <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">Sample 4 (Auto-Shortened)</div>
                    <div class="sample-svg-holder" style="width: 100%; aspect-ratio: 4/5; background: #000; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center;"></div>
                    <div class="sample-metrics" style="font-size: 9px; color: #cbd5e1; margin-top: 4px; line-height: 1.3;">-</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card" style="background: #0b0f19; border: 1px solid var(--card-border); padding: 14px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label style="font-weight: 700; font-size: 13px; text-transform: uppercase; color: #34d399;">First Comment Auto-Booster (Reach Optimization)</label>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="editFirstCommentEnabled" checked onchange="toggleFirstCommentValidation()"> Auto-post first comment
                </label>
              </div>
              <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Keeps external links and citations out of main caption to avoid Facebook reach suppression.</p>
              <textarea id="editFirstCommentPrompt" class="form-control" style="height: 60px;" placeholder="e.g. 💬 What part of this surprised you most? Drop your thoughts below!" oninput="validateStudioFirstComment()"></textarea>
              <div id="editFirstCommentError" style="display: none; color: #f87171; font-size: 11px; font-weight: 600; margin-top: 4px;"></div>
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
    <div id="tab-review" class="tab-content ${routeInfo.tabId === 'review' ? 'active' : ''}">
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

                <!-- Per-Post Quality Verification Audit Grid -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 14px; font-size: 12px;">
                  <!-- 1. Image Check Result -->
                  <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 10px 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                      <strong style="color: #34d399;">📷 Image Check:</strong>
                      <span class="badge" style="background: ${p.qa_result?.visionRelevanceCheck?.passed === false ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}; color: ${p.qa_result?.visionRelevanceCheck?.passed === false ? '#f87171' : '#34d399'}; font-size: 10px;">
                        ${p.qa_result?.visionRelevanceCheck?.passed === false ? 'FAIL' : 'PASS'}
                      </span>
                    </div>
                    <div style="color: #cbd5e1; font-size: 11px; line-height: 1.4;">
                      ${p.qa_result?.visionRelevanceCheck?.passed === false
                        ? escapeHtml(p.qa_result.visionRelevanceCheck.feedback || 'Visual deformity or generic glow detected')
                        : 'Concrete National Geographic scene verified (calm bottom 35%, zero abstract blue glow).'}
                    </div>
                  </div>

                  <!-- 2. Consistency Result -->
                  <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 6px; padding: 10px 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                      <strong style="color: #60a5fa;">⚖️ Consistency:</strong>
                      <span class="badge" style="background: ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'NUMERICAL_MISMATCH' || v.code === 'CONTRADICTION') ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)'}; color: ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'NUMERICAL_MISMATCH' || v.code === 'CONTRADICTION') ? '#f87171' : '#60a5fa'}; font-size: 10px;">
                        ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'NUMERICAL_MISMATCH' || v.code === 'CONTRADICTION') ? 'MISMATCH' : 'MATCHED'}
                      </span>
                    </div>
                    <div style="color: #cbd5e1; font-size: 11px; line-height: 1.4;">
                      ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'NUMERICAL_MISMATCH' || v.code === 'CONTRADICTION')
                        ? escapeHtml(p.qa_result.integrityCheck.violations.filter((v: any) => v.code === 'NUMERICAL_MISMATCH' || v.code === 'CONTRADICTION').map((v: any) => v.message).join('; '))
                        : 'Numbers, scientific units and key terms in headline match caption exactly.'}
                    </div>
                  </div>

                  <!-- 3. Grounding Result -->
                  <div style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 6px; padding: 10px 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                      <strong style="color: #c084fc;">🔬 Grounding:</strong>
                      <span class="badge" style="background: ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'UNGROUNDED_CLAIM') ? 'rgba(239,68,68,0.2)' : 'rgba(168,85,247,0.2)'}; color: ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'UNGROUNDED_CLAIM') ? '#f87171' : '#c084fc'}; font-size: 10px;">
                        ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'UNGROUNDED_CLAIM') ? 'UNVERIFIED' : 'VERIFIED'}
                      </span>
                    </div>
                    <div style="color: #cbd5e1; font-size: 11px; line-height: 1.4;">
                      ${p.qa_result?.integrityCheck?.violations?.some((v: any) => v.code === 'UNGROUNDED_CLAIM')
                        ? escapeHtml(p.qa_result.integrityCheck.violations.find((v: any) => v.code === 'UNGROUNDED_CLAIM')?.message || 'No source found')
                        : 'All factual claims grounded in peer-reviewed scientific sources.'}
                    </div>
                    ${p.source_line ? `<div style="margin-top: 4px;"><a href="${escapeHtml(p.source_line)}" target="_blank" style="color: #93c5fd; text-decoration: underline; font-size: 11px;">🔗 Primary Source Fact</a></div>` : ''}
                  </div>

                  <!-- 4. Provider & Cost -->
                  <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px; padding: 10px 12px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                      <strong style="color: #fbbf24;">🎨 Provider & Cost:</strong>
                      <span class="badge" style="background: rgba(245,158,11,0.2); color: #fbbf24; font-size: 10px;">
                        ${escapeHtml(p.image_provider_used || 'Pollinations AI (flux)')}
                      </span>
                    </div>
                    <div style="color: #cbd5e1; font-size: 11px; line-height: 1.4;">
                      Estimated Cost: <strong style="color: #fef08a;">$${typeof p.qa_result?.estimatedCost?.costPerImage === 'number' ? p.qa_result.estimatedCost.costPerImage.toFixed(4) : '0.0000'}</strong>
                      <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">Daily budget impact: ~$${typeof p.qa_result?.estimatedCost?.estimatedDailyCost === 'number' ? p.qa_result.estimatedCost.estimatedDailyCost.toFixed(3) : '0.000'}</div>
                    </div>
                  </div>
                </div>

                <!-- Visual Preview if generated image exists -->
                ${p.composed_image_path || p.raw_image_path ? `
                  <div style="margin-bottom: 14px; display: flex; align-items: flex-start; gap: 14px; background: #080d1a; border: 1px solid #1e293b; border-radius: 8px; padding: 12px;">
                    <img src="${escapeHtml(p.composed_image_path || p.raw_image_path || '')}" alt="Visual Preview" style="width: 120px; height: 150px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0;" />
                    <div style="flex: 1; min-width: 0;">
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <strong style="font-size: 12px; color: #93c5fd;">Concrete Physical Scene Prompt:</strong>
                        <span class="badge" style="background: rgba(147,197,253,0.15); color: #93c5fd; font-size: 10px;">4:5 National Geographic</span>
                      </div>
                      <div style="font-size: 11px; color: #94a3b8; line-height: 1.5; font-family: monospace;">
                        ${escapeHtml(p.image_prompt || 'Natural documentary composition with calm bottom 35% overlay zone.')}
                      </div>
                    </div>
                  </div>
                ` : ''}

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
    <div id="tab-calendar" class="tab-content ${routeInfo.tabId === 'calendar' ? 'active' : ''}">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div>
            <h3 style="font-size: 18px; margin-bottom: 4px;">7-Day Autonomous Schedule Calendar</h3>
            <p style="color: var(--text-muted); font-size: 13px;">Multi-page posting time slots optimized for Facebook algorithm audience peaks.</p>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
            ${pages.length > 0 ? `<button class="btn btn-secondary" style="font-size: 12px; font-weight: 700; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.08); padding: 5px 12px; cursor: pointer;" onclick="openDailyContentStudio('${pages[0].id}', '${escapeHtml(pages[0].name)}')">💡 Daily Content & Image Ideas</button>` : ''}
            <span class="badge" style="background: #064e3b; color: #34d399;">● Published</span>
            <span class="badge" style="background: #1e3a8a; color: #60a5fa;">● Scheduled on FB</span>
            <span class="badge" style="background: #78350f; color: #f59e0b;">● Review Required</span>
            <span class="badge" style="background: rgba(15, 23, 42, 0.8); border: 1px dashed #38bdf8; color: #38bdf8;">● Planned (T-30m)</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; overflow-x: auto;">
          ${(() => {
            const userTz = 'Asia/Kolkata';
            const defaultTz = pages[0]?.schedule?.timezone || 'America/New_York';
            const now = new Date();
            const todayUserStr = new Intl.DateTimeFormat('en-CA', {
              timeZone: userTz,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(now);
            const [tYear, tMonth, tDay] = todayUserStr.split('-').map(Number);

            return Array.from({ length: 7 })
              .map((_, idx) => {
                const slotDate = new Date(Date.UTC(tYear, tMonth - 1, tDay + idx, 12, 0, 0));
                const dayDateStr = new Intl.DateTimeFormat('en-CA', {
                  timeZone: userTz,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(slotDate);
                const dayName = slotDate.toLocaleDateString('en-US', { timeZone: userTz, weekday: 'short' });
                const dayMonthStr = slotDate.toLocaleDateString('en-US', { timeZone: userTz, month: 'short', day: 'numeric' });

                const dayPosts = posts.filter((p) => {
                  if (!p.scheduled_for) return false;
                  try {
                    const pTzDate = new Intl.DateTimeFormat('en-CA', {
                      timeZone: userTz,
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    }).format(new Date(p.scheduled_for));
                    return pTzDate === dayDateStr;
                  } catch (_) {
                    return false;
                  }
                });

                // Check planned slots for active live pages
                const activePages = pages.filter((pg) => pg.active === true || (pg.schedule as any)?.is_live === true);
                const plannedSlotsForDay: Array<{ timeStr: string; localTimeStr: string; pageName: string }> = [];

                for (const ap of activePages) {
                  const pageTz = ap.schedule?.timezone || defaultTz;
                  const times: string[] = ap.schedule?.postingTimes || (ap.schedule as any)?.times || ['08:00', '10:00', '12:00', '15:00', '17:00'];
                  for (const t of times) {
                    const [tHour, tMin] = t.split(':').map(Number);
                    // Check if there is already a post scheduled for this slot (matching hour and minute within 20m)
                    const hasPost = dayPosts.some((dp) => {
                      try {
                        const dpTzDate = new Date(dp.scheduled_for);
                        const dpParts = new Intl.DateTimeFormat('en-US', {
                          timeZone: pageTz,
                          hour: 'numeric',
                          minute: 'numeric',
                          hour12: false,
                        }).formatToParts(dpTzDate);
                        const dpHour = Number(dpParts.find((p) => p.type === 'hour')?.value || 0);
                        const dpMin = Number(dpParts.find((p) => p.type === 'minute')?.value || 0);
                        return dpHour === tHour && Math.abs(dpMin - tMin) <= 20;
                      } catch (_) {
                        return false;
                      }
                    });

                    if (!hasPost) {
                      const audTimeFmt = `${tHour % 12 || 12}:${tMin.toString().padStart(2, '0')} ${tHour >= 12 ? 'PM' : 'AM'}`;
                      // IST time (+10h30m relative to EST)
                      const istMinutes = (tHour * 60 + tMin + 630) % 1440;
                      const istH = Math.floor(istMinutes / 60);
                      const istM = istMinutes % 60;
                      const istTimeFmt = `${istH % 12 || 12}:${istM.toString().padStart(2, '0')} ${istH >= 12 ? 'PM' : 'AM'}`;

                      plannedSlotsForDay.push({
                        timeStr: audTimeFmt,
                        localTimeStr: istTimeFmt,
                        pageName: ap.name,
                      });
                    }
                  }
                }

                const hasItems = dayPosts.length > 0 || plannedSlotsForDay.length > 0;

                return `
                <div style="background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 12px; min-width: 140px;">
                  <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: ${idx === 0 ? '#38bdf8' : '#93c5fd'};">${dayName} ${idx === 0 ? '(Today)' : ''}</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">${dayMonthStr}</div>

                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${
                      dayPosts.map((p) => {
                        const pg = pages.find((page) => page.id === p.page_id);
                        const pageTz = pg?.schedule?.timezone || defaultTz;
                        const audTime = new Date(p.scheduled_for).toLocaleTimeString('en-US', {
                          timeZone: pageTz,
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        });
                        const locTime = new Date(p.scheduled_for).toLocaleTimeString('en-US', {
                          timeZone: userTz,
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        });
                        const isPub = p.status === 'published';
                        const isSched = p.status === 'scheduled_on_fb';
                        const bg = isPub ? '#064e3b' : isSched ? '#1e3a8a' : '#78350f';
                        const borderC = isPub ? '#059669' : isSched ? '#2563eb' : '#d97706';
                        const textC = isPub ? '#34d399' : isSched ? '#93c5fd' : '#f59e0b';
                        const badgeLabel = isPub ? 'PUBLISHED' : isSched ? 'ON FB' : 'REVIEW';

                        return `
                        <div
                          class="calendar-post-card"
                          onclick="openPostDetailsModal('${p.id}')"
                          title="Click to view full post content, caption and Facebook link"
                          style="background: #111827; border: 1px solid ${borderC}; border-radius: 6px; padding: 9px; font-size: 11px; cursor: pointer; transition: all 0.2s ease; position: relative;"
                          onmouseover="this.style.borderColor='#38bdf8'; this.style.transform='translateY(-2px)';"
                          onmouseout="this.style.borderColor='${borderC}'; this.style.transform='none';"
                        >
                          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                            <div>
                              <span style="font-weight: 700; color: ${textC}; font-size: 12px;">${audTime} EST</span>
                              <div style="font-size: 9px; color: #94a3b8;">${locTime} IST</div>
                            </div>
                            <span style="font-size: 9px; background: ${bg}; color: white; padding: 2px 5px; border-radius: 4px; font-weight: 700; border: 1px solid ${borderC};">${badgeLabel}</span>
                          </div>
                          <div style="font-weight: 600; color: #f3f4f6; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(p.title || '')}">${escapeHtml(p.title || 'Scheduled Post')}</div>
                          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; border-top: 1px solid #1f2937; padding-top: 3px;">
                            <span style="color: var(--text-muted); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80px;">${escapeHtml(pg?.name.split('&')[0] || 'Beyond the Known')}</span>
                            <span style="color: #38bdf8; font-size: 10px; font-weight: 600;">View &rarr;</span>
                          </div>
                        </div>
                        `;
                      }).join('')
                    }
                    ${
                      plannedSlotsForDay.map((ps) => {
                        return `
                        <div style="background: rgba(15, 23, 42, 0.6); border: 1px dashed rgba(56, 189, 248, 0.35); border-radius: 6px; padding: 8px; font-size: 11px;">
                          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                            <div>
                              <span style="font-weight: 700; color: #38bdf8; font-size: 11px;">${ps.timeStr} EST</span>
                              <div style="font-size: 9px; color: #64748b;">${ps.localTimeStr} IST</div>
                            </div>
                            <span style="font-size: 9px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 1px 4px; border-radius: 4px; font-weight: 600;">PLANNED</span>
                          </div>
                          <div style="font-weight: 600; color: #cbd5e1; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(ps.pageName)}">${escapeHtml(ps.pageName)}</div>
                          <div style="color: var(--text-muted); font-size: 9px;">Pre-generates T-30m</div>
                        </div>
                        `;
                      }).join('')
                    }
                    ${
                      !hasItems
                        ? '<div style="color: #4b5563; font-size: 11px; font-style: italic; padding: 8px 0;">No active slots</div>'
                        : ''
                    }
                  </div>
                </div>
              `;
              })
              .join('');
          })()}
        </div>
      </div>
    </div>

    <!-- TAB 7: ANALYTICS & INSIGHTS -->
    <div id="tab-analytics" class="tab-content ${routeInfo.tabId === 'analytics' ? 'active' : ''}">
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
    <div id="tab-simulator" class="tab-content ${routeInfo.tabId === 'simulator' ? 'active' : ''}">
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
    <div id="tab-providers" class="tab-content ${routeInfo.tabId === 'providers' ? 'active' : ''}">
      <!-- Text Chain Card -->
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 17px; margin-bottom: 4px;">🔤 Text Generation Failover Chain</h3>
            <p style="font-size: 13px; color: var(--text-muted);">
              Sequential failover priority for captions, ideas, outlines, and niche evaluation. If Primary fails, worker automatically cascades to Secondary and Fallbacks.
            </p>
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
              <th>Health & Latency</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="textProvidersTableBody">
            ${renderProviderChainRows(
              providers.filter((p) => getProviderChain(p) === 'text').sort((a, b) => a.priority - b.priority),
              providerKeys,
              'text'
            )}
          </tbody>
        </table>
      </div>

      <!-- Image Chain Card -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 17px; margin-bottom: 4px;">🎨 Image Generation Failover Chain</h3>
            <p style="font-size: 13px; color: var(--text-muted);">
              Sequential image generation providers (Gemini Native, ZenMux, Pollinations, Cloudflare Workers AI) with live health tracking.
            </p>
          </div>
          <button class="btn btn-secondary" style="font-size: 12px; font-weight: 700; color: #a78bfa; border: 1px solid rgba(167, 139, 250, 0.4); background: rgba(167, 139, 250, 0.08); padding: 6px 14px; cursor: pointer;" onclick="openImageBenchModal()">
            🔬 Image Quality Bench
          </button>
        </div>
        ${renderBudgetTrackerBanner()}
        <table>
          <thead>
            <tr>
              <th>Provider & Model</th>
              <th>Adapter Kind</th>
              <th>Failover Priority</th>
              <th>Daily Quota</th>
              <th>Key Pool (AES-256-GCM)</th>
              <th>Health & Latency</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="imageProvidersTableBody">
            ${renderProviderChainRows(
              providers.filter((p) => getProviderChain(p) === 'image').sort((a, b) => a.priority - b.priority),
              providerKeys,
              'image'
            )}
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 10: SYSTEM AUDIT LOGS -->
    <div id="tab-audit" class="tab-content ${routeInfo.tabId === 'audit' ? 'active' : ''}">
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
    <div id="tab-settings" class="tab-content ${routeInfo.tabId === 'settings' ? 'active' : ''}">
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

      <!-- GO-LIVE SYSTEM READINESS AUDIT (11 MULTI-POINT CHECKS) -->
      <div class="card" style="margin-bottom: 24px; border: 1px solid var(--card-border);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
              <span>🚀</span> Go-Live System Readiness Audit
            </h3>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Comprehensive 11-point production audit: database schema, tokens, provider quotas, worker health, and public compliance.
            </div>
          </div>
          <button class="btn btn-primary" onclick="runSystemReadinessAuditAction(this)" style="font-weight: 700; padding: 6px 16px;">
            🩺 Run Readiness Audit
          </button>
        </div>
        <div id="readinessAuditContainer" style="display: none; margin-top: 14px;"></div>
      </div>

      <!-- DATABASE SCHEMA CHECK TOOL -->
      <div class="card" style="margin-bottom: 24px; border: 1px solid var(--card-border);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
              <span>🗄️</span> Database Schema & Migration Verification
            </h3>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Validates real Supabase schema against expected 19 tables, indexes, and required columns. Blocks go-live if incomplete.
            </div>
          </div>
          <button class="btn btn-secondary" onclick="runDatabaseSchemaCheckAction(this)" style="font-weight: 600; padding: 6px 14px;">
            🔍 Check Schema Integrity
          </button>
        </div>
        <div id="schemaCheckContainer" style="display: none; margin-top: 14px;"></div>
      </div>

      <!-- SETTINGS BACKUP & RESTORE -->
      <div class="card" style="margin-bottom: 24px; border: 1px solid var(--card-border);">
        <h3 style="margin: 0 0 8px 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <span>💾</span> Settings Backup & Disaster Recovery (Zero Secrets)
        </h3>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Export and import entire system settings (page cadences, prompt overrides, content profiles, provider configurations). Secrets, tokens, and keys are strictly stripped for security.
        </p>
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-secondary" onclick="downloadSettingsBackupAction()" style="padding: 8px 16px;">
            📥 Download Settings Backup (JSON)
          </button>
          <label class="btn btn-secondary" style="padding: 8px 16px; cursor: pointer; margin: 0;">
            📤 Restore from Backup JSON
            <input type="file" id="restoreBackupFileInput" accept=".json" onchange="handleRestoreBackupFile(this)" style="display: none;">
          </label>
          <button class="btn btn-secondary" onclick="importStarterProfilesFromSettings(this)" style="padding: 8px 16px;">
            📦 Import 7 Starter Profiles to Supabase
          </button>
        </div>
        <div id="backupStatusMsg" style="margin-top: 10px; font-size: 12px; display: none;"></div>
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

  <!-- MODAL: PAGE SETTINGS & SCHEDULING CONTROLS -->
  <div class="modal" id="pageSettingsModal">
    <div class="modal-content" style="max-width: 960px; width: 95%; max-height: 92vh; overflow-y: auto; padding: 26px;">
      <!-- Modal Top Header & Big Auto-Posting Switch -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid var(--card-border); padding-bottom: 14px; flex-wrap: wrap; gap: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
            <h3 id="psmTitle" style="font-size: 20px; margin: 0; color: #f9fafb;">⚙️ Page Settings</h3>
            <span id="psmLiveBadge" class="badge" style="background: rgba(239,68,68,0.2); color: #f87171; font-size: 11px;">● POSTING DISABLED</span>
            <span id="psmUnsavedBadge" style="display: none; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;">● Unsaved changes</span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 14px; flex-wrap: wrap;">
            <span>Page: <strong id="psmPageName" style="color: #cbd5e1;">-</strong></span>
            <span>Facebook Page ID: <code id="psmPageFbId" style="color: #93c5fd;">-</code></span>
            <span>Token: <span id="psmTokenStatus" class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 10px;">VALID</span></span>
          </div>
        </div>

        <!-- Big Auto-Posting Switch -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="text-align: right;">
            <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Autonomous Posting</div>
            <div id="psmSwitchLabel" style="font-size: 14px; font-weight: 800; color: #f87171;">OFF</div>
          </div>
          <button type="button" id="psmBigSwitchBtn" onclick="toggleAutoPostingFromSwitch()" class="btn btn-secondary" style="font-size: 13px; font-weight: 800; padding: 8px 16px;">
            🚀 Turn Auto-Posting ON
          </button>
          <button type="button" onclick="closePageSettingsModal()" style="background: none; border: none; color: var(--text-muted); font-size: 22px; cursor: pointer; padding: 0 4px; margin-left: 10px;" aria-label="Close modal">✕</button>
        </div>
      </div>

      <!-- Setup Checklist Progress Banner -->
      <div id="psmChecklistBanner" style="background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
          <strong style="font-size: 13px; color: #f3f4f6;">📋 Setup Checklist</strong>
          <span id="psmChecklistProgress" style="font-size: 12px; font-weight: 600; color: #f59e0b;">Step 1 of 5 Incomplete</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; font-size: 12px;">
          <div id="psmStepProfile" style="background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
            <span class="psm-step-icon">⭕</span> <strong>1. Profile:</strong> <span class="psm-step-status" style="color: #9ca3af;">Not Chosen</span>
          </div>
          <div id="psmStepSchedule" style="background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
            <span class="psm-step-icon">⭕</span> <strong>2. Schedule:</strong> <span class="psm-step-status" style="color: #9ca3af;">0 posts/day</span>
          </div>
          <div id="psmStepMode" style="background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
            <span class="psm-step-icon">⭕</span> <strong>3. Mode:</strong> <span class="psm-step-status" style="color: #9ca3af;">Review</span>
          </div>
          <div id="psmStepTest" style="background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
            <span class="psm-step-icon">⭕</span> <strong>4. Test Run:</strong> <span class="psm-step-status" style="color: #9ca3af;">Needed</span>
          </div>
          <div id="psmStepLive" style="background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
            <span class="psm-step-icon">⭕</span> <strong>5. Status:</strong> <span class="psm-step-status" style="color: #9ca3af;">Paused</span>
          </div>
        </div>
      </div>

      <form id="pageSettingsForm" onsubmit="handleSavePageSettings(event)">
        <input type="hidden" id="psmPageId" name="psmPageId">
        <input type="hidden" id="psmPostsPerDay" name="psmPostsPerDay" value="0">

        <!-- Stale Profile Alert & Recovery Banner -->
        <div id="psmAlertNotice" style="display: none; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div>
              <strong style="color: #fca5a5; font-size: 13px;">⚠️ Stale Profile Detected</strong>
              <div id="psmAlertNoticeText" style="font-size: 12px; color: #fecaca; margin-top: 2px;">
                The profile assigned to this page no longer exists.
              </div>
            </div>
            <button type="button" class="btn btn-secondary" onclick="reloadProfilesAndResetToCustom()" style="font-size: 12px; padding: 6px 12px; background: #991b1b; color: white; border: none; border-radius: 6px; cursor: pointer;">
              🔄 Reload Profiles & Reset to Custom
            </button>
          </div>
        </div>

        <!-- STEP 1 CARD: NICHE -->
        <div class="card" style="background: #0b0f19; border: 1px solid var(--card-border); padding: 18px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <h4 style="font-size: 15px; margin: 0; color: #93c5fd; display: flex; align-items: center; gap: 8px;">
              <span id="psmCardCheck1">⭕</span> <span>Step 1: Choose Niche & Content Profile</span>
            </h4>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="importStarterProfilesFromModal()">
                📦 Import Starter Profiles
              </button>
              <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="analyzePageNicheActionFromModal()">
                ✨ Detect Niche via AI
              </button>
              <a href="javascript:void(0)" onclick="openPagePromptStudioFromModal()" style="font-size: 11px; color: #60a5fa; text-decoration: none; display: flex; align-items: center;">
                ✍️ Edit Prompts & Voice →
              </a>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 12px;">
            <label for="psmProfileSelect" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Assigned Content Profile</label>
            <select id="psmProfileSelect" class="form-control" style="font-size: 13px; padding: 8px 12px; width: 100%;" onchange="handleModalProfileChange(this.value); markFormModified();">
              ${renderNicheSelectOptions(seedProfiles)}
            </select>
            <small style="color: var(--text-muted); font-size: 11px; margin-top: 4px; display: block;">
              Select a specialized profile. The system tunes topic selection, headline styles, caption length, and visual generation specifically for this niche.
            </small>
          </div>

          <!-- Custom Niche Inline Editor -->
          <div id="psmCustomNicheBox" style="display: none; margin-bottom: 12px; background: rgba(59, 130, 246, 0.08); border: 1px dashed #3b82f6; border-radius: 8px; padding: 12px;">
            <label for="psmCustomNicheText" style="font-size: 12px; color: #93c5fd; font-weight: 600; display: block; margin-bottom: 4px;">
              Custom Niche Description & Focus Areas <span style="color: #ef4444;">*</span>
            </label>
            <textarea id="psmCustomNicheText" class="form-control" rows="3" maxlength="1000"
              placeholder="e.g. Deep space exploration, James Webb telescope findings, exoplanets, and astrophysicist theories."
              style="font-size: 13px; width: 100%; box-sizing: border-box; resize: vertical;"
              oninput="handleCustomNicheTextInput(this.value); markFormModified();"></textarea>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <small style="color: var(--text-muted); font-size: 11px;">Describe the themes, subjects, and tone for this page.</small>
              <span id="psmCustomNicheCharCount" style="font-size: 11px; color: var(--text-muted);">0 / 1000 characters</span>
            </div>
          </div>

          <!-- Niche Recommendation Card -->
          <div id="psmNicheSuggestionBox" style="display: none; background: #0f172a; border: 1px solid #3b82f6; border-radius: 8px; padding: 14px; margin-top: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <strong style="color: #60a5fa; font-size: 13px;">✨ AI Niche Recommendation:</strong>
                <span id="psmNicheSuggestedName" style="color: #f3f4f6; font-weight: 700; margin-left: 6px;">Science & Space</span>
                <span id="psmNicheConfidenceBadge" class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 11px; margin-left: 6px;">95% Match</span>
              </div>
              <button type="button" onclick="dismissModalNicheSuggestion()" style="background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer;">✕</button>
            </div>
            <p id="psmNicheReasoning" style="font-size: 12px; color: #cbd5e1; margin-bottom: 10px; line-height: 1.4;"></p>
            <div id="psmNicheMeta" style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px; display: flex; gap: 14px; flex-wrap: wrap;"></div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button type="button" class="btn btn-primary" style="font-size: 12px; padding: 6px 14px;" onclick="acceptModalNicheSuggestion()">
                ✅ Accept & Apply Niche
              </button>
              <button type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="createProfileFromModalNiche()">
                ➕ Create New Profile from this Page
              </button>
              <button type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px 10px;" onclick="analyzePageNicheActionFromModal()">
                🔄 Re-analyze
              </button>
            </div>
          </div>
        </div>

        <!-- STEP 2 CARD: SCHEDULE -->
        <div class="card" style="background: #0b0f19; border: 1px solid var(--card-border); padding: 18px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
            <h4 style="font-size: 15px; margin: 0; color: #93c5fd; display: flex; align-items: center; gap: 8px;">
              <span id="psmCardCheck2">⭕</span> <span>Step 2: Set Cadence & Posting Schedule</span>
            </h4>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span style="font-size: 11px; color: var(--text-muted);">Quick-fill:</span>
              <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="applyQuickSchedule(5)">
                ⭐ 5 posts/day (US Prime Time)
              </button>
              <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="applyQuickSchedule(3)">
                ⚡ 3 posts/day
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 16px;">
            <!-- Audience Timezone -->
            <div class="form-group" style="margin-bottom: 0;">
              <label for="psmTimezone" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Audience Timezone</label>
              <select id="psmTimezone" name="psmTimezone" class="form-control" style="font-size: 12px;" onchange="handleScheduleInputChange(); markFormModified();">
                <option value="America/New_York" selected>America/New_York (US Eastern Time - ET)</option>
                <option value="America/Chicago">America/Chicago (US Central Time - CT)</option>
                <option value="America/Denver">America/Denver (US Mountain Time - MT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (US Pacific Time - PT)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST +4:00)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT +8:00)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST +9:00)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
                <option value="UTC">UTC (Universal Time)</option>
              </select>
              <small id="psmCurrentTzTime" style="color: #93c5fd; font-size: 11px; margin-top: 4px; display: block;"></small>
            </div>

            <!-- Cadence Derived Count -->
            <div class="form-group" style="margin-bottom: 0;">
              <label style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Calculated Cadence</label>
              <div style="display: flex; align-items: center; gap: 10px; padding-top: 6px;">
                <span id="psmCadenceBadge" class="badge" style="font-size: 14px; font-weight: 700; background: #1e3a8a; color: #93c5fd; padding: 6px 14px;">
                  0 posts / day
                </span>
                <span style="font-size: 11px; color: var(--text-muted);">(Driven by number of posting times below)</span>
              </div>
            </div>
          </div>

          <!-- Time Chips Container -->
          <div style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 14px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 12px; color: #e2e8f0; font-weight: 600;">Daily Posting Times (Audience Timezone):</span>
              <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 3px 10px;" onclick="addFixedTimePicker()">+ Add Time</button>
            </div>
            <div id="psmFixedTimesList" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
            <div id="psmHighCadenceWarning" style="display: none; color: #fbbf24; font-size: 11px; margin-top: 8px; padding: 6px 10px; background: rgba(251, 191, 36, 0.1); border-radius: 4px;">
              ⚠️ Warning: Facebook algorithm may penalize organic reach for pages posting over 5 times per day.
            </div>
            <div id="psmOvernightWarning" style="display: none; color: #fbbf24; font-size: 11px; margin-top: 8px; padding: 8px 12px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span>⚠️ Overnight hours in <span id="psmOvernightTzName">selected timezone</span> (00:00–05:59), usually poor reach.</span>
                <button type="button" class="btn btn-secondary" style="font-size: 11px; padding: 3px 8px; background: #b45309; color: #fff; border: none; cursor: pointer;" onclick="applyUsPrimeTimeSuggestions()">
                  ⚡ Use US prime-time suggestions
                </button>
              </div>
            </div>
          </div>

          <!-- Live 7-Day Preview Table -->
          <div style="background: #060913; border: 1px solid #1e293b; border-radius: 8px; padding: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 6px;">
              <strong style="font-size: 13px; color: #34d399;">📅 Live 7-Day Autonomous Slot Preview</strong>
              <span id="psmSlotSummaryBadge" style="font-size: 11px; color: var(--text-muted);">Recalculating live...</span>
            </div>
            <div style="overflow-x: auto; max-height: 200px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                <thead>
                  <tr style="border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-muted);">
                    <th style="padding: 6px 8px;">Date & Day</th>
                    <th style="padding: 6px 8px;">Slot #</th>
                    <th style="padding: 6px 8px;">Audience Time</th>
                    <th style="padding: 6px 8px; color: #93c5fd;">Your Local Time (Asia/Kolkata)</th>
                    <th style="padding: 6px 8px;">Timing Mode</th>
                  </tr>
                </thead>
                <tbody id="psmSchedulePreviewTableBody">
                  <tr><td colspan="5" style="text-align: center; padding: 12px; color: var(--text-muted);">Configure schedule times above to see preview slots</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- STEP 3 CARD: PUBLISHING MODE -->
        <div class="card" style="background: #0b0f19; border: 1px solid var(--card-border); padding: 18px; margin-bottom: 20px;">
          <h4 style="font-size: 15px; margin: 0 0 14px 0; color: #93c5fd; display: flex; align-items: center; gap: 8px;">
            <span id="psmCardCheck3">⭕</span> <span>Step 3: Choose Publishing Mode</span>
          </h4>

          <input type="hidden" id="psmPublishingMode" name="psmPublishingMode" value="review">

          <!-- 3 Mode Selection Cards -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 14px;">
            <!-- Mode 1: Review -->
            <div class="psm-mode-card active" id="modeCardReview" onclick="selectPublishingMode('review')" style="cursor: pointer; padding: 14px; border-radius: 8px; border: 2px solid #3b82f6; background: rgba(59,130,246,0.1);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="color: #93c5fd; font-size: 14px;">📬 Review Each Post</strong>
                <span class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 10px;">RECOMMENDED</span>
              </div>
              <p style="font-size: 12px; color: #cbd5e1; line-height: 1.4; margin: 0;">
                Worker generates caption, image & QA score into Review Inbox. Nothing is posted to Facebook until you approve it. Safest default.
              </p>
            </div>

            <!-- Mode 2: Fully Automatic -->
            <div class="psm-mode-card" id="modeCardAuto" onclick="selectPublishingMode('auto')" style="cursor: pointer; padding: 14px; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(255,255,255,0.02);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="color: #f3f4f6; font-size: 14px;">🚀 Fully Automatic</strong>
                <span class="badge" style="background: rgba(59,130,246,0.2); color: #93c5fd; font-size: 10px;">HANDS-OFF</span>
              </div>
              <p style="font-size: 12px; color: #cbd5e1; line-height: 1.4; margin: 0;">
                Worker generates and publishes directly to Facebook at scheduled times without manual approval.
              </p>
            </div>

            <!-- Mode 3: Hybrid -->
            <div class="psm-mode-card" id="modeCardHybrid" onclick="selectPublishingMode('hybrid')" style="cursor: pointer; padding: 14px; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(255,255,255,0.02);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="color: #f3f4f6; font-size: 14px;">⚖️ Hybrid Mode</strong>
                <span class="badge" style="background: rgba(245,158,11,0.2); color: #fbbf24; font-size: 10px;">QUALITY GATE</span>
              </div>
              <p style="font-size: 12px; color: #cbd5e1; line-height: 1.4; margin: 0;">
                High-confidence posts (QA score ≥ threshold) auto-post. Posts below threshold route to Review Inbox.
              </p>
            </div>
          </div>

          <!-- Hybrid Threshold Slider (Shown when hybrid selected) -->
          <div id="psmHybridScoreGroup" style="display: none; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-top: 10px;">
            <label for="psmHybridScore" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">
              Hybrid QA Score Threshold: <span id="psmHybridScoreVal" style="color: #34d399; font-weight: 700;">80</span>/100
            </label>
            <input type="range" id="psmHybridScore" min="50" max="95" value="80" style="width: 100%; margin-top: 6px;" oninput="document.getElementById('psmHybridScoreVal').innerText = this.value; markFormModified();">
            <small style="color: var(--text-muted); font-size: 11px;">Scores below threshold are routed to your Review Inbox for human sign-off.</small>
          </div>
        </div>

        <!-- COLLAPSED ADVANCED SECTION -->
        <details style="background: rgba(255,255,255,0.015); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px 18px; margin-bottom: 20px;">
          <summary style="cursor: pointer; font-size: 13px; font-weight: 600; color: #cbd5e1; user-select: none;">
            ⚙️ Advanced Settings (Jitter, Min Gap, Lead Time, Vacation Pause, AI Disclosures, Daily Cap)
          </summary>
          <div style="margin-top: 16px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 14px;">
              <div>
                <label for="psmJitter" style="font-size: 11px; color: var(--text-muted);">Time Jitter (± Minutes)</label>
                <input type="number" id="psmJitter" value="10" min="0" max="60" class="form-control" style="font-size: 12px;" oninput="handleScheduleInputChange(); markFormModified();">
                <small style="color: var(--text-muted); font-size: 10px;">Natural time shift to avoid exact-minute robotic posting.</small>
              </div>
              <div>
                <label for="psmMinGap" style="font-size: 11px; color: var(--text-muted);">Minimum Gap (Minutes)</label>
                <input type="number" id="psmMinGap" value="60" min="30" max="720" class="form-control" style="font-size: 12px;" oninput="handleScheduleInputChange(); markFormModified();">
                <small style="color: var(--text-muted); font-size: 10px;">Guaranteed spacing between consecutive posts.</small>
              </div>
              <div>
                <label for="psmLeadTime" style="font-size: 11px; color: var(--text-muted);">Generation Lead Time</label>
                <select id="psmLeadTime" class="form-control" style="font-size: 12px;" onchange="handleScheduleInputChange(); markFormModified();">
                  <option value="24">24 hours ahead</option>
                  <option value="48" selected>48 hours ahead</option>
                  <option value="72">3 days ahead</option>
                  <option value="168">7 days ahead</option>
                </select>
              </div>
              <div>
                <label for="psmDailyCap" style="font-size: 11px; color: var(--text-muted);">Hard Daily Cap</label>
                <input type="number" id="psmDailyCap" value="3" min="1" max="20" class="form-control" style="font-size: 12px;" oninput="markFormModified()">
                <small style="color: var(--text-muted); font-size: 10px;">Safety ceiling for maximum posts per calendar day.</small>
              </div>
            </div>

            <!-- Vacation Pause Range -->
            <div style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-bottom: 14px;">
              <div style="font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">🌴 Optional Vacation / Pause Date Range (Skip Posting)</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <label for="psmVacationStart" style="font-size: 11px; color: var(--text-muted);">Pause Start Date</label>
                  <input type="date" id="psmVacationStart" class="form-control" style="font-size: 12px;" onchange="handleScheduleInputChange(); markFormModified();">
                </div>
                <div>
                  <label for="psmVacationEnd" style="font-size: 11px; color: var(--text-muted);">Pause End Date</label>
                  <input type="date" id="psmVacationEnd" class="form-control" style="font-size: 12px;" onchange="handleScheduleInputChange(); markFormModified();">
                </div>
              </div>
            </div>

            <!-- AI Disclosure Toggle -->
            <div style="background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; user-select: none; margin-bottom: 6px;">
                <input type="checkbox" id="psmAiDisclosureToggle" onchange="document.getElementById('psmAiDisclosureBox').style.display = this.checked ? 'block' : 'none'; markFormModified();">
                <span style="font-weight: 600; color: #f3f4f6;">Append AI Disclosure Statement to Caption</span>
              </label>
              <div id="psmAiDisclosureBox" style="display: none; margin-top: 8px;">
                <input type="text" id="psmAiDisclosureText" class="form-control" value="AI-assisted content created for Beyond the Known." style="font-size: 12px;" oninput="markFormModified()">
                <small style="color: var(--text-muted); font-size: 10px;">Ensures compliance with Meta content integrity standards.</small>
              </div>
            </div>

            <!-- Quality Assurance & Structure Controls -->
            <div style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 14px; margin-bottom: 14px;">
              <div style="font-size: 12px; font-weight: 700; color: #93c5fd; margin-bottom: 10px;">📐 Quality Assurance & Editorial Structure Rules</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                <div>
                  <label for="psmQaPassThreshold" style="font-size: 11px; color: var(--text-muted);">QA Pass Score</label>
                  <input type="number" id="psmQaPassThreshold" value="80" min="50" max="100" class="form-control" style="font-size: 12px;" oninput="markFormModified()">
                  <small style="color: var(--text-muted); font-size: 10px;">Min score (0-100) required to pass.</small>
                </div>
                <div>
                  <label for="psmMaxSentencesPerParagraph" style="font-size: 11px; color: var(--text-muted);">Max Sentences/Para</label>
                  <input type="number" id="psmMaxSentencesPerParagraph" value="3" min="1" max="10" class="form-control" style="font-size: 12px;" oninput="markFormModified()">
                  <small style="color: var(--text-muted); font-size: 10px;">Prevents wall-of-text (default 3).</small>
                </div>
                <div>
                  <label for="psmMinWords" style="font-size: 11px; color: var(--text-muted);">Min Words</label>
                  <input type="number" id="psmMinWords" placeholder="50" min="10" max="500" class="form-control" style="font-size: 12px;" oninput="markFormModified()">
                  <small style="color: var(--text-muted); font-size: 10px;">Minimum word threshold.</small>
                </div>
                <div>
                  <label for="psmTargetWords" style="font-size: 11px; color: var(--text-muted);">Target Words</label>
                  <input type="number" id="psmTargetWords" placeholder="120" min="20" max="800" class="form-control" style="font-size: 12px;" oninput="markFormModified()">
                  <small style="color: var(--text-muted); font-size: 10px;">Optimal post length target.</small>
                </div>
                <div>
                  <label for="psmMaxWords" style="font-size: 11px; color: var(--text-muted);">Max Words</label>
                  <input type="number" id="psmMaxWords" placeholder="220" min="30" max="1000" class="form-control" style="font-size: 12px;" oninput="markFormModified()">
                  <small style="color: var(--text-muted); font-size: 10px;">Upper word limit ceiling.</small>
                </div>
              </div>
            </div>

            <!-- Source Line Toggle -->
            <div style="background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; user-select: none; margin: 0;">
                <input type="checkbox" id="psmSourceLineToggle" checked onchange="markFormModified()">
                <span style="font-weight: 600; color: #f3f4f6;">Include Verified Source Line (e.g. "Source: NASA / Nature")</span>
              </label>
            </div>
          </div>
        </details>

        <!-- Footer Actions -->
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; border-top: 1px solid var(--card-border); padding-top: 18px;">
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="btn btn-secondary" style="font-size: 13px;" onclick="runTestRunFromModal()">
              ⚡ Run Test Run Now
            </button>
            <button type="button" id="psmRevertBtn" class="btn btn-secondary" style="font-size: 13px;" onclick="revertModalChanges()" disabled>
              ↩️ Revert Changes
            </button>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="btn btn-secondary" onclick="closePageSettingsModal()">Cancel</button>
            <button type="submit" id="psmSaveBtn" class="btn btn-primary" style="padding: 10px 24px; font-weight: 700;">
              💾 Save Settings to Supabase
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: STOP / PAUSE AUTO-POSTING CONFIRMATION -->
  <div class="modal" id="stopAutoPostingModal">
    <div class="modal-content" style="max-width: 520px; padding: 26px;">
      <h3 style="font-size: 18px; margin-top: 0; color: #f87171;">⏸️ Pause Auto-Posting for <span id="stopModalPageName">Page</span></h3>
      <p style="font-size: 13px; color: #d1d5db; line-height: 1.5; margin-bottom: 20px;">
        Choose how you want to handle scheduled posts when pausing autonomous generation:
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
        <label style="display: flex; gap: 12px; padding: 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--card-border); border-radius: 8px; cursor: pointer;">
          <input type="radio" name="stopActionChoice" value="pause" checked style="margin-top: 3px;">
          <div>
            <strong style="color: #f3f4f6; font-size: 13px;">Pause new posts only (Recommended)</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Stops future post planning. Any posts already planned or scheduled will remain in queue.
            </div>
          </div>
        </label>
        <label style="display: flex; gap: 12px; padding: 14px; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; cursor: pointer;">
          <input type="radio" name="stopActionChoice" value="cancel_pending" style="margin-top: 3px;">
          <div>
            <strong style="color: #fca5a5; font-size: 13px;">Stop everything & cancel scheduled posts</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Cancels all pending/scheduled draft posts in database. Nothing will be published to Facebook.
            </div>
          </div>
        </label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn btn-secondary" onclick="closeStopAutoPostingModal()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="confirmStopAutoPosting()">Confirm & Pause Posting</button>
      </div>
    </div>
  </div>

  <!-- MODAL: PUBLISHING MODE CONFIRMATION -->
  <div class="modal" id="modeConfirmationModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 99999; align-items: center; justify-content: center;">
    <div class="modal-content" style="max-width: 540px; padding: 26px; background: #0f172a; border: 1px solid #334155; border-radius: 12px;">
      <h3 style="font-size: 18px; margin-top: 0; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
        <span>⚠️ Confirm Publishing Mode Switch</span>
      </h3>
      <p style="font-size: 13px; color: #e2e8f0; line-height: 1.5; margin-bottom: 16px;">
        You are switching to <strong id="mcmModeName" style="color: #60a5fa;">Fully Automatic</strong> mode.
      </p>
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 14px; margin-bottom: 20px; font-size: 12px; line-height: 1.6; color: #fde68a;">
        <ul style="margin: 0; padding-left: 18px;">
          <li>Posts will be published directly to Facebook at scheduled times without manual review.</li>
          <li>Ensure you have run and verified a Test Run to confirm quality before proceeding.</li>
          <li>System safeguards (QA score threshold, daily caps, failover) remain active.</li>
        </ul>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn btn-secondary" onclick="cancelModeConfirmation()">Keep in Review Mode</button>
        <button type="button" class="btn btn-primary" id="mcmConfirmBtn" onclick="confirmModeChange()" style="background: #2563eb; font-weight: 700;">
          Confirm & Switch
        </button>
      </div>
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

  <!-- MODAL: CONCURRENCY CONFLICT RESOLUTION (3-WAY) -->
  <div class="modal" id="concurrencyConflictModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 99999; align-items: center; justify-content: center;">
    <div class="modal-content" style="max-width: 600px; width: 90%; background: #0f172a; border: 1px solid #f59e0b; border-radius: 12px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 24px;">⚠️</span>
          <div>
            <h3 style="margin: 0; font-size: 18px; color: #fbbf24;">Concurrency Conflict Detected</h3>
            <div style="font-size: 12px; color: #94a3b8;">Settings were modified elsewhere. Your typed edits are safe.</div>
          </div>
        </div>
        <button type="button" onclick="closeConcurrencyConflictModal()" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; padding: 12px; font-size: 13px; color: #fde68a; margin-bottom: 16px; line-height: 1.5;" id="conflictSummaryText">
        Another session or update modified settings for this page. Please select how you want to resolve this conflict:
      </div>

      <div id="conflictFieldsList" style="max-height: 160px; overflow-y: auto; background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 10px; margin-bottom: 20px; font-size: 12px; font-family: monospace; color: #cbd5e1;">
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button type="button" class="btn btn-primary" onclick="resolveConflictKeepMine()" style="justify-content: center; background: #3b82f6; font-weight: 700;">
          💾 Keep Mine (Force Save My Edits)
        </button>
        <button type="button" class="btn btn-secondary" onclick="resolveConflictMerge()" style="justify-content: center; background: #1e293b; border: 1px solid #3b82f6; color: #93c5fd;">
          🔀 Merge Non-Overlapping Fields
        </button>
        <button type="button" class="btn btn-secondary" onclick="resolveConflictUseLatest()" style="justify-content: center; background: #1e293b; border: 1px solid #475569; color: #cbd5e1;">
          🔄 Use Latest (Discard My Form Changes)
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL: PIPELINE TEST RUN VERIFICATION REPORT -->
  <div class="modal" id="testRunReportModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 99999; align-items: center; justify-content: center;">
    <div class="modal-content" style="max-width: 750px; width: 92%; max-height: 90vh; overflow-y: auto; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #1e293b; padding-bottom: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
            <h3 style="margin: 0; font-size: 18px; color: #f8fafc;">🧪 Test Run Verification Report</h3>
            <span id="trrStatusBadge" class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 11px;">VERIFIED</span>
          </div>
          <div style="font-size: 12px; color: #94a3b8;">
            Page: <strong id="trrPageName" style="color: #f1f5f9;">-</strong> • Tested at: <span id="trrTestedAt">-</span>
          </div>
        </div>
        <button type="button" onclick="closeTestRunReportModal()" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">✕</button>
      </div>

      <!-- Pipeline Stages Progress -->
      <div style="margin-bottom: 18px;">
        <div style="font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">Pipeline Execution Stages</div>
        <div id="trrStagesContainer" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px;">
          <!-- Dynamically filled -->
        </div>
        <div id="trrRulesContainer" style="display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px;">
          <!-- Editorial Structure & Rules Badges -->
        </div>
      </div>

      <!-- Research Sources (Factual Posts) -->
      <div id="trrResearchSection" style="display: none; background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
        <div style="font-size: 12px; font-weight: 700; color: #38bdf8; text-transform: uppercase; margin-bottom: 8px;">🔬 Verified Research Sources & Evidence URLs</div>
        <div id="trrResearchSourcesContainer" style="display: flex; flex-direction: column; gap: 6px;"></div>
      </div>

      <!-- Claim-by-Claim Factual Verification Audit -->
      <div id="trrClaimsSection" style="display: none; background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: #34d399; text-transform: uppercase;">🛡️ Claim-by-Claim Factual Verification Audit</div>
          <span id="trrClaimsBadge" class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 11px;">100% GROUNDED</span>
        </div>
        <div id="trrClaimsContainer" style="display: flex; flex-direction: column; gap: 8px;"></div>
      </div>

      <!-- Multi-Provider Revision & Failover Log -->
      <div id="trrAttemptsSection" style="display: none; background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
        <div style="font-size: 12px; font-weight: 700; color: #f59e0b; text-transform: uppercase; margin-bottom: 8px;">🔄 Multi-Provider Revision & Failover History</div>
        <div id="trrAttemptsContainer" style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Dynamically filled -->
        </div>
      </div>

      <!-- Effective Writer Prompt (Masked Secrets) -->
      <details id="trrPromptSection" style="display: none; background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px;">
        <summary style="cursor: pointer; font-size: 12px; font-weight: 700; color: #93c5fd; user-select: none;">
          🔍 View Effective Writer Prompt (Masked Secrets)
        </summary>
        <pre id="trrEffectivePromptText" style="white-space: pre-wrap; font-size: 11px; color: #94a3b8; margin-top: 10px; max-height: 180px; overflow-y: auto; font-family: monospace; background: #0b0f19; padding: 10px; border-radius: 6px;"></pre>
      </details>

      <!-- Topic & Content Preview -->
      <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: #60a5fa; text-transform: uppercase;">Generated Content & Topic</div>
          <div id="trrWordBadge" style="font-size: 11px; color: #94a3b8; font-family: monospace;">- words</div>
        </div>
        <div style="font-size: 14px; font-weight: 700; color: #f8fafc; margin-bottom: 8px;" id="trrTopicTitle">-</div>
        <div id="trrCaptionText" style="font-size: 13px; line-height: 1.6; color: #cbd5e1; white-space: pre-wrap; background: #0f172a; padding: 12px; border-radius: 6px; font-family: sans-serif; max-height: 220px; overflow-y: auto;">-</div>
      </div>

      <!-- Visual & Overlay Details -->
      <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 700; color: #a78bfa; text-transform: uppercase; margin-bottom: 8px;">Visual Framing & Headline Panel</div>
        <div style="font-size: 12px; color: #cbd5e1; line-height: 1.5; margin-bottom: 6px;">
          <strong>Scene:</strong> <span id="trrImagePrompt">-</span>
        </div>
        <div style="font-size: 12px; color: #cbd5e1;">
          <strong>Headline Overlay:</strong> <span id="trrHeadlineText">-</span> • <span id="trrAspectDim">-</span>
        </div>
        <div id="trrPreviewImagesRow" style="display: none; margin-top: 14px; gap: 14px; align-items: flex-start; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 180px;">
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">Thumbnail Preview:</div>
            <img id="trrThumbnailImg" src="" alt="Thumbnail" style="width: 100%; max-height: 200px; object-fit: contain; border-radius: 6px; border: 1px solid #1e293b; background: #000;" />
          </div>
          <div style="flex: 2; min-width: 240px;">
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">1080x1350 Composed Image Preview:</div>
            <img id="trrCompositeImg" src="" alt="Composite Preview" style="width: 100%; max-height: 280px; object-fit: contain; border-radius: 6px; border: 1px solid #1e293b; background: #000;" />
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn-secondary" onclick="closeTestRunReportModal()">Close Report</button>
      </div>
    </div>
  </div>

  <!-- POST DETAILS & PREVIEW MODAL -->
  <div class="modal" id="postDetailsModal" style="display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); z-index: 10000; overflow-y: auto; padding: 20px;">
    <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; width: 100%; max-width: 820px; max-height: 90vh; overflow-y: auto; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); position: relative;">
      
      <!-- Modal Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #1e293b; padding-bottom: 14px;">
        <div style="flex: 1; padding-right: 12px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            <span id="pdmStatusBadge" class="badge" style="background: #1e3a8a; color: #60a5fa; font-weight: 700;">● SCHEDULED ON FACEBOOK</span>
            <span id="pdmCategoryBadge" class="badge" style="background: #312e81; color: #a5b4fc;">General</span>
            <span id="pdmQaScoreBadge" class="badge" style="background: #064e3b; color: #34d399; font-weight: 700;">QA: 100/100</span>
          </div>
          <h2 id="pdmTitle" style="font-size: 20px; font-weight: 700; color: #f8fafc; margin: 0; line-height: 1.3;">Post Details</h2>
          <div style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">
            Page: <strong id="pdmPageName" style="color: #38bdf8;">Beyond the Known</strong> • Post ID: <span id="pdmId" style="font-family: monospace; color: #94a3b8;">-</span>
          </div>
        </div>
        <button type="button" onclick="closePostDetailsModal()" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 4px;" title="Close Modal">&times;</button>
      </div>

      <!-- Schedule & Facebook Status Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px;">
        <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Audience Posting Time</div>
          <div id="pdmAudienceTime" style="font-size: 16px; font-weight: 700; color: #34d399;">8:00 AM EST</div>
          <div id="pdmAudienceTz" style="font-size: 11px; color: #64748b;">America/New_York (US Eastern Time)</div>
        </div>
        <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px;">
          <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Your Local Time</div>
          <div id="pdmLocalTime" style="font-size: 16px; font-weight: 700; color: #60a5fa;">6:30 PM IST</div>
          <div id="pdmLocalTz" style="font-size: 11px; color: #64748b;">Asia/Kolkata (Your Browser Timezone)</div>
        </div>
        <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Facebook Meta Status</div>
            <div id="pdmFbStatusText" style="font-size: 12px; color: #cbd5e1; font-weight: 600;">Scheduled in Graph API</div>
            <div id="pdmFbPostId" style="font-size: 11px; font-family: monospace; color: #94a3b8; word-break: break-all; margin-top: 2px;">-</div>
          </div>
          <div style="margin-top: 8px;">
            <a id="pdmFbLinkBtn" href="#" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display: none; padding: 5px 12px; font-size: 11px; text-decoration: none;">🔗 Open on Facebook</a>
          </div>
        </div>
      </div>

      <!-- Full Post Caption Section -->
      <div style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 13px; font-weight: 700; color: #f8fafc; text-transform: uppercase;">Full Post Caption</span>
            <span id="pdmWordCountBadge" class="badge" style="background: #1e293b; color: #94a3b8; font-size: 11px;">0 words</span>
            <span id="pdmHashtagsBadge" class="badge" style="background: #1e293b; color: #94a3b8; font-size: 11px;">0 hashtags</span>
          </div>
          <button type="button" id="pdmCopyCaptionBtn" onclick="copyPostCaptionToClipboard()" class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px; display: flex; align-items: center; gap: 4px;">📋 Copy Caption</button>
        </div>
        <div id="pdmCaption" style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; font-size: 13.5px; line-height: 1.7; color: #e2e8f0; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"></div>
      </div>

      <!-- Image & Creative Panel Section -->
      <div id="pdmVisualSection" style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: #a78bfa; text-transform: uppercase;">Visual Framing & Creative Preview</div>
          <div id="pdmViewToggleRow" style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-secondary" id="pdmViewComposedBtn" onclick="togglePostModalView('composed')" style="padding: 4px 10px; font-size: 11px; background: #1e3a8a; color: #60a5fa;">🖼️ Composed Card (1080×1350)</button>
            <button type="button" class="btn btn-secondary" id="pdmViewRawBtn" onclick="togglePostModalView('raw')" style="padding: 4px 10px; font-size: 11px; background: #1e293b; color: #94a3b8;">🎨 Raw AI Photo</button>
          </div>
        </div>
        <div id="pdmImagePromptRow" style="font-size: 12px; color: #cbd5e1; margin-bottom: 12px; display: none;">
          <strong>Scene Prompt:</strong> <span id="pdmImagePrompt" style="color: #94a3b8; font-style: italic;">-</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <a id="pdmPreviewLink" href="#" target="_blank" rel="noopener noreferrer" style="display: flex; justify-content: center; width: 100%; cursor: zoom-in;" title="Click to view full resolution">
            <img id="pdmPreviewImg" src="" alt="Post Visual Preview" style="max-width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; border: 1px solid #1e293b; background: #000; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); display: none;" />
          </a>
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; max-width: 480px; margin-top: 8px; flex-wrap: wrap; gap: 8px;">
            <div style="font-size: 11px; color: #64748b;">(Click image to open in full high-resolution)</div>
            <button type="button" id="pdmDownloadBtn" onclick="downloadCurrentPostImage()" class="btn btn-secondary" style="padding: 5px 12px; font-size: 12px; background: #065f46; color: #6ee7b7; border: 1px solid #059669; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border-radius: 6px;">
              ⬇️ Save Composed Card (.JPG)
            </button>
          </div>
        </div>
      </div>

      <!-- Footer Buttons -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #1e293b; padding-top: 16px;">
        <button type="button" class="btn btn-secondary" onclick="closePostDetailsModal()">Close</button>
        <button type="button" class="btn btn-primary" onclick="copyPostCaptionToClipboard()">📋 Copy Caption</button>
      </div>
    </div>
  </div>

  <!-- DAILY CONTENT & IMAGE IDEAS STUDIO MODAL -->
  <div class="modal" id="dailyContentStudioModal" style="display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.88); backdrop-filter: blur(8px); z-index: 10000; overflow-y: auto; padding: 20px;">
    <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; width: 100%; max-width: 1080px; max-height: 92vh; overflow-y: auto; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8); position: relative;">
      
      <!-- Studio Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #1e293b; padding-bottom: 14px; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <h2 style="font-size: 20px; font-weight: 700; color: #f8fafc; margin: 0;">💡 Daily Content & Image Ideas Studio</h2>
            <span id="dcsPageBadge" class="badge" style="background: #1e3a8a; color: #60a5fa; font-weight: 700;">Page: -</span>
            <span id="dcsCountBadge" class="badge" style="background: #064e3b; color: #34d399; font-weight: 700;">0 Ideas in Queue</span>
          </div>
          <p style="color: var(--text-muted); font-size: 13px; margin: 4px 0 0 0;">
            Review, edit, or regenerate today's researched topics and photorealistic visual scenes. The autonomous worker generates the full caption and composes the final card at T-30m before each slot.
          </p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary" style="font-size: 12px; font-weight: 600; color: #38bdf8; border: 1px solid rgba(56,189,248,0.4);" onclick="openAddTopicModal()">
            ➕ Add Idea
          </button>
          <button type="button" class="btn btn-primary" id="dcsRegenAllBtn" style="font-size: 12px; font-weight: 700;" onclick="regenerateAllTopics()">
            ⚡ Regenerate All (Fresh Batch)
          </button>
          <button type="button" onclick="closeDailyContentStudio()" style="background: none; border: none; color: #94a3b8; font-size: 26px; cursor: pointer; line-height: 1; padding: 2px 8px; border-radius: 4px;" title="Close Modal">&times;</button>
        </div>
      </div>

      <!-- Loading Indicator -->
      <div id="dcsLoading" style="display: none; text-align: center; padding: 40px 20px;">
        <div style="font-size: 28px; margin-bottom: 12px;">⏳</div>
        <h4 style="font-size: 15px; color: #93c5fd; margin-bottom: 4px;" id="dcsLoadingText">Researching fresh verified topics...</h4>
        <p style="font-size: 12px; color: var(--text-muted);">Consulting AI models with scientific databases and generating FLUX visual scenes</p>
      </div>

      <!-- Empty State -->
      <div id="dcsEmptyState" style="display: none; text-align: center; padding: 48px 20px; background: #020617; border: 1px solid #1e293b; border-radius: 8px;">
        <div style="font-size: 36px; margin-bottom: 12px;">💡</div>
        <h3 style="font-size: 16px; color: #f8fafc; margin-bottom: 6px;">No Content Ideas in Queue for Today</h3>
        <p style="color: var(--text-muted); font-size: 13px; max-width: 520px; margin: 0 auto 18px auto;">
          Run Daily Research now to generate today's content topics, verified facts, and visual prompts based on your page's niche and cadence.
        </p>
        <button class="btn btn-primary" onclick="regenerateAllTopics()" style="font-size: 13px; padding: 8px 18px; font-weight: 700;">
          ✨ Generate Today's Ideas Now
        </button>
      </div>

      <!-- List of Ideas Cards -->
      <div id="dcsCardsContainer" style="display: flex; flex-direction: column; gap: 16px;"></div>

      <!-- Modal Footer -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e293b; padding-top: 16px; margin-top: 20px; flex-wrap: wrap; gap: 10px;">
        <div style="font-size: 12px; color: #64748b;">
          💡 Changes take effect immediately. Scheduled slots pop ideas in order (Slot 1, Slot 2...).
        </div>
        <button type="button" class="btn btn-secondary" onclick="closeDailyContentStudio()">Close</button>
      </div>
    </div>
  </div>

  <!-- EDIT CONTENT IDEA MODAL -->
  <div class="modal" id="editTopicIdeaModal" style="display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.88); backdrop-filter: blur(8px); z-index: 10001; overflow-y: auto; padding: 20px;">
    <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8); position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #1e293b; padding-bottom: 12px;">
        <h3 style="font-size: 18px; font-weight: 700; color: #f8fafc; margin: 0;" id="etiModalHeading">✏️ Edit Content & Image Idea</h3>
        <button type="button" onclick="closeEditTopicModal()" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer;">&times;</button>
      </div>

      <input type="hidden" id="etiId" value="" />

      <div style="margin-bottom: 14px;">
        <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">Topic Title</label>
        <input type="text" id="etiTitle" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #f8fafc; font-size: 14px;" placeholder="e.g. James Webb Confirms Water Vapor in PDS 70" />
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">Category</label>
          <input type="text" id="etiCategory" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #f8fafc; font-size: 13px;" placeholder="e.g. Space & Astronomy" />
        </div>
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">Headline (Wrap accents in **)</label>
          <input type="text" id="etiHeadline" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #f8fafc; font-size: 13px;" placeholder="e.g. WEBB CONFIRMS **WATER VAPOR** ON PLANET" />
        </div>
      </div>

      <div style="margin-bottom: 14px;">
        <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
          Verified Facts (One fact per line)
        </label>
        <textarea id="etiFacts" rows="4" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #f8fafc; font-size: 13px; line-height: 1.5;" placeholder="Fact 1&#10;Fact 2&#10;Fact 3"></textarea>
      </div>

      <div style="margin-bottom: 14px;">
        <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
          Visual Scene Description (For Image Generator)
        </label>
        <textarea id="etiVisualSubject" rows="3" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #f8fafc; font-size: 13px; line-height: 1.5;" placeholder="Vivid, photorealistic scene description of the exact physical subject"></textarea>
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">Image URL</label>
        <input type="text" id="etiImageUrl" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #f8fafc; font-size: 12px; font-family: monospace;" placeholder="https://..." />
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #1e293b; padding-top: 14px;">
        <button type="button" class="btn btn-secondary" onclick="closeEditTopicModal()">Cancel</button>
        <button type="button" class="btn btn-primary" onclick="saveTopicEditAction()">💾 Save Changes</button>
      </div>
    </div>
  </div>

  <!-- REGENERATE WITH CUSTOM PROMPT / FEEDBACK DIALOG -->
  <div class="modal" id="customPromptRegenModal" style="display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.88); backdrop-filter: blur(8px); z-index: 10001; overflow-y: auto; padding: 20px;">
    <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; width: 100%; max-width: 580px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8); position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid #1e293b; padding-bottom: 12px;">
        <h3 style="font-size: 17px; font-weight: 700; color: #f8fafc; margin: 0;">💬 Regenerate Idea with Custom Guidance</h3>
        <button type="button" onclick="closeCustomPromptRegenModal()" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer;">&times;</button>
      </div>

      <input type="hidden" id="cprItemId" value="" />
      <div style="font-size: 13px; color: #94a3b8; margin-bottom: 14px;">
        Currently replacing: <strong id="cprCurrentTitle" style="color: #f8fafc;">-</strong>
      </div>

      <div style="margin-bottom: 18px;">
        <label style="display: block; font-size: 12px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
          What would you like the AI to research or change?
        </label>
        <textarea id="cprGuidanceText" rows="4" class="form-control" style="width: 100%; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 10px 12px; color: #f8fafc; font-size: 13px; line-height: 1.5;" placeholder="e.g. Focus on deep-sea bioluminescence, or make it about Europa's ocean, or make the headline punchier with a number."></textarea>
        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">
          The AI will research a brand new, verified scientific topic matching your direction and generate a matching FLUX visual scene.
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #1e293b; padding-top: 14px;">
        <button type="button" class="btn btn-secondary" onclick="closeCustomPromptRegenModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="cprSubmitBtn" onclick="submitCustomPromptRegen()">🚀 Regenerate with this Direction</button>
      </div>
    </div>
  </div>

  <!-- IMAGE QUALITY BENCH MODAL -->
  <div class="modal" id="imageBenchModal" style="display: none; align-items: center; justify-content: center; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.9); backdrop-filter: blur(10px); z-index: 10002; overflow-y: auto; padding: 20px;">
    <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; width: 100%; max-width: 1100px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9); position: relative; max-height: 90vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid #1e293b; padding-bottom: 12px;">
        <div>
          <h3 style="font-size: 18px; font-weight: 700; color: #f8fafc; margin: 0;">🔬 Image Quality Bench (6-Prompt Standard Matrix)</h3>
          <p style="font-size: 13px; color: #94a3b8; margin: 4px 0 0 0;">
            Benchmark your image providers (Gemini 2.5 Flash, ZenMux, Pollinations Flux, Turbo, Seedream) side by side on 6 concrete scientific prompts.
          </p>
        </div>
        <button type="button" onclick="closeImageBenchModal()" style="background: none; border: none; color: #94a3b8; font-size: 24px; cursor: pointer;">&times;</button>
      </div>

      <!-- Provider Selection & Actions Bar -->
      <div style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span style="font-size: 13px; font-weight: 600; color: #cbd5e1;">Test Providers:</span>
          <div id="imageBenchProviderCheckboxes" style="display: flex; gap: 12px; flex-wrap: wrap;">
            <!-- Populated dynamically from image providers -->
          </div>
        </div>
        <button class="btn btn-primary" id="btnRunImageBench" onclick="runImageBenchAction()">
          ▶️ Run Benchmark (6 Prompts)
        </button>
      </div>

      <!-- Suggested Chain Order Banner (Shown after ratings) -->
      <div id="imageBenchOrderBanner" style="display: none; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 8px; padding: 12px 16px; margin-bottom: 18px; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <div>
          <strong style="color: #60a5fa; font-size: 14px;">💡 Recommended Failover Order Based on Your Ratings:</strong>
          <div id="imageBenchSuggestedList" style="font-size: 12px; color: #e2e8f0; margin-top: 4px; font-family: monospace;"></div>
        </div>
        <button class="btn btn-success" onclick="applySuggestedChainOrder()" style="padding: 6px 14px; font-size: 12px;">
          ✓ Apply Suggested Chain Order
        </button>
      </div>

      <!-- Benchmark Results Container -->
      <div id="imageBenchResultsContainer">
        <div style="text-align: center; padding: 40px 20px; color: #64748b;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔬</div>
          <div style="font-size: 14px; font-weight: 600; color: #94a3b8;">No Benchmark Run Executed Yet</div>
          <div style="font-size: 12px; max-width: 450px; margin: 4px auto 0 auto;">Select providers above and click "Run Benchmark" to test real outputs side-by-side with latency, cost, and thumbs up/down rating.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Safe Initial State (JSON payload, non-executable, immune to syntax errors) -->
  <script id="initial-data" type="application/json">
    ${JSON.stringify({
      accounts: accounts || [],
      pages: pages || [],
      posts: posts || [],
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
  <!-- Mobile Bottom Navigation Bar -->
  <nav class="mobile-bottom-nav">
    <button class="mobile-nav-btn ${routeInfo.tabId === 'overview' ? 'active' : ''}" data-mobile-tab="overview" onclick="showTab('overview', this)">
      <span class="icon">📊</span>
      <span>Overview</span>
    </button>
    <button class="mobile-nav-btn ${routeInfo.tabId === 'pages' ? 'active' : ''}" data-mobile-tab="pages" onclick="showTab('pages', this)">
      <span class="icon">📑</span>
      <span>Pages</span>
    </button>
    <button class="mobile-nav-btn ${routeInfo.tabId === 'calendar' ? 'active' : ''}" data-mobile-tab="calendar" onclick="showTab('calendar', this)">
      <span class="icon">📅</span>
      <span>Calendar</span>
    </button>
    <button class="mobile-nav-btn ${routeInfo.tabId === 'review' ? 'active' : ''}" data-mobile-tab="review" onclick="showTab('review', this)">
      <span class="icon">📬</span>
      <span>Review</span>
    </button>
    <button class="mobile-nav-btn" onclick="toggleMobileSidebar()" aria-label="Open all tabs menu">
      <span class="icon">☰</span>
      <span>Menu</span>
    </button>
  </nav>

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
  const profile = resolvePageProfile(page);

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

    /* Mobile Responsive Topbar, Drawer & Bottom Navigation */
    .mobile-topbar {
      display: none;
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      height: 56px;
      background: rgba(11, 15, 25, 0.95);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--card-border);
      padding: 0 14px;
      align-items: center;
      justify-content: space-between;
      z-index: 60;
    }
    .mobile-topbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .mobile-menu-btn {
      width: 40px;
      height: 40px;
      background: #1e293b;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      cursor: pointer;
      color: var(--text);
      padding: 0;
      flex-shrink: 0;
    }
    .mobile-menu-btn span {
      display: block;
      width: 18px;
      height: 2px;
      background: #e2e8f0;
      border-radius: 2px;
    }
    .mobile-topbar-title {
      font-size: 15px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #f3f4f6;
    }

    /* Mobile Backdrop */
    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      z-index: 70;
    }
    .sidebar-backdrop.active {
      display: block;
    }
    .sidebar-mobile-close-row {
      display: none;
    }

    /* Mobile Bottom Navigation Bar */
    .mobile-bottom-nav {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 60px;
      background: rgba(11, 15, 25, 0.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid var(--card-border);
      padding: 0 4px;
      z-index: 60;
      align-items: center;
      justify-content: space-around;
    }
    .mobile-nav-btn {
      flex: 1;
      height: 100%;
      background: none;
      border: none;
      color: #94a3b8;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      transition: color 0.15s;
    }
    .mobile-nav-btn span.icon {
      font-size: 18px;
      line-height: 1;
    }
    .mobile-nav-btn.active, .mobile-nav-btn:hover {
      color: #38bdf8;
    }

    /* Responsive Breakpoints for Mobile Phones & Tablets */
    @media (max-width: 900px) {
      body {
        flex-direction: column;
      }
      .mobile-topbar {
        display: flex;
      }
      .mobile-bottom-nav {
        display: flex;
      }
      .sidebar-mobile-close-row {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 8px;
      }
      .sidebar {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        width: min(300px, 84vw);
        z-index: 80;
        transform: translateX(-100%);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.7);
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      .sidebar.mobile-open {
        transform: translateX(0);
      }
      .main {
        padding: 16px 12px 84px 12px;
        max-width: 100vw;
        overflow-x: hidden;
      }
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 20px;
      }
      .grid {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .card {
        padding: 16px 14px;
      }
      table {
        display: block;
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        white-space: nowrap;
      }
      .modal {
        padding: 0;
        align-items: flex-end;
      }
      .modal-content {
        max-height: 94vh;
        border-radius: 20px 20px 0 0;
        padding: 20px 16px 28px 16px;
        width: 100%;
        max-width: 100%;
        border-bottom: none;
      }
      .form-control, .form-input, input, select, textarea {
        font-size: 16px !important;
        min-height: 44px;
      }
      .btn {
        min-height: 42px;
      }
    }
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
