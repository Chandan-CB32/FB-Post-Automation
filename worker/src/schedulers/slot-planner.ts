import {
  createDateInTimezone,
  resolveSchedulePostingTimes,
  parseTimeString,
} from '@fb-auto/core';

export interface PageScheduleConfig {
  active?: boolean;
  is_live?: boolean;
  postsPerDay?: number;
  mode?: 'fixed' | 'interval' | 'auto_spread';
  postingTimes?: string[]; // e.g. ["09:00", "14:00", "20:00"]
  intervalHours?: number;
  intervalStart?: string;
  intervalEnd?: string;
  spreadStart?: string;
  spreadEnd?: string;
  timezone?: string; // e.g. 'UTC', 'America/New_York', 'Asia/Kolkata'
  minGapMinutes?: number; // default 60
  leadTimeHours?: number; // default 24 hours
  activeDays?: number[]; // [0,1,2,3,4,5,6] (0 = Sunday) or [1..7]
  dailyCap?: number;
  startDate?: string;
  endDate?: string;
  pauseStart?: string;
  pauseEnd?: string;
  vacationPause?: {
    startDate: string;
    endDate: string;
  };
}

export { parseTimeString };

/**
 * Calculates upcoming post slots based on schedule configuration.
 * Gating: If active === false or postsPerDay === 0, returns [] immediately.
 * No hardcoded times: Returns [] if posting times are not configured.
 * Respects timezone, DST, days of week, min gap, and vacation pause.
 */
export function calculateNextSlots(
  config: PageScheduleConfig,
  fromDate = new Date(),
  slotCount = 10
): Date[] {
  // Safe default & live gating: Inactive or unconfigured pages generate 0 slots
  const isExplicitlyDisabled = config.active === false || (config.is_live === false && config.active !== true);
  if (isExplicitlyDisabled || config.postsPerDay === 0) {
    return [];
  }

  // Resolve posting times (strictly based on settings, NO hardcoded default)
  let times: string[] = [];
  if (config.postingTimes && config.postingTimes.length > 0) {
    times = [...config.postingTimes].sort();
  } else if (config.mode === 'interval' || config.mode === 'auto_spread') {
    times = resolveSchedulePostingTimes({
      postsPerDay: config.postsPerDay,
      mode: config.mode,
      intervalHours: config.intervalHours,
      intervalStart: config.intervalStart,
      intervalEnd: config.intervalEnd,
      spreadStart: config.spreadStart,
      spreadEnd: config.spreadEnd,
    });
  }

  if (times.length === 0) {
    return [];
  }

  // Map active days (support both 0-6 Sun-Sat and 1-7 Mon-Sun)
  let activeDays = new Set<number>([0, 1, 2, 3, 4, 5, 6]);
  if (config.activeDays && config.activeDays.length > 0) {
    activeDays = new Set(config.activeDays.map((d) => (d === 7 ? 0 : d)));
  }

  const targetTimezone = config.timezone || 'UTC';
  const minGapMs = (config.minGapMinutes ?? 60) * 60 * 1000;
  const slots: Date[] = [];

  const pauseStart = config.pauseStart || config.vacationPause?.startDate;
  const pauseEnd = config.pauseEnd || config.vacationPause?.endDate;

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  let daysAhead = 0;
  const maxDays = 60;

  while (slots.length < slotCount && daysAhead < maxDays) {
    const curRefDate = new Date(fromDate.getTime() + daysAhead * 86400000);
    const dateParts = tzFormatter.formatToParts(curRefDate);
    const y = parseInt(dateParts.find((p) => p.type === 'year')!.value, 10);
    const m = parseInt(dateParts.find((p) => p.type === 'month')!.value, 10);
    const d = parseInt(dateParts.find((p) => p.type === 'day')!.value, 10);
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    if (config.startDate && dateStr < config.startDate) {
      daysAhead++;
      continue;
    }
    if (config.endDate && dateStr > config.endDate) {
      break;
    }
    if (pauseStart && pauseEnd && dateStr >= pauseStart && dateStr <= pauseEnd) {
      daysAhead++;
      continue;
    }

    // Midday date in timezone
    const midday = createDateInTimezone(y, m, d, 12, 0, targetTimezone);
    const dayOfWeek = midday.getDay(); // 0 = Sunday

    if (activeDays.has(dayOfWeek)) {
      for (const timeStr of times) {
        const { hours, minutes } = parseTimeString(timeStr);
        const slotDate = targetTimezone === 'UTC'
          ? (() => {
              const dt = new Date(curRefDate);
              dt.setUTCHours(hours, minutes, 0, 0);
              return dt;
            })()
          : createDateInTimezone(y, m, d, hours, minutes, targetTimezone);

        if (slotDate.getTime() > fromDate.getTime()) {
          const lastSlot = slots[slots.length - 1];
          if (!lastSlot || slotDate.getTime() - lastSlot.getTime() >= minGapMs) {
            slots.push(slotDate);
            if (slots.length >= slotCount) break;
          }
        }
      }
    }

    daysAhead++;
  }

  return enforceDailyCap(slots, config.dailyCap ?? 5);
}

/**
 * Enforces that no single calendar day (UTC) exceeds the dailyCap.
 */
export function enforceDailyCap(slots: Date[], dailyCap = 5): Date[] {
  const countsPerDay: Record<string, number> = {};
  const filtered: Date[] = [];

  for (const slot of slots) {
    const dayKey = slot.toISOString().slice(0, 10);
    const currentCount = countsPerDay[dayKey] || 0;
    if (currentCount < dailyCap) {
      countsPerDay[dayKey] = currentCount + 1;
      filtered.push(slot);
    }
  }

  return filtered;
}

/**
 * Identifies unfulfilled post slots within the configured lead-time window.
 */
export function planMissingSlots(
  existingScheduledDates: Date[],
  config: PageScheduleConfig,
  leadTimeHours = 48,
  now = new Date()
): Date[] {
  const leadWindowEnd = new Date(now.getTime() + leadTimeHours * 3600 * 1000);
  const potentialSlots = calculateNextSlots(config, now, 50);

  // Filter slots within the leadTime window
  const targetSlotsInWindow = potentialSlots.filter(
    (slot) => slot.getTime() <= leadWindowEnd.getTime()
  );

  const minGapMs = ((config.minGapMinutes ?? 180) * 60 * 1000) / 2; // Tolerance window

  const missingSlots: Date[] = [];

  for (const targetSlot of targetSlotsInWindow) {
    const isCovered = existingScheduledDates.some((existing) => {
      return Math.abs(existing.getTime() - targetSlot.getTime()) <= minGapMs;
    });

    if (!isCovered) {
      missingSlots.push(targetSlot);
    }
  }

  return missingSlots;
}

