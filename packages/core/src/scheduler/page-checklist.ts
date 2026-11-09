/**
 * Page Setup Checklist Evaluator & Safe Onboarding Guard
 * FB Auto 247 - Made by Chandan Biswas
 */

import { PageSchedule, validatePageSchedule } from './slot-planner.js';

export interface PageChecklistStatus {
  profileChosen: boolean;
  profileName?: string;
  scheduleSet: boolean;
  scheduleSummary?: string;
  modeChosen: boolean;
  publishingMode: string;
  testRunDone: boolean;
  lastTestRunAt?: string;
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
  publishing_mode: 'auto' | 'review' | 'hybrid' | string;
  schedule?: Partial<PageSchedule> | null;
  last_test_run_at?: string | null;
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

  // Step 1: Content Profile
  const profileChosen = Boolean(
    page.profile_id &&
    page.profile_id.trim() &&
    page.profile_id !== 'default-niche' &&
    page.profile_id !== '__custom__'
  );
  if (!profileChosen) {
    missingSteps.push('Select a Content Profile or run Automatic Niche Detection');
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
    page.publishing_mode === 'auto' || page.publishing_mode === 'review' || page.publishing_mode === 'hybrid'
  );
  if (!modeChosen) {
    missingSteps.push('Choose a publishing mode (Review, Hybrid, or Auto)');
  }

  // Step 4: Test Run
  const testRunDone = Boolean(page.last_test_run_at);
  if (!testRunDone) {
    missingSteps.push('Run at least one Test Run to verify prompt & image generation');
  }

  // Step 5: Went Live
  const wentLive = Boolean(page.active);
  const isReadyToGoLive = profileChosen && scheduleSet && modeChosen && testRunDone;

  return {
    profileChosen,
    profileName: page.profile_name || undefined,
    scheduleSet,
    scheduleSummary,
    modeChosen,
    publishingMode: page.publishing_mode || 'review',
    testRunDone,
    lastTestRunAt: page.last_test_run_at || undefined,
    wentLive,
    isReadyToGoLive,
    missingSteps,
  };
}

