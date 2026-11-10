/**
 * Page Setup Checklist Evaluator & Safe Onboarding Guard
 * FB Auto 247 - Made by Chandan Biswas
 */

import { PageSchedule, validatePageSchedule } from './slot-planner.js';

export interface PageChecklistStatus {
  profileChosen: boolean;
  profileName?: string;
  hasCustomNiche?: boolean;
  scheduleSet: boolean;
  scheduleSummary?: string;
  modeChosen: boolean;
  publishingMode: string;
  testRunDone: boolean;
  lastTestRunAt?: string;
  testRunReport?: any;
  wentLive: boolean;
  isReadyToGoLive: boolean;
  missingSteps: string[];
}

export interface PageOnboardingInput {
  id: string;
  name: string;
  active: boolean;
  profile_id?: string | null;
  profile_name?: string | null;
  custom_niche?: string | null;
  custom_niche_text?: string | null;
  publishing_mode: 'auto' | 'review' | 'hybrid' | string;
  mode_chosen?: boolean | null;
  schedule?: Partial<PageSchedule> | null;
  last_test_run_at?: string | null;
  test_run_verified?: boolean | null;
  test_run_report?: any | null;
}

/**
 * Safe Initial Schedule Default for Newly Discovered Pages.
 * Starts with 0 posts/day (schedule unconfigured), Active OFF, Mode Review.
 */
export const SAFE_DEFAULT_SCHEDULE: PageSchedule = {
  postsPerDay: 0,
  mode: 'fixed',
  postingTimes: [],
  daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
  timezone: 'Asia/Kolkata',
  jitterMinutes: 10,
  minGapMinutes: 60,
  leadTimeHours: 24,
};

/**
 * Evaluates the 5-step onboarding checklist for a Facebook Page.
 */
export function evaluatePageChecklist(page: PageOnboardingInput): PageChecklistStatus {
  const missingSteps: string[] = [];

  // Step 1: Content Profile (Real Profile ID or Saved Custom Niche)
  const hasProfileId = Boolean(
    page.profile_id &&
    page.profile_id.trim() &&
    page.profile_id !== 'default-niche' &&
    page.profile_id !== '__custom__' &&
    page.profile_id !== 'custom'
  );
  const hasCustomNiche = Boolean(
    (page.custom_niche && page.custom_niche.trim().length > 0) ||
    (page.custom_niche_text && page.custom_niche_text.trim().length > 0)
  );
  const profileChosen = hasProfileId || hasCustomNiche;
  if (!profileChosen) {
    missingSteps.push('Select a Content Profile or configure a Custom Niche');
  }

  // Step 2: Schedule
  let scheduleSet = false;
  let scheduleSummary = 'No schedule configured (Posting disabled)';
  if (page.schedule && page.schedule.postsPerDay && page.schedule.postsPerDay > 0) {
    const val = validatePageSchedule(page.schedule);
    if (val.valid && val.resolvedPostingTimes.length > 0) {
      scheduleSet = true;
      scheduleSummary = `${page.schedule.postsPerDay} post(s)/day at ${val.resolvedPostingTimes.join(', ')} (${page.schedule.timezone || 'Asia/Kolkata'})`;
    }
  }
  if (!scheduleSet) {
    missingSteps.push('Configure posting frequency and schedule times');
  }

  // Step 3: Publishing Mode
  const modeChosen = Boolean(
    page.mode_chosen !== false &&
    (page.publishing_mode === 'auto' || page.publishing_mode === 'review' || page.publishing_mode === 'hybrid')
  );
  if (!modeChosen) {
    missingSteps.push('Confirm and select publishing mode (Review, Hybrid, or Auto)');
  }

  // Step 4: Test Run (Marked verified ONLY when real pipeline pass is verified)
  const testRunDone = Boolean(
    page.last_test_run_at &&
    page.test_run_verified !== false
  );
  if (!testRunDone) {
    missingSteps.push('Execute a verified Test Run through the pipeline');
  }

  // Step 5: Went Live
  const wentLive = Boolean(page.active);
  const isReadyToGoLive = profileChosen && scheduleSet && modeChosen && testRunDone;

  return {
    profileChosen,
    profileName: page.profile_name || undefined,
    hasCustomNiche,
    scheduleSet,
    scheduleSummary,
    modeChosen,
    publishingMode: page.publishing_mode || 'review',
    testRunDone,
    lastTestRunAt: page.last_test_run_at || undefined,
    testRunReport: page.test_run_report || undefined,
    wentLive,
    isReadyToGoLive,
    missingSteps,
  };
}

