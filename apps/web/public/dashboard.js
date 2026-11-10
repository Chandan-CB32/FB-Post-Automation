/**
 * FB Auto 247 - Client Dashboard Script
 * Made by Chandan Biswas
 */

(function () {
  'use strict';

  // In-memory client state initialized from <script id="initial-data" type="application/json">
  let accountsData = [];
  let pagesData = [];
  let providersData = [];
  let providerKeysData = [];
  let auditLogsData = [];
  let storageHealth = null;

  // Track loaded tabs to prevent unnecessary re-fetching
  const loadedTabs = new Set(['overview']);

  function safeParseInitialData() {
    try {
      const dataElem = document.getElementById('initial-data');
      if (dataElem && dataElem.textContent) {
        const parsed = JSON.parse(dataElem.textContent);
        if (parsed.accounts) accountsData = parsed.accounts;
        if (parsed.pages) pagesData = parsed.pages;
        if (parsed.providers) providersData = parsed.providers;
        if (parsed.providerKeys) providerKeysData = parsed.providerKeys;
        if (parsed.auditLogs) auditLogsData = parsed.auditLogs;
        if (parsed.storageHealth) storageHealth = parsed.storageHealth;
      }
    } catch (e) {
      console.warn('[Dashboard] Could not parse initial JSON payload, fetching dynamically:', e);
    }
  }

  // --- Tab Navigation, Titles & Clean Routing ---
  const TAB_TITLES = {
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

  const TAB_TO_ROUTE = {
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

  const ROUTE_TO_TAB = {
    '/overview': 'overview',
    '/accounts': 'accounts',
    '/pages': 'pages',
    '/prompts': 'page-prompts',
    '/review': 'review',
    '/calendar': 'calendar',
    '/analytics': 'analytics',
    '/test-run': 'simulator',
    '/providers': 'providers',
    '/audit-logs': 'audit',
    '/settings': 'settings',
  };

  function hasUnsavedModalChanges() {
    var modal = document.getElementById('pageSettingsModal');
    if (!modal || !modal.classList.contains('active')) return false;
    if (typeof getModalSnapshot !== 'function' || !currentModalOriginalSnapshot) return false;
    var currentSnapshot = getModalSnapshot();
    return currentSnapshot !== currentModalOriginalSnapshot;
  }

  function showTab(tabId, btn, pushState) {
    if (pushState === undefined) pushState = true;
    if (!tabId) tabId = 'overview';

    if (hasUnsavedModalChanges()) {
      if (!confirm('You have unsaved changes in Page Settings. Discard changes and switch tabs?')) {
        return;
      }
      closePageSettingsModal(false);
    }

    document.querySelectorAll('.tab-content').forEach(function (el) {
      el.classList.remove('active');
    });
    document.querySelectorAll('.nav-list .nav-item button').forEach(function (el) {
      el.classList.remove('active');
    });

    const target = document.getElementById('tab-' + tabId);
    if (target) {
      target.classList.add('active');
    }

    if (btn) {
      btn.classList.add('active');
    } else {
      const matchingBtn = document.querySelector('.nav-list .nav-item button[data-tab="' + tabId + '"]');
      if (matchingBtn) matchingBtn.classList.add('active');
    }

    if (TAB_TITLES[tabId]) {
      const heading = document.getElementById('tabHeading');
      const desc = document.getElementById('tabDesc');
      if (heading) heading.innerText = TAB_TITLES[tabId][0];
      if (desc) desc.innerText = TAB_TITLES[tabId][1];
      document.title = 'FB Auto 247 - ' + TAB_TITLES[tabId][0];
    }

    const routePath = TAB_TO_ROUTE[tabId] || '/overview';
    if (pushState && window.location.pathname !== routePath) {
      try {
        history.pushState({ tabId: tabId }, '', routePath);
      } catch (e) {}
    }

    try {
      sessionStorage.setItem('last_active_tab', routePath);
    } catch (e) {}

    if (tabId === 'page-prompts') {
      loadPageIntoStudio();
    }

    // Lazy load tab data if not already loaded
    ensureTabDataLoaded(tabId);
  }

  // Expose showTab immediately on window
  window.showTab = showTab;
  window.TAB_TO_ROUTE = TAB_TO_ROUTE;
  window.ROUTE_TO_TAB = ROUTE_TO_TAB;

  function restoreSubStateFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const panel = params.get('panel');
      const pageId = params.get('page');
      const dialog = params.get('dialog');
      const providerId = params.get('provider');
      const profileId = params.get('profile');

      if (panel === 'settings' && pageId) {
        openPageSettingsModal(pageId);
      } else if (!panel) {
        closePageSettingsModal(false);
      }

      if (dialog === 'keys' && providerId) {
        openManageKeysModal(providerId);
      } else if (!dialog) {
        closeManageKeysModal(false);
      }

      if (profileId) {
        const select = document.getElementById('editProfileSelect');
        if (select) {
          select.value = profileId;
          if (typeof toggleCustomNicheField === 'function') {
            toggleCustomNicheField(profileId, 'studioCustomNicheBox');
          }
        }
      }
    } catch (e) {
      console.warn('[Dashboard] Error restoring sub-state:', e);
    }
  }

  window.addEventListener('popstate', function (e) {
    const path = window.location.pathname;
    const tabId = ROUTE_TO_TAB[path] || (e.state && e.state.tabId) || 'overview';
    showTab(tabId, null, false);
    restoreSubStateFromUrl();
  });

  window.addEventListener('beforeunload', function (e) {
    if (hasUnsavedModalChanges()) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes in Page Settings.';
      return e.returnValue;
    }
  });

  function ensureTabDataLoaded(tabId) {
    if (loadedTabs.has(tabId)) return;
    loadedTabs.add(tabId);

    if (tabId === 'accounts' && accountsData.length === 0) {
      fetchAccountsTab();
    } else if (tabId === 'pages' && pagesData.length === 0) {
      fetchPagesTab();
    } else if (tabId === 'providers' && providersData.length === 0) {
      fetchProvidersTab();
    } else if (tabId === 'audit' && auditLogsData.length === 0) {
      fetchAuditTab();
    }
  }

  function showTabError(tabId, message, retryFn) {
    const tabEl = document.getElementById('tab-' + tabId);
    if (!tabEl) return;
    const existing = tabEl.querySelector('.tab-error-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'tab-error-banner';
    banner.style.cssText = 'background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;';
    banner.innerHTML = '<div>⚠️ <strong>Failed to load data:</strong> ' + escapeHtml(message) + '</div>';

    if (typeof retryFn === 'function') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-secondary';
      retryBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; margin-left: 12px;';
      retryBtn.innerText = '🔄 Retry';
      retryBtn.onclick = function () {
        banner.remove();
        retryFn();
      };
      banner.appendChild(retryBtn);
    }
    tabEl.prepend(banner);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Dynamic Tab Data Fetchers ---
  async function fetchAccountsTab() {
    try {
      const res = await fetch('/api/accounts');
      if (!res.ok) throw new Error('Status ' + res.status);
      const accounts = await res.json();
      accountsData = accounts;
      renderAccountsTable(accounts);
    } catch (err) {
      showTabError('accounts', err.message, fetchAccountsTab);
    }
  }

  async function fetchPagesTab() {
    try {
      const res = await fetch('/api/pages');
      if (!res.ok) throw new Error('Status ' + res.status);
      const pages = await res.json();
      pagesData = pages;
      renderPagesTable(pages);
    } catch (err) {
      showTabError('pages', err.message, fetchPagesTab);
    }
  }

  async function fetchProvidersTab() {
    try {
      const [pRes, kRes] = await Promise.all([
        fetch('/api/providers'),
        fetch('/api/provider-keys'),
      ]);
      if (pRes.ok) providersData = await pRes.json();
      if (kRes.ok) {
        const keysObj = await kRes.json();
        providerKeysData = keysObj.keys || keysObj;
      }
      renderProvidersTables();
    } catch (err) {
      showTabError('providers', err.message, fetchProvidersTab);
    }
  }

  function isImageProvider(p) {
    const kind = (p.adapter_kind || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    const model = (p.model_name || '').toLowerCase();
    return (
      kind === 'pollinations' ||
      kind === 'cloudflare_workers_ai' ||
      kind === 'openai_compatible_images' ||
      name.includes('image') ||
      model.includes('flux') ||
      model.includes('dall-e') ||
      model.includes('stable-diffusion')
    );
  }

  function getOfficialFreeQuotaClient(p) {
    const name = (p.name || '').toLowerCase();
    const kind = (p.adapter_kind || '').toLowerCase();
    const model = (p.model_name || '').toLowerCase();

    if (kind.includes('gemini') || name.includes('gemini')) return { limit: 1500, badge: '1,500 reqs/day', note: 'Google AI Studio free tier: 15 RPM / 1,500 RPD' };
    if (name.includes('groq') || model.includes('groq')) return { limit: 14400, badge: '14,400 reqs/day (token-gated)', note: 'Groq Cloud free tier: 30 RPM / 14,400 RPD' };
    if (name.includes('openrouter') || model.includes('openrouter')) return { limit: 200, badge: '200 reqs/day', note: 'OpenRouter free models tier (:free)' };
    if (kind.includes('cloudflare') || name.includes('cloudflare')) return { limit: 10000, badge: '10,000 neurons/day', note: 'Cloudflare Workers AI free tier' };
    if (kind.includes('huggingface') || name.includes('hugging') || name.includes('hf')) return { limit: 0, badge: '0 credits (rate-limited)', note: 'Hugging Face free tier: 0 monthly credits' };
    if (kind.includes('pollinations') || name.includes('pollinations')) return { limit: 1000, badge: '1,000 reqs/day', note: 'Pollinations AI free tier' };
    return null;
  }

  function renderChainTableBody(tbodyId, chainProviders, chainType) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (chainProviders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">No ' + (chainType === 'text' ? 'text generation' : 'image generation') + ' providers configured in this chain.</td></tr>';
      return;
    }

    tbody.innerHTML = chainProviders.map(function (p, idx) {
      const keys = providerKeysData.filter(function (k) { return k.provider_id === p.id; });
      const activeKeys = keys.filter(function (k) { return k.is_active; });
      const keyBadges = keys.length > 0
        ? keys.map(function (k) {
            return '<span class="badge" style="background: ' + (k.is_active ? '#1e293b' : '#27272a') + '; color: ' + (k.is_active ? '#93c5fd' : '#71717a') + '; font-family: \'JetBrains Mono\', monospace; font-size: 11px; margin: 2px; display: inline-block;">' + escapeHtml(k.masked_key) + '</span>';
          }).join('')
        : '<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No keys added</span>';

      const officialQuota = getOfficialFreeQuotaClient(p);
      const exceedsQuota = officialQuota && (
        (officialQuota.limit > 0 && (p.daily_limit || 0) > officialQuota.limit) ||
        (officialQuota.limit === 0 && (p.daily_limit || 0) > 0)
      );

      let priorityBadge = '';
      if (idx === 0) {
        priorityBadge = '<span class="badge" style="background: #064e3b; color: #34d399; font-weight: 700; padding: 3px 8px; font-size: 11px;">#1 Primary</span>';
      } else if (idx === 1) {
        priorityBadge = '<span class="badge" style="background: #1e3a8a; color: #60a5fa; font-weight: 700; padding: 3px 8px; font-size: 11px;">#2 Secondary</span>';
      } else if (idx === 2) {
        priorityBadge = '<span class="badge" style="background: #78350f; color: #fbbf24; font-weight: 700; padding: 3px 8px; font-size: 11px;">#3 Fallback</span>';
      } else {
        priorityBadge = '<span class="badge" style="background: #27272a; color: #a1a1aa; font-weight: 600; padding: 3px 8px; font-size: 11px;">#' + (idx + 1) + ' Fallback</span>';
      }

      let statusDisplay = '';
      if (p.health_status === 'failing') {
        statusDisplay = '<div style="color: #ef4444; font-weight: 700; font-size: 12px;">● Failing (skipped)</div><div style="font-size: 10px; color: #f87171;" title="' + escapeHtml(p.test_error || '') + '">' + escapeHtml((p.test_error || 'Probe failed').slice(0, 30)) + '</div>';
      } else if (p.health_status === 'healthy') {
        statusDisplay = '<div style="color: #34d399; font-weight: 600; font-size: 12px;">● Healthy (' + (p.latency_ms || 120) + 'ms)</div><div style="font-size: 10px; color: #94a3b8;">' + (p.last_tested_at ? 'Tested ' + new Date(p.last_tested_at).toLocaleTimeString() : 'Verified') + '</div>';
      } else if (p.enabled) {
        statusDisplay = '<span style="color: #34d399; font-weight: 600; font-size: 12px;">● Active</span>';
      } else {
        statusDisplay = '<span style="color: #9ca3af; font-weight: 600; font-size: 12px;">● Disabled</span>';
      }

      const pct = Math.min(100, Math.round(((p.used_today || 0) / (p.daily_limit || 1)) * 100));

      return (
        '<tr id="provider-row-' + p.id + '">' +
        '<td><div style="font-weight: 700; font-size: 14px; color: #f3f4f6;">' + escapeHtml(p.name) + '</div>' +
        '<div style="font-size: 12px; color: var(--text-muted); font-family: monospace; margin-top: 2px;">' + escapeHtml(p.model_name || 'default') + '</div></td>' +
        '<td><code>' + escapeHtml(p.adapter_kind) + '</code></td>' +
        '<td>' + priorityBadge + '</td>' +
        '<td><div style="font-weight: 600;">' + (p.used_today || 0) + ' / ' + p.daily_limit + ' reqs</div>' +
        '<div style="width: 100px; height: 5px; background: #374151; border-radius: 3px; margin-top: 4px; overflow: hidden;">' +
        '<div style="width: ' + pct + '%; height: 100%; background: ' + (pct > 85 ? '#ef4444' : '#3b82f6') + ';"></div>' +
        '</div>' +
        (exceedsQuota ? '<div style="margin-top: 4px;"><span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 10px; padding: 2px 6px;" title="' + escapeHtml(officialQuota.note) + '">⚠️ Exceeds free limit (' + officialQuota.badge + ')</span></div>' : (officialQuota ? '<div style="margin-top: 2px; font-size: 10px; color: #9ca3af;">Free: ' + officialQuota.badge + '</div>' : '')) +
        '</td>' +
        '<td><div style="margin-bottom: 4px; max-width: 260px;">' + keyBadges + '</div>' +
        '<span style="font-size: 11px; color: ' + (activeKeys.length > 0 ? '#34d399' : '#f59e0b') + ';">● ' + activeKeys.length + ' active key' + (activeKeys.length === 1 ? '' : 's') + '</span></td>' +
        '<td id="provider-status-' + p.id + '">' + statusDisplay + '</td>' +
        '<td style="text-align: right; white-space: nowrap;"><div style="display: inline-flex; gap: 4px;">' +
        '<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="moveProviderPriority(\'' + p.id + '\', \'up\')" title="Move up in chain" ' + (idx === 0 ? 'disabled style="opacity: 0.35; cursor: not-allowed; padding: 4px 8px; font-size: 11px;"' : '') + '>⬆️</button>' +
        '<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="moveProviderPriority(\'' + p.id + '\', \'down\')" title="Move down in chain" ' + (idx === chainProviders.length - 1 ? 'disabled style="opacity: 0.35; cursor: not-allowed; padding: 4px 8px; font-size: 11px;"' : '') + '>⬇️</button>' +
        '<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="testProviderAction(\'' + p.id + '\', this)" title="Test latency & connection">🩺 Test</button>' +
        '<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openManageKeysModal(\'' + p.id + '\')">🔑 Keys (' + keys.length + ')</button>' +
        '<button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openEditProviderModal(\'' + p.id + '\')">✏️</button>' +
        '<button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteProviderAction(\'' + p.id + '\')">🗑️</button>' +
        '</div></td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderProvidersTables() {
    const textProvs = providersData.filter(function (p) { return !isImageProvider(p); }).sort(function (a, b) { return a.priority - b.priority; });
    const imageProvs = providersData.filter(function (p) { return isImageProvider(p); }).sort(function (a, b) { return a.priority - b.priority; });
    renderChainTableBody('textProvidersTableBody', textProvs, 'text');
    renderChainTableBody('imageProvidersTableBody', imageProvs, 'image');
  }
  window.renderProvidersTables = renderProvidersTables;

  async function moveProviderPriority(providerId, direction) {
    try {
      var res = await fetch('/api/providers/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: providerId, direction: direction })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        providersData = data.providers;
        renderProvidersTables();
        showToast('Saved and verified failover priority order', 'success');
      } else {
        alert('Could not reorder provider: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Network error while reordering provider: ' + e.message);
    }
  }
  window.moveProviderPriority = moveProviderPriority;

  async function testProviderAction(providerId, btn) {
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Testing...';
    }
    try {
      var res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: providerId })
      });
      var data = await res.json();
      var target = providersData.find(function (p) { return p.id === providerId; });
      if (target) {
        target.health_status = data.status || (data.success ? 'healthy' : 'failing');
        target.latency_ms = data.latency_ms;
        target.test_error = data.error;
        target.last_tested_at = new Date().toISOString();
      }
      renderProvidersTables();
      if (data.success) {
        showToast('✅ Probe succeeded in ' + (data.latency_ms || 0) + 'ms', 'success');
      } else {
        showToast('⚠️ Provider failing: ' + (data.error || 'Connection failed'), 'error');
      }
    } catch (e) {
      alert('Network error testing provider: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }
  window.testProviderAction = testProviderAction;

  async function fetchAuditTab() {
    try {
      const res = await fetch('/api/audit-logs');
      if (!res.ok) throw new Error('Status ' + res.status);
      const logs = await res.json();
      auditLogsData = logs;
    } catch (err) {
      showTabError('audit', err.message, fetchAuditTab);
    }
  }

  function renderAccountsTable(accounts) {
    const tbody = document.getElementById('accountsTableBody');
    if (!tbody) return;
    if (!accounts || accounts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 36px; color: var(--text-muted);"><div style="font-size: 28px; margin-bottom: 8px;">👤</div><div style="font-size: 15px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Facebook User Accounts Linked</div><div style="font-size: 13px;">Click <strong>+ Link New Facebook ID</strong> above or use <strong>Connect Facebook via Meta Login</strong>.</div></td></tr>';
      return;
    }
    // Update badge count
    const countEl = document.getElementById('sidebarAccountCount');
    if (countEl) countEl.innerText = accounts.length;
    const ovCountEl = document.getElementById('ovAccountCount');
    if (ovCountEl) ovCountEl.innerText = accounts.length;
  }

  function renderPagesTable(pages) {
    const tbody = document.getElementById('pagesTableBody');
    if (!tbody) return;
    if (!pages || pages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 36px; color: var(--text-muted);"><div style="font-size: 28px; margin-bottom: 8px;">📄</div><div style="font-size: 15px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Facebook Pages Configured</div><div style="font-size: 13px;">Connect via Facebook Login for Business or click <strong>+ Add New Page</strong> above.</div></td></tr>';
      return;
    }
    const countEl = document.getElementById('sidebarPageCount');
    if (countEl) countEl.innerText = pages.length;
    const ovCountEl = document.getElementById('ovPageCount');
    if (ovCountEl) ovCountEl.innerText = pages.length;
  }

  // --- Missing Tables Alert Banner ---
  function checkMissingTablesBanner() {
    if (!storageHealth) return;
    const container = document.getElementById('databaseHealthBanner');
    if (!container) return;

    if (storageHealth.missingTables && storageHealth.missingTables.length > 0) {
      container.style.display = 'block';
      container.style.background = '#7f1d1d';
      container.style.border = '1px solid #dc2626';
      container.style.color = '#fee2e2';
      container.style.padding = '16px 20px';
      container.style.borderRadius = '10px';
      container.style.marginBottom = '24px';
      container.innerHTML =
        '<div style="display: flex; align-items: flex-start; gap: 12px;">' +
        '<div style="font-size: 24px;">⚠️</div>' +
        '<div>' +
        '<h3 style="font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #fff;">Database Setup Incomplete: Missing Required Tables</h3>' +
        '<p style="font-size: 13px; line-height: 1.5; margin-bottom: 10px;">The following tables are missing from your Supabase <code>public</code> schema: ' +
        '<strong style="color: #fca5a5;">' + escapeHtml(storageHealth.missingTables.join(', ')) + '</strong></p>' +
        '<p style="font-size: 13px; line-height: 1.5;">To create all tables, open your <a href="https://supabase.com/dashboard" target="_blank" style="color: #93c5fd; text-decoration: underline; font-weight: 600;">Supabase Dashboard ➔ SQL Editor</a>, copy and paste the contents of <code>supabase/all_migrations.sql</code>, and click <strong>Run</strong>.</p>' +
        '</div></div>';
    } else {
      container.style.display = 'none';
    }
  }

  // --- Facebook Accounts Management ---
  function openAddAccountModal() {
    const el = document.getElementById('addAccountModal');
    if (el) el.classList.add('active');
  }

  function closeAddAccountModal() {
    const el = document.getElementById('addAccountModal');
    if (el) el.classList.remove('active');
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
        account_name: account_name,
        fb_user_id: fb_user_id,
        email: email,
        user_access_token: user_access_token,
        notes: notes,
      }),
    });

    if (res.ok) {
      closeAddAccountModal();
      showToast('Facebook Account connected and token encrypted in vault!');
      fetchAccountsTab();
    } else {
      const err = await res.json();
      showToast('Failed to connect Facebook account: ' + (err.error || 'Unknown error'), 'error');
    }
  }

  function openEditAccountModal(id) {
    const acc = accountsData.find(function (a) {
      return a.id === id;
    });
    if (!acc) return;
    document.getElementById('editAccountId').value = acc.id;
    document.getElementById('editAccountName').value = acc.account_name;
    document.getElementById('editAccountFbId').value = acc.fb_user_id;
    document.getElementById('editAccountEmail').value = acc.email || '';
    document.getElementById('editAccountNotes').value = acc.notes || '';
    const el = document.getElementById('editAccountModal');
    if (el) el.classList.add('active');
  }

  function closeEditAccountModal() {
    const el = document.getElementById('editAccountModal');
    if (el) el.classList.remove('active');
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
        id: id,
        account_name: account_name,
        fb_user_id: fb_user_id,
        email: email,
        notes: notes,
      }),
    });

    if (res.ok) {
      closeEditAccountModal();
      showToast('Facebook Account updated!');
      fetchAccountsTab();
    } else {
      showToast('Failed to update account.', 'error');
    }
  }

  async function deleteAccountAction(id) {
    if (!confirm('Are you sure you want to disconnect this Facebook Account? Pages under it will remain but become unlinked.')) return;
    const res = await fetch('/api/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    });
    if (res.ok) {
      showToast('Facebook Account disconnected.');
      fetchAccountsTab();
    }
  }

  function addPageForAccount(accId) {
    openAddPageModal();
    const accInput = document.getElementById('newPageAccountId');
    if (accInput) accInput.value = accId;
  }

  function filterPagesByAccount(accId, btn) {
    document.querySelectorAll('.page-filter-btn').forEach(function (b) {
      b.classList.remove('active', 'btn-primary');
      b.classList.add('btn-secondary');
    });
    if (btn) {
      btn.classList.add('active', 'btn-primary');
      btn.classList.remove('btn-secondary');
    }
    document.querySelectorAll('.page-row').forEach(function (row) {
      if (accId === 'all' || row.dataset.account === accId) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
    try {
      if (accId && accId !== 'all') {
        history.replaceState(null, '', '/pages?account=' + encodeURIComponent(accId));
      } else if (window.location.search.includes('account=')) {
        history.replaceState(null, '', '/pages');
      }
    } catch (_) {}
  }

  // --- Pages Management ---
  function toggleCustomNicheField(val, elementId) {
    const box = document.getElementById(elementId);
    if (box) {
      box.style.display = val === '__custom__' ? 'block' : 'none';
    }
  }

  function openAddPageModal() {
    const el = document.getElementById('addPageModal');
    if (el) el.classList.add('active');
  }

  function closeAddPageModal() {
    const el = document.getElementById('addPageModal');
    if (el) el.classList.remove('active');
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
    const postingTimes = document.getElementById('newPostingTimes').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const custom_caption_prompt = document.getElementById('newCaptionPrompt').value;

    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        fb_account_id: fb_account_id,
        fb_page_id: fb_page_id,
        fb_page_token: fb_page_token,
        profile_id: profile_id,
        custom_niche_name: custom_niche_name,
        custom_niche_type: custom_niche_type,
        custom_niche_audience: custom_niche_audience,
        publishing_mode: publishing_mode,
        daily_cap: daily_cap,
        schedule: { postsPerDay: postingTimes.length, postingTimes: postingTimes, timezone: 'UTC' },
        custom_caption_prompt: custom_caption_prompt,
        first_comment_enabled: true,
      }),
    });

    if (res.ok) {
      closeAddPageModal();
      showToast('Page successfully added and encrypted under selected Facebook ID!');
      fetchPagesTab();
    } else {
      const err = await res.json();
      showToast('Failed to add page: ' + (err.error || 'Unknown error'), 'error');
    }
  }

  async function deletePageAction(id) {
    if (!confirm('Are you sure you want to disconnect this Page?')) return;
    const res = await fetch('/api/pages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    });
    if (res.ok) {
      showToast('Page deleted.');
      fetchPagesTab();
    }
  }

  function openPagePromptStudio(pageId) {
    showTab('page-prompts');
    const sel = document.getElementById('studioPageSelect');
    if (sel) sel.value = pageId;
    loadPageIntoStudio();
    try {
      history.replaceState(null, '', '/prompts?profile=' + encodeURIComponent(pageId));
    } catch (_) {}
  }

  function loadPageIntoStudio() {
    const selectPageElem = document.getElementById('studioPageSelect');
    if (!selectPageElem) return;
    const pageId = selectPageElem.value;
    const page = pagesData.find(function (p) { return p.id === pageId; }) || pagesData[0];
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
    if (!found || !page.profile_id || page.profile_id === '__custom__' || page.profile_id === 'custom') {
      selectElem.value = '__custom__';
      toggleCustomNicheField('__custom__', 'studioCustomNicheBox');
      const customNameInput = document.getElementById('editCustomNicheName');
      if (customNameInput) customNameInput.value = page.custom_niche || page.custom_niche_text || '';
      handleStudioProfileChange('__custom__');
    } else {
      toggleCustomNicheField(selectElem.value, 'studioCustomNicheBox');
      handleStudioProfileChange(selectElem.value);
    }

    document.getElementById('editCaptionPrompt').value = page.custom_caption_prompt || '';
    document.getElementById('editCaptionMode').value = page.custom_caption_prompt_mode || (page.profile_id ? 'append' : 'replace');
    document.getElementById('editImagePrompt').value = page.custom_image_prompt || '';
    document.getElementById('editImageMode').value = page.custom_image_prompt_mode || (page.profile_id ? 'append' : 'replace');
    document.getElementById('editFirstCommentEnabled').checked = page.first_comment_enabled !== false;
    document.getElementById('editFirstCommentPrompt').value = page.first_comment_prompt || '';

    const overrides = page.overrides || {};
    document.getElementById('editMinWords').value = overrides['caption.min'] || 120;
    document.getElementById('editTargetWords').value = overrides['caption.target'] || 180;
    document.getElementById('editMaxWords').value = overrides['caption.max'] || 250;
    document.getElementById('editAspectRatio').value = overrides['image.aspectRatio'] || '4:5';
    document.getElementById('editPanelEnabled').checked = overrides['image.headlinePanel.enabled'] !== false;
    document.getElementById('editPanelHeight').value = overrides['image.headlinePanel.heightPercent'] || 25;
    const bgColor = overrides['image.headlinePanel.backgroundColor'] || '#050b14';
    document.getElementById('editPanelColor').value = bgColor;
    const hexInput = document.getElementById('editPanelColorHex');
    if (hexInput) hexInput.value = bgColor;

    validateStudioWordLimits();
    validateStudioFirstComment();

    const inspectBox = document.getElementById('effectiveInspectBox');
    if (inspectBox) inspectBox.style.display = 'none';
  }

  function handleStudioProfileChange(profileVal) {
    const isCustom = profileVal === '__custom__' || profileVal === 'custom' || !profileVal;
    const notice = document.getElementById('customNicheReplaceNotice');
    if (notice) {
      notice.style.display = isCustom ? 'block' : 'none';
    }
    if (isCustom) {
      const capMode = document.getElementById('editCaptionMode');
      const imgMode = document.getElementById('editImageMode');
      if (capMode) capMode.value = 'replace';
      if (imgMode) imgMode.value = 'replace';
    }
  }

  function validateStudioWordLimits() {
    const minVal = parseInt(document.getElementById('editMinWords').value, 10);
    const targetVal = parseInt(document.getElementById('editTargetWords').value, 10);
    const maxVal = parseInt(document.getElementById('editMaxWords').value, 10);
    const errBox = document.getElementById('editWordsError');
    if (!errBox) return true;

    if (!isNaN(minVal) && !isNaN(targetVal) && !isNaN(maxVal)) {
      if (minVal > targetVal || targetVal > maxVal) {
        errBox.style.display = 'block';
        errBox.innerText = '⚠️ Min words (' + minVal + ') cannot exceed target (' + targetVal + '), and target cannot exceed max (' + maxVal + ').';
        return false;
      }
    }
    errBox.style.display = 'none';
    return true;
  }

  function validateStudioFirstComment() {
    const enabled = document.getElementById('editFirstCommentEnabled') ? document.getElementById('editFirstCommentEnabled').checked : false;
    const prompt = document.getElementById('editFirstCommentPrompt') ? document.getElementById('editFirstCommentPrompt').value.trim() : '';
    const errBox = document.getElementById('editFirstCommentError');
    if (!errBox) return true;

    if (enabled && !prompt) {
      errBox.style.display = 'block';
      errBox.innerText = '⚠️ First comment text is required when auto-post is enabled.';
      return false;
    }
    errBox.style.display = 'none';
    return true;
  }

  function toggleFirstCommentValidation() {
    validateStudioFirstComment();
  }

  function syncHeadlineColorPicker(val) {
    const hexInput = document.getElementById('editPanelColorHex');
    if (hexInput) hexInput.value = val;
    const err = document.getElementById('editHeadlineColorError');
    if (err) err.style.display = 'none';
  }

  function syncHeadlineColorText(val) {
    const err = document.getElementById('editHeadlineColorError');
    const colorPicker = document.getElementById('editPanelColor');
    const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
    if (hexRegex.test(val.trim())) {
      if (colorPicker) colorPicker.value = val.trim();
      if (err) err.style.display = 'none';
    } else {
      if (err) {
        err.style.display = 'block';
        err.innerText = 'Invalid hex color (e.g. #050b14 or #000000)';
      }
    }
  }

  async function savePagePromptsAction(forceSave) {
    const pageId = document.getElementById('studioPageSelect') ? document.getElementById('studioPageSelect').value : null;
    const page = pagesData.find(function (p) { return p.id === pageId; });
    if (!page) {
      showToast('Please select a Facebook Page first.', 'warning');
      return;
    }

    if (!validateStudioWordLimits()) {
      showToast('Please fix word limits: Min <= Target <= Max', 'error');
      return;
    }
    if (!validateStudioFirstComment()) {
      showToast('Please provide a first comment text before saving.', 'error');
      return;
    }

    const saveBtn = document.querySelector('button[onclick="savePagePromptsAction()"]');
    const origText = saveBtn ? saveBtn.innerText : 'Save Page Prompts';

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = 'Saving...';
      }

      const rawProfileId = document.getElementById('editProfileSelect').value;
      const custom_niche_name = document.getElementById('editCustomNicheName') ? document.getElementById('editCustomNicheName').value.trim() : '';

      if ((rawProfileId === '__custom__' || rawProfileId === 'custom') && !custom_niche_name) {
        showToast('Please enter a name for your custom niche!', 'warning');
        return;
      }

      const custom_caption_prompt = document.getElementById('editCaptionPrompt').value;
      const custom_caption_prompt_mode = document.getElementById('editCaptionMode').value;
      const custom_image_prompt = document.getElementById('editImagePrompt').value;
      const custom_image_prompt_mode = document.getElementById('editImageMode').value;
      const first_comment_enabled = document.getElementById('editFirstCommentEnabled').checked;
      const first_comment_prompt = document.getElementById('editFirstCommentPrompt').value;

      const panelColorVal = (document.getElementById('editPanelColorHex') ? document.getElementById('editPanelColorHex').value.trim() : '') || document.getElementById('editPanelColor').value || '#050b14';

      const overrides = Object.assign({}, page.overrides || {}, {
        'caption.min': parseInt(document.getElementById('editMinWords').value, 10),
        'caption.target': parseInt(document.getElementById('editTargetWords').value, 10),
        'caption.max': parseInt(document.getElementById('editMaxWords').value, 10),
        'image.aspectRatio': document.getElementById('editAspectRatio').value,
        'image.headlinePanel.enabled': document.getElementById('editPanelEnabled').checked,
        'image.headlinePanel.heightPercent': parseInt(document.getElementById('editPanelHeight').value, 10),
        'image.headlinePanel.backgroundColor': panelColorVal,
      });

      const payload = {
        id: pageId,
        pageId: pageId,
        profile_id: rawProfileId === '__custom__' || rawProfileId === 'custom' ? null : rawProfileId,
        custom_niche: custom_niche_name,
        custom_niche_name: custom_niche_name,
        custom_niche_text: custom_niche_name,
        custom_caption_prompt: custom_caption_prompt,
        custom_caption_prompt_mode: custom_caption_prompt_mode,
        custom_image_prompt: custom_image_prompt,
        custom_image_prompt_mode: custom_image_prompt_mode,
        first_comment_enabled: first_comment_enabled,
        first_comment_prompt: first_comment_prompt,
        overrides: overrides,
        expected_settings_version: page.settings_version || page.version || 1,
        expected_updated_at: page.settings_updated_at || page.updated_at,
        force: Boolean(forceSave),
      };

      const res = await fetch('/api/pages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.status === 409 || data.conflict) {
        openConcurrencyConflictModal(pageId, data, payload, function () {
          savePagePromptsAction(true);
        });
        return;
      }

      if (res.ok && data.success) {
        showToast('✅ Custom prompts and settings for this Page successfully saved!', 'success');
        const idx = pagesData.findIndex(function (p) { return p.id === pageId; });
        if (idx !== -1 && data.page) pagesData[idx] = data.page;
      } else {
        showToast('Error saving page prompts: ' + (data.error || 'Server error'), 'error');
      }
    } catch (err) {
      showToast('Network error saving prompts: ' + err.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = origText;
      }
    }
  }

  async function inspectEffectivePrompt() {
    const pageId = document.getElementById('studioPageSelect').value;
    const res = await fetch('/api/page-effective-settings?pageId=' + encodeURIComponent(pageId));
    const data = await res.json();

    const box = document.getElementById('effectiveInspectBox');
    const code = document.getElementById('effectiveInspectCode');
    if (box) box.style.display = 'block';

    if (code) {
      code.innerText = JSON.stringify({
        targetPage: data.page.name,
        inheritedBaseProfile: data.baseProfile.name,
        effectiveTemplates: data.effectiveSettings.templates,
        effectiveCaptionSettings: data.effectiveSettings.caption,
        effectiveImageSettings: data.effectiveSettings.image,
        settingSourceAudit: data.provenance,
      }, null, 2);
    }
  }

  async function testRunCurrentPage() {
    const pageId = document.getElementById('studioPageSelect').value;
    showTab('simulator');
    const simSelect = document.getElementById('simPageSelect');
    if (simSelect) simSelect.value = pageId;
    runSimulationForSelectedPage();
  }

  function renderAuditLogs(cat) {
    document.querySelectorAll('.audit-log-item').forEach(function (el) {
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
      showToast('Please select a Facebook Page first before running test run.', 'warning');
      return;
    }
    const runBtn = document.querySelector('button[onclick="runSimulationForSelectedPage()"]');
    const origText = runBtn ? runBtn.innerText : '⚡ Execute Simulation Cycle';
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.innerText = '⚡ Running Pipeline Stages...';
    }

    try {
      const res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        showToast('❌ Test Run Failed: ' + (data.error || 'Pipeline stage failed'), 'error');
        const page = pagesData.find(function (p) { return p.id === pageId; });
        if (page && data.test_run_report) {
          page.test_run_report = data.test_run_report;
          page.test_run_verified = false;
          if (data.checklist) page.checklist_status = data.checklist;
          if (typeof updateModalChecklistDisplay === 'function' && currentSettingsPageId === pageId) {
            updateModalChecklistDisplay(page);
          }
        }
        return;
      }

      showToast('🎉 Test Run Passed! All 4 pipeline stages verified.', 'success');
      const page = pagesData.find(function (p) { return p.id === pageId; });
      if (page) {
        page.last_test_run_at = data.testedAt;
        page.test_run_verified = true;
        page.test_run_report = data;
        if (data.checklist) page.checklist_status = data.checklist;
        if (typeof updateModalChecklistDisplay === 'function' && currentSettingsPageId === pageId) {
          updateModalChecklistDisplay(page);
        }
      }

      const simBox = document.getElementById('simResult');
      const simOut = document.getElementById('simOutput');
      if (simBox) simBox.style.display = 'block';
      if (simOut) {
        simOut.innerHTML =
          '<strong>Target Page:</strong> ' + escapeHtml(data.pageName) + ' (Base: ' + escapeHtml(data.baseProfile) + ')<br>' +
          '<strong>Selected Topic:</strong> ' + escapeHtml(data.topic?.title || '') + ' (' + escapeHtml(data.topic?.category || '') + ')<br><br>' +
          '<strong>Generated Long-Form Caption:</strong><br>' +
          '<div style="background: #111827; padding: 12px; border-radius: 6px; margin: 8px 0; white-space: pre-wrap; font-size: 13px; line-height: 1.6;">' + escapeHtml(data.caption) + '</div><br>' +
          '<strong>Caption Word Count:</strong> ' + (data.wordCount || 0) + ' words<br>' +
          '<strong>QA Composite Score:</strong> <span style="color: #34d399; font-weight: bold;">' + (data.qaScore || 0) + '/100 (Passes ' + escapeHtml(String(data.publishingMode || '').toUpperCase()) + ' Mode)</span><br>' +
          '<strong>Key Visual Scene:</strong> ' + escapeHtml(data.keySceneExtracted || '') + '<br>' +
          '<strong>Sharp Composed Format:</strong> ' + escapeHtml(data.imageDimensions || '') + '<br>' +
          '<strong>Token Accounting:</strong> ' + (data.tokensUsed || 0) + ' tokens used (' + escapeHtml(data.estimatedCost || '$0.00') + ') • Latency: ' + (data.latencyMs || 0) + 'ms';
      }
    } catch (e) {
      showToast('Network error during test run: ' + e.message, 'error');
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.innerText = origText;
      }
    }
  }

  async function approvePostAction(postId) {
    const res = await fetch('/api/review-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: postId, action: 'approve' }),
    });
    if (res.ok) {
      const card = document.getElementById('card-' + postId);
      if (card) card.remove();
      const badge = document.getElementById('revBadge');
      if (badge) {
        const c = parseInt(badge.innerText, 10);
        if (!isNaN(c) && c > 0) badge.innerText = c - 1;
      }
      showToast('Post approved! Scheduled on Facebook.');
    }
  }

  async function rejectPostAction(postId) {
    const reason = prompt('Please enter rejection reason:');
    if (!reason) return;
    const res = await fetch('/api/review-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: postId, action: 'reject', reason: reason }),
    });
    if (res.ok) {
      const card = document.getElementById('card-' + postId);
      if (card) card.remove();
      const badge = document.getElementById('revBadge');
      if (badge) {
        const c = parseInt(badge.innerText, 10);
        if (!isNaN(c) && c > 0) badge.innerText = c - 1;
      }
      showToast('Post rejected and skipped.');
    }
  }

  function editCaptionPrompt(postId) {
    const newCaption = prompt('Enter updated caption:');
    if (newCaption) {
      fetch('/api/review-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: postId, action: 'edit', updates: { caption: newCaption } }),
      }).then(function (res) {
        if (res.ok) {
          const capElem = document.getElementById('caption-' + postId);
          if (capElem) capElem.innerText = newCaption;
          showToast('Caption updated! Word count and content hash recalculated.');
        } else {
          showToast('Failed to update caption.', 'error');
        }
      });
    }
  }

  async function toggleKillSwitch() {
    const res = await fetch('/api/kill-switch', { method: 'POST' });
    const data = await res.json();
    const btn = document.getElementById('killSwitchBtn');
    if (btn) {
      if (data.killSwitchActive) {
        btn.innerText = 'Resume System';
        alert('Kill switch ACTIVATED. All generation and publishing loops are paused.');
      } else {
        btn.innerText = 'Activate Kill Switch';
        alert('System RESUMED.');
      }
    }
  }

  // --- Provider Modal & Actions ---
  function openAddProviderModal() {
    const modal = document.getElementById('addProviderModal');
    if (modal) modal.classList.add('active');
    const select = document.getElementById('quickProviderSelect');
    if (select && select.value) {
      onQuickProviderChange(select.value);
    }
  }

  function closeAddProviderModal() {
    const modal = document.getElementById('addProviderModal');
    if (modal) modal.classList.remove('active');
  }

  function toggleQuickKeyVisibility() {
    const input = document.getElementById('quickApiKey');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  }

  function toggleQuickAdvanced() {
    const fields = document.getElementById('quickAdvancedFields');
    const arrow = document.getElementById('quickAdvArrow');
    if (fields) {
      if (fields.style.display === 'none' || !fields.style.display) {
        fields.style.display = 'block';
        if (arrow) arrow.innerText = '▼';
      } else {
        fields.style.display = 'none';
        if (arrow) arrow.innerText = '▶';
      }
    }
  }

  function onQuickProviderChange(presetId) {
    const select = document.getElementById('quickProviderSelect');
    if (!select) return;
    const option = select.options[select.selectedIndex];
    if (!option) return;

    const name = option.getAttribute('data-name') || option.text;
    const kind = option.getAttribute('data-kind') || 'openai_compatible_chat';
    const baseUrl = option.getAttribute('data-baseurl') || '';
    const model = option.getAttribute('data-model') || '';
    const limit = option.getAttribute('data-limit') || '1000';
    const instructions = option.getAttribute('data-instructions') || '';

    const infoBox = document.getElementById('quickProviderInstructions');
    if (infoBox) {
      if (!instructions) {
        infoBox.innerText = 'Enter your API key below.';
      } else {
        const parts = instructions.split(' ');
        const formatted = parts.map(function (word) {
          const cleanUrl = word.replace(/[\(\)]/g, '');
          if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
            return '<a href="' + cleanUrl + '" target="_blank" style="color: #60a5fa; text-decoration: underline; font-weight: 600;">' + cleanUrl + '</a>';
          }
          return escapeHtml(word);
        }).join(' ');
        infoBox.innerHTML = formatted;
      }
    }

    const keyInput = document.getElementById('quickApiKey');
    const keyHint = document.getElementById('quickKeyHint');
    if (keyInput && keyHint) {
      if (presetId === 'preset-pollinations' || presetId === 'preset-ollama') {
        keyInput.placeholder = 'Optional / Keyless (Click Connect & Save directly!)';
        keyHint.innerText = '💡 Keyless: This provider functions without an API key.';
      } else {
        keyInput.placeholder = 'sk-... or AIzaSy... (Paste your secret API key here)';
        keyHint.innerText = 'AES-256-GCM encrypted upon saving. Never stored or logged in plaintext.';
      }
    }

    const nameInput = document.getElementById('newProviderName');
    if (nameInput) nameInput.value = name;
    const kindInput = document.getElementById('newProviderAdapter');
    if (kindInput) kindInput.value = kind;
    const baseInput = document.getElementById('newProviderBaseUrl');
    if (baseInput) baseInput.value = baseUrl;
    const modelInput = document.getElementById('newProviderModel');
    if (modelInput) modelInput.value = model;
    const limitInput = document.getElementById('newProviderDailyLimit');
    if (limitInput) limitInput.value = limit;
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
        preset_id: preset_id,
        name: name,
        adapter_kind: adapter_kind,
        base_url: base_url,
        model_name: model_name,
        priority: priority,
        daily_limit: daily_limit,
        initial_key: initial_key,
        key_label: 'Primary Key',
      }),
    });

    if (res.ok) {
      const data = await res.json();
      closeAddProviderModal();
      if (data.is_existing) {
        showToast('Provider "' + data.provider.name + '" updated! Added ' + (data.addedKeys ? data.addedKeys.length : 0) + ' API key(s).');
      } else {
        showToast('AI Provider "' + data.provider.name + '" successfully connected!');
      }
      fetchProvidersTab();
    } else {
      const err = await res.json();
      showToast('Failed to add provider: ' + (err.error || 'Unknown error'), 'error');
    }
  }

  // --- Deep Page Inspection Separate Window Logic ---
  let currentPageModalData = null;
  let currentPostFilter = 'all';

  async function openPageDetailsWindow(pageId) {
    try {
      const res = await fetch('/api/page-details?pageId=' + encodeURIComponent(pageId));
      if (!res.ok) {
        alert('Could not retrieve details for this page.');
        return;
      }
      const data = await res.json();
      currentPageModalData = data;
      const page = data.page;
      const account = data.account;
      const profile = data.profile;
      const posts = data.posts || [];
      const stats = data.stats || {};
      const auditLogs = data.auditLogs || [];

      document.getElementById('pdwTitle').innerHTML = '📄 ' + escapeHtml(page.name);
      const statusBadge = document.getElementById('pdwStatusBadge');
      if (statusBadge) {
        statusBadge.innerText = page.active !== false ? '● ACTIVE' : '● PAUSED';
        statusBadge.style.background = page.active !== false ? '#064e3b' : '#7f1d1d';
        statusBadge.style.color = page.active !== false ? '#34d399' : '#f87171';
      }

      document.getElementById('pdwModeBadge').innerText = String(page.publishing_mode || 'autonomous').toUpperCase();
      document.getElementById('pdwNiche').innerText = page.profile_id;
      document.getElementById('pdwFbPageId').innerText = page.fb_page_id;
      document.getElementById('pdwOwner').innerText = account ? (account.account_name + ' (ID: ' + account.fb_user_id + ')') : 'Direct Page Access Token';

      document.getElementById('pdwTotalPosts').innerText = stats.totalPosts || 0;
      document.getElementById('pdwPostBreakdown').innerText = (stats.publishedCount || 0) + ' Published • ' + (stats.scheduledCount || 0) + ' Scheduled • ' + (stats.reviewCount || 0) + ' Review';
      document.getElementById('pdwTotalReach').innerText = Number(stats.totalReach || 0).toLocaleString() + ' reach';
      document.getElementById('pdwEngagement').innerText = (stats.avgEngagement || 0) + '% Avg Engagement (' + Number(stats.totalImpressions || 0).toLocaleString() + ' imp)';

      document.getElementById('pdwCadenceTitle').innerText = (page.schedule?.postsPerDay || 3) + ' posts / day';
      document.getElementById('pdwNextSlot').innerText = 'Times: ' + (page.schedule?.postingTimes || ['09:00', '15:00', '21:00']).join(', ');

      document.getElementById('pdwQaScore').innerText = stats.avgQaScore > 0 ? (stats.avgQaScore + ' / 100') : 'N/A';
      document.getElementById('pdwQaStatus').innerText = 'Threshold: ' + (page.hybrid_min_score || 85) + ' (Strict)';

      document.getElementById('pdwCountAll').innerText = posts.length;
      document.getElementById('pdwCountPublished').innerText = stats.publishedCount || 0;
      document.getElementById('pdwCountScheduled').innerText = stats.scheduledCount || 0;
      document.getElementById('pdwCountReview').innerText = stats.reviewCount || 0;
      renderPageModalPostsList(posts, 'all');

      document.getElementById('pdwNicheName').innerText = profile?.name || page.profile_id;
      document.getElementById('pdwNicheType').innerText = profile?.type ? profile.type.toUpperCase() : 'FACTUAL';
      const minW = page.overrides?.['caption.min'] || profile?.captionSettings?.lengthRange?.min || 200;
      const maxW = page.overrides?.['caption.max'] || profile?.captionSettings?.lengthRange?.max || 450;
      document.getElementById('pdwWordTargets').innerText = minW + ' - ' + maxW + ' words';
      document.getElementById('pdwAspectRatio').innerText = page.overrides?.['image.aspectRatio'] || profile?.imageSettings?.aspectRatio || '4:5 Portrait';

      document.getElementById('pdwCustomCaptionPrompt').innerText = page.custom_caption_prompt
        ? '[Mode: ' + String(page.custom_caption_prompt_mode || 'append').toUpperCase() + ']\n' + page.custom_caption_prompt
        : '(No custom caption override set - inheriting standard base niche prompts)';

      document.getElementById('pdwCustomImagePrompt').innerText = page.custom_image_prompt
        ? '[Mode: ' + String(page.custom_image_prompt_mode || 'append').toUpperCase() + ']\n' + page.custom_image_prompt
        : '(No custom image override set - using default cinematic visual composition)';

      document.getElementById('pdwSchedTarget').innerText = (page.schedule?.postsPerDay || 3) + ' posts / day';
      document.getElementById('pdwSchedTz').innerText = page.schedule?.timezone || 'UTC';
      document.getElementById('pdwSchedTimes').innerText = (page.schedule?.postingTimes || []).join(', ');
      document.getElementById('pdwSchedMode').innerText = String(page.publishing_mode || '').toUpperCase() + ' (Min Score: ' + (page.hybrid_min_score || 85) + ')';

      const upcomingContainer = document.getElementById('pdwUpcomingSlots');
      const times = page.schedule?.postingTimes || ['09:00', '15:00', '21:00'];
      upcomingContainer.innerHTML = times.map(function (t, idx) {
        return (
          '<div style="background: #111827; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #1f2937;">' +
          '<div><strong style="color: #60a5fa;">Posting Run #' + (idx + 1) + ': ' + escapeHtml(t) + '</strong>' +
          '<span style="color: var(--text-muted); font-size: 12px; margin-left: 10px;">' + escapeHtml(page.schedule?.timezone || 'UTC') + '</span></div>' +
          '<span class="badge" style="background: #1e3a8a; color: #93c5fd; font-size: 11px;">Active Automated Schedule</span></div>'
        );
      }).join('');

      const logsContainer = document.getElementById('pdwLogsContainer');
      if (auditLogs && auditLogs.length > 0) {
        logsContainer.innerHTML = auditLogs.map(function (l) {
          const borderCol = l.level === 'error' ? '#ef4444' : (l.level === 'warning' ? '#f59e0b' : '#3b82f6');
          return (
            '<div style="background: #111827; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border-left: 3px solid ' + borderCol + ';">' +
            '<div><span style="font-size: 11px; color: var(--text-muted);">' + new Date(l.timestamp).toLocaleTimeString() + ' • ' + escapeHtml(String(l.category).toUpperCase()) + '</span>' +
            '<div style="font-size: 13px; color: #f3f4f6; margin-top: 2px;">' + escapeHtml(l.message) + '</div></div>' +
            '<span class="badge" style="background: #1e293b; color: #93c5fd; font-size: 10px;">' + escapeHtml(l.level) + '</span></div>'
          );
        }).join('');
      } else {
        logsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 24px;">No dedicated logs recorded for this page yet.</div>';
      }

      switchPageModalTab('posts', document.querySelector('.pdw-tab-btn'));
      const modal = document.getElementById('pageDetailsModal');
      if (modal) modal.classList.add('active');
    } catch (err) {
      alert('Error loading page details: ' + err.message);
    }
  }

  function closePageDetailsModal() {
    const modal = document.getElementById('pageDetailsModal');
    if (modal) modal.classList.remove('active');
  }

  function switchPageModalTab(tabName, btn) {
    document.querySelectorAll('.pdw-tab-btn').forEach(function (b) {
      b.classList.remove('btn-primary', 'active');
      b.classList.add('btn-secondary');
    });
    if (btn) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary', 'active');
    }
    document.querySelectorAll('.pdw-subtab').forEach(function (el) {
      el.style.display = 'none';
    });
    const subTab = document.getElementById('pdwTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (subTab) subTab.style.display = 'block';
  }

  function filterPageModalPosts(filter, btn) {
    currentPostFilter = filter;
    document.querySelectorAll('.pdw-post-filter').forEach(function (b) {
      b.classList.remove('active', 'btn-primary');
    });
    if (btn) btn.classList.add('active', 'btn-primary');
    if (currentPageModalData && currentPageModalData.posts) {
      renderPageModalPostsList(currentPageModalData.posts, filter);
    }
  }

  function renderPageModalPostsList(allPosts, filter) {
    const container = document.getElementById('pdwPostsListContainer');
    if (!container) return;
    let filtered = allPosts;
    if (filter === 'published') filtered = allPosts.filter(function (p) { return p.status === 'published'; });
    if (filter === 'scheduled') filtered = allPosts.filter(function (p) { return p.status === 'scheduled'; });
    if (filter === 'review') filtered = allPosts.filter(function (p) { return p.status === 'pending_review' || p.review_state === 'pending'; });

    if (filtered.length === 0) {
      container.innerHTML =
        '<div style="text-align: center; padding: 36px; color: var(--text-muted); background: #0b0f19; border-radius: 8px; border: 1px dashed var(--card-border);">' +
        '<div style="font-size: 28px; margin-bottom: 8px;">📭</div>' +
        '<div style="font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 4px;">No Posts Found in this Category</div>' +
        '<div style="font-size: 12px;">Click <strong>🚀 Generate Post Now for this Page</strong> above to immediately produce long-form content.</div></div>';
      return;
    }

    container.innerHTML = filtered.map(function (p) {
      const isPub = p.status === 'published';
      const isSched = p.status === 'scheduled';
      const statusColor = isPub ? '#34d399' : (isSched ? '#60a5fa' : '#f59e0b');
      const statusBg = isPub ? 'rgba(52, 211, 153, 0.15)' : (isSched ? 'rgba(96, 165, 250, 0.15)' : 'rgba(245, 158, 11, 0.15)');

      return (
        '<div class="card" style="background: #0f172a; border: 1px solid #1e293b; padding: 16px;">' +
        '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">' +
        '<div><span class="badge" style="background: ' + statusBg + '; color: ' + statusColor + '; font-weight: 600; text-transform: uppercase; font-size: 11px;">● ' + escapeHtml(p.status) + '</span>' +
        (p.qa_score ? '<span class="badge" style="background: #1e3a8a; color: #93c5fd; font-size: 11px; margin-left: 6px;">QA Score: ' + p.qa_score + '/100</span>' : '') +
        '<h4 style="font-size: 16px; margin: 8px 0 4px 0; color: #f9fafb;">' + escapeHtml(p.title || 'Untitled Post') + '</h4>' +
        '<div style="font-size: 12px; color: var(--text-muted);">' +
        (p.scheduled_for ? 'Scheduled: ' + new Date(p.scheduled_for).toLocaleString() : '') +
        (p.published_at ? 'Published: ' + new Date(p.published_at).toLocaleString() : '') +
        (p.caption_word_count ? ' • ' + p.caption_word_count + ' words' : '') +
        '</div></div>' +
        '<div style="display: flex; gap: 6px;">' +
        (isPub && p.fb_permalink ? '<a href="' + escapeHtml(p.fb_permalink) + '" target="_blank" class="btn btn-secondary" style="font-size: 11px; padding: 4px 8px; text-decoration: none;">Facebook ↗</a>' : '') +
        '</div></div>' +
        '<div style="background: #111827; padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #e5e7eb; white-space: pre-wrap; max-height: 140px; overflow-y: auto; border: 1px solid #1f2937; margin-bottom: 8px;">' + escapeHtml(p.caption) + '</div>' +
        (p.first_comment ? '<div style="font-size: 12px; color: #93c5fd; background: rgba(30, 58, 138, 0.2); padding: 8px 10px; border-radius: 4px;">💬 <strong>First Comment:</strong> ' + escapeHtml(p.first_comment) + '</div>' : '') +
        '</div>'
      );
    }).join('');
  }

  function openCurrentPageInNewWindow() {
    if (currentPageModalData && currentPageModalData.page) {
      window.open('/page-details?id=' + encodeURIComponent(currentPageModalData.page.id), '_blank');
    }
  }

  async function runTestGenerationForModalPage() {
    if (!currentPageModalData || !currentPageModalData.page) return;
    const pageId = currentPageModalData.page.id;
    const res = await fetch('/api/test-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: pageId }),
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
    const p = providersData.find(function (item) { return item.id === id; });
    if (!p) return;
    document.getElementById('editProviderId').value = p.id;
    document.getElementById('editProviderName').value = p.name;
    document.getElementById('editProviderAdapter').value = p.adapter_kind;
    document.getElementById('editProviderBaseUrl').value = p.base_url || '';
    document.getElementById('editProviderModel').value = p.model_name || '';
    document.getElementById('editProviderPriority').value = p.priority;
    document.getElementById('editProviderDailyLimit').value = p.daily_limit;
    document.getElementById('editProviderEnabled').checked = p.enabled !== false;

    const keys = providerKeysData.filter(function (k) { return k.provider_id === p.id; });
    const summary = document.getElementById('editProviderKeysSummary');
    if (summary) {
      if (keys.length === 0) {
        summary.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">No keys in pool yet. Add one below or via Key Manager.</span>';
      } else {
        const badges = keys.map(function (k) {
          return '<span class="badge" style="background: ' + (k.is_active ? '#1e293b' : '#27272a') + '; color: ' + (k.is_active ? '#93c5fd' : '#71717a') + '; font-family: monospace; font-size: 11px; margin: 2px; display: inline-block;">' + escapeHtml(k.masked_key) + (k.label ? ' (' + escapeHtml(k.label) + ')' : '') + '</span>';
        }).join('');
        summary.innerHTML = '<div style="margin-bottom: 4px;">' + badges + '</div><span style="color: #34d399; font-size: 11px; font-weight: 600;">● ' + keys.filter(function (k) { return k.is_active; }).length + ' active / ' + keys.length + ' total keys</span>';
      }
    }
    const newKeysInput = document.getElementById('editProviderNewKeys');
    if (newKeysInput) newKeysInput.value = '';

    const modal = document.getElementById('editProviderModal');
    if (modal) modal.classList.add('active');
  }

  function openManageKeysFromEditModal() {
    const id = document.getElementById('editProviderId').value;
    closeEditProviderModal();
    if (id) openManageKeysModal(id);
  }

  function closeEditProviderModal() {
    const modal = document.getElementById('editProviderModal');
    if (modal) modal.classList.remove('active');
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
        id: id,
        name: name,
        adapter_kind: adapter_kind,
        base_url: base_url,
        model_name: model_name,
        priority: priority,
        daily_limit: daily_limit,
        enabled: enabled,
        new_keys: new_keys,
      }),
    });

    if (res.ok) {
      closeEditProviderModal();
      showToast('Provider settings and keys successfully saved!');
      fetchProvidersTab();
    } else {
      const err = await res.json();
      showToast('Failed to update provider: ' + (err.error || 'Unknown error'), 'error');
    }
  }

  async function deleteProviderAction(id) {
    if (!confirm('Are you sure you want to delete this provider and all associated API keys?')) return;
    const res = await fetch('/api/providers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    });
    if (res.ok) {
      showToast('Provider deleted.');
      fetchProvidersTab();
    } else {
      showToast('Failed to delete provider.', 'error');
    }
  }

  // --- Key Pool Modal & Actions ---
  function openManageKeysModal(providerId) {
    const p = providersData.find(function (item) { return item.id === providerId; });
    if (!p) return;
    try {
      history.replaceState(null, '', '/providers?provider=' + encodeURIComponent(providerId) + '&dialog=keys');
    } catch (_) {}
    document.getElementById('keyPoolProviderId').value = providerId;
    document.getElementById('manageKeysTitle').innerText = '🔑 Keys for ' + p.name;
    document.getElementById('manageKeysSubtitle').innerText = 'Adapter: ' + p.adapter_kind + ' • Model: ' + (p.model_name || 'default');
    renderKeysList(providerId);
    const modal = document.getElementById('manageKeysModal');
    if (modal) modal.classList.add('active');
  }

  function closeManageKeysModal(updateUrl) {
    const modal = document.getElementById('manageKeysModal');
    if (modal) modal.classList.remove('active');
    if (updateUrl !== false) {
      try {
        if (window.location.search.includes('dialog=keys')) {
          history.replaceState(null, '', '/providers');
        }
      } catch (_) {}
    }
  }

  function renderKeysList(providerId) {
    const keys = providerKeysData.filter(function (k) { return k.provider_id === providerId; });
    const container = document.getElementById('keysListContainer');
    if (!container) return;
    if (keys.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 12px; background: #0b0f19; border-radius: 6px; text-align: center;">No API keys configured for this provider. Add one below.</div>';
      return;
    }

    container.innerHTML = keys.map(function (k) {
      return (
        '<div style="display: flex; justify-content: space-between; align-items: center; background: #0b0f19; border: 1px solid var(--card-border); padding: 12px 14px; border-radius: 8px;">' +
        '<div><div style="display: flex; align-items: center; gap: 8px;">' +
        '<span style="font-family: \'JetBrains Mono\', monospace; font-size: 13px; font-weight: 700; color: #93c5fd;">' + escapeHtml(k.masked_key) + '</span>' +
        (k.label ? '<span style="font-size: 11px; background: #1f2937; padding: 2px 6px; border-radius: 4px; color: #d1d5db;">' + escapeHtml(k.label) + '</span>' : '') +
        (k.is_active ? '<span style="color: #34d399; font-size: 11px; font-weight: 600;">● Active</span>' : '<span style="color: #f59e0b; font-size: 11px; font-weight: 600;">⏸ Paused</span>') +
        '</div><div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Added ' + new Date(k.created_at).toLocaleDateString() + '</div></div>' +
        '<div style="display: flex; gap: 8px;">' +
        '<button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="toggleKeyAction(\'' + k.id + '\', \'' + providerId + '\')">' +
        (k.is_active ? '⏸ Pause' : '▶ Activate') + '</button>' +
        '<button type="button" class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteKeyAction(\'' + k.id + '\', \'' + providerId + '\')">🗑️ Delete</button>' +
        '</div></div>'
      );
    }).join('');
  }

  function updateProviderTableRow(providerId) {
    const row = document.getElementById('provider-row-' + providerId);
    if (!row) return;
    const keys = providerKeysData.filter(function (k) { return k.provider_id === providerId; });
    const activeKeys = keys.filter(function (k) { return k.is_active; });
    const keyBadges = keys.length > 0
      ? keys.map(function (k) {
          return '<span class="badge" style="background: ' + (k.is_active ? '#1e293b' : '#27272a') + '; color: ' + (k.is_active ? '#93c5fd' : '#71717a') + '; font-family: monospace; font-size: 11px; margin: 2px; display: inline-block;">' + escapeHtml(k.masked_key) + '</span>';
        }).join('')
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
        label: label,
      }),
    });

    if (res.ok) {
      const result = await res.json();
      const newKeys = result.addedKeys || (result.key ? [result.key] : []);
      for (const nk of newKeys) {
        const idx = providerKeysData.findIndex(function (k) { return k.id === nk.id; });
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
      const activeCount = providerKeysData.filter(function (k) { return k.provider_id === providerId && k.is_active; }).length;
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
      body: JSON.stringify({ id: keyId }),
    });
    if (res.ok) {
      const result = await res.json();
      const idx = providerKeysData.findIndex(function (k) { return k.id === keyId; });
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
      body: JSON.stringify({ id: keyId }),
    });
    if (res.ok) {
      providerKeysData = providerKeysData.filter(function (k) { return k.id !== keyId; });
      renderKeysList(providerId);
      updateProviderTableRow(providerId);
      alert('API Key deleted.');
    } else {
      alert('Failed to delete key.');
    }
  }

  // --- Safe Token Health Checkers ---
  async function checkPageTokenHealth(pageId) {
    const btn = window.event?.currentTarget;
    if (btn) btn.innerText = 'Checking...';
    try {
      const res = await fetch('/api/pages/check-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const r = data.result;
        const statusText = r.valid ? '✅ Valid & Active' : '⚠️ ' + (r.error || r.status);
        const lines = [
          'Facebook Page Token Inspection Result:',
          '',
          '• Status: ' + statusText,
          '• Token Type: ' + (r.type || 'PAGE'),
          '• Expiration: ' + (r.isNeverExpiring ? 'Never (Permanent Page Token)' : (r.expiresAt ? new Date(r.expiresAt * 1000).toLocaleString() : 'N/A')),
          '• Granted Permissions: ' + (r.scopes && r.scopes.length ? r.scopes.join(', ') : 'none'),
        ];
        if (r.missingRequiredScopes && r.missingRequiredScopes.length) {
          lines.push('• Missing Permissions: ' + r.missingRequiredScopes.join(', '));
        }
        alert(lines.join('\n'));
      } else {
        alert('Failed to check token: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Network error while checking token: ' + err.message);
    } finally {
      if (btn) btn.innerText = '🩺 Check';
    }
  }

  async function checkAccountTokenHealth(accountId) {
    const btn = window.event?.currentTarget;
    if (btn) btn.innerText = 'Checking...';
    try {
      const res = await fetch('/api/accounts/check-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const r = data.result;
        const statusText = r.valid ? '✅ Valid & Active' : '⚠️ ' + (r.error || r.status);
        const lines = [
          'Facebook User Account Token Inspection Result:',
          '',
          '• Status: ' + statusText,
          '• Token Type: ' + (r.type || 'USER'),
          '• Expiration: ' + (r.expiresAt ? new Date(r.expiresAt * 1000).toLocaleString() : 'Long-Lived (~60 Days)'),
          '• Granted Permissions: ' + (r.scopes && r.scopes.length ? r.scopes.join(', ') : 'none'),
        ];
        if (r.missingRequiredScopes && r.missingRequiredScopes.length) {
          lines.push('• Missing Permissions: ' + r.missingRequiredScopes.join(', '));
        }
        alert(lines.join('\n'));
      } else {
        alert('Failed to check token: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Network error while checking token: ' + err.message);
    } finally {
      if (btn) btn.innerText = '🩺 Check';
    }
  }

  // --- Attach all functions to window for global invocation ---
  window.openAddAccountModal = openAddAccountModal;
  window.closeAddAccountModal = closeAddAccountModal;
  window.submitNewAccount = submitNewAccount;
  window.openEditAccountModal = openEditAccountModal;
  window.closeEditAccountModal = closeEditAccountModal;
  window.submitEditAccount = submitEditAccount;
  window.deleteAccountAction = deleteAccountAction;
  window.addPageForAccount = addPageForAccount;
  window.filterPagesByAccount = filterPagesByAccount;
  window.toggleCustomNicheField = toggleCustomNicheField;
  window.openAddPageModal = openAddPageModal;
  window.closeAddPageModal = closeAddPageModal;
  window.submitNewPage = submitNewPage;
  window.deletePageAction = deletePageAction;
  window.openPagePromptStudio = openPagePromptStudio;
  window.loadPageIntoStudio = loadPageIntoStudio;
  window.savePagePromptsAction = savePagePromptsAction;
  window.inspectEffectivePrompt = inspectEffectivePrompt;
  window.testRunCurrentPage = testRunCurrentPage;
  window.renderAuditLogs = renderAuditLogs;
  window.runSimulationForSelectedPage = runSimulationForSelectedPage;
  window.approvePostAction = approvePostAction;
  window.rejectPostAction = rejectPostAction;
  window.editCaptionPrompt = editCaptionPrompt;
  window.toggleKillSwitch = toggleKillSwitch;
  window.openAddProviderModal = openAddProviderModal;
  window.closeAddProviderModal = closeAddProviderModal;
  window.toggleQuickKeyVisibility = toggleQuickKeyVisibility;
  window.toggleQuickAdvanced = toggleQuickAdvanced;
  window.onQuickProviderChange = onQuickProviderChange;
  window.submitNewProvider = submitNewProvider;
  window.openPageDetailsWindow = openPageDetailsWindow;
  window.closePageDetailsModal = closePageDetailsModal;
  window.switchPageModalTab = switchPageModalTab;
  window.filterPageModalPosts = filterPageModalPosts;
  window.renderPageModalPostsList = renderPageModalPostsList;
  window.openCurrentPageInNewWindow = openCurrentPageInNewWindow;
  window.runTestGenerationForModalPage = runTestGenerationForModalPage;
  window.openPromptsStudioFromModal = openPromptsStudioFromModal;
  window.openEditProviderModal = openEditProviderModal;
  window.openManageKeysFromEditModal = openManageKeysFromEditModal;
  window.closeEditProviderModal = closeEditProviderModal;
  window.submitEditProvider = submitEditProvider;
  window.deleteProviderAction = deleteProviderAction;
  window.openManageKeysModal = openManageKeysModal;
  window.closeManageKeysModal = closeManageKeysModal;
  window.renderKeysList = renderKeysList;
  window.updateProviderTableRow = updateProviderTableRow;
  window.submitAddKey = submitAddKey;
  window.toggleKeyAction = toggleKeyAction;
  window.deleteKeyAction = deleteKeyAction;
  window.checkPageTokenHealth = checkPageTokenHealth;
  window.checkAccountTokenHealth = checkAccountTokenHealth;
  window.syncAccountAction = syncAccountAction;
  window.syncAllPagesAction = syncAllPagesAction;
  window.quickTogglePageActive = quickTogglePageActive;
  window.quickUpdatePageProfile = quickUpdatePageProfile;
  window.quickUpdatePageTimezone = quickUpdatePageTimezone;

  async function syncAccountAction(accountId, btn) {
    if (!accountId) return;
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Syncing...';
    }
    try {
      const res = await fetch('/api/facebook/sync-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Sync error: ' + (data.error || 'Failed to sync account pages'));
      } else {
        let msg = '🎉 Synced ' + (data.accountName || 'Account') + ' successfully!\n\n' +
          'Discovered: ' + data.totalDiscovered + ' Page(s)\n' +
          'New: ' + data.newCount + ' | Updated: ' + data.updatedCount +
          (data.inaccessibleCount > 0 ? ' | Inaccessible: ' + data.inaccessibleCount : '') +
          '\nPublishable: ' + data.publishableCount;
        if (data.totalDiscovered === 0 && data.emptyExplanation) {
          msg += '\n\n⚠️ Notice: ' + data.emptyExplanation;
        }
        alert(msg);
        fetchPagesTab();
        fetchAccountsTab();
      }
    } catch (e) {
      alert('Network error while syncing account: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  async function syncAllPagesAction(btn) {
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Syncing All...';
    }
    try {
      const res = await fetch('/api/facebook/sync-all', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Sync all error: ' + (data.error || 'Failed to sync pages across accounts'));
      } else {
        alert(
          '🎉 Full Facebook Sync Completed!\n\n' +
          'Accounts Synced: ' + data.accountsSynced + '\n' +
          'Total Discovered Pages: ' + data.totalPages + '\n' +
          'New Pages: ' + data.newPages + ' | Updated: ' + data.updatedPages +
          (data.inaccessiblePages > 0 ? ' | Inaccessible: ' + data.inaccessiblePages : '')
        );
        fetchPagesTab();
        fetchAccountsTab();
      }
    } catch (e) {
      alert('Network error while syncing all accounts: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  async function quickTogglePageActive(pageId, active) {
    try {
      const res = await fetch('/api/pages/quick-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, active }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Error updating page status: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Quick toggle error:', e);
    }
  }

  async function quickUpdatePageProfile(pageId, profileId) {
    try {
      const res = await fetch('/api/pages/quick-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, profile_id: profileId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Error updating page niche profile: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Quick update profile error:', e);
    }
  }

  async function quickUpdatePageTimezone(pageId, timezone) {
    try {
      const res = await fetch('/api/pages/quick-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, timezone }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert('Error updating page timezone: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Quick update timezone error:', e);
    }
  }

  // --- Page Settings & Scheduling Controls Modal ---
  // --- Toast Notification System ---
  function showToast(message, type) {
    type = type || 'success';
    var container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; pointer-events: none;';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    var bg = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : type === 'info' ? '#3b82f6' : '#10b981';
    toast.style.cssText = 'background: ' + bg + '; color: #ffffff; padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); pointer-events: auto; display: flex; align-items: center; gap: 8px; transition: opacity 0.3s ease; opacity: 1;';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    }, 4500);
  }

  // --- Page Settings & Scheduling State ---
  var currentSettingsPageId = null;
  var currentStopPageId = null;
  var currentScheduleTimingMode = 'fixed';
  var previewDebounceTimer = null;
  var currentModalOriginalSnapshot = null;
  var currentExpectedUpdatedAt = null;
  var currentExpectedVersion = 1;

  function setScheduleTimingMode(mode) {
    currentScheduleTimingMode = mode || 'fixed';
  }

  function handlePublishingModeChange(mode) {
    selectPublishingMode(mode);
  }

  function toggleLiveFromModal() {
    toggleAutoPostingFromSwitch();
  }

  function getModalSnapshot() {
    var fixedTimes = [];
    document.querySelectorAll('.psm-fixed-time-input').forEach(function (inp) {
      if (inp.value) fixedTimes.push(inp.value);
    });
    return JSON.stringify({
      profile_id: document.getElementById('psmProfileSelect') ? document.getElementById('psmProfileSelect').value : '',
      publishing_mode: document.getElementById('psmPublishingMode') ? document.getElementById('psmPublishingMode').value : 'review',
      hybrid_min_score: document.getElementById('psmHybridScore') ? document.getElementById('psmHybridScore').value : '80',
      timezone: document.getElementById('psmTimezone') ? document.getElementById('psmTimezone').value : 'America/New_York',
      fixedTimes: fixedTimes.sort(),
      jitter: document.getElementById('psmJitter') ? document.getElementById('psmJitter').value : '10',
      minGap: document.getElementById('psmMinGap') ? document.getElementById('psmMinGap').value : '60',
      leadTime: document.getElementById('psmLeadTime') ? document.getElementById('psmLeadTime').value : '48',
      dailyCap: document.getElementById('psmDailyCap') ? document.getElementById('psmDailyCap').value : '3',
      vacationStart: document.getElementById('psmVacationStart') ? document.getElementById('psmVacationStart').value : '',
      vacationEnd: document.getElementById('psmVacationEnd') ? document.getElementById('psmVacationEnd').value : '',
      aiDisclosure: document.getElementById('psmAiDisclosureToggle') ? document.getElementById('psmAiDisclosureToggle').checked : false,
      aiText: document.getElementById('psmAiDisclosureText') ? document.getElementById('psmAiDisclosureText').value : '',
      sourceLine: document.getElementById('psmSourceLineToggle') ? document.getElementById('psmSourceLineToggle').checked : true,
    });
  }

  function markFormModified() {
    if (!currentModalOriginalSnapshot) return;
    var snap = getModalSnapshot();
    var isDirty = snap !== currentModalOriginalSnapshot;
    var unsavedBadge = document.getElementById('psmUnsavedBadge');
    var revertBtn = document.getElementById('psmRevertBtn');
    if (unsavedBadge) unsavedBadge.style.display = isDirty ? 'inline-block' : 'none';
    if (revertBtn) revertBtn.disabled = !isDirty;
  }

  function revertModalChanges() {
    if (!currentSettingsPageId) return;
    var page = pagesData.find(function (p) { return p.id === currentSettingsPageId; });
    if (!page) return;
    populateModalFromPage(page);
    var unsavedBadge = document.getElementById('psmUnsavedBadge');
    var revertBtn = document.getElementById('psmRevertBtn');
    if (unsavedBadge) unsavedBadge.style.display = 'none';
    if (revertBtn) revertBtn.disabled = true;
    showToast('↩️ Changes reverted to Supabase saved state', 'info');
  }

  function updateBigSwitchUI(isLive) {
    var liveBadge = document.getElementById('psmLiveBadge');
    var switchLabel = document.getElementById('psmSwitchLabel');
    var bigBtn = document.getElementById('psmBigSwitchBtn');
    var stepLive = document.getElementById('psmStepLive');

    if (isLive) {
      if (liveBadge) {
        liveBadge.innerText = '● LIVE (AUTONOMOUS)';
        liveBadge.style.background = 'rgba(16,185,129,0.2)';
        liveBadge.style.color = '#34d399';
      }
      if (switchLabel) {
        switchLabel.innerText = 'ON';
        switchLabel.style.color = '#34d399';
      }
      if (bigBtn) {
        bigBtn.innerText = '⏸️ Turn Auto-Posting OFF';
        bigBtn.className = 'btn btn-secondary';
        bigBtn.style.color = '#f87171';
        bigBtn.style.borderColor = 'rgba(239,68,68,0.4)';
      }
      if (stepLive) {
        stepLive.querySelector('.psm-step-icon').innerText = '✅';
        stepLive.querySelector('.psm-step-status').innerText = 'Live';
        stepLive.querySelector('.psm-step-status').style.color = '#34d399';
      }
    } else {
      if (liveBadge) {
        liveBadge.innerText = '● POSTING DISABLED';
        liveBadge.style.background = 'rgba(239,68,68,0.2)';
        liveBadge.style.color = '#f87171';
      }
      if (switchLabel) {
        switchLabel.innerText = 'OFF';
        switchLabel.style.color = '#f87171';
      }
      if (bigBtn) {
        bigBtn.innerText = '🚀 Turn Auto-Posting ON';
        bigBtn.className = 'btn btn-primary';
        bigBtn.style.color = '#ffffff';
        bigBtn.style.borderColor = '';
      }
      if (stepLive) {
        stepLive.querySelector('.psm-step-icon').innerText = '⭕';
        stepLive.querySelector('.psm-step-status').innerText = 'Paused';
        stepLive.querySelector('.psm-step-status').style.color = '#9ca3af';
      }
    }
  }

  async function openPageSettingsModal(pageId) {
    currentSettingsPageId = pageId;
    var page = pagesData.find(function (p) { return p.id === pageId; });
    if (!page) {
      alert('Page not found.');
      return;
    }

    currentExpectedUpdatedAt = page.updated_at;
    currentExpectedVersion = page.version || 1;

    document.getElementById('psmPageId').value = page.id;
    document.getElementById('psmTitle').innerText = '⚙️ Page Settings: ' + page.name;
    document.getElementById('psmPageName').innerText = page.name;
    document.getElementById('psmPageFbId').innerText = page.fb_page_id;
    document.getElementById('psmTokenStatus').innerText = (page.token_status || 'valid').toUpperCase();

    // Freshly fetch profiles from database to guarantee no stale profile IDs
    try {
      var pRes = await fetch('/api/profiles');
      if (pRes.ok) {
        var freshProfiles = await pRes.json();
        var profSelect = document.getElementById('psmProfileSelect');
        var alertNotice = document.getElementById('psmAlertNotice');
        if (profSelect && Array.isArray(freshProfiles)) {
          var optHtml = '<option value="__custom__">Custom / Type Your Own Niche...</option>';
          freshProfiles.forEach(function (pr) {
            optHtml += '<option value="' + pr.id + '">' + escapeHtml(pr.name) + (pr.category ? ' (' + escapeHtml(pr.category) + ')' : '') + '</option>';
          });
          profSelect.innerHTML = optHtml;

          if (page.profile_id && page.profile_id !== '__custom__' && page.profile_id !== 'custom') {
            var exists = freshProfiles.some(function (pr) { return pr.id === page.profile_id; });
            if (!exists) {
              if (alertNotice) {
                document.getElementById('psmAlertNoticeText').innerText = 'The previously assigned profile (ID: ' + page.profile_id + ') no longer exists in the database. Selection has been safely reset to Custom Niche.';
                alertNotice.style.display = 'block';
              }
              page.profile_id = null;
            } else if (alertNotice) {
              alertNotice.style.display = 'none';
            }
          } else if (alertNotice) {
            alertNotice.style.display = 'none';
          }
        }
      }
    } catch (e) {
      console.warn('Could not refresh profiles list on modal open:', e);
    }

    // Populate Modal Inputs
    populateModalFromPage(page);

    // Save snapshot for unsaved detection
    currentModalOriginalSnapshot = getModalSnapshot();
    var unsavedBadge = document.getElementById('psmUnsavedBadge');
    var revertBtn = document.getElementById('psmRevertBtn');
    if (unsavedBadge) unsavedBadge.style.display = 'none';
    if (revertBtn) revertBtn.disabled = true;

    // Update Checklist Banner
    updateModalChecklistDisplay(page);

    // Live preview
    updateLiveSchedulePreview();

    var modal = document.getElementById('pageSettingsModal');
    if (modal) modal.classList.add('active');
  }

  async function reloadProfilesAndResetToCustom() {
    try {
      var pRes = await fetch('/api/profiles');
      if (pRes.ok) {
        var freshProfiles = await pRes.json();
        var profSelect = document.getElementById('psmProfileSelect');
        if (profSelect && Array.isArray(freshProfiles)) {
          var optHtml = '<option value="__custom__" selected>Custom / Type Your Own Niche...</option>';
          freshProfiles.forEach(function (pr) {
            optHtml += '<option value="' + pr.id + '">' + escapeHtml(pr.name) + (pr.category ? ' (' + escapeHtml(pr.category) + ')' : '') + '</option>';
          });
          profSelect.innerHTML = optHtml;
          profSelect.value = '__custom__';
        }
      }
      handleModalProfileChange('__custom__');
      var alertBox = document.getElementById('psmAlertNotice');
      if (alertBox) alertBox.style.display = 'none';
      markFormModified();
      showToast('Profiles reloaded and selection reset to Custom Niche.', 'success');
    } catch (err) {
      showToast('Error reloading profiles: ' + err.message, 'error');
    }
  }

  function closePageSettingsModal() {
    var modal = document.getElementById('pageSettingsModal');
    if (modal) modal.classList.remove('active');
    currentSettingsPageId = null;
  }

  function populateModalFromPage(page) {
    var isLive = Boolean(page.active || page.is_live);
    updateBigSwitchUI(isLive);

    // Step 1: Profile Select & Custom Niche
    var profSelect = document.getElementById('psmProfileSelect');
    if (profSelect) {
      profSelect.value = page.profile_id || '__custom__';
    }
    var customNicheText = document.getElementById('psmCustomNicheText');
    if (customNicheText) {
      customNicheText.value = page.custom_niche_text || '';
      var countEl = document.getElementById('psmCustomNicheCharCount');
      if (countEl) countEl.innerText = (page.custom_niche_text ? page.custom_niche_text.length : 0) + ' / 1000 characters';
    }
    handleModalProfileChange(page.profile_id || '__custom__', true);

    // Niche suggestion box
    var suggestionBox = document.getElementById('psmNicheSuggestionBox');
    if (page.niche_analysis && page.niche_analysis.suggested_profile_name) {
      document.getElementById('psmNicheSuggestedName').innerText = page.niche_analysis.suggested_profile_name;
      document.getElementById('psmNicheConfidenceBadge').innerText = Math.round((page.niche_analysis.confidence || 0) * 100) + '% Match';
      document.getElementById('psmNicheReasoning').innerText = page.niche_analysis.reasoning || '';

      var meta = document.getElementById('psmNicheMeta');
      meta.innerHTML = '';
      if (page.niche_analysis.detected_tone) {
        meta.innerHTML += '<span>Tone: <strong style="color: #cbd5e1;">' + escapeHtml(page.niche_analysis.detected_tone) + '</strong></span>';
      }
      if (page.niche_analysis.suggested_posts_per_day) {
        meta.innerHTML += '<span>Suggested: <strong style="color: #cbd5e1;">' + page.niche_analysis.suggested_posts_per_day + ' posts/day</strong></span>';
      }
      if (page.niche_analysis.caption_length_preference) {
        meta.innerHTML += '<span>Caption: <strong style="color: #cbd5e1;">' + escapeHtml(page.niche_analysis.caption_length_preference) + '</strong></span>';
      }
      suggestionBox.style.display = 'block';
    } else {
      if (suggestionBox) suggestionBox.style.display = 'none';
    }

    // Step 2: Schedule & Timezone
    var sched = page.schedule || { postsPerDay: 0, postingTimes: [], timezone: 'America/New_York' };
    var tzSelect = document.getElementById('psmTimezone');
    if (tzSelect) {
      tzSelect.value = sched.timezone || 'America/New_York';
    }

    var fixedList = document.getElementById('psmFixedTimesList');
    if (fixedList) {
      fixedList.innerHTML = '';
      var times = sched.postingTimes && sched.postingTimes.length > 0 ? sched.postingTimes : [];
      times.forEach(function (t) {
        addFixedTimePicker(t);
      });
    }

    // Step 3: Publishing mode (initial populate without confirmation dialog)
    selectPublishingMode(page.publishing_mode || 'review', true);
    var hybridScore = document.getElementById('psmHybridScore');
    if (hybridScore) {
      hybridScore.value = page.hybrid_min_score || 80;
      document.getElementById('psmHybridScoreVal').innerText = page.hybrid_min_score || 80;
    }

    // Advanced inputs
    document.getElementById('psmJitter').value = sched.jitterMinutes !== undefined ? sched.jitterMinutes : 10;
    document.getElementById('psmMinGap').value = sched.minGapMinutes !== undefined ? sched.minGapMinutes : 60;
    document.getElementById('psmLeadTime').value = sched.leadTimeHours !== undefined ? sched.leadTimeHours : 48;
    document.getElementById('psmDailyCap').value = page.daily_cap || 3;
    document.getElementById('psmVacationStart').value = sched.vacationStart || '';
    document.getElementById('psmVacationEnd').value = sched.vacationEnd || '';

    // QA and Structure Inputs
    var qaScoreInp = document.getElementById('psmQaPassThreshold');
    if (qaScoreInp) qaScoreInp.value = page.qa_pass_threshold !== undefined && page.qa_pass_threshold !== null ? page.qa_pass_threshold : 80;
    var maxSentInp = document.getElementById('psmMaxSentencesPerParagraph');
    if (maxSentInp) maxSentInp.value = page.max_sentences_per_paragraph !== undefined && page.max_sentences_per_paragraph !== null ? page.max_sentences_per_paragraph : 3;
    var minWordsInp = document.getElementById('psmMinWords');
    if (minWordsInp) minWordsInp.value = page.min_words !== undefined && page.min_words !== null ? page.min_words : '';
    var targetWordsInp = document.getElementById('psmTargetWords');
    if (targetWordsInp) targetWordsInp.value = page.target_words !== undefined && page.target_words !== null ? page.target_words : '';
    var maxWordsInp = document.getElementById('psmMaxWords');
    if (maxWordsInp) maxWordsInp.value = page.max_words !== undefined && page.max_words !== null ? page.max_words : '';

    var aiToggle = document.getElementById('psmAiDisclosureToggle');
    if (aiToggle) {
      aiToggle.checked = Boolean(page.ai_disclosure_enabled);
      document.getElementById('psmAiDisclosureBox').style.display = aiToggle.checked ? 'block' : 'none';
      document.getElementById('psmAiDisclosureText').value = page.ai_disclosure_text || 'AI-assisted content created for Beyond the Known.';
    }
    var srcToggle = document.getElementById('psmSourceLineToggle');
    if (srcToggle) {
      srcToggle.checked = page.source_attribution_enabled !== false;
    }

    handleScheduleInputChange();
  }

  function updateModalChecklistDisplay(page) {
    var sched = page.schedule || {};
    var customText = page.custom_niche || page.custom_niche_text || (document.getElementById('psmCustomNicheText') ? document.getElementById('psmCustomNicheText').value.trim() : '');
    var profileChosen = Boolean(
      (page.profile_id && page.profile_id !== 'default-niche' && page.profile_id !== '__custom__' && page.profile_id !== 'custom') ||
      (customText && customText.length > 0)
    );
    var scheduleSet = Boolean(sched.postsPerDay && sched.postsPerDay > 0 && sched.postingTimes && sched.postingTimes.length > 0);
    var modeChosen = Boolean(page.mode_chosen !== false && page.publishing_mode);
    var testDone = Boolean(page.test_run_verified && page.last_test_run_at);
    var isLive = Boolean(page.active || page.is_live);

    function setStep(id, done, htmlLabel) {
      var el = document.getElementById(id);
      if (!el) return;
      el.querySelector('.psm-step-icon').innerText = done ? '✅' : '⭕';
      var st = el.querySelector('.psm-step-status');
      st.innerHTML = htmlLabel;
      st.style.color = done ? '#34d399' : '#f87171';
    }

    var profileLabel = profileChosen ? (customText ? 'Custom Niche' : 'Chosen') : 'Not Chosen';
    var testLabel = testDone
      ? 'Verified • <a href="javascript:void(0)" onclick="viewTestRunReport(\'' + page.id + '\')" style="color: #60a5fa; text-decoration: underline; font-size: 11px;">View report</a>'
      : (page.test_run_report && page.test_run_report.error
        ? 'Failed • <a href="javascript:void(0)" onclick="viewTestRunReport(\'' + page.id + '\')" style="color: #f87171; text-decoration: underline; font-size: 11px;">View error</a>'
        : 'Needed');

    setStep('psmStepProfile', profileChosen, profileLabel);
    setStep('psmStepSchedule', scheduleSet, scheduleSet ? (sched.postsPerDay + ' posts/day') : '0 posts/day');
    setStep('psmStepMode', modeChosen, (page.publishing_mode || 'review').toUpperCase());
    setStep('psmStepTest', testDone, testLabel);
    setStep('psmStepLive', isLive, isLive ? 'Live' : 'Paused');

    var missingCount = (profileChosen ? 0 : 1) + (scheduleSet ? 0 : 1) + (modeChosen ? 0 : 1) + (testDone ? 0 : 1);
    var totalDone = 4 - missingCount;

    var progressElem = document.getElementById('psmChecklistProgress');
    if (progressElem) {
      if (isLive) {
        progressElem.innerText = 'All Steps Complete • Page Active';
        progressElem.style.color = '#34d399';
      } else if (missingCount === 0) {
        progressElem.innerText = 'Ready to Go Live! Click "Turn Auto-Posting ON"';
        progressElem.style.color = '#34d399';
      } else {
        progressElem.innerText = missingCount + ' Step(s) Incomplete before Live';
        progressElem.style.color = '#f59e0b';
      }
    }

    var bigBtn = document.getElementById('psmBigSwitchBtn');
    if (bigBtn) {
      if (!isLive) {
        var canActivate = (missingCount === 0);
        bigBtn.disabled = !canActivate;
        if (!canActivate) {
          bigBtn.title = 'Complete all 4 checklist steps and verify before taking page live.';
          bigBtn.style.opacity = '0.5';
          bigBtn.style.cursor = 'not-allowed';
        } else {
          bigBtn.title = 'All steps complete. Click to activate auto-posting.';
          bigBtn.style.opacity = '1';
          bigBtn.style.cursor = 'pointer';
        }
      } else {
        bigBtn.disabled = false;
        bigBtn.title = 'Click to stop auto-posting.';
        bigBtn.style.opacity = '1';
        bigBtn.style.cursor = 'pointer';
      }
    }
  }

  function addFixedTimePicker(timeVal) {
    var list = document.getElementById('psmFixedTimesList');
    if (!list) return;
    var val = timeVal || '12:00';
    var tag = document.createElement('div');
    tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; background: #1e293b; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);';
    tag.innerHTML = '<input type="time" class="psm-fixed-time-input" value="' + val + '" style="background: none; border: none; color: #f3f4f6; font-size: 13px; font-weight: 600;" onchange="handleScheduleInputChange(); markFormModified();">' +
      '<button type="button" onclick="removeFixedTimePicker(this)" style="background: none; border: none; color: #ef4444; font-size: 14px; cursor: pointer; padding: 0 4px;" title="Remove time">✕</button>';
    list.appendChild(tag);
    handleScheduleInputChange();
  }

  function removeFixedTimePicker(btn) {
    var parent = btn.parentElement;
    if (parent && parent.parentElement) {
      parent.parentElement.removeChild(parent);
      handleScheduleInputChange();
      markFormModified();
    }
  }

  function handleScheduleInputChange() {
    var fixedTimes = [];
    document.querySelectorAll('.psm-fixed-time-input').forEach(function (inp) {
      if (inp.value) fixedTimes.push(inp.value);
    });

    var postsPerDay = fixedTimes.length;
    var postsInp = document.getElementById('psmPostsPerDay');
    if (postsInp) postsInp.value = postsPerDay;

    var cadenceBadge = document.getElementById('psmCadenceBadge');
    if (cadenceBadge) cadenceBadge.innerText = postsPerDay + ' posts / day';

    var warning = document.getElementById('psmHighCadenceWarning');
    if (warning) {
      warning.style.display = postsPerDay > 5 ? 'block' : 'none';
    }

    var tzSelect = document.getElementById('psmTimezone');
    var tzVal = tzSelect ? tzSelect.value : 'America/New_York';

    // Overnight warning (00:00 - 05:59)
    var hasOvernight = fixedTimes.some(function (t) {
      var h = parseInt(t.split(':')[0], 10);
      return !isNaN(h) && h >= 0 && h <= 5;
    });
    var overnightEl = document.getElementById('psmOvernightWarning');
    var overnightTzEl = document.getElementById('psmOvernightTzName');
    if (overnightTzEl) overnightTzEl.innerText = tzVal;
    if (overnightEl) overnightEl.style.display = hasOvernight ? 'block' : 'none';

    // Update Step 2 Card Check
    var cardCheck2 = document.getElementById('psmCardCheck2');
    if (cardCheck2) cardCheck2.innerText = postsPerDay > 0 ? '✅' : '⭕';

    var stepSchedule = document.getElementById('psmStepSchedule');
    if (stepSchedule) {
      stepSchedule.querySelector('.psm-step-icon').innerText = postsPerDay > 0 ? '✅' : '⭕';
      stepSchedule.querySelector('.psm-step-status').innerText = postsPerDay + ' posts/day';
      stepSchedule.querySelector('.psm-step-status').style.color = postsPerDay > 0 ? '#34d399' : '#9ca3af';
    }

    // Update Audience Timezone current time display
    var tzDisplay = document.getElementById('psmCurrentTzTime');
    if (tzSelect && tzDisplay) {
      try {
        var nowStr = new Intl.DateTimeFormat('en-US', {
          timeZone: tzSelect.value,
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          weekday: 'short'
        }).format(new Date());
        tzDisplay.innerText = 'Current time in ' + tzSelect.value + ': ' + nowStr;
      } catch (e) {
        tzDisplay.innerText = '';
      }
    }

    if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(updateLiveSchedulePreview, 250);
  }

  function applyUsPrimeTimeSuggestions() {
    var list = document.getElementById('psmFixedTimesList');
    if (!list) return;
    list.innerHTML = '';
    var primeTimes = ['09:00', '13:00', '18:00', '21:00'];
    primeTimes.forEach(function (t) {
      addFixedTimePicker(t);
    });
    handleScheduleInputChange();
    markFormModified();
    showToast('Applied US prime-time schedule (09:00, 13:00, 18:00, 21:00)!', 'success');
  }

  function applyQuickSchedule(count) {
    var list = document.getElementById('psmFixedTimesList');
    if (!list) return;
    list.innerHTML = '';
    var times = count === 5
      ? ['09:00', '12:00', '15:00', '18:00', '21:00']
      : ['10:00', '15:00', '20:00'];
    times.forEach(function (t) {
      addFixedTimePicker(t);
    });
    handleScheduleInputChange();
    markFormModified();
    showToast('Applied ' + count + ' posts/day quick schedule!', 'info');
  }

  var pendingPublishingMode = null;

  function selectPublishingMode(mode, isInitial) {
    var modeInp = document.getElementById('psmPublishingMode');
    var currentMode = modeInp ? modeInp.value : 'review';

    if (!isInitial && (mode === 'auto' || mode === 'hybrid') && mode !== currentMode) {
      pendingPublishingMode = mode;
      var confirmModal = document.getElementById('modeConfirmationModal');
      var nameEl = document.getElementById('mcmModeName');
      if (confirmModal && nameEl) {
        nameEl.innerText = mode === 'auto' ? 'Fully Automatic' : 'Hybrid (Quality Gate)';
        confirmModal.style.display = 'flex';
        return;
      }
    }

    applyPublishingModeSelection(mode);
    if (!isInitial) markFormModified();
  }

  function applyPublishingModeSelection(mode) {
    var modeInp = document.getElementById('psmPublishingMode');
    if (modeInp) modeInp.value = mode;

    var cards = [
      { id: 'modeCardReview', name: 'review' },
      { id: 'modeCardAuto', name: 'auto' },
      { id: 'modeCardHybrid', name: 'hybrid' }
    ];

    cards.forEach(function (c) {
      var el = document.getElementById(c.id);
      if (!el) return;
      if (c.name === mode) {
        el.style.border = '2px solid #3b82f6';
        el.style.background = 'rgba(59,130,246,0.1)';
      } else {
        el.style.border = '1px solid var(--card-border)';
        el.style.background = 'rgba(255,255,255,0.02)';
      }
    });

    var hybridGrp = document.getElementById('psmHybridScoreGroup');
    if (hybridGrp) {
      hybridGrp.style.display = mode === 'hybrid' ? 'block' : 'none';
    }

    var stepMode = document.getElementById('psmStepMode');
    if (stepMode) {
      stepMode.querySelector('.psm-step-icon').innerText = '✅';
      stepMode.querySelector('.psm-step-status').innerText = mode.toUpperCase();
      stepMode.querySelector('.psm-step-status').style.color = '#34d399';
    }
    var cardCheck3 = document.getElementById('psmCardCheck3');
    if (cardCheck3) cardCheck3.innerText = '✅';
  }

  function confirmModeChange() {
    var modal = document.getElementById('modeConfirmationModal');
    if (modal) modal.style.display = 'none';
    if (pendingPublishingMode) {
      applyPublishingModeSelection(pendingPublishingMode);
      pendingPublishingMode = null;
      markFormModified();
    }
  }

  function cancelModeConfirmation() {
    var modal = document.getElementById('modeConfirmationModal');
    if (modal) modal.style.display = 'none';
    pendingPublishingMode = null;
  }

  function handleModalProfileChange(val, silent) {
    var isCustom = (val === '__custom__');
    var customBox = document.getElementById('psmCustomNicheBox');
    if (customBox) {
      customBox.style.display = isCustom ? 'block' : 'none';
    }
    var customText = document.getElementById('psmCustomNicheText') ? document.getElementById('psmCustomNicheText').value.trim() : '';
    var isChosen = Boolean((val && val !== '__custom__') || (isCustom && customText.length > 0));

    var cardCheck1 = document.getElementById('psmCardCheck1');
    if (cardCheck1) {
      cardCheck1.innerText = isChosen ? '✅' : '⭕';
    }
    var stepProfile = document.getElementById('psmStepProfile');
    if (stepProfile) {
      stepProfile.querySelector('.psm-step-icon').innerText = isChosen ? '✅' : '⭕';
      stepProfile.querySelector('.psm-step-status').innerText = isChosen ? 'Chosen' : 'Not Chosen';
      stepProfile.querySelector('.psm-step-status').style.color = isChosen ? '#34d399' : '#f87171';
    }
    if (!silent) markFormModified();
  }

  function handleCustomNicheTextInput(val) {
    var countEl = document.getElementById('psmCustomNicheCharCount');
    if (countEl) {
      countEl.innerText = (val ? val.length : 0) + ' / 1000 characters';
    }
    var profVal = document.getElementById('psmProfileSelect') ? document.getElementById('psmProfileSelect').value : '';
    if (profVal === '__custom__') {
      var isChosen = Boolean(val && val.trim().length > 0);
      var cardCheck1 = document.getElementById('psmCardCheck1');
      if (cardCheck1) cardCheck1.innerText = isChosen ? '✅' : '⭕';
      var stepProfile = document.getElementById('psmStepProfile');
      if (stepProfile) {
        stepProfile.querySelector('.psm-step-icon').innerText = isChosen ? '✅' : '⭕';
        stepProfile.querySelector('.psm-step-status').innerText = isChosen ? 'Chosen' : 'Not Chosen';
        stepProfile.querySelector('.psm-step-status').style.color = isChosen ? '#34d399' : '#f87171';
      }
    }
  }

  function getSchedulePayloadFromModal() {
    var fixedTimes = [];
    document.querySelectorAll('.psm-fixed-time-input').forEach(function (inp) {
      if (inp.value) fixedTimes.push(inp.value);
    });

    var postsPerDay = fixedTimes.length;
    var timezone = document.getElementById('psmTimezone') ? document.getElementById('psmTimezone').value : 'America/New_York';

    return {
      postsPerDay: postsPerDay,
      mode: 'fixed',
      postingTimes: fixedTimes,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      timezone: timezone,
      windowStart: '09:00',
      windowEnd: '21:00',
      intervalHours: 3,
      jitterMinutes: Number(document.getElementById('psmJitter') ? document.getElementById('psmJitter').value : 10) || 10,
      minGapMinutes: Number(document.getElementById('psmMinGap') ? document.getElementById('psmMinGap').value : 60) || 60,
      leadTimeHours: Number(document.getElementById('psmLeadTime') ? document.getElementById('psmLeadTime').value : 48) || 48,
      vacationStart: document.getElementById('psmVacationStart') ? document.getElementById('psmVacationStart').value : null,
      vacationEnd: document.getElementById('psmVacationEnd') ? document.getElementById('psmVacationEnd').value : null,
    };
  }

  async function updateLiveSchedulePreview() {
    var tableBody = document.getElementById('psmSchedulePreviewTableBody');
    var badge = document.getElementById('psmSlotSummaryBadge');
    if (!tableBody) return;

    var sched = getSchedulePayloadFromModal();
    if (!sched.postsPerDay || sched.postsPerDay === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 12px; color: var(--text-muted); font-style: italic;">Cadence is 0 posts/day. Click "+ Add Time" or a Quick-fill button above to plan slots.</td></tr>';
      if (badge) badge.innerText = 'Posting Disabled (0 posts/day)';
      return;
    }

    try {
      var res = await fetch('/api/pages/preview-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: sched, countDays: 7, userTimezone: 'Asia/Kolkata' }),
      });
      var data = await res.json();
      if (!res.ok || !data.success) {
        tableBody.innerHTML = '<tr><td colspan="5" style="color: #f87171; padding: 8px;">' + escapeHtml(data.error || (data.errors ? data.errors.join('; ') : 'Validation error')) + '</td></tr>';
        if (badge) badge.innerText = 'Validation Error';
        return;
      }

      var slots = data.slots || (Array.isArray(data.preview) ? data.preview : (data.preview && data.preview.slots ? data.preview.slots : []));

      if (!slots || slots.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 12px; color: var(--text-muted);">No slots scheduled in the next 7 days for current settings.</td></tr>';
        if (badge) badge.innerText = '0 slots';
        return;
      }

      if (badge) badge.innerText = (data.nextSlotLabel ? data.nextSlotLabel + ' • ' : '') + slots.length + ' slots planned over next 7 days';

      var html = '';
      slots.forEach(function (slot) {
        var dayLabel = escapeHtml(slot.dayOfWeekName || slot.dayOfWeek || '') + ' (' + escapeHtml(slot.date || slot.audienceDate || '') + ')';
        var audTz = escapeHtml(slot.audienceTimezone || slot.timezone || '');
        var locTz = escapeHtml(slot.localTimezone || 'IST');
        html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">' +
          '<td style="padding: 6px 8px; font-weight: 600; color: #f3f4f6;">' + dayLabel + '</td>' +
          '<td style="padding: 6px 8px; color: var(--text-muted);">' + (slot.slotIndex || 1) + '</td>' +
          '<td style="padding: 6px 8px; color: #34d399; font-weight: 700;">' + escapeHtml(slot.audienceTime) + ' <small style="color: var(--text-muted); font-weight: normal;">' + audTz + '</small></td>' +
          '<td style="padding: 6px 8px; color: #93c5fd; font-weight: 700;">' + escapeHtml(slot.localTime) + ' <small style="color: var(--text-muted); font-weight: normal;">' + locTz + '</small></td>' +
          '<td style="padding: 6px 8px; text-transform: uppercase; font-size: 10px; color: #a78bfa;">' + escapeHtml(slot.mode || 'fixed') + '</td>' +
        '</tr>';
      });
      tableBody.innerHTML = html;
    } catch (err) {
      tableBody.innerHTML = '<tr><td colspan="5" style="color: #f87171; padding: 8px;">Error generating preview: ' + escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function handleSavePageSettings(e, forceSave) {
    if (e && e.preventDefault) e.preventDefault();
    if (!currentSettingsPageId) return;

    var saveBtn = document.getElementById('psmSaveBtn');
    var origText = saveBtn ? saveBtn.innerText : '💾 Save Settings to Supabase';

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = '💾 Saving & Verifying...';
      }

      var sched = getSchedulePayloadFromModal();
      var rawProfileVal = document.getElementById('psmProfileSelect').value;
      var customNicheText = document.getElementById('psmCustomNicheText') ? document.getElementById('psmCustomNicheText').value.trim() : '';

      var isCustom = rawProfileVal === '__custom__' || rawProfileVal === 'custom' || !rawProfileVal;
      var profile_id = isCustom ? null : rawProfileVal;

      var payload = {
        pageId: currentSettingsPageId,
        id: currentSettingsPageId,
        profile_id: profile_id,
        custom_niche: customNicheText,
        custom_niche_text: customNicheText,
        custom_niche_name: customNicheText,
        publishing_mode: document.getElementById('psmPublishingMode').value,
        mode_chosen: true,
        hybrid_min_score: Number(document.getElementById('psmHybridScore').value) || 80,
        daily_cap: Number(document.getElementById('psmDailyCap').value) || 3,
        qa_pass_threshold: Number(document.getElementById('psmQaPassThreshold') ? document.getElementById('psmQaPassThreshold').value : 80) || 80,
        max_sentences_per_paragraph: Number(document.getElementById('psmMaxSentencesPerParagraph') ? document.getElementById('psmMaxSentencesPerParagraph').value : 3) || 3,
        min_words: document.getElementById('psmMinWords') && document.getElementById('psmMinWords').value ? Number(document.getElementById('psmMinWords').value) : null,
        target_words: document.getElementById('psmTargetWords') && document.getElementById('psmTargetWords').value ? Number(document.getElementById('psmTargetWords').value) : null,
        max_words: document.getElementById('psmMaxWords') && document.getElementById('psmMaxWords').value ? Number(document.getElementById('psmMaxWords').value) : null,
        schedule: sched,
        ai_disclosure_enabled: document.getElementById('psmAiDisclosureToggle').checked,
        ai_disclosure_text: document.getElementById('psmAiDisclosureText').value,
        source_attribution_enabled: document.getElementById('psmSourceLineToggle').checked,
        expected_updated_at: currentExpectedUpdatedAt,
        expected_version: currentExpectedVersion,
        expected_settings_version: currentExpectedVersion,
        force: Boolean(forceSave),
      };

      var res = await fetch('/api/pages/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json();

      if (res.status === 409 || data.conflict) {
        openConcurrencyConflictModal(currentSettingsPageId, data, payload, function () {
          handleSavePageSettings(null, true);
        });
        return;
      }

      if (!res.ok || data.error) {
        if (data.missingId || (data.error && data.error.includes('profile'))) {
          var alertBox = document.getElementById('psmAlertNotice');
          var alertText = document.getElementById('psmAlertNoticeText');
          if (alertBox && alertText) {
            alertText.innerText = data.error || 'Selected profile no longer exists. Click "Reload Profiles & Reset to Custom" above to recover.';
            alertBox.style.display = 'block';
          }
        }
        showToast('Failed to save settings: ' + (data.error || 'Unknown error'), 'error');
        return;
      }

      // Update in local pagesData
      var idx = pagesData.findIndex(function (p) { return p.id === currentSettingsPageId; });
      if (idx !== -1 && data.page) {
        pagesData[idx] = data.page;
        currentExpectedUpdatedAt = data.page.settings_updated_at || data.page.updated_at;
        currentExpectedVersion = data.page.settings_version || data.page.version;
      }

      currentModalOriginalSnapshot = getModalSnapshot();
      var unsavedBadge = document.getElementById('psmUnsavedBadge');
      var revertBtn = document.getElementById('psmRevertBtn');
      if (unsavedBadge) unsavedBadge.style.display = 'none';
      if (revertBtn) revertBtn.disabled = true;

      var savedTime = new Date(data.savedAt || Date.now()).toLocaleTimeString();
      showToast('✅ Saved and verified at ' + savedTime, 'success');

      if (data.page) {
        updateModalChecklistDisplay(data.page);
      }
    } catch (err) {
      showToast('Network error while saving settings: ' + err.message, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = origText;
      }
    }
  }

  // --- Concurrency Conflict 3-Way Dialog ---
  let activeConflictPageId = null;
  let activeConflictData = null;
  let activePendingPayload = null;
  let activeConflictRetryCallback = null;

  function openConcurrencyConflictModal(pageId, conflictData, pendingPayload, retryCallback) {
    activeConflictPageId = pageId;
    activeConflictData = conflictData;
    activePendingPayload = pendingPayload;
    activeConflictRetryCallback = retryCallback;

    const modal = document.getElementById('concurrencyConflictModal');
    if (!modal) {
      alert('Concurrency conflict: Settings were modified elsewhere. Please reload to see latest.');
      return;
    }

    const summaryText = document.getElementById('conflictSummaryText');
    const changedAt = (conflictData.currentRecord && (conflictData.currentRecord.settings_updated_at || conflictData.currentRecord.updated_at)) || 'recently';
    if (summaryText) {
      summaryText.innerHTML = '⚠️ Another session or background process modified this page at <strong>' + escapeHtml(new Date(changedAt).toLocaleTimeString()) + '</strong>. Choose how you want to proceed. Your typed edits will not be lost.';
    }

    const fieldsList = document.getElementById('conflictFieldsList');
    if (fieldsList) {
      const changed = conflictData.changedFields && conflictData.changedFields.length > 0
        ? conflictData.changedFields
        : ['settings_version', 'publishing_mode', 'schedule'];
      fieldsList.innerHTML = '<div style="color: #94a3b8; margin-bottom: 4px;">Modified Fields in Database:</div>' +
        changed.map(function(f) { return '<div style="padding: 2px 0;">• ' + escapeHtml(f) + '</div>'; }).join('');
    }

    modal.style.display = 'flex';
  }

  function closeConcurrencyConflictModal() {
    const modal = document.getElementById('concurrencyConflictModal');
    if (modal) modal.style.display = 'none';
    activeConflictPageId = null;
    activeConflictData = null;
    activePendingPayload = null;
    activeConflictRetryCallback = null;
  }

  async function resolveConflictKeepMine() {
    if (typeof activeConflictRetryCallback === 'function') {
      const cb = activeConflictRetryCallback;
      closeConcurrencyConflictModal();
      await cb();
    }
  }

  function resolveConflictUseLatest() {
    if (activeConflictData && activeConflictData.currentRecord) {
      const record = activeConflictData.currentRecord;
      const idx = pagesData.findIndex(function (p) { return p.id === record.id; });
      if (idx !== -1) pagesData[idx] = record;
      populateModalFromPage(record);
      currentExpectedUpdatedAt = record.settings_updated_at || record.updated_at;
      currentExpectedVersion = record.settings_version || record.version;
      currentModalOriginalSnapshot = getModalSnapshot();
      updateModalChecklistDisplay(record);
      showToast('Loaded latest settings from database.', 'info');
    }
    closeConcurrencyConflictModal();
  }

  async function resolveConflictMerge() {
    if (!activeConflictPageId || !activePendingPayload || !activeConflictData) {
      closeConcurrencyConflictModal();
      return;
    }
    const merged = Object.assign({}, activeConflictData.currentRecord || {}, activePendingPayload, { force: true });
    closeConcurrencyConflictModal();

    try {
      showToast('Merging and saving settings...', 'info');
      const res = await fetch('/api/pages/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Merged settings successfully saved!', 'success');
        const idx = pagesData.findIndex(function (p) { return p.id === activeConflictPageId; });
        if (idx !== -1 && data.page) pagesData[idx] = data.page;
        if (data.page) updateModalChecklistDisplay(data.page);
      } else {
        showToast('Failed to save merged settings: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (e) {
      showToast('Network error while merging: ' + e.message, 'error');
    }
  }

  // --- Test Run Report Modal ---
  function viewTestRunReport(pageId) {
    const page = pagesData.find(function (p) { return p.id === pageId; });
    if (!page || !page.test_run_report) {
      showToast('No test run report available yet. Run a Test Run first.', 'warning');
      return;
    }

    const report = page.test_run_report;
    const modal = document.getElementById('testRunReportModal');
    if (!modal) return;

    document.getElementById('trrPageName').innerText = page.name || 'Facebook Page';
    document.getElementById('trrTestedAt').innerText = report.testedAt ? new Date(report.testedAt).toLocaleString() : 'Recent';

    const badge = document.getElementById('trrStatusBadge');
    if (badge) {
      if (report.success) {
        badge.innerText = 'VERIFIED';
        badge.style.background = 'rgba(16,185,129,0.2)';
        badge.style.color = '#34d399';
      } else {
        badge.innerText = 'FAILED';
        badge.style.background = 'rgba(239,68,68,0.2)';
        badge.style.color = '#f87171';
      }
    }

    const stagesList = document.getElementById('trrStagesContainer');
    if (stagesList) {
      stagesList.innerHTML = (report.stages || []).map(function (s) {
        const isPassed = s.status === 'completed' || s.status === 'passed';
        const color = isPassed ? '#34d399' : '#f87171';
        const icon = isPassed ? '✅' : '❌';
        const provInfo = s.provider ? (escapeHtml(s.provider) + (s.model ? ' / ' + escapeHtml(s.model) : '')) : '';
        const tokenInfo = s.tokens && s.tokens.totalTokens ? (s.tokens.totalTokens + ' tokens') : '';
        const metaLine = [provInfo, tokenInfo].filter(Boolean).join(' • ');

        return '<div style="background: #020617; border: 1px solid ' + (isPassed ? '#1e293b' : '#7f1d1d') + '; border-radius: 6px; padding: 10px;">' +
          '<div style="font-size: 11px; color: #94a3b8; margin-bottom: 2px;">' + icon + ' ' + escapeHtml(s.name) + '</div>' +
          '<div style="font-size: 13px; font-weight: 700; color: ' + color + ';">' + escapeHtml(s.status.toUpperCase()) + (s.score ? (' (' + s.score + ')') : '') + '</div>' +
          '<div style="font-size: 11px; color: #64748b;">' + (s.durationMs || 0) + 'ms</div>' +
          (metaLine ? ('<div style="font-size: 10px; color: #475569; margin-top: 2px;">' + metaLine + '</div>') : '') +
          (s.error ? ('<div style="font-size: 11px; color: #fca5a5; margin-top: 4px;">' + escapeHtml(s.error) + '</div>') : '') +
          '</div>';
      }).join('');
    }

    // Research Sources (Factual Posts)
    const researchSection = document.getElementById('trrResearchSection');
    const researchContainer = document.getElementById('trrResearchSourcesContainer');
    if (researchSection && researchContainer) {
      if (report.researchSources && report.researchSources.length > 0) {
        researchContainer.innerHTML = report.researchSources.map(function (url) {
          return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; font-size: 12px; text-decoration: underline; display: flex; align-items: center; gap: 6px;">' +
            '<span>🔗</span> <span>' + escapeHtml(url) + '</span>' +
          '</a>';
        }).join('');
        researchSection.style.display = 'block';
      } else {
        researchSection.style.display = 'none';
      }
    }

    // Claim-by-Claim Factual Verification Audit
    const claimsSection = document.getElementById('trrClaimsSection');
    const claimsContainer = document.getElementById('trrClaimsContainer');
    const claimsBadge = document.getElementById('trrClaimsBadge');
    if (claimsSection && claimsContainer) {
      if (report.claimVerification && report.claimVerification.length > 0) {
        const unverified = report.claimVerification.filter(function (c) { return !c.verified; });
        if (claimsBadge) {
          if (unverified.length === 0) {
            claimsBadge.innerText = '100% GROUNDED';
            claimsBadge.style.background = 'rgba(16,185,129,0.2)';
            claimsBadge.style.color = '#34d399';
          } else {
            claimsBadge.innerText = unverified.length + ' UNVERIFIED CLAIM(S)';
            claimsBadge.style.background = 'rgba(239,68,68,0.2)';
            claimsBadge.style.color = '#f87171';
          }
        }
        claimsContainer.innerHTML = report.claimVerification.map(function (c) {
          const ok = c.verified;
          const icon = ok ? '✅' : '❌';
          return '<div style="background: #0b0f19; border: 1px solid ' + (ok ? '#1e293b' : 'rgba(239,68,68,0.4)') + '; border-radius: 6px; padding: 8px 10px;">' +
            '<div style="font-size: 12px; color: ' + (ok ? '#e2e8f0' : '#fca5a5') + ';">' + icon + ' ' + escapeHtml(c.claim) + '</div>' +
            (c.sourceUrl
              ? ('<div style="font-size: 11px; color: #38bdf8; margin-top: 3px;"><strong>Evidence Source:</strong> ' + escapeHtml(c.sourceUrl) + '</div>')
              : ('<div style="font-size: 11px; color: #f87171; margin-top: 3px;"><strong>Audit Warning:</strong> Factual claim lacks verified research source URL</div>')) +
          '</div>';
        }).join('');
        claimsSection.style.display = 'block';
      } else {
        claimsSection.style.display = 'none';
      }
    }

    // Rules Badges
    const rulesContainer = document.getElementById('trrRulesContainer');
    if (rulesContainer) {
      if (report.structureRules) {
        const r = report.structureRules;
        rulesContainer.innerHTML =
          '<span class="badge" style="background: rgba(59,130,246,0.15); color: #93c5fd; padding: 3px 8px;">Target Words: ' + r.minWords + '–' + r.maxWords + ' (Goal: ' + r.targetWords + ')</span>' +
          '<span class="badge" style="background: rgba(168,85,247,0.15); color: #c084fc; padding: 3px 8px;">Max Sentences/Para: ' + r.maxSentencesPerParagraph + '</span>' +
          '<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; padding: 3px 8px;">QA Pass Threshold: ' + r.passThreshold + '/100</span>';
      } else {
        rulesContainer.innerHTML = '';
      }
    }

    // Revision Attempts Log
    const attemptsSection = document.getElementById('trrAttemptsSection');
    const attemptsContainer = document.getElementById('trrAttemptsContainer');
    if (attemptsSection && attemptsContainer) {
      if (report.attempts && report.attempts.length > 0) {
        attemptsContainer.innerHTML = report.attempts.map(function (att) {
          const isPassed = att.status === 'passed';
          const icon = isPassed ? '✅' : '⚠️';
          const badgeColor = isPassed ? '#34d399' : '#f59e0b';
          const violationsHtml = att.violations && att.violations.length > 0
            ? '<div style="font-size: 11px; color: #fca5a5; margin-top: 4px;"><strong>Violations:</strong> ' + escapeHtml(att.violations.join('; ')) + '</div>'
            : '';
          return '<div style="background: #0b0f19; border: 1px solid ' + (isPassed ? '#1e293b' : 'rgba(245,158,11,0.3)') + '; border-radius: 6px; padding: 10px;">' +
            '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin-bottom: 2px;">' +
              '<span>' + icon + ' <strong>Attempt ' + att.attempt + '</strong> (' + escapeHtml(att.provider) + ' / ' + escapeHtml(att.model) + ')</span>' +
              '<span style="font-weight: 700; color: ' + badgeColor + ';">Score ' + att.qaScore + ' • ' + (att.durationMs || 0) + 'ms</span>' +
            '</div>' +
            violationsHtml +
          '</div>';
        }).join('');
        attemptsSection.style.display = 'block';
      } else {
        attemptsSection.style.display = 'none';
      }
    }

    // Effective Prompt (Masked Secrets)
    const promptSection = document.getElementById('trrPromptSection');
    const promptText = document.getElementById('trrEffectivePromptText');
    if (promptSection && promptText) {
      if (report.effectivePrompt) {
        promptText.innerText = report.effectivePrompt;
        promptSection.style.display = 'block';
      } else {
        promptSection.style.display = 'none';
      }
    }

    const topicEl = document.getElementById('trrTopicTitle');
    if (topicEl) {
      topicEl.innerText = (report.topic && report.topic.title) || page.name + ' Highlight';
    }

    const captionEl = document.getElementById('trrCaptionText');
    if (captionEl) {
      captionEl.innerText = report.caption || '(No caption generated)';
    }

    const wordBadge = document.getElementById('trrWordBadge');
    if (wordBadge) {
      wordBadge.innerText = (report.wordCount || 0) + ' words';
    }

    const imagePromptEl = document.getElementById('trrImagePrompt');
    if (imagePromptEl) {
      imagePromptEl.innerText = report.imagePrompt || '(Standard atmospheric visual framing)';
    }

    const headlineEl = document.getElementById('trrHeadlineText');
    if (headlineEl) {
      headlineEl.innerText = (report.headlinePanel && report.headlinePanel.headlineText) || 'Headline Overlay';
    }

    const aspectDimEl = document.getElementById('trrAspectDim');
    if (aspectDimEl) {
      aspectDimEl.innerText = report.imageDimensions || '1080x1350 (4:5 Portrait)';
    }

    // Visual Previews (Thumbnail & 1080x1350 Composite)
    const previewRow = document.getElementById('trrPreviewImagesRow');
    const thumbImg = document.getElementById('trrThumbnailImg');
    const compImg = document.getElementById('trrCompositeImg');
    if (previewRow && (report.compositeImageUrl || report.thumbnailUrl)) {
      if (thumbImg && report.thumbnailUrl) {
        thumbImg.src = report.thumbnailUrl;
      }
      if (compImg && report.compositeImageUrl) {
        compImg.src = report.compositeImageUrl;
      }
      previewRow.style.display = 'flex';
    } else if (previewRow) {
      previewRow.style.display = 'none';
    }

    modal.style.display = 'flex';
  }

  function closeTestRunReportModal() {
    const modal = document.getElementById('testRunReportModal');
    if (modal) modal.style.display = 'none';
  }

  async function toggleAutoPostingFromSwitch() {
    if (!currentSettingsPageId) return;
    var page = pagesData.find(function (p) { return p.id === currentSettingsPageId; });
    if (!page) return;

    var isCurrentlyLive = Boolean(page.active || page.is_live);
    if (isCurrentlyLive) {
      promptStopAutoPosting(currentSettingsPageId, page.name);
    } else {
      var sched = getSchedulePayloadFromModal();
      var profileId = document.getElementById('psmProfileSelect') ? document.getElementById('psmProfileSelect').value : page.profile_id;
      var customText = document.getElementById('psmCustomNicheText') ? document.getElementById('psmCustomNicheText').value.trim() : (page.custom_niche_text || '');
      var hasProfile = Boolean((profileId && profileId !== '__custom__') || (profileId === '__custom__' && customText.length > 0));
      var hasSchedule = Boolean(sched.postsPerDay && sched.postsPerDay > 0 && sched.postingTimes && sched.postingTimes.length > 0);
      var hasMode = Boolean(document.getElementById('psmPublishingMode') ? document.getElementById('psmPublishingMode').value : page.publishing_mode);
      var hasTestRun = Boolean(page.last_test_run_at);

      var missing = [];
      if (!hasProfile) missing.push('Step 1: Choose a Content Profile or specify a Custom Niche');
      if (!hasSchedule) missing.push('Step 2: Set daily cadence and posting times');
      if (!hasMode) missing.push('Step 3: Select a publishing mode');
      if (!hasTestRun) missing.push('Step 4: Run at least one Test Run to verify prompts');

      if (missing.length > 0) {
        showToast('⚠️ Checklist incomplete: ' + missing.join(' • '), 'warning');
        return;
      }

      var bigBtn = document.getElementById('psmBigSwitchBtn');
      if (bigBtn) bigBtn.disabled = true;

      try {
        var res = await fetch('/api/pages/toggle-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: currentSettingsPageId, active: true }),
        });
        var data = await res.json();
        if (!res.ok || data.error) {
          showToast('Failed to activate: ' + (data.error || 'Unknown error'), 'error');
          return;
        }

        page.active = true;
        page.is_live = true;
        updateBigSwitchUI(true);
        updateModalChecklistDisplay(page);
        showToast('🚀 Autonomous posting is now LIVE for ' + page.name + '!', 'success');
      } catch (err) {
        showToast('Network error activating page: ' + err.message, 'error');
      } finally {
        if (bigBtn) bigBtn.disabled = false;
      }
    }
  }

  function promptStopAutoPosting(pageId, pageName) {
    currentStopPageId = pageId;
    var modal = document.getElementById('stopAutoPostingModal');
    var nameEl = document.getElementById('stopModalPageName');
    if (nameEl) nameEl.innerText = pageName || 'Page';
    if (modal) modal.classList.add('active');
  }

  function closeStopAutoPostingModal() {
    var modal = document.getElementById('stopAutoPostingModal');
    if (modal) modal.classList.remove('active');
  }

  async function confirmStopAutoPosting() {
    var pageId = currentStopPageId || currentSettingsPageId;
    if (!pageId) return;

    var selectedAction = 'pause';
    var radios = document.querySelectorAll('input[name="stopActionChoice"]');
    radios.forEach(function (r) {
      if (r.checked) selectedAction = r.value;
    });

    try {
      var res = await fetch('/api/pages/toggle-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId, active: false, action: selectedAction }),
      });
      var data = await res.json();
      if (!res.ok || data.error) {
        alert('Failed to pause: ' + (data.error || 'Unknown error'));
        return;
      }

      closeStopAutoPostingModal();

      var page = pagesData.find(function (p) { return p.id === pageId; });
      if (page) {
        page.active = false;
        page.is_live = false;
        page.auto_posting_stopped_action = selectedAction;
      }

      if (currentSettingsPageId === pageId) {
        updateBigSwitchUI(false);
        if (page) updateModalChecklistDisplay(page);
      }

      showToast('⏸️ Autonomous posting paused (' + (selectedAction === 'cancel_pending' ? 'scheduled posts cancelled' : 'in-flight preserved') + ')', 'warning');
      fetchPagesTab();
    } catch (err) {
      alert('Network error pausing auto-posting: ' + err.message);
    }
  }

  function startAutoPostingFromRow(pageId) {
    currentSettingsPageId = pageId;
    toggleAutoPostingFromSwitch();
  }

  async function runTestRunFromModal() {
    if (!currentSettingsPageId) return;
    triggerPageTestRun(currentSettingsPageId);
  }

  async function triggerPageTestRun(pageId) {
    if (!pageId) return;
    try {
      var res = await fetch('/api/test-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId }),
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('⚡ Test Run Succeeded! Step 4 marked verified.', 'success');
        var p = pagesData.find(function (x) { return x.id === pageId; });
        if (p) {
          p.last_test_run_at = new Date().toISOString();
          p.test_run_completed = true;
          if (currentSettingsPageId === pageId) updateModalChecklistDisplay(p);
        }
        fetchPagesTab();
      } else {
        showToast('Test run error: ' + (data.error || 'Failed to run test'), 'error');
      }
    } catch (err) {
      showToast('Error executing test run: ' + err.message, 'error');
    }
  }

  async function analyzePageNicheAction(pageId) {
    if (!pageId) return;
    var page = pagesData.find(function (p) { return p.id === pageId; });
    var pageName = page ? page.name : 'this Page';

    var ok = confirm('✨ Run Automatic Niche Detection for "' + pageName + '"?\n\nThis will scan public Page metadata and recent posts via Meta Graph API, and evaluate the ideal content profile with strict privacy (zero tokens transmitted).');
    if (!ok) return;

    try {
      var res = await fetch('/api/pages/analyze-niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId }),
      });
      var data = await res.json();

      if (!res.ok && data.noProviders) {
        alert('⚠️ No active AI providers configured.\n\nPlease add an API key under the "Providers & Quotas" tab first to enable AI Niche Detection.');
        showTab('providers');
        return;
      }

      if (!res.ok || data.error) {
        alert('Niche Detection Notice: ' + (data.error || 'Failed'));
        return;
      }

      if (data.analysis) {
        var ana = data.analysis;
        var msg = '✨ Niche Evaluation Complete for "' + pageName + '":\n\n' +
          '• Suggested Profile: ' + (ana.suggested_profile_name || 'N/A') + '\n' +
          '• Match Confidence: ' + Math.round((ana.confidence || 0) * 100) + '%\n' +
          '• Reasoning: ' + (ana.reasoning || '') + '\n' +
          '• Tone: ' + (ana.detected_tone || 'Standard') + '\n' +
          '• Suggested Cadence: ' + (ana.suggested_posts_per_day || 2) + ' posts/day\n\n' +
          'Click OK to open Page Settings and review or apply this recommendation.';
        alert(msg);
        openPageSettingsModal(pageId);
      }
    } catch (err) {
      alert('Network error while analyzing niche: ' + err.message);
    }
  }

  function analyzePageNicheActionFromModal() {
    if (currentSettingsPageId) {
      analyzePageNicheAction(currentSettingsPageId);
    }
  }

  function dismissModalNicheSuggestion() {
    var box = document.getElementById('psmNicheSuggestionBox');
    if (box) box.style.display = 'none';
  }

  async function acceptModalNicheSuggestion() {
    if (!currentSettingsPageId) return;
    var page = pagesData.find(function (p) { return p.id === currentSettingsPageId; });
    if (!page || !page.niche_analysis || !page.niche_analysis.suggested_profile_id) return;

    var profSelect = document.getElementById('psmProfileSelect');
    if (profSelect) {
      profSelect.value = page.niche_analysis.suggested_profile_id;
    }
    if (page.niche_analysis.suggested_posts_per_day) {
      applyQuickSchedule(page.niche_analysis.suggested_posts_per_day);
    }
    dismissModalNicheSuggestion();
    markFormModified();
    showToast('Suggested profile "' + page.niche_analysis.suggested_profile_name + '" applied! Click Save Settings to persist.', 'success');
  }

  async function applyNicheProfile(pageId, profileId) {
    if (!pageId || !profileId) return;
    try {
      var res = await fetch('/api/pages/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId, profile_id: profileId }),
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('✅ Niche profile applied!', 'success');
        var page = pagesData.find(function (p) { return p.id === pageId; });
        if (page) page.profile_id = profileId;
        fetchPagesTab();
      } else {
        showToast('Notice: ' + (data.error || 'Failed to apply niche profile'), 'error');
      }
    } catch (err) {
      showToast('Error applying niche: ' + err.message, 'error');
    }
  }

  async function createProfileFromModalNiche() {
    if (!currentSettingsPageId) return;
    try {
      var res = await fetch('/api/pages/create-profile-from-niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: currentSettingsPageId }),
      });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('🎉 New Content Profile created!', 'success');
        if (data.profile) {
          var profSelect = document.getElementById('psmProfileSelect');
          if (profSelect) {
            var opt = document.createElement('option');
            opt.value = data.profile.id;
            opt.innerText = data.profile.name + ' (' + (data.profile.niche || data.profile.type || 'profile') + ')';
            profSelect.insertBefore(opt, profSelect.lastElementChild);
            profSelect.value = data.profile.id;
          }
        }
        fetchPagesTab();
      } else {
        showToast('Failed: ' + (data.error || 'Could not generate profile'), 'error');
      }
    } catch (err) {
      showToast('Error creating profile: ' + err.message, 'error');
    }
  }

  async function importStarterProfilesFromModal() {
    try {
      var res = await fetch('/api/profiles/import-starter', { method: 'POST' });
      var data = await res.json();
      if (res.ok && data.success) {
        var imp = data.importedCount !== undefined ? data.importedCount : (data.count || 0);
        var skip = data.skippedCount !== undefined ? data.skippedCount : 0;
        var upd = data.updatedCount !== undefined ? data.updatedCount : 0;
        showToast('📦 Starter profiles: ' + imp + ' imported, ' + skip + ' skipped, ' + upd + ' updated.', 'success');
        var profSelect = document.getElementById('psmProfileSelect');
        var studioSelect = document.getElementById('editProfileSelect');
        if (data.profiles) {
          [profSelect, studioSelect].forEach(function (sel) {
            if (!sel) return;
            var currentVal = sel.value;
            sel.innerHTML = '';
            data.profiles.forEach(function (prof) {
              var opt = document.createElement('option');
              opt.value = prof.id;
              opt.innerText = prof.name + ' (' + (prof.niche || prof.type || 'profile') + ')';
              sel.appendChild(opt);
            });
            var customOpt = document.createElement('option');
            customOpt.value = '__custom__';
            customOpt.innerText = '✍️ Custom / Type Your Own Niche...';
            sel.appendChild(customOpt);
            if (currentVal) sel.value = currentVal;
          });
        }
      } else {
        showToast('Notice: ' + (data.error || 'Failed to import starter profiles'), 'error');
      }
    } catch (err) {
      showToast('Network error importing starter profiles: ' + err.message, 'error');
    }
  }

  async function importStarterProfilesFromSettings(btn) {
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Importing...';
    }

    try {
      var res = await fetch('/api/profiles/import-starter', { method: 'POST' });
      var data = await res.json();
      if (res.ok && data.success) {
        var imp = data.importedCount !== undefined ? data.importedCount : (data.count || 0);
        var skip = data.skippedCount !== undefined ? data.skippedCount : 0;
        var upd = data.updatedCount !== undefined ? data.updatedCount : 0;
        showToast('📦 Starter profiles: ' + imp + ' imported, ' + skip + ' skipped, ' + upd + ' updated.', 'success');
        fetchPagesTab();
      } else {
        showToast('Notice: ' + (data.error || 'Failed to import starter profiles'), 'error');
      }
    } catch (err) {
      showToast('Network error importing starter profiles: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  async function runSystemReadinessAuditAction(btn) {
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Auditing System...';
    }
    var container = document.getElementById('readinessAuditContainer');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = '<div style="padding: 14px; color: var(--text-muted); font-size: 13px;">Checking all 11 production readiness vectors against Supabase and Meta...</div>';

    try {
      var res = await fetch('/api/settings/readiness');
      var data = await res.json();
      if (!res.ok || !data.success) {
        container.innerHTML = '<div style="color: #f87171; padding: 12px; background: rgba(239,68,68,0.1); border-radius: 6px;">Audit failed: ' + escapeHtml(data.error || 'Unknown error') + '</div>';
        return;
      }

      var overallColor = data.overallReady ? '#34d399' : '#f59e0b';
      var overallTitle = data.overallReady ? '🟢 100% PRODUCTION READY' : '⚠️ ATTENTION NEEDED BEFORE GO-LIVE';

      var html = '<div style="background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); border-radius: 8px; padding: 16px;">' +
        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 10px;">' +
        '<strong style="color: ' + overallColor + '; font-size: 14px;">' + overallTitle + '</strong>' +
        '<span style="font-size: 12px; color: var(--text-muted);">' + data.passedCount + ' / ' + data.totalCount + ' Checks Passed</span>' +
        '</div>' +
        '<div style="display: flex; flex-direction: column; gap: 8px;">';

      data.checks.forEach(function (c) {
        var statusPill = c.passed
          ? '<span class="badge" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 10px; font-weight: 700;">PASS</span>'
          : (c.critical ? '<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171; font-size: 10px; font-weight: 700;">FAIL</span>' : '<span class="badge" style="background: rgba(245,158,11,0.2); color: #fbbf24; font-size: 10px; font-weight: 700;">WARN</span>');
        html += '<div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 10px; background: rgba(255,255,255,0.02); border-radius: 6px; font-size: 12px;">' +
          '<div>' +
          '<div style="font-weight: 600; color: #f3f4f6;">' + escapeHtml(c.title) + '</div>' +
          '<div style="color: var(--text-muted); font-size: 11px; margin-top: 2px;">' + escapeHtml(c.message) + '</div>' +
          '</div>' +
          '<div>' + statusPill + '</div>' +
          '</div>';
      });

      html += '</div></div>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div style="color: #f87171; padding: 12px;">Audit request error: ' + escapeHtml(err.message) + '</div>';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  async function runDatabaseSchemaCheckAction(btn) {
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Verifying Schema...';
    }
    var container = document.getElementById('schemaCheckContainer');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = '<div style="padding: 14px; color: var(--text-muted); font-size: 13px;">Checking all 19 database tables and columns in Supabase...</div>';

    try {
      var res = await fetch('/api/settings/schema-check');
      var data = await res.json();
      if (!res.ok) throw new Error('Status ' + res.status);

      var color = data.isComplete ? '#34d399' : '#f87171';
      var title = data.isComplete ? '✅ Database Schema 100% Complete & Synchronized' : '⚠️ Missing Schema Tables or Columns';

      var html = '<div style="background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); border-radius: 8px; padding: 16px;">' +
        '<div style="margin-bottom: 12px; font-weight: 700; color: ' + color + '; font-size: 14px;">' + title + '</div>' +
        '<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">' +
        'Verified: ' + data.tablesFound.length + ' / ' + data.expectedTables.length + ' tables present in public schema.' +
        '</div>';

      if (data.missingTables && data.missingTables.length > 0) {
        html += '<div style="padding: 10px; background: rgba(239,68,68,0.15); border: 1px solid #ef4444; border-radius: 6px; margin-bottom: 10px; font-size: 12px; color: #fecaca;">' +
          '<strong>Missing Tables:</strong> ' + escapeHtml(data.missingTables.join(', ')) +
          '<div style="margin-top: 6px; font-size: 11px;">Run <code>supabase/all_migrations.sql</code> or <code>supabase/delta_20261109.sql</code> in Supabase SQL Editor.</div>' +
          '</div>';
      }

      if (data.missingColumns && data.missingColumns.length > 0) {
        html += '<div style="padding: 10px; background: rgba(245,158,11,0.15); border: 1px solid #f59e0b; border-radius: 6px; margin-bottom: 10px; font-size: 12px; color: #fde68a;">' +
          '<strong>Missing Columns:</strong> ' + escapeHtml(data.missingColumns.map(function(m) { return m.table + '.' + m.column; }).join(', ')) +
          '<div style="margin-top: 6px; font-size: 11px;">Run <code>supabase/delta_20261109.sql</code> in Supabase SQL Editor to add these columns.</div>' +
          '</div>';
      }

      if (data.isComplete) {
        html += '<div style="font-size: 12px; color: #a7f3d0;">All core tables, RLS policies, indexes, and versioning columns are present and ready for autonomous operations.</div>';
      }

      html += '</div>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div style="color: #f87171; padding: 12px;">Schema check error: ' + escapeHtml(err.message) + '</div>';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  function downloadSettingsBackupAction() {
    var a = document.createElement('a');
    a.href = '/api/settings/backup';
    a.download = 'fb-auto-settings-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📥 Downloading settings backup (zero secrets)...', 'info');
  }

  async function handleRestoreBackupFile(fileInput) {
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
    var file = fileInput.files[0];
    var reader = new FileReader();

    reader.onload = async function (e) {
      try {
        var json = JSON.parse(e.target.result);
        var res = await fetch('/api/settings/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
        var data = await res.json();
        if (res.ok && data.success) {
          showToast('✅ Settings restored: ' + data.restored.pages + ' pages, ' + data.restored.profiles + ' profiles!', 'success');
          fetchPagesTab();
          fetchAccountsTab();
          fetchProvidersTab();
        } else {
          alert('Restore notice: ' + (data.error || 'Failed to restore backup'));
        }
      } catch (err) {
        alert('Invalid backup JSON file: ' + err.message);
      } finally {
        fileInput.value = '';
      }
    };

    reader.readAsText(file);
  }

  function openPagePromptStudioFromModal() {
    var pageId = currentSettingsPageId;
    closePageSettingsModal();
    if (pageId) {
      openPagePromptStudio(pageId);
    }
  }

  window.showToast = showToast;
  window.openPageSettingsModal = openPageSettingsModal;
  window.closePageSettingsModal = closePageSettingsModal;
  window.setScheduleTimingMode = setScheduleTimingMode;
  window.handlePublishingModeChange = handlePublishingModeChange;
  window.toggleLiveFromModal = toggleLiveFromModal;
  window.toggleAutoPostingFromSwitch = toggleAutoPostingFromSwitch;
  window.promptStopAutoPosting = promptStopAutoPosting;
  window.startAutoPostingFromRow = startAutoPostingFromRow;
  window.closeStopAutoPostingModal = closeStopAutoPostingModal;
  window.confirmStopAutoPosting = confirmStopAutoPosting;
  window.addFixedTimePicker = addFixedTimePicker;
  window.removeFixedTimePicker = removeFixedTimePicker;
  window.applyQuickSchedule = applyQuickSchedule;
  window.selectPublishingMode = selectPublishingMode;
  window.handleModalProfileChange = handleModalProfileChange;
  window.handleCustomNicheTextInput = handleCustomNicheTextInput;
  window.applyUsPrimeTimeSuggestions = applyUsPrimeTimeSuggestions;
  window.handleScheduleInputChange = handleScheduleInputChange;
  window.handleSavePageSettings = handleSavePageSettings;
  window.revertModalChanges = revertModalChanges;
  window.markFormModified = markFormModified;
  window.runTestRunFromModal = runTestRunFromModal;
  window.analyzePageNicheActionFromModal = analyzePageNicheActionFromModal;
  window.dismissModalNicheSuggestion = dismissModalNicheSuggestion;
  window.acceptModalNicheSuggestion = acceptModalNicheSuggestion;
  window.createProfileFromModalNiche = createProfileFromModalNiche;
  window.importStarterProfilesFromModal = importStarterProfilesFromModal;
  window.importStarterProfilesFromSettings = importStarterProfilesFromSettings;
  window.runSystemReadinessAuditAction = runSystemReadinessAuditAction;
  window.runDatabaseSchemaCheckAction = runDatabaseSchemaCheckAction;
  window.downloadSettingsBackupAction = downloadSettingsBackupAction;
  window.handleRestoreBackupFile = handleRestoreBackupFile;
  window.openPagePromptStudioFromModal = openPagePromptStudioFromModal;
  window.handleStudioProfileChange = handleStudioProfileChange;
  window.validateStudioWordLimits = validateStudioWordLimits;
  window.validateStudioFirstComment = validateStudioFirstComment;
  window.toggleFirstCommentValidation = toggleFirstCommentValidation;
  window.syncHeadlineColorPicker = syncHeadlineColorPicker;
  window.syncHeadlineColorText = syncHeadlineColorText;
  window.openConcurrencyConflictModal = openConcurrencyConflictModal;
  window.closeConcurrencyConflictModal = closeConcurrencyConflictModal;
  window.resolveConflictKeepMine = resolveConflictKeepMine;
  window.resolveConflictUseLatest = resolveConflictUseLatest;
  window.resolveConflictMerge = resolveConflictMerge;
  window.viewTestRunReport = viewTestRunReport;
  window.closeTestRunReportModal = closeTestRunReportModal;
  window.confirmModeChange = confirmModeChange;
  window.cancelModeConfirmation = cancelModeConfirmation;
  window.reloadProfilesAndResetToCustom = reloadProfilesAndResetToCustom;

  function copyExpectedRedirectUri() {
    const el = document.getElementById('expectedRedirectUriText');
    if (!el) return;
    const text = el.innerText || el.textContent;
    navigator.clipboard.writeText(text.trim()).then(function () {
      alert('Copied OAuth Redirect URI to clipboard:\n' + text.trim());
    }).catch(function () {
      prompt('Copy OAuth Redirect URI:', text.trim());
    });
  }

  async function testFacebookConnectionAction(btn) {
    const origText = btn ? btn.innerHTML : '';
    const statusSpan = document.getElementById('testFbConnStatus');
    const resultsBox = document.getElementById('testFbConnResults');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Testing with Meta Graph API...';
    }
    if (statusSpan) statusSpan.innerText = 'Connecting to Meta...';
    if (resultsBox) resultsBox.style.display = 'none';

    try {
      const res = await fetch('/api/facebook/test-connection', { method: 'POST' });
      const data = await res.json();

      if (resultsBox) {
        resultsBox.style.display = 'block';
        if (data.success) {
          resultsBox.innerHTML =
            '<div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); padding: 14px 18px; border-radius: 8px; color: #a7f3d0;">' +
            '<div style="font-weight: 700; font-size: 14px; margin-bottom: 6px;">✅ Meta Graph API Connection Verified!</div>' +
            '<div style="font-size: 13px;">Meta App Name: <strong>' + escapeHtml(data.metaAppName || 'N/A') + '</strong> (ID: ' + escapeHtml(data.metaAppId || 'N/A') + ')</div>' +
            (data.configIdValid ? '<div style="font-size: 13px; margin-top: 4px;">✅ Business Login Configuration ID verified with Meta.</div>' : '') +
            '</div>';
        } else {
          let issuesHtml = '';
          if (data.issues && data.issues.length > 0) {
            issuesHtml = '<ul style="margin: 8px 0 8px 20px; font-size: 13px;">' +
              data.issues.map(function (iss) { return '<li>' + escapeHtml(iss) + '</li>'; }).join('') +
              '</ul>';
          }
          let recsHtml = '';
          if (data.recommendations && data.recommendations.length > 0) {
            recsHtml = '<div style="margin-top: 8px; font-size: 12px; color: #fde68a;"><strong>Recommendations:</strong><ul style="margin: 4px 0 0 20px;">' +
              data.recommendations.map(function (rec) { return '<li>' + escapeHtml(rec) + '</li>'; }).join('') +
              '</ul></div>';
          }

          resultsBox.innerHTML =
            '<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); padding: 14px 18px; border-radius: 8px; color: #fecaca;">' +
            '<div style="font-weight: 700; font-size: 14px;">⚠️ Meta Graph API Connection Diagnostic Report</div>' +
            issuesHtml +
            recsHtml +
            '</div>';
        }
      }
      if (statusSpan) statusSpan.innerText = data.success ? 'Verified' : 'Issues detected';
    } catch (e) {
      if (resultsBox) {
        resultsBox.style.display = 'block';
        resultsBox.innerHTML = '<div style="background: rgba(239,68,68,0.15); border: 1px solid #ef4444; padding: 12px; border-radius: 6px; color: #fecaca;">Network test error: ' + escapeHtml(e.message) + '</div>';
      }
      if (statusSpan) statusSpan.innerText = 'Error';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  // --- Master Initialization Routine ---
  function initDashboard() {
    safeParseInitialData();
    checkMissingTablesBanner();

    // Bind event listeners to all navigation buttons (resilient architecture)
    document.querySelectorAll('.nav-list .nav-item button').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        const tabId = btn.getAttribute('data-tab');
        if (tabId) {
          e.preventDefault();
          showTab(tabId, btn);
        }
      });
    });

    // Check URL parameters (e.g. ?connected=true, ?error=..., ?tab=...)
    try {
      const params = new URLSearchParams(window.location.search);
      const banner = document.getElementById('urlAlertBanner');
      if (banner) {
        if (params.get('connected') === 'true') {
          const count = params.get('count') || '0';
          const account = params.get('account') || '';
          const found = params.get('found') || count;
          const newCount = params.get('new') || '0';
          const updatedCount = params.get('updated') || '0';
          const publishable = params.get('publishable');

          banner.style.display = 'block';
          banner.style.background = '#064e3b';
          banner.style.border = '1px solid #059669';
          banner.style.color = '#a7f3d0';

          let msg = '🎉 <strong>Facebook Connected Successfully!</strong> ';
          if (account) {
            msg += 'Connected account <strong>' + escapeHtml(account) + '</strong>: found ' + escapeHtml(found) + ' Pages (' + escapeHtml(newCount) + ' new, ' + escapeHtml(updatedCount) + ' updated).';
          } else {
            msg += 'Synced ' + escapeHtml(found) + ' Facebook Page(s) with encrypted tokens stored safely in the Supabase vault.';
          }
          if (publishable !== null && Number(publishable) < Number(found)) {
            msg += ' <span style="color: #fde68a;">(Notice: ' + (Number(found) - Number(publishable)) + ' page(s) lack content creation tasks and cannot auto-publish).</span>';
          }
          banner.innerHTML = msg;
        } else if (params.get('error')) {
          banner.style.display = 'block';
          banner.style.background = '#7f1d1d';
          banner.style.border = '1px solid #dc2626';
          banner.style.color = '#fecaca';
          banner.innerHTML = '⚠️ <strong>Facebook Connection Notice:</strong> ' + escapeHtml(params.get('error'));
        } else if (params.get('warning')) {
          banner.style.display = 'block';
          banner.style.background = '#78350f';
          banner.style.border = '1px solid #d97706';
          banner.style.color = '#fde68a';
          banner.innerHTML = '⚠️ <strong>Notice:</strong> ' + escapeHtml(params.get('warning'));
        }
      }

      if (params.get('connected') === 'true' || params.get('error') || params.get('warning')) {
        try {
          const cleanParams = new URLSearchParams(window.location.search);
          cleanParams.delete('connected');
          cleanParams.delete('count');
          cleanParams.delete('account');
          cleanParams.delete('found');
          cleanParams.delete('new');
          cleanParams.delete('updated');
          cleanParams.delete('publishable');
          cleanParams.delete('error');
          cleanParams.delete('warning');
          const cleanSearch = cleanParams.toString() ? ('?' + cleanParams.toString()) : '';
          history.replaceState(null, '', window.location.pathname + cleanSearch);
        } catch (_) {}
      }

      const path = window.location.pathname;
      const initialTab = (window.__INITIAL_ROUTE__ && window.__INITIAL_ROUTE__.tabId) || ROUTE_TO_TAB[path] || params.get('tab') || sessionStorage.getItem('last_active_tab') || 'overview';
      const targetBtn = document.querySelector('.nav-list .nav-item button[data-tab="' + initialTab + '"]');
      showTab(initialTab, targetBtn, false);
      restoreSubStateFromUrl();
    } catch (e) {
      console.warn('[Dashboard] Error parsing URL parameters:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
})();

