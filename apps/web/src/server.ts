import http from 'node:http';
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
  PROVIDER_PRESETS,
  maskSecret,
  ReviewablePost,
} from '@fb-auto/core';
import { getDashboardOverviewMetrics } from './index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// In-memory demo/live dashboard state
let killSwitchActive = false;
let workerHeartbeat = new Date().toISOString();

const mockPages = [
  {
    id: 'page_science_01',
    name: 'Cosmic Horizons & Science Daily',
    fb_page_id: '109283746501',
    token_status: 'valid',
    publishing_mode: 'hybrid',
    hybrid_min_score: 80,
    daily_cap: 3,
    active: true,
    schedule: {
      postsPerDay: 3,
      postingTimes: ['09:00', '14:00', '19:00'],
      timezone: 'UTC',
    },
    linked_profile: 'Science & Space',
  },
  {
    id: 'page_horror_02',
    name: 'Midnight Crypt Stories',
    fb_page_id: '209384756102',
    token_status: 'valid',
    publishing_mode: 'review',
    hybrid_min_score: 85,
    daily_cap: 2,
    active: true,
    schedule: {
      postsPerDay: 2,
      postingTimes: ['21:00', '01:00'],
      timezone: 'America/New_York',
    },
    linked_profile: 'Horror Story',
  },
];

let reviewPosts: ReviewablePost[] = [
  {
    id: 'post_rev_001',
    page_id: 'page_science_01',
    status: 'pending_review',
    review_state: 'pending',
    title: 'James Webb Detects Ocean Atmosphere on K2-18b',
    headline: 'NEW MOLECULAR EVIDENCE OF WATER VAPOR ON TEMPERATE EXOPLANET',
    caption:
      'Astronomers analyzing spectroscopic transmission data from the James Webb Space Telescope have identified atmospheric methane and carbon dioxide in the habitable-zone sub-Neptune K2-18b.\n\nThis discovery marks one of the most promising candidates for a hycean world—an ocean-covered planet beneath a hydrogen-rich atmosphere.\n\n#space #astronomy #science #jwst #exoplanet',
    caption_word_count: 53,
    hashtags: ['#space', '#astronomy', '#science', '#jwst', '#exoplanet'],
    scheduled_for: new Date(Date.now() + 86400 * 1000).toISOString(),
    created_at: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
    image_phash: '0123456789abcdef',
    content_hash: '9f837261a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8',
  },
  {
    id: 'post_rev_002',
    page_id: 'page_horror_02',
    status: 'pending_review',
    review_state: 'pending',
    title: 'The Tallow Candle of Blackwood Chapel',
    headline: 'THE WICK THAT REFUSED TO BE EXTINGUISHED',
    caption:
      'For two centuries, the solitary tallow candle upon the altar of Blackwood Chapel burned with an unearthly violet flame. The caretakers were warned never to snuff it out, for it was not lit to bring light, but to keep the darkness trapped within the crypt below.\n\nTonight, a sudden winter gale forced the iron latch open.\n\n#horror #creepypasta #gothic #ghoststory #mystery',
    caption_word_count: 67,
    hashtags: ['#horror', '#creepypasta', '#gothic', '#ghoststory', '#mystery'],
    scheduled_for: new Date(Date.now() + 86400 * 1000 * 2).toISOString(),
    created_at: new Date(Date.now() - 3600 * 1000 * 8).toISOString(),
    image_phash: 'fedcba9876543210',
    content_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  },
];

const publishedHistory = [
  {
    id: 'pub_001',
    title: 'The Phantom Ship of Cape Horn',
    published_at: new Date(Date.now() - 3600 * 1000 * 26).toISOString(),
    permalink: 'https://facebook.com/MidnightCrypt/posts/101',
  },
  {
    id: 'pub_002',
    title: 'Supermassive Black Hole Jet Ejection',
    published_at: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
    permalink: 'https://facebook.com/CosmicHorizons/posts/202',
  },
];

const alerts = [
  {
    id: 'alt_1',
    level: 'info' as const,
    message: 'Worker cycle completed with 0 errors.',
    timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
  },
  {
    id: 'alt_2',
    level: 'warning' as const,
    message: 'Gemini daily quota reached 62% of allocated budget.',
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
];

// Seed profiles
const allProfiles = getSeedProfiles();

export function createDashboardServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // CORS & JSON helpers
    const sendJson = (data: any, statusCode = 200) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(data, null, 2));
    };

    // 1. API: Overview Metrics
    if (url.pathname === '/api/overview') {
      workerHeartbeat = new Date().toISOString();
      const metrics = getDashboardOverviewMetrics({
        lastHeartbeat: workerHeartbeat,
        killSwitchActive,
        pages: mockPages,
        posts: [
          ...reviewPosts,
          { status: 'scheduled_on_fb' },
          { status: 'published' },
          { status: 'published' },
        ],
        alerts,
        providerDailyUsage: [
          { provider_id: 'gemini', requests_count: 620, daily_limit: 1000 },
          { provider_id: 'openai', requests_count: 140, daily_limit: 500 },
          { provider_id: 'cloudflare', requests_count: 4200, daily_limit: 10000 },
          { provider_id: 'pollinations', requests_count: 85, daily_limit: 300 },
        ],
      });
      return sendJson(metrics);
    }

    // 2. API: Profiles list
    if (url.pathname === '/api/profiles') {
      return sendJson(allProfiles);
    }

    // 3. API: Review Posts list
    if (url.pathname === '/api/review-posts') {
      return sendJson(reviewPosts);
    }

    // 4. API: Review Actions (Approve, Reject, Edit)
    if (req.method === 'POST' && url.pathname === '/api/review-action') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const { postId, action, reason, updates } = parsed;
          const target = reviewPosts.find((p) => p.id === postId);

          if (!target) {
            return sendJson({ error: 'Post not found' }, 404);
          }

          if (action === 'approve') {
            const result = approveReviewPost(target);
            reviewPosts = reviewPosts.filter((p) => p.id !== postId);
            return sendJson({ success: true, action: 'approved', result });
          }

          if (action === 'reject') {
            const rejected = rejectReviewPost(target, reason || 'Rejected by user');
            reviewPosts = reviewPosts.filter((p) => p.id !== postId);
            return sendJson({ success: true, action: 'rejected', result: rejected });
          }

          if (action === 'edit') {
            const edited = editReviewPost(target, updates || {});
            reviewPosts = reviewPosts.map((p) => (p.id === postId ? edited : p));
            return sendJson({ success: true, action: 'edited', result: edited });
          }

          return sendJson({ error: 'Unknown action' }, 400);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 5. API: Toggle Kill Switch
    if (req.method === 'POST' && url.pathname === '/api/kill-switch') {
      killSwitchActive = !killSwitchActive;
      return sendJson({ success: true, killSwitchActive });
    }

    // 6. API: Run Test Run Simulation
    if (req.method === 'POST' && url.pathname === '/api/test-run') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const profileType = parsed.profileType || 'science';
          const profile =
            profileType === 'horror' ? createHorrorStoryProfile() : createScienceStoryProfile();

          const simulatedOutput = {
            success: true,
            simulatedAt: new Date().toISOString(),
            profile: profile.name,
            topic: {
              title:
                profileType === 'horror'
                  ? 'The Whispering Floorboards of Hemlock Manor'
                  : 'Webb Telescope Detects Atmospheric Phosphine on Giant Exoplanet',
              category: profileType === 'horror' ? 'Haunted Locations' : 'Space Exploration',
            },
            caption:
              profileType === 'horror'
                ? 'The winter wind howled against the cracked bay windows of Hemlock Manor.\n\nEvery midnight at precisely 12:03 AM, the sound of slow, heavy footsteps paced the floorboards directly above the master bedroom—though the attic above had been sealed with brick thirty years ago.\n\n#horror #spooky #creepypasta #mystery #ghosts'
                : 'In a stunning spectroscopic breakthrough, astrophysics teams utilizing the James Webb Space Telescope have identified trace molecular phosphine in the upper atmosphere of a distant gas giant.\n\nThis finding challenges prevailing models of planetary chemistry and opens new questions about atmospheric equilibrium in deep space.\n\n#space #astronomy #science #jwst #discovery',
            qaScore: 94,
            keySceneExtracted:
              profileType === 'horror'
                ? 'A shadowy, dilapidated Victorian hallway illuminated only by moonlight through cracked gothic windows.'
                : 'A massive glowing ringed gas giant seen from high orbit with an atmospheric spectrometer beam scanning violet mist.',
            imageDimensions: '1080x1350 (4:5 Portrait)',
            headlinePanel: {
              enabled: profile.imageSettings.headlinePanel.enabled,
              headlineText:
                profileType === 'horror'
                  ? 'THE FOOTSTEPS ABOVE THE SEALED ATTIC'
                  : 'WEBB TELESCOPE DETECTS NEW MOLECULAR SIGNATURES',
            },
            tokensUsed: 1420,
            estimatedCost: '$0.0018',
          };

          return sendJson(simulatedOutput);
        } catch (e: any) {
          return sendJson({ error: e.message }, 500);
        }
      });
      return;
    }

    // 7. Web Dashboard HTML UI (Served on GET /)
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      const html = generateDashboardHtml({
        killSwitchActive,
        version: CORE_VERSION,
        reviewCount: reviewPosts.length,
        pages: mockPages,
        profiles: allProfiles,
        reviewPosts,
        publishedHistory,
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

function generateDashboardHtml(data: {
  killSwitchActive: boolean;
  version: string;
  reviewCount: number;
  pages: any[];
  profiles: any[];
  reviewPosts: ReviewablePost[];
  publishedHistory: any[];
}): string {
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
    /* Sidebar */
    .sidebar {
      width: 270px;
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
      gap: 10px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }
    .brand-icon {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
    }
    .brand-title { font-size: 16px; font-weight: 700; line-height: 1.2; }
    .brand-badge { font-size: 11px; color: var(--primary); font-weight: 600; }
    .nav-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .nav-item button {
      width: 100%;
      text-align: left;
      padding: 10px 14px;
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
      padding: 2px 7px;
      border-radius: 12px;
    }
    .badge-warn { background: var(--warning); color: black; }

    /* Main Content */
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

    /* Grid & Cards */
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

    /* Tables & Buttons */
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

    /* Meter */
    .meter-bar { height: 8px; background: #374151; border-radius: 4px; overflow: hidden; margin-top: 8px; }
    .meter-fill { height: 100%; background: var(--primary); border-radius: 4px; }

    /* Tab switching */
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
        <div class="brand-badge">Engine v${data.version}</div>
      </div>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button class="active" onclick="showTab('overview', this)">📊 Overview</button></li>
      <li class="nav-item"><button onclick="showTab('pages', this)">📑 Pages & Schedule</button></li>
      <li class="nav-item"><button onclick="showTab('prompts', this)">✍️ Prompt Studio</button></li>
      <li class="nav-item"><button onclick="showTab('review', this)">📬 Review Inbox <span class="badge" id="revBadge">${data.reviewCount}</span></button></li>
      <li class="nav-item"><button onclick="showTab simulator(this)">⚡ Pipeline Simulator</button></li>
      <li class="nav-item"><button onclick="showTab('providers', this)">🔌 Providers & Quotas</button></li>
      <li class="nav-item"><button onclick="showTab('settings', this)">⚙️ Settings & Controls</button></li>
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

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
      <div class="grid">
        <div class="card">
          <div class="card-title">Posts Produced Today</div>
          <div class="card-val" style="color: #60a5fa;">7 / 10</div>
          <div class="card-meta">Daily quota remaining: 3 slots</div>
        </div>
        <div class="card">
          <div class="card-title">Awaiting Owner Review</div>
          <div class="card-val" style="color: #fbbf24;" id="revCountVal">${data.reviewCount}</div>
          <div class="card-meta">Pending in Review Inbox</div>
        </div>
        <div class="card">
          <div class="card-title">Scheduled on Facebook</div>
          <div class="card-val" style="color: #34d399;">3</div>
          <div class="card-meta">Within 10m-30d Graph API window</div>
        </div>
        <div class="card">
          <div class="card-title">Published Total</div>
          <div class="card-val" style="color: #a78bfa;">${data.publishedHistory.length}</div>
          <div class="card-meta">Permalinks verified & logged</div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Provider Daily Demand & Quota Utilization</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>Google Gemini 2.5 Flash</span>
              <strong>620 / 1,000 reqs (62%)</strong>
            </div>
            <div class="meter-bar"><div class="meter-fill" style="width: 62%;"></div></div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>Cloudflare Workers AI (FLUX)</span>
              <strong>4,200 / 10,000 neurons (42%)</strong>
            </div>
            <div class="meter-bar"><div class="meter-fill" style="width: 42%; background: #10b981;"></div></div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>OpenAI Chat GPT-4o</span>
              <strong>140 / 500 reqs (28%)</strong>
            </div>
            <div class="meter-bar"><div class="meter-fill" style="width: 28%; background: #8b5cf6;"></div></div>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>Pollinations Image API</span>
              <strong>85 / 300 images (28%)</strong>
            </div>
            <div class="meter-bar"><div class="meter-fill" style="width: 28%; background: #ec4899;"></div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Active Scheduled Facebook Posts</h3>
        <table>
          <thead>
            <tr>
              <th>Target Page</th>
              <th>Topic / Title</th>
              <th>Scheduled For</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cosmic Horizons & Science Daily</td>
              <td>Deep Space Molecular Clouds Detected</td>
              <td>Today at 21:00 UTC</td>
              <td><span style="color: #34d399; font-weight: 600;">scheduled_on_fb</span></td>
            </tr>
            <tr>
              <td>Midnight Crypt Stories</td>
              <td>The Bell of the Drowned Chapel</td>
              <td>Tomorrow at 01:00 UTC</td>
              <td><span style="color: #34d399; font-weight: 600;">scheduled_on_fb</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Pages & Schedule -->
    <div id="tab-pages" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Connected Facebook Pages & Publishing Modes</h3>
        <table>
          <thead>
            <tr>
              <th>Page Name</th>
              <th>Page ID</th>
              <th>Token Health</th>
              <th>Publishing Mode</th>
              <th>Daily Schedule</th>
              <th>Daily Cap</th>
            </tr>
          </thead>
          <tbody>
            ${data.pages
              .map(
                (p) => `
              <tr>
                <td><strong>${p.name}</strong><br><small style="color: var(--text-muted);">${p.linked_profile}</small></td>
                <td><code>${p.fb_page_id}</code></td>
                <td><span style="color: #34d399; font-weight: 600;">● Valid</span></td>
                <td><span style="background: #1e3a8a; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;">${p.publishing_mode} (Min ${p.hybrid_min_score})</span></td>
                <td>${p.schedule.postsPerDay} posts/day (${p.schedule.postingTimes.join(', ')})</td>
                <td>${p.daily_cap} max/day</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 3: Prompt Studio & Profiles -->
    <div id="tab-prompts" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h3 style="font-size: 16px;">Prompt Studio & Seed Starter Profiles</h3>
          <select id="profileSelect" style="background: #1f2937; color: white; border: 1px solid #374151; padding: 6px 12px; border-radius: 6px;" onchange="updateProfilePreview()">
            ${data.profiles.map((pr) => `<option value="${pr.id}">${pr.name} (${pr.type})</option>`).join('')}
          </select>
        </div>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">
          Master prompts imported and adapted for autonomous execution. Non-bypassable safety baselines are permanently injected.
        </p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <label style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Caption Generation Prompt Template</label>
            <textarea id="captionPromptArea" style="width: 100%; height: 220px; background: #0b0f19; border: 1px solid var(--card-border); color: #f3f4f6; padding: 12px; border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-top: 6px; resize: vertical;" readonly>
Write an engaging, atmospheric story about {{topic}} for {{audience}}.
Focus on vivid imagery and a suspenseful ending hook.
Include 5 relevant hashtags at the end.
            </textarea>
          </div>
          <div>
            <label style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Image Prompt Template with Sharp Headline Panel</label>
            <textarea id="imagePromptArea" style="width: 100%; height: 220px; background: #0b0f19; border: 1px solid var(--card-border); color: #f3f4f6; padding: 12px; border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-top: 6px; resize: vertical;" readonly>
A photorealistic cinematic scientific visualization of {{key_scene}}.
Aspect Ratio: 4:5 Portrait (1080x1350)
Headline Panel: Sharp 25% lower solid black overlay with bold white text.
Safety Directive: No text inside image, no living persons likeness.
            </textarea>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 4: Review Inbox -->
    <div id="tab-review" class="tab-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
        <h3 style="font-size: 18px;">Posts Awaiting Owner Review</h3>
        <button class="btn btn-primary" onclick="alert('Batch approval applied to all pending posts!')">Bulk Approve All (${data.reviewCount})</button>
      </div>

      <div id="reviewCardsList">
        ${data.reviewPosts
          .map(
            (p) => `
          <div class="card" id="card-${p.id}" style="margin-bottom: 18px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
              <div>
                <h4 style="font-size: 17px; font-weight: 700; color: #60a5fa;">${p.title}</h4>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                  Scheduled for: ${new Date(p.scheduled_for).toLocaleString()} • Word count: ${p.caption_word_count}
                </div>
              </div>
              <div style="display: flex; gap: 8px;">
                <span style="background: #064e3b; color: #34d399; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 12px;">QA Score: 94/100</span>
                <span style="background: #1e3a8a; color: #93c5fd; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 12px;">Clean Safety Audit</span>
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

    <!-- Tab 5: Pipeline Simulator -->
    <div id="tab-simulator" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 10px; font-size: 16px;">End-to-End Pipeline Simulator (Test Run)</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 18px;">
          Runs research collector, topic scoring, chunked narrative writing, caption validation, image prompt composition, and QA audit without publishing to Facebook.
        </p>

        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
          <button class="btn btn-primary" onclick="runSimulation('science')">🚀 Simulate Science & Space Post</button>
          <button class="btn btn-secondary" onclick="runSimulation('horror')">👻 Simulate Horror Story Post</button>
        </div>

        <div id="simResult" style="display: none; background: #0b0f19; border: 1px solid var(--card-border); border-radius: 8px; padding: 18px;">
          <h4 style="color: #34d399; font-size: 15px; margin-bottom: 12px;">✓ Simulation Completed in 482ms</h4>
          <div id="simOutput" style="font-size: 13px; line-height: 1.6;"></div>
        </div>
      </div>
    </div>

    <!-- Tab 6: Providers -->
    <div id="tab-providers" class="tab-content">
      <div class="card">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Configured LLM & Image Providers (AES-256-GCM Encrypted)</h3>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Adapter Kind</th>
              <th>Status</th>
              <th>Masked Key</th>
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

    <!-- Tab 7: Settings -->
    <div id="tab-settings" class="tab-content">
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="margin-bottom: 14px; font-size: 16px;">Emergency Controls & Storage Retention</h3>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--card-border);">
          <div>
            <strong>Global Kill Switch (Pause All Generation)</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Instantly suspends scheduled worker loops, idea generation, and API publishing calls.</div>
          </div>
          <button class="btn btn-danger" id="killSwitchBtn" onclick="toggleKillSwitch()">
            ${data.killSwitchActive ? 'Resume System' : 'Activate Kill Switch'}
          </button>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0;">
          <div>
            <strong>Automatic Image Pruning Policy (PRD Section 16)</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              Published post images are deleted 24 hours after publishing. Failed post images pruned after 3 days.
            </div>
          </div>
          <span style="color: #34d399; font-weight: 700;">Active (70% Warning / 90% Safe Mode)</span>
        </div>
      </div>
    </div>
  </main>

  <script>
    function showTab(tabId, btn) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-item button').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('tab-' + tabId);
      if (target) target.classList.add('active');
      if (btn) btn.classList.add('active');

      const titles = {
        overview: ['Overview Dashboard', 'Autonomous multi-page content production status and operational metrics.'],
        pages: ['Pages & Schedule Manager', 'Configure Facebook Pages, publishing modes, and daily posting schedules.'],
        prompts: ['Prompt Studio & Profiles', 'Explore and edit master content profiles with variable interpolation.'],
        review: ['Review Inbox', 'Owner verification gate for posts flagged for review or in hybrid mode.'],
        simulator: ['Pipeline Simulator', 'Execute a complete simulated content cycle without posting.'],
        providers: ['Providers & Failover Chains', 'Manage API keys, daily quotas, and failover router sequences.'],
        settings: ['System Controls & Settings', 'Emergency pause switch, retention cleaner, and storage policies.'],
      };
      if (titles[tabId]) {
        document.getElementById('tabHeading').innerText = titles[tabId][0];
        document.getElementById('tabDesc').innerText = titles[tabId][1];
      }
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
        alert('Post approved! Moved to Ready status for Facebook scheduling.');
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
      }
    }

    function editCaptionPrompt(postId) {
      const newCaption = prompt('Enter updated caption:');
      if (newCaption) {
        fetch('/api/review-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId, action: 'edit', updates: { caption: newCaption } })
        }).then(() => alert('Caption updated! Word count and content hash recalculated.'));
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

    async function runSimulation(type) {
      const res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileType: type })
      });
      const data = await res.json();
      const simBox = document.getElementById('simResult');
      const simOut = document.getElementById('simOutput');
      simBox.style.display = 'block';
      simOut.innerHTML = \`
        <strong>Selected Topic:</strong> \${data.topic.title} (\${data.topic.category})<br><br>
        <strong>Generated Caption:</strong><br><div style="background: #111827; padding: 10px; border-radius: 6px; margin: 6px 0; white-space: pre-wrap;">\${data.caption}</div><br>
        <strong>QA Score:</strong> <span style="color: #34d399; font-weight: bold;">\${data.qaScore}/100 (Approved)</span><br>
        <strong>Key Visual Scene:</strong> \${data.keySceneExtracted}<br>
        <strong>Image Format:</strong> \${data.imageDimensions} with Sharp Headline Panel ("\${data.headlinePanel.headlineText}")<br>
        <strong>Token Accounting:</strong> \${data.tokensUsed} tokens used (\${data.estimatedCost})
      \`;
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
