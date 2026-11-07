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

  // --- Tab Navigation & Titles ---
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

  function showTab(tabId, btn) {
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
    }

    if (tabId === 'page-prompts') {
      loadPageIntoStudio();
    }

    // Lazy load tab data if not already loaded
    ensureTabDataLoaded(tabId);
  }

  // Expose showTab immediately on window
  window.showTab = showTab;

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
    } catch (err) {
      showTabError('providers', err.message, fetchProvidersTab);
    }
  }

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
      alert('Facebook Account connected and token encrypted in vault!');
      window.location.reload();
    } else {
      const err = await res.json();
      alert('Failed to connect Facebook account: ' + (err.error || 'Unknown error'));
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
      body: JSON.stringify({ id: id }),
    });
    if (res.ok) {
      alert('Facebook Account disconnected.');
      window.location.reload();
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
      body: JSON.stringify({ id: id }),
    });
    if (res.ok) {
      alert('Page deleted.');
      window.location.reload();
    }
  }

  function openPagePromptStudio(pageId) {
    showTab('page-prompts');
    const sel = document.getElementById('studioPageSelect');
    if (sel) sel.value = pageId;
    loadPageIntoStudio();
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
    if (!found && page.profile_id) {
      selectElem.value = '__custom__';
      toggleCustomNicheField('__custom__', 'studioCustomNicheBox');
      const customNameInput = document.getElementById('editCustomNicheName');
      if (customNameInput) customNameInput.value = page.profile_id;
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
    const inspectBox = document.getElementById('effectiveInspectBox');
    if (inspectBox) inspectBox.style.display = 'none';
  }

  async function savePagePromptsAction() {
    const pageId = document.getElementById('studioPageSelect').value;
    const page = pagesData.find(function (p) { return p.id === pageId; });
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

    const overrides = Object.assign({}, page.overrides || {}, {
      'caption.min': parseInt(document.getElementById('editMinWords').value, 10),
      'caption.target': parseInt(document.getElementById('editTargetWords').value, 10),
      'caption.max': parseInt(document.getElementById('editMaxWords').value, 10),
      'image.aspectRatio': document.getElementById('editAspectRatio').value,
      'image.headlinePanel.enabled': document.getElementById('editPanelEnabled').checked,
      'image.headlinePanel.heightPercent': parseInt(document.getElementById('editPanelHeight').value, 10),
      'image.headlinePanel.backgroundColor': document.getElementById('editPanelColor').value,
    });

    const res = await fetch('/api/pages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: pageId,
        profile_id: profile_id,
        custom_niche_name: custom_niche_name,
        custom_caption_prompt: custom_caption_prompt,
        custom_caption_prompt_mode: custom_caption_prompt_mode,
        custom_image_prompt: custom_image_prompt,
        custom_image_prompt_mode: custom_image_prompt_mode,
        first_comment_enabled: first_comment_enabled,
        first_comment_prompt: first_comment_prompt,
        overrides: overrides,
      }),
    });

    if (res.ok) {
      alert('Custom prompts and settings for this Page successfully saved!');
      const updated = await res.json();
      const idx = pagesData.findIndex(function (p) { return p.id === pageId; });
      if (idx !== -1) pagesData[idx] = updated.page;
    } else {
      alert('Error saving page prompts.');
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
      alert('Please add a Facebook Page first in the Pages & Accounts tab before running simulations.');
      return;
    }
    const res = await fetch('/api/test-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: pageId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      alert('Notice: ' + (data.error || 'Failed to run simulation.'));
      return;
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
        '<strong>Token Accounting:</strong> ' + (data.tokensUsed || 0) + ' tokens used (' + escapeHtml(data.estimatedCost || '$0.00') + ')';
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
      body: JSON.stringify({ postId: postId, action: 'reject', reason: reason }),
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
        body: JSON.stringify({ postId: postId, action: 'edit', updates: { caption: newCaption } }),
      }).then(function () {
        alert('Caption updated! Word count and content hash recalculated.');
        window.location.reload();
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
      body: JSON.stringify({ id: id }),
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
    const p = providersData.find(function (item) { return item.id === providerId; });
    if (!p) return;
    document.getElementById('keyPoolProviderId').value = providerId;
    document.getElementById('manageKeysTitle').innerText = '🔑 Keys for ' + p.name;
    document.getElementById('manageKeysSubtitle').innerText = 'Adapter: ' + p.adapter_kind + ' • Model: ' + (p.model_name || 'default');
    renderKeysList(providerId);
    const modal = document.getElementById('manageKeysModal');
    if (modal) modal.classList.add('active');
  }

  function closeManageKeysModal() {
    const modal = document.getElementById('manageKeysModal');
    if (modal) modal.classList.remove('active');
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
        window.location.reload();
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
        window.location.reload();
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
          banner.style.display = 'block';
          banner.style.background = '#064e3b';
          banner.style.border = '1px solid #059669';
          banner.style.color = '#a7f3d0';
          banner.innerHTML = '🎉 <strong>Facebook Connected Successfully!</strong> Synced ' + escapeHtml(count) + ' Facebook Page(s) with encrypted tokens stored safely in the Supabase vault.';
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

      if (params.get('tab')) {
        const tabName = params.get('tab');
        const targetBtn = document.querySelector('.nav-list .nav-item button[data-tab="' + tabName + '"]');
        if (targetBtn) {
          showTab(tabName, targetBtn);
        }
      }
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

