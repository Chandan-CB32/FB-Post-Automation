import { describe, it, expect } from 'vitest';
import {
  SAFE_DEFAULT_SCHEDULE,
  PageSchedule,
  validatePageSchedule,
  generateLiveSchedulePreview,
  evaluatePageChecklist,
  resolveSchedulePostingTimes,
  createDateInTimezone,
} from '../packages/core/src/index.js';
import { calculateNextSlots } from '../worker/src/schedulers/slot-planner.js';

describe('Per-Page Scheduling Controls & Slot Planner', () => {
  describe('Safe Defaults & Validation', () => {
    it('SAFE_DEFAULT_SCHEDULE starts with 0 posts/day (posting disabled)', () => {
      expect(SAFE_DEFAULT_SCHEDULE.postsPerDay).toBe(0);
      expect(SAFE_DEFAULT_SCHEDULE.postingTimes).toEqual([]);
      expect(SAFE_DEFAULT_SCHEDULE.mode).toBe('fixed');
      expect(SAFE_DEFAULT_SCHEDULE.timezone).toBe('Asia/Kolkata');
    });

    it('rejects schedule when postsPerDay > 0 but no postingTimes are provided in fixed mode', () => {
      const res = validatePageSchedule({
        postsPerDay: 3,
        mode: 'fixed',
        postingTimes: [],
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Fixed mode requires at least one posting time'))).toBe(true);
    });

    it('warns when postsPerDay > 5 due to Facebook algorithmic reach limits', () => {
      const res = validatePageSchedule({
        postsPerDay: 6,
        mode: 'fixed',
        postingTimes: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'],
        minGapMinutes: 60,
      });
      expect(res.valid).toBe(true);
      expect(res.warnings.some((w) => w.includes('reduce organic reach'))).toBe(true);
    });

    it('enforces minimum gap between consecutive posting times (rejects violations < 30m)', () => {
      const res = validatePageSchedule({
        postsPerDay: 2,
        mode: 'fixed',
        postingTimes: ['10:00', '10:15'], // 15 mins gap
        minGapMinutes: 60,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('Minimum gap violated'))).toBe(true);
    });

    it('generates evenly spaced times in auto_spread mode', () => {
      const res = validatePageSchedule({
        postsPerDay: 3,
        mode: 'auto_spread',
        spreadStart: '08:00',
        spreadEnd: '22:00',
        minGapMinutes: 60,
      });
      expect(res.valid).toBe(true);
      expect(res.resolvedPostingTimes).toEqual(['08:00', '15:00', '22:00']);
    });

    it('generates interval times correctly in interval mode', () => {
      const res = validatePageSchedule({
        postsPerDay: 4,
        mode: 'interval',
        intervalStart: '09:00',
        intervalEnd: '21:00',
        intervalHours: 3,
      });
      expect(res.valid).toBe(true);
      expect(res.resolvedPostingTimes).toEqual(['09:00', '12:00', '15:00', '18:00']);
    });
  });

  describe('Timezone, Local Time & DST Transitions', () => {
    it('correctly maps audience times to local user time (Asia/Kolkata +5:30)', () => {
      const schedule: PageSchedule = {
        postsPerDay: 2,
        mode: 'fixed',
        postingTimes: ['10:00', '18:00'],
        timezone: 'UTC',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      };

      const fromDate = new Date('2026-11-10T00:00:00.000Z');
      const res = generateLiveSchedulePreview(schedule, fromDate, 'Asia/Kolkata', 2);

      expect(res.slots.length).toBe(4); // 2 days * 2 posts
      // 10:00 UTC = 15:30 IST (3:30 PM)
      expect(res.slots[0].audienceTime24h).toBe('10:00');
      expect(res.slots[0].slotIso).toContain('10:00:00.000Z');
      expect(res.slots[0].localTime).toContain('3:30');
      // 18:00 UTC = 23:30 IST (11:30 PM)
      expect(res.slots[1].audienceTime24h).toBe('18:00');
      expect(res.slots[1].slotIso).toContain('18:00:00.000Z');
      expect(res.slots[1].localTime).toContain('11:30');
    });

    it('handles US Daylight Saving Time (EDT to EST transition) without clock drift', () => {
      // In 2026, US DST ends on Sunday, Nov 1, 2026 (EDT UTC-4 -> EST UTC-5)
      const schedule: PageSchedule = {
        postsPerDay: 1,
        mode: 'fixed',
        postingTimes: ['14:00'], // 2:00 PM in New York
        timezone: 'America/New_York',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      };

      // Before DST change: Oct 30, 2026 (EDT is UTC-4 -> 14:00 EDT = 18:00 UTC)
      const d1 = createDateInTimezone('2026-10-30', '14:00', 'America/New_York');
      expect(d1.toISOString()).toBe('2026-10-30T18:00:00.000Z');

      // After DST change: Nov 05, 2026 (EST is UTC-5 -> 14:00 EST = 19:00 UTC)
      const d2 = createDateInTimezone('2026-11-05', '14:00', 'America/New_York');
      expect(d2.toISOString()).toBe('2026-11-05T19:00:00.000Z');
    });
  });

  describe('Worker Slot Planner Execution Gating', () => {
    it('returns 0 slots if page is inactive (active === false)', () => {
      const slots = calculateNextSlots({
        active: false,
        postsPerDay: 3,
        postingTimes: ['10:00', '15:00', '20:00'],
        timezone: 'Asia/Kolkata',
      });
      expect(slots).toEqual([]);
    });

    it('returns 0 slots if postsPerDay === 0', () => {
      const slots = calculateNextSlots({
        active: true,
        postsPerDay: 0,
        postingTimes: ['10:00'],
        timezone: 'Asia/Kolkata',
      });
      expect(slots).toEqual([]);
    });

    it('returns 0 slots during an active vacation pause range', () => {
      const refDate = new Date('2026-12-25T08:00:00.000Z');
      const slots = calculateNextSlots(
        {
          active: true,
          postsPerDay: 1,
          postingTimes: ['12:00'],
          timezone: 'UTC',
          pauseStart: '2026-12-24',
          pauseEnd: '2026-12-26',
        },
        refDate,
        2
      );
      // December 25 and 26 are in pause range, so first slot must be on Dec 27
      expect(slots.length).toBe(2);
      expect(slots[0].toISOString()).toBe('2026-12-27T12:00:00.000Z');
    });
  });

  describe('5-Step Setup Checklist Evaluator', () => {
    it('detects incomplete steps for newly connected page', () => {
      const page = {
        id: 'page-123',
        name: 'Beyond the Known',
        active: false,
        profile_id: null,
        publishing_mode: 'review',
        mode_chosen: false,
        schedule: SAFE_DEFAULT_SCHEDULE,
      };

      const status = evaluatePageChecklist(page);
      expect(status.profileChosen).toBe(false);
      expect(status.scheduleSet).toBe(false);
      expect(status.modeChosen).toBe(false); // Mode not explicitly chosen yet
      expect(status.testRunDone).toBe(false);
      expect(status.wentLive).toBe(false);
      expect(status.isReadyToGoLive).toBe(false);
      expect(status.missingSteps.length).toBeGreaterThanOrEqual(4);
    });

    it('confirms isReadyToGoLive when profile, schedule, mode, and test run are complete', () => {
      const page = {
        id: 'page-123',
        name: 'Beyond the Known',
        active: false,
        profile_id: 'science-space-deep-facts',
        publishing_mode: 'hybrid',
        mode_chosen: true,
        test_run_verified: true,
        schedule: {
          postsPerDay: 2,
          mode: 'fixed' as const,
          postingTimes: ['11:00', '19:00'],
          timezone: 'Asia/Kolkata',
        },
        last_test_run_at: '2026-11-08T09:00:00.000Z',
      };

      const status = evaluatePageChecklist(page);
      expect(status.profileChosen).toBe(true);
      expect(status.scheduleSet).toBe(true);
      expect(status.modeChosen).toBe(true);
      expect(status.testRunDone).toBe(true);
      expect(status.isReadyToGoLive).toBe(true);
      expect(status.missingSteps).toEqual([]);
    });
  });
});
