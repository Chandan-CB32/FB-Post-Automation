import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const dashboardJsPath = path.join(root, 'apps', 'web', 'public', 'dashboard.js');
const dashboardScriptTsPath = path.join(root, 'apps', 'web', 'src', 'client', 'dashboard-script.ts');

let code = fs.readFileSync(dashboardJsPath, 'utf8');

// 1. Remove premature window assignments around lines 1402-1424
const prematureStart = '  window.copyExpectedRedirectUri = copyExpectedRedirectUri;\n';
const prematureEnd = '  window.openPagePromptStudioFromModal = openPagePromptStudioFromModal;\n\n';

if (code.includes(prematureStart)) {
  const pStartIdx = code.indexOf(prematureStart);
  const pEndIdx = code.indexOf(prematureEnd) + prematureEnd.length;
  code = code.slice(0, pStartIdx) + '\n' + code.slice(pEndIdx);
  console.log('Removed premature window assignments');
}

// 2. Find boundaries for modal & settings functions
const startMarker = '  // --- Toast Notification System ---';
const endMarker = '  function copyExpectedRedirectUri() {';

const startIdx = code.indexOf(startMarker);
const endIdx = code.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found! startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

const newSection = `  // --- Toast Notification System ---
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
    var bg = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981';
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

  function openPageSettingsModal(pageId) {
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

  function closePageSettingsModal() {
    var modal = document.getElementById('pageSettingsModal');
    if (modal) modal.classList.remove('active');
    currentSettingsPageId = null;
  }

  function populateModalFromPage(page) {
    var isLive = Boolean(page.active || page.is_live);
    updateBigSwitchUI(isLive);

    // Step 1: Profile Select
    var profSelect = document.getElementById('psmProfileSelect');
    if (profSelect) {
      profSelect.value = page.profile_id || '__custom__';
    }
    var cardCheck1 = document.getElementById('psmCardCheck1');
    if (cardCheck1) cardCheck1.innerText = (page.profile_id && page.profile_id !== '__custom__') ? '✅' : '⭕';

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

    // Step 3: Publishing mode
    selectPublishingMode(page.publishing_mode || 'review');
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
    var profileChosen = Boolean(page.profile_id && page.profile_id !== 'default-niche' && page.profile_id !== '__custom__');
    var scheduleSet = Boolean(sched.postsPerDay && sched.postsPerDay > 0);
    var modeChosen = Boolean(page.publishing_mode);
    var testDone = Boolean(page.last_test_run_at);
    var isLive = Boolean(page.active || page.is_live);

    function setStep(id, done, label) {
      var el = document.getElementById(id);
      if (!el) return;
      el.querySelector('.psm-step-icon').innerText = done ? '✅' : '⭕';
      var st = el.querySelector('.psm-step-status');
      st.innerText = label;
      st.style.color = done ? '#34d399' : '#f87171';
    }

    setStep('psmStepProfile', profileChosen, profileChosen ? 'Chosen' : 'Not Chosen');
    setStep('psmStepSchedule', scheduleSet, scheduleSet ? (sched.postsPerDay + ' posts/day') : '0 posts/day');
    setStep('psmStepMode', modeChosen, (page.publishing_mode || 'review').toUpperCase());
    setStep('psmStepTest', testDone, testDone ? 'Verified' : 'Needed');
    setStep('psmStepLive', isLive, isLive ? 'Live' : 'Paused');

    var totalDone = (profileChosen ? 1 : 0) + (scheduleSet ? 1 : 0) + (modeChosen ? 1 : 0) + (testDone ? 1 : 0);
    var progressElem = document.getElementById('psmChecklistProgress');
    if (progressElem) {
      if (isLive) {
        progressElem.innerText = 'All Steps Complete • Page Active';
        progressElem.style.color = '#34d399';
      } else if (totalDone === 4) {
        progressElem.innerText = 'Ready to Go Live! Click "Turn Auto-Posting ON"';
        progressElem.style.color = '#34d399';
      } else {
        progressElem.innerText = (4 - totalDone) + ' Step(s) Incomplete before Live';
        progressElem.style.color = '#f59e0b';
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
    var tzSelect = document.getElementById('psmTimezone');
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

  function selectPublishingMode(mode) {
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

    markFormModified();
  }

  function handleModalProfileChange(val) {
    var cardCheck1 = document.getElementById('psmCardCheck1');
    if (cardCheck1) {
      cardCheck1.innerText = (val && val !== '__custom__') ? '✅' : '⭕';
    }
    var stepProfile = document.getElementById('psmStepProfile');
    if (stepProfile) {
      var isChosen = Boolean(val && val !== '__custom__');
      stepProfile.querySelector('.psm-step-icon').innerText = isChosen ? '✅' : '⭕';
      stepProfile.querySelector('.psm-step-status').innerText = isChosen ? 'Chosen' : 'Not Chosen';
      stepProfile.querySelector('.psm-step-status').style.color = isChosen ? '#34d399' : '#f87171';
    }
    if (val === '__custom__') {
      openPagePromptStudioFromModal();
    }
    markFormModified();
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

      if (!data.preview || data.preview.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 12px; color: var(--text-muted);">No slots scheduled in the next 7 days for current settings.</td></tr>';
        if (badge) badge.innerText = '0 slots';
        return;
      }

      if (badge) badge.innerText = data.preview.length + ' slots planned over next 7 days';

      var html = '';
      data.preview.forEach(function (slot) {
        html += '<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">' +
          '<td style="padding: 6px 8px; font-weight: 600; color: #f3f4f6;">' + escapeHtml(slot.dayOfWeek) + ' (' + escapeHtml(slot.audienceDate) + ')</td>' +
          '<td style="padding: 6px 8px; color: var(--text-muted);">' + slot.slotIndex + '</td>' +
          '<td style="padding: 6px 8px; color: #34d399; font-weight: 700;">' + escapeHtml(slot.audienceTime) + ' <small style="color: var(--text-muted); font-weight: normal;">' + escapeHtml(slot.timezone) + '</small></td>' +
          '<td style="padding: 6px 8px; color: #93c5fd; font-weight: 700;">' + escapeHtml(slot.localTime) + ' <small style="color: var(--text-muted); font-weight: normal;">IST</small></td>' +
          '<td style="padding: 6px 8px; text-transform: uppercase; font-size: 10px; color: #a78bfa;">' + escapeHtml(slot.mode) + '</td>' +
        '</tr>';
      });
      tableBody.innerHTML = html;
    } catch (err) {
      tableBody.innerHTML = '<tr><td colspan="5" style="color: #f87171; padding: 8px;">Error generating preview: ' + escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function handleSavePageSettings(e) {
    if (e) e.preventDefault();
    if (!currentSettingsPageId) return;

    var saveBtn = document.getElementById('psmSaveBtn');
    var origText = saveBtn ? saveBtn.innerText : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerText = '💾 Saving & Verifying...';
    }

    var sched = getSchedulePayloadFromModal();
    var payload = {
      pageId: currentSettingsPageId,
      profile_id: document.getElementById('psmProfileSelect').value,
      publishing_mode: document.getElementById('psmPublishingMode').value,
      hybrid_min_score: Number(document.getElementById('psmHybridScore').value) || 80,
      daily_cap: Number(document.getElementById('psmDailyCap').value) || 3,
      schedule: sched,
      ai_disclosure_enabled: document.getElementById('psmAiDisclosureToggle').checked,
      ai_disclosure_text: document.getElementById('psmAiDisclosureText').value,
      source_attribution_enabled: document.getElementById('psmSourceLineToggle').checked,
      expected_updated_at: currentExpectedUpdatedAt,
      expected_version: currentExpectedVersion,
    };

    try {
      var res = await fetch('/api/pages/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json();

      if (res.status === 409) {
        alert('⚠️ Concurrency Conflict:\\n\\nThese Page settings were updated in another session or window.\\nPlease close this modal, refresh the page, and re-apply your changes.');
        return;
      }

      if (!res.ok || data.error) {
        alert('Failed to save settings: ' + (data.error || 'Unknown error'));
        return;
      }

      // Update in local pagesData
      var idx = pagesData.findIndex(function (p) { return p.id === currentSettingsPageId; });
      if (idx !== -1 && data.page) {
        pagesData[idx] = data.page;
        currentExpectedUpdatedAt = data.page.updated_at;
        currentExpectedVersion = data.page.version;
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
      alert('Network error while saving settings: ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = origText;
      }
    }
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
      var hasProfile = Boolean(profileId && profileId !== '__custom__');
      var hasSchedule = Boolean(sched.postsPerDay && sched.postsPerDay > 0 && sched.postingTimes && sched.postingTimes.length > 0);
      var hasMode = Boolean(document.getElementById('psmPublishingMode') ? document.getElementById('psmPublishingMode').value : page.publishing_mode);

      var missing = [];
      if (!hasProfile) missing.push('Step 1: Choose a Content Profile (not Custom)');
      if (!hasSchedule) missing.push('Step 2: Set daily cadence and posting times');
      if (!hasMode) missing.push('Step 3: Select a publishing mode');

      if (missing.length > 0) {
        var force = confirm('⚠️ Setup Checklist Incomplete:\\n\\n' + missing.map(function (m, i) { return (i + 1) + '. ' + m; }).join('\\n') + '\\n\\nDo you want to FORCE taking this page live anyway?');
        if (!force) return;
      }

      var bigBtn = document.getElementById('psmBigSwitchBtn');
      if (bigBtn) bigBtn.disabled = true;

      try {
        var res = await fetch('/api/pages/toggle-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: currentSettingsPageId, active: true, force: true }),
        });
        var data = await res.json();
        if (!res.ok || data.error) {
          alert('Failed to activate: ' + (data.error || 'Unknown error'));
          return;
        }

        page.active = true;
        page.is_live = true;
        updateBigSwitchUI(true);
        updateModalChecklistDisplay(page);
        showToast('🚀 Autonomous posting is now LIVE for ' + page.name + '!', 'success');
      } catch (err) {
        alert('Network error activating page: ' + err.message);
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
      setTimeout(function() { window.location.reload(); }, 1200);
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
        alert('⚡ Simulation Succeeded!\\n\\nTopic: ' + (data.topic ? data.topic.title : 'Generated') + '\\nQA Score: ' + (data.qaScore || 95) + '/100\\n\\nWord Count: ' + (data.wordCount || 0) + ' words\\nStep 4 (Test Run) marked verified on the Page checklist!');
        window.location.reload();
      } else {
        alert('Simulation notice: ' + (data.error || 'Failed to run test'));
      }
    } catch (err) {
      alert('Error executing test run: ' + err.message);
    }
  }

  async function analyzePageNicheAction(pageId) {
    if (!pageId) return;
    var page = pagesData.find(function (p) { return p.id === pageId; });
    var pageName = page ? page.name : 'this Page';

    var ok = confirm('✨ Run Automatic Niche Detection for "' + pageName + '"?\\n\\nThis will scan public Page metadata and recent posts via Meta Graph API, and evaluate the ideal content profile with strict privacy (zero tokens transmitted).');
    if (!ok) return;

    try {
      var res = await fetch('/api/pages/analyze-niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId }),
      });
      var data = await res.json();

      if (!res.ok && data.noProviders) {
        alert('⚠️ No active AI providers configured.\\n\\nPlease add an API key under the "Providers & Quotas" tab first to enable AI Niche Detection.');
        showTab('providers');
        return;
      }

      if (!res.ok || data.error) {
        alert('Niche Detection Notice: ' + (data.error || 'Failed'));
        return;
      }

      if (data.analysis) {
        var ana = data.analysis;
        var msg = '✨ Niche Evaluation Complete for "' + pageName + '":\\n\\n' +
          '• Suggested Profile: ' + (ana.suggested_profile_name || 'N/A') + '\\n' +
          '• Match Confidence: ' + Math.round((ana.confidence || 0) * 100) + '%\\n' +
          '• Reasoning: ' + (ana.reasoning || '') + '\\n' +
          '• Tone: ' + (ana.detected_tone || 'Standard') + '\\n' +
          '• Suggested Cadence: ' + (ana.suggested_posts_per_day || 2) + ' posts/day\\n\\n' +
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
        setTimeout(function() { window.location.reload(); }, 1000);
      } else {
        alert('Notice: ' + (data.error || 'Failed to apply niche profile'));
      }
    } catch (err) {
      alert('Error applying niche: ' + err.message);
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
        setTimeout(function() { window.location.reload(); }, 1200);
      } else {
        alert('Failed: ' + (data.error || 'Could not generate profile'));
      }
    } catch (err) {
      alert('Error creating profile: ' + err.message);
    }
  }

  async function importStarterProfilesFromModal() {
    try {
      var res = await fetch('/api/profiles/import-starter', { method: 'POST' });
      var data = await res.json();
      if (res.ok && data.success) {
        showToast('📦 Imported ' + data.importedCount + ' starter profiles!', 'success');
        var profSelect = document.getElementById('psmProfileSelect');
        if (profSelect && data.profiles) {
          profSelect.innerHTML = '';
          data.profiles.forEach(function (prof) {
            var opt = document.createElement('option');
            opt.value = prof.id;
            opt.innerText = prof.name + ' (' + prof.niche + ')';
            profSelect.appendChild(opt);
          });
          var customOpt = document.createElement('option');
          customOpt.value = '__custom__';
          customOpt.innerText = '✍️ Custom / Type Your Own Profile...';
          profSelect.appendChild(customOpt);
        }
      } else {
        alert('Notice: ' + (data.error || 'Failed to import starter profiles'));
      }
    } catch (err) {
      alert('Network error importing starter profiles: ' + err.message);
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
        showToast('📦 Imported ' + data.importedCount + ' starter profiles to Supabase!', 'success');
        setTimeout(function() { window.location.reload(); }, 1200);
      } else {
        alert('Notice: ' + (data.error || 'Failed to import starter profiles'));
      }
    } catch (err) {
      alert('Network error importing starter profiles: ' + err.message);
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
          setTimeout(function() { window.location.reload(); }, 1500);
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

`;

const updatedCode = code.slice(0, startIdx) + newSection + code.slice(endIdx);
fs.writeFileSync(dashboardJsPath, updatedCode, 'utf8');
console.log('Successfully updated apps/web/public/dashboard.js');

// Now re-generate apps/web/src/client/dashboard-script.ts
const scriptTsContent = `// Auto-generated from apps/web/public/dashboard.js
// Do not edit directly; modify apps/web/public/dashboard.js and re-sync.

export const DASHBOARD_CLIENT_SCRIPT = ${JSON.stringify(updatedCode)};
`;

fs.writeFileSync(dashboardScriptTsPath, scriptTsContent, 'utf8');
console.log('Successfully updated apps/web/src/client/dashboard-script.ts');
