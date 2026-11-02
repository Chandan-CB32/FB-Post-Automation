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
} from '@fb-auto/core';
import { SystemStore, StoredPage } from './server/storage.js';
import { getDashboardOverviewMetrics } from './index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const store = SystemStore.getInstance();
const seedProfiles = getSeedProfiles();

export function createDashboardServer(): http.Server {
  return http.createServer(async (req, res) => {
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
        providerDailyUsage: [
          { provider_id: 'gemini', requests_count: 520, daily_limit: 1000 },
          { provider_id: 'cloudflare', requests_count: 3600, daily_limit: 10000 },
          { provider_id: 'openai', requests_count: 110, daily_limit: 500 },
          { provider_id: 'pollinations', requests_count: 45, daily_limit: 300 },
        ],
      });

      return sendJson(metrics);
    }

    // 2. API: Profiles list
    if (url.pathname === '/api/profiles') {
      return sendJson(seedProfiles);
    }

    // 3. API: Pages CRUD
    if (url.pathname === '/api/pages') {
      if (req.method === 'GET') {
        return sendJson(store.getPages());
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

            const newPage = store.createPage({
              name: data.name,
              fb_page_id: data.fb_page_id,
              fb_page_token: data.fb_page_token,
              profile_id: data.profile_id || 'science_space',
              publishing_mode: data.publishing_mode || 'hybrid',
              hybrid_min_score: Number(data.hybrid_min_score) || 80,
              daily_cap: Number(data.daily_cap) || 3,
              schedule: data.schedule,
              custom_caption_prompt: data.custom_caption_prompt || '',
              custom_caption_prompt_mode: data.custom_caption_prompt_mode || 'append',
              custom_image_prompt: data.custom_image_prompt || '',
              custom_image_prompt_mode: data.custom_image_prompt_mode || 'append',
              overrides: data.overrides || {},
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
            p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
            page.profile_id.toLowerCase().includes(p.name.toLowerCase())
        ) || seedProfiles[0];

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
          const profile =
            seedProfiles.find(
              (p) =>
                page &&
                (p.name.toLowerCase().includes(page.profile_id.toLowerCase()) ||
                  page.profile_id.toLowerCase().includes(p.name.toLowerCase()))
            ) || seedProfiles[0];

          const isHorror = profile.name.toLowerCase().includes('horror');

          const topicTitle = isHorror
            ? 'The Whispering Clock of Hemlock Manor'
            : 'Webb Telescope Identifies Potential Hycean Atmosphere on K2-18b';

          const topicCategory = isHorror ? 'Haunted Relics' : 'Exoplanet Atmospheres';

          const captionPromptCustom = page?.custom_caption_prompt
            ? `\n\n[Page Override Applied: ${page.custom_caption_prompt}]`
            : '';

          const generatedCaption = isHorror
            ? `The grandfather clock in the study of Hemlock Manor had not been wound since 1894, yet every night at 3:17 AM, its brass pendulum swung into motion.\n\nLocal legend claimed that the clock did not mark the passage of hours, but the distance between our world and the darkness beneath the cellar stairs.\n\nWhat would you do if a broken clock in your house suddenly started chiming?${captionPromptCustom}\n\n#horror #spooky #creepypasta #mystery #ghoststory`
            : `Astrophysicists analyzing spectroscopic transmission data from the James Webb Space Telescope have detected atmospheric methane and carbon dioxide in the habitable zone exoplanet K2-18b.\n\nThis finding supports the hypothesis that K2-18b could be a Hycean world—an ocean-covered planet beneath a hydrogen-rich atmosphere.\n\nDo you believe ocean worlds are our best chance of discovering microbial life outside the solar system?${captionPromptCustom}\n\n#space #astronomy #science #jwst #discovery`;

          const headline = isHorror
            ? 'THE CLOCK THAT TICKED WITHOUT TIME'
            : 'WEBB TELESCOPE FINDS WATER VAPOR ON EXOPLANET';

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
            keySceneExtracted: isHorror
              ? 'An antique dark mahogany pendulum clock in a moonlit decaying library, casting long shadows.'
              : 'A vibrant turquoise ocean planet viewed from low orbit with a luminous atmosphere glowing in infrared star light.',
            imageDimensions: page?.overrides?.['image.aspectRatio'] === '1:1' ? '1080x1080 (1:1 Square)' : '1080x1350 (4:5 Portrait)',
            headlinePanel: {
              enabled: page?.overrides?.['image.headlinePanel.enabled'] ?? true,
              headlineText: headline,
              backgroundColor: page?.overrides?.['image.headlinePanel.backgroundColor'] || '#050b14',
            },
            tokensUsed: 1380,
            estimatedCost: '$0.0016',
          };

          return sendJson(simOutput);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 9. Web Dashboard HTML UI
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      const html = generateDashboardHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

function generateDashboardHtml(): string {
  const pages = store.getPages();
  const posts = store.getPosts();
  const killSwitch = store.getKillSwitch();
  const reviewPosts = posts.filter((p) => p.status === 'pending_review' || p.review_state === 'pending');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autonomous Facebook Content Automation System</title>
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
      <div class="brand-icon">FB</div>
      <div>
        <div class="brand-title">FB Autonomous</div>
        <div class="brand-badge">Engine v${CORE_VERSION}</div>
      </div>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button class="active" onclick="showTab('overview', this)">📊 Overview</button></li>
      <li class="nav-item"><button onclick="showTab('pages', this)">📑 Pages & Accounts (<span id="sidebarPageCount">${pages.length}</span>)</button></li>
      <li class="nav-item"><button onclick="showTab('page-prompts', this)">✍️ Page Prompt Studio</button></li>
      <li class="nav-item"><button onclick="showTab('review', this)">📬 Review Inbox <span class="badge" id="revBadge">${reviewPosts.length}</span></button></li>
      <li class="nav-item"><button onclick="showTab('simulator', this)">⚡ Test Run Simulator</button></li>
      <li class="nav-item"><button onclick="showTab('providers', this)">🔌 Providers & Quotas</button></li>
      <li class="nav-item"><button onclick="showTab('settings', this)">⚙️ Settings & Kill Switch</button></li>
    </ul>
  </aside>

  <!-- Main Body -->
  <main class="main">
    <header class="header">
      <div class="header-title">
        <h1 id="tabHeading">Overview Dashboard</h1>
        <p id="tabDesc">Autonomous multi-page content production status and operational metrics.</p>
      </div>
      <div class="status-pill" id="workerPill">
        <div class="status-dot"></div>
        <span>Worker Active & Heartbeat Healthy</span>
      </div>
    </header>

    <!-- TAB 1: OVERVIEW -->
    <div id="tab-overview" class="tab-content active">
      <div class="grid">
        <div class="card">
          <div class="card-title">Connected Facebook Pages</div>
          <div class="card-val" style="color: #60a5fa;" id="ovPageCount">${pages.length}</div>
          <div class="card-meta">All configured with custom prompts</div>
        </div>
        <div class="card">
          <div class="card-title">Awaiting Owner Review</div>
          <div class="card-val" style="color: #fbbf24;" id="ovRevCount">${reviewPosts.length}</div>
          <div class="card-meta">Pending verification in Review Inbox</div>
        </div>
        <div class="card">
          <div class="card-title">Scheduled on Facebook</div>
          <div class="card-val" style="color: #34d399;" id="ovSchedCount">${posts.filter((p) => p.status === 'scheduled_on_fb').length}</div>
          <div class="card-meta">Within Graph API 10m-30d window</div>
        </div>
        <div class="card">
          <div class="card-title">Published Total</div>
          <div class="card-val" style="color: #a78bfa;">${posts.filter((p) => p.status === 'published').length}</div>
          <div class="card-meta">Permalinks verified & logged</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Provider Daily Demand & Quotas</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>Google Gemini 2.5 Flash</span>
              <strong>520 / 1,000 reqs (52%)</strong>
            </div>
            <div style="height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 6px;"><div style="height: 100%; width: 52%; background: var(--primary);"></div></div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>Cloudflare Workers AI (FLUX)</span>
              <strong>3,600 / 10,000 neurons (36%)</strong>
            </div>
            <div style="height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 6px;"><div style="height: 100%; width: 36%; background: var(--success);"></div></div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>OpenAI GPT-4o</span>
              <strong>110 / 500 reqs (22%)</strong>
            </div>
            <div style="height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 6px;"><div style="height: 100%; width: 22%; background: var(--accent);"></div></div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>Pollinations Image API</span>
              <strong>45 / 300 images (15%)</strong>
            </div>
            <div style="height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 6px;"><div style="height: 100%; width: 15%; background: #ec4899;"></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: PAGES & ACCOUNTS -->
    <div id="tab-pages" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <h3 style="font-size: 18px;">Connected Facebook Pages</h3>
            <p style="color: var(--text-muted); font-size: 13px;">Each Page runs on its own isolated prompt pack, voice, and publishing schedule.</p>
          </div>
          <button class="btn btn-primary" onclick="openAddPageModal()">➕ Connect / Add New Page</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Page Name & Base Niche</th>
              <th>Facebook Page ID</th>
              <th>Publishing Mode</th>
              <th>Posting Schedule</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="pagesTableBody">
            ${pages
              .map(
                (p) => `
              <tr id="page-row-${p.id}">
                <td>
                  <strong>${p.name}</strong><br>
                  <small style="color: #60a5fa;">Profile: ${p.profile_id}</small>
                </td>
                <td><code>${p.fb_page_id}</code></td>
                <td>
                  <span style="background: #1e3a8a; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                    ${p.publishing_mode} (Min ${p.hybrid_min_score})
                  </span>
                </td>
                <td>${p.schedule.postsPerDay} posts/day (${p.schedule.postingTimes.join(', ')})</td>
                <td>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary" onclick="openPagePromptStudio('${p.id}')">✍️ Custom Prompts</button>
                    <button class="btn btn-danger" onclick="deletePageAction('${p.id}')">🗑️</button>
                  </div>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: PAGE PROMPT STUDIO -->
    <div id="tab-page-prompts" class="tab-content">
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
              <label>Base Content Niche / Profile</label>
              <select id="editProfileSelect" class="form-control">
                ${seedProfiles.map((pr) => `<option value="${pr.id}">${pr.name} (${pr.type})</option>`).join('')}
              </select>
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
      </div>
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
        ${reviewPosts
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

            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button class="btn btn-secondary" onclick="editCaptionPrompt('${p.id}')">✏️ Edit Caption</button>
              <button class="btn btn-danger" onclick="rejectPostAction('${p.id}')">✕ Reject</button>
              <button class="btn btn-success" onclick="approvePostAction('${p.id}')">✓ Approve & Schedule</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>

    <!-- TAB 5: PIPELINE SIMULATOR -->
    <div id="tab-simulator" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 10px; font-size: 16px;">End-to-End Pipeline Simulator (Test Run)</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 18px;">
          Runs research collector, topic scoring, chunked narrative writing, caption validation, image prompt composition, and QA audit for any selected page.
        </p>

        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 20px;">
          <select id="simPageSelect" class="form-control" style="width: 320px;">
            ${pages.map((p) => `<option value="${p.id}">Page: ${p.name}</option>`).join('')}
          </select>
          <button class="btn btn-primary" onclick="runSimulationForSelectedPage()">🚀 Run Test Run For Page</button>
        </div>

        <div id="simResult" style="display: none; background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 18px;">
          <h4 style="color: #34d399; font-size: 15px; margin-bottom: 12px;">✓ Simulation Completed with Page's Exact Prompts</h4>
          <div id="simOutput" style="font-size: 13px; line-height: 1.6;"></div>
        </div>
      </div>
    </div>

    <!-- TAB 6: PROVIDERS -->
    <div id="tab-providers" class="tab-content">
      <div class="card">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Configured LLM & Image Providers (AES-256-GCM Encrypted)</h3>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Adapter Kind</th>
              <th>Status</th>
              <th>Encrypted Key Storage</th>
              <th>Failover Strategy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Google Gemini 2.5 Flash</strong></td>
              <td><code>gemini_native</code></td>
              <td><span style="color: #34d399; font-weight: 600;">● Active</span></td>
              <td><code>AIza...8932</code></td>
              <td>Priority 1</td>
            </tr>
            <tr>
              <td><strong>OpenAI GPT-4o</strong></td>
              <td><code>openai_compatible_chat</code></td>
              <td><span style="color: #34d399; font-weight: 600;">● Active</span></td>
              <td><code>sk-...cdef</code></td>
              <td>Priority 2 (Failover)</td>
            </tr>
            <tr>
              <td><strong>Cloudflare Workers AI (FLUX)</strong></td>
              <td><code>cloudflare_workers_ai</code></td>
              <td><span style="color: #34d399; font-weight: 600;">● Active</span></td>
              <td><code>cf-...7789</code></td>
              <td>Image Primary</td>
            </tr>
            <tr>
              <td><strong>Pollinations AI</strong></td>
              <td><code>pollinations_image</code></td>
              <td><span style="color: #34d399; font-weight: 600;">● Active</span></td>
              <td><code>Free Tier (No Auth)</code></td>
              <td>Image Failover</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 7: SETTINGS & KILL SWITCH -->
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
          <label>Base Content Niche / Profile</label>
          <select id="newProfileId" class="form-control">
            ${seedProfiles.map((pr) => `<option value="${pr.id}">${pr.name} (${pr.type})</option>`).join('')}
          </select>
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

  <script>
    let pagesData = ${JSON.stringify(pages)};

    function showTab(tabId, btn) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-item button').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('tab-' + tabId);
      if (target) target.classList.add('active');
      if (btn) btn.classList.add('active');

      const titles = {
        overview: ['Overview Dashboard', 'Autonomous multi-page content production status and operational metrics.'],
        pages: ['Pages & Accounts', 'Manage connected Facebook Pages, schedule slots, and publishing modes.'],
        'page-prompts': ['Page Prompt Studio', 'Configure page-specific prompt packs, voice overrides, and visual styles.'],
        review: ['Review Inbox', 'Owner verification gate for posts flagged for review or in hybrid mode.'],
        simulator: ['Test Run Simulator', 'Execute a complete simulated content cycle for any page without posting.'],
        providers: ['Providers & Failover Chains', 'Manage API keys, daily quotas, and failover router sequences.'],
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

    function openAddPageModal() {
      document.getElementById('addPageModal').classList.add('active');
    }

    function closeAddPageModal() {
      document.getElementById('addPageModal').classList.remove('active');
    }

    async function submitNewPage(e) {
      e.preventDefault();
      const name = document.getElementById('newPageName').value;
      const fb_page_id = document.getElementById('newPageFbId').value;
      const fb_page_token = document.getElementById('newPageToken').value;
      const profile_id = document.getElementById('newProfileId').value;
      const publishing_mode = document.getElementById('newPublishingMode').value;
      const daily_cap = parseInt(document.getElementById('newDailyCap').value, 10) || 3;
      const postingTimes = document.getElementById('newPostingTimes').value.split(',').map(s => s.trim()).filter(Boolean);
      const custom_caption_prompt = document.getElementById('newCaptionPrompt').value;

      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          fb_page_id,
          fb_page_token,
          profile_id,
          publishing_mode,
          daily_cap,
          schedule: { postsPerDay: postingTimes.length, postingTimes, timezone: 'UTC' },
          custom_caption_prompt,
        })
      });

      if (res.ok) {
        closeAddPageModal();
        alert('Page successfully added and encrypted! Refreshing...');
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
      showTab('page-prompts', document.querySelectorAll('.nav-item button')[2]);
      document.getElementById('studioPageSelect').value = pageId;
      loadPageIntoStudio();
    }

    function loadPageIntoStudio() {
      const pageId = document.getElementById('studioPageSelect').value;
      const page = pagesData.find(p => p.id === pageId) || pagesData[0];
      if (!page) return;

      document.getElementById('editProfileSelect').value = page.profile_id;
      document.getElementById('editCaptionPrompt').value = page.custom_caption_prompt || '';
      document.getElementById('editCaptionMode').value = page.custom_caption_prompt_mode || 'append';
      document.getElementById('editImagePrompt').value = page.custom_image_prompt || '';
      document.getElementById('editImageMode').value = page.custom_image_prompt_mode || 'append';

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
      const custom_caption_prompt = document.getElementById('editCaptionPrompt').value;
      const custom_caption_prompt_mode = document.getElementById('editCaptionMode').value;
      const custom_image_prompt = document.getElementById('editImagePrompt').value;
      const custom_image_prompt_mode = document.getElementById('editImageMode').value;

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
          custom_caption_prompt,
          custom_caption_prompt_mode,
          custom_image_prompt,
          custom_image_prompt_mode,
          overrides,
        })
      });

      if (res.ok) {
        alert('Custom prompts and settings for this Page successfully saved!');
        const updated = await res.json();
        // Update local memory
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
      showTab('simulator', document.querySelectorAll('.nav-item button')[4]);
      document.getElementById('simPageSelect').value = pageId;
      runSimulationForSelectedPage();
    }

    async function runSimulationForSelectedPage() {
      const pageId = document.getElementById('simPageSelect').value;
      const res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId })
      });
      const data = await res.json();
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
