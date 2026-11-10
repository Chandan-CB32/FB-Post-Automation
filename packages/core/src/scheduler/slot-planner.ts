/**
 * Advanced Timezone & DST-Aware Post Slot Planner & Schedule Validator
 * FB Auto 247 - Made by Chandan Biswas
 */

export type ScheduleMode = 'fixed' | 'interval' | 'auto_spread';

export interface PageSchedule {
  postsPerDay: number; // 0 = disabled/unconfigured, 1-10
  mode: ScheduleMode;
  postingTimes: string[]; // ["09:00", "14:00", "20:00"] (HH:mm 24h format)
  // Interval mode
  intervalHours?: number; // e.g. every 3 hours
  intervalStart?: string; // "09:00"
  intervalEnd?: string; // "21:00"
  // Auto-spread mode
  spreadStart?: string; // "08:00"
  spreadEnd?: string; // "22:00"

  daysOfWeek: number[]; // [1, 2, 3, 4, 5, 6, 7] (1=Monday ... 7=Sunday)
  timezone: string; // IANA timezone, e.g. 'Asia/Kolkata', 'America/New_York', 'UTC'
  jitterMinutes: number; // default 10 (±10 mins)
  minGapMinutes: number; // default 60 mins between posts
  leadTimeHours: number; // default 24 hours ahead
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  pauseStart?: string; // YYYY-MM-DD (vacation pause)
  pauseEnd?: string; // YYYY-MM-DD
}

export interface ScheduleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  resolvedPostingTimes: string[];
}

export interface ScheduledSlotPreview {
  date: string; // YYYY-MM-DD
  dayOfWeekName: string; // "Monday", "Tuesday", etc.
  audienceTime: string; // e.g. "09:00 AM (EDT)"
  audienceTime24h: string; // "09:00"
  audienceTimezone: string;
  localTime: string; // e.g. "06:30 PM (IST)"
  localTimezone: string;
  slotIso: string; // ISO 8601 UTC
  jitterWindow: string; // e.g. "08:50 - 09:10"
  slotIndex: number; // 1-based index within day
  totalSlotsForDay: number;
}

/**
 * Parses "HH:mm" time string into hours and minutes
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const parts = String(timeStr || '').split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return {
    hours: isNaN(h) ? 12 : Math.min(Math.max(h, 0), 23),
    minutes: isNaN(m) ? 0 : Math.min(Math.max(m, 0), 59),
  };
}

/**
 * Formats hours and minutes into "HH:mm"
 */
export function formatTimeString(hours: number, minutes: number): string {
  const h = String(Math.min(Math.max(hours, 0), 23)).padStart(2, '0');
  const m = String(Math.min(Math.max(minutes, 0), 59)).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Converts a time in minutes from midnight (0 - 1439) into "HH:mm"
 */
export function minutesToTimeString(totalMinutes: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return formatTimeString(hours, mins);
}

/**
 * Converts "HH:mm" to total minutes from midnight
 */
export function timeStringToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTimeString(timeStr);
  return hours * 60 + minutes;
}

/**
 * Resolves effective posting times for a given schedule mode.
 */
export function resolveSchedulePostingTimes(schedule: Partial<PageSchedule>): string[] {
  const postsPerDay = Math.max(0, schedule.postsPerDay ?? 0);
  if (postsPerDay === 0) return [];

  const mode = schedule.mode || 'fixed';

  if (mode === 'fixed') {
    return Array.isArray(schedule.postingTimes)
      ? [...schedule.postingTimes].filter((t) => typeof t === 'string' && t.includes(':')).sort()
      : [];
  }

  if (mode === 'interval') {
    const startMin = timeStringToMinutes(schedule.intervalStart || (schedule as any).windowStart || '09:00');
    const endMin = timeStringToMinutes(schedule.intervalEnd || (schedule as any).windowEnd || '21:00');
    const intervalHours = schedule.intervalHours && schedule.intervalHours > 0 ? schedule.intervalHours : 3;
    const intervalMin = intervalHours * 60;

    const times: string[] = [];
    let current = startMin;
    while (current <= endMin && times.length < postsPerDay) {
      times.push(minutesToTimeString(current));
      current += intervalMin;
    }
    return times;
  }

  if (mode === 'auto_spread') {
    const startMin = timeStringToMinutes(schedule.spreadStart || (schedule as any).windowStart || '08:00');
    const endMin = timeStringToMinutes(schedule.spreadEnd || (schedule as any).windowEnd || '22:00');

    if (postsPerDay === 1) {
      return [minutesToTimeString(Math.round((startMin + endMin) / 2))];
    }

    const times: string[] = [];
    const step = (endMin - startMin) / (postsPerDay - 1);
    for (let i = 0; i < postsPerDay; i++) {
      times.push(minutesToTimeString(startMin + i * step));
    }
    return times;
  }

  return [];
}

/**
 * Validates a Page schedule and returns errors, warnings, and resolved times.
 */
export function validatePageSchedule(schedule: Partial<PageSchedule>): ScheduleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const postsPerDay = schedule.postsPerDay ?? 0;
  if (postsPerDay < 0 || postsPerDay > 10) {
    errors.push('Posts per day must be between 1 and 10 (or 0 to disable schedule).');
  }

  if (postsPerDay > 5) {
    warnings.push(
      'Posting more than 5 times per day may trigger Facebook algorithm distribution penalties and reduce organic reach.'
    );
  }

  const resolvedPostingTimes = resolveSchedulePostingTimes(schedule);

  if (postsPerDay > 0) {
    if (resolvedPostingTimes.length === 0) {
      errors.push('Fixed mode requires at least one posting time.');
    } else if (schedule.mode === 'fixed' && resolvedPostingTimes.length !== postsPerDay) {
      errors.push(
        `Configured ${postsPerDay} post(s) per day, but specified ${resolvedPostingTimes.length} posting time(s). Please align your time pickers.`
      );
    }

    const minGap = schedule.minGapMinutes ?? 60;
    // Check gap between consecutive times
    for (let i = 0; i < resolvedPostingTimes.length - 1; i++) {
      const t1 = timeStringToMinutes(resolvedPostingTimes[i]);
      const t2 = timeStringToMinutes(resolvedPostingTimes[i + 1]);
      if (t2 - t1 < 30) {
        errors.push(
          `Minimum gap violated: gap between ${resolvedPostingTimes[i]} and ${resolvedPostingTimes[i + 1]} (${t2 - t1} min) is less than the required 30 minutes.`
        );
      } else if (t2 - t1 < minGap) {
        warnings.push(
          `Gap between ${resolvedPostingTimes[i]} and ${resolvedPostingTimes[i + 1]} (${t2 - t1} min) is less than the configured minimum gap of ${minGap} minutes.`
        );
      }
    }

    const days = schedule.daysOfWeek || [1, 2, 3, 4, 5, 6, 7];
    if (!Array.isArray(days) || days.length === 0) {
      errors.push('At least one day of the week must be selected.');
    }
  }

  // Validate timezone
  if (schedule.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone });
    } catch {
      errors.push(`Invalid IANA timezone: "${schedule.timezone}". Please select a valid timezone.`);
    }
  }

  // Validate pause range if provided
  if (schedule.pauseStart && schedule.pauseEnd) {
    if (new Date(schedule.pauseStart).getTime() > new Date(schedule.pauseEnd).getTime()) {
      errors.push('Vacation pause start date cannot be after pause end date.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedPostingTimes,
  };
}

/**
 * Creates a UTC Date corresponding to a calendar date YYYY-MM-DD and time HH:mm in a specific IANA timezone.
 * Handles Daylight Saving Time (DST) transitions accurately.
 */
export function createDateInTimezone(
  dateOrYear: string | number,
  timeOrMonth: string | number,
  dayOrTz?: number | string,
  hours?: number,
  minutes?: number,
  timeZone?: string
): Date {
  let year: number;
  let month: number;
  let day: number;
  let h: number;
  let m: number;
  let tz: string;

  if (typeof dateOrYear === 'string' && typeof timeOrMonth === 'string') {
    const [yStr, mStr, dStr] = dateOrYear.split('-');
    const [hourStr, minStr] = timeOrMonth.split(':');
    year = parseInt(yStr, 10);
    month = parseInt(mStr, 10);
    day = parseInt(dStr, 10);
    h = parseInt(hourStr, 10);
    m = parseInt(minStr, 10);
    tz = (dayOrTz as string) || 'UTC';
  } else {
    year = dateOrYear as number;
    month = timeOrMonth as number;
    day = dayOrTz as number;
    h = hours as number;
    m = minutes as number;
    tz = timeZone || 'UTC';
  }

  // Approximate as UTC first
  const approxUtc = new Date(Date.UTC(year, month - 1, day, h, m, 0, 0));

  // Determine timezone offset for approxUtc
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(approxUtc);
  const partMap: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      partMap[p.type] = parseInt(p.value, 10);
    }
  }

  // Adjust for hour 24 if returned by Intl
  const targetHour = partMap.hour === 24 ? 0 : partMap.hour;

  const targetDateInTz = new Date(
    Date.UTC(partMap.year, partMap.month - 1, partMap.day, targetHour, partMap.minute, 0, 0)
  );

  // Offset in milliseconds between UTC and the requested timezone
  const offsetMs = approxUtc.getTime() - targetDateInTz.getTime();
  return new Date(approxUtc.getTime() + offsetMs);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generates interactive slot preview for the next N days.
 * Formats times in both Audience Timezone and Viewer Local Timezone.
 * Strictly excludes past slots (must be >= fromDate + minLeadMinutes).
 */
export function generateLiveSchedulePreview(
  schedule: Partial<PageSchedule>,
  fromDate: Date = new Date(),
  viewerTimezone: string = 'Asia/Kolkata',
  previewDays: number = 7,
  options?: { minLeadMinutes?: number }
): {
  slots: ScheduledSlotPreview[];
  validation: ScheduleValidationResult;
  nextSlotLabel: string;
  nextSlotIso: string | null;
  futureSlotsCount: number;
} {
  const validation = validatePageSchedule(schedule);
  const targetTimezone = schedule.timezone || 'Asia/Kolkata';
  const resolvedTimes = validation.resolvedPostingTimes;

  if (schedule.postsPerDay === 0 || resolvedTimes.length === 0 || !validation.valid) {
    return {
      slots: [],
      validation,
      nextSlotLabel: 'Posting Disabled (0 posts/day)',
      nextSlotIso: null,
      futureSlotsCount: 0,
    };
  }

  const activeDays = new Set(
    schedule.daysOfWeek && schedule.daysOfWeek.length > 0 ? schedule.daysOfWeek : [1, 2, 3, 4, 5, 6, 7]
  );
  const jitter = schedule.jitterMinutes ?? 10;
  const minLeadMinutes = options?.minLeadMinutes ?? (schedule as any).minLeadMinutes ?? 15;
  const minSlotTime = fromDate.getTime() + minLeadMinutes * 60 * 1000;
  const slots: ScheduledSlotPreview[] = [];

  // Get current calendar year/month/day in audience timezone
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  for (let dayOffset = 0; dayOffset < previewDays; dayOffset++) {
    const curRefDate = new Date(fromDate.getTime() + dayOffset * 86400000);
    const dateParts = tzFormatter.formatToParts(curRefDate);
    const y = parseInt(dateParts.find((p) => p.type === 'year')!.value, 10);
    const m = parseInt(dateParts.find((p) => p.type === 'month')!.value, 10);
    const d = parseInt(dateParts.find((p) => p.type === 'day')!.value, 10);

    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    // Check Start / End date boundaries
    if (schedule.startDate && dateStr < schedule.startDate) continue;
    if (schedule.endDate && dateStr > schedule.endDate) continue;

    // Check Vacation / Pause range
    if (schedule.pauseStart && schedule.pauseEnd) {
      if (dateStr >= schedule.pauseStart && dateStr <= schedule.pauseEnd) continue;
    }

    // Determine Day of Week (1=Mon ... 7=Sun) in target timezone
    const midday = createDateInTimezone(y, m, d, 12, 0, targetTimezone);
    const jsDay = midday.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const isoDayOfWeek = jsDay === 0 ? 7 : jsDay;

    if (!activeDays.has(isoDayOfWeek)) continue;

    resolvedTimes.forEach((timeStr, idx) => {
      const { hours, minutes } = parseTimeString(timeStr);
      const slotUtcDate = createDateInTimezone(y, m, d, hours, minutes, targetTimezone);

      // Strictly filter out past slots or slots inside minimum lead buffer
      if (slotUtcDate.getTime() < minSlotTime) {
        return;
      }

      // Audience timezone formatted time
      const audienceFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: targetTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
      const audienceTime = audienceFormatter.format(slotUtcDate);

      // Local viewer timezone formatted time
      const localFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: viewerTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
      const localTime = localFormatter.format(slotUtcDate);

      // Jitter range
      const minJitterTime = minutesToTimeString(hours * 60 + minutes - jitter);
      const maxJitterTime = minutesToTimeString(hours * 60 + minutes + jitter);

      slots.push({
        date: dateStr,
        dayOfWeekName: DAY_NAMES[jsDay],
        audienceTime,
        audienceTime24h: timeStr,
        audienceTimezone: targetTimezone,
        localTime,
        localTimezone: viewerTimezone,
        slotIso: slotUtcDate.toISOString(),
        jitterWindow: `${minJitterTime} - ${maxJitterTime}`,
        slotIndex: idx + 1,
        totalSlotsForDay: resolvedTimes.length,
      });
    });
  }

  // Ensure slots are strictly sorted by ISO timestamp
  slots.sort((a, b) => new Date(a.slotIso).getTime() - new Date(b.slotIso).getTime());

  let nextSlotLabel = 'No upcoming slots planned';
  let nextSlotIso: string | null = null;

  if (slots.length > 0) {
    nextSlotIso = slots[0].slotIso;
    const diffMs = new Date(nextSlotIso).getTime() - fromDate.getTime();
    if (diffMs > 0) {
      const totalMinutes = Math.round(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      if (hours > 0 && mins > 0) {
        nextSlotLabel = `Next post in ${hours} hour${hours > 1 ? 's' : ''} ${mins} minute${mins > 1 ? 's' : ''}`;
      } else if (hours > 0) {
        nextSlotLabel = `Next post in ${hours} hour${hours > 1 ? 's' : ''}`;
      } else {
        nextSlotLabel = `Next post in ${Math.max(1, mins)} minute${mins !== 1 ? 's' : ''}`;
      }
    } else {
      nextSlotLabel = 'Next post due now';
    }
  }

  return {
    slots,
    validation,
    nextSlotLabel,
    nextSlotIso,
    futureSlotsCount: slots.length,
  };
}

/**
 * Calculates upcoming scheduled slots for worker post planning.
 * Strictly respects active status, timezone, lead time, min gap, days of week, and jitter.
 */
export function calculateNextScheduledSlots(
  schedule: Partial<PageSchedule>,
  fromDate: Date = new Date(),
  maxSlots: number = 50
): Date[] {
  const postsPerDay = schedule.postsPerDay ?? 0;
  if (postsPerDay <= 0) return [];

  const validation = validatePageSchedule(schedule);
  if (!validation.valid) return [];

  const times = validation.resolvedPostingTimes;
  if (times.length === 0) return [];

  const targetTimezone = schedule.timezone || 'Asia/Kolkata';
  const activeDays = new Set(
    schedule.daysOfWeek && schedule.daysOfWeek.length > 0 ? schedule.daysOfWeek : [1, 2, 3, 4, 5, 6, 7]
  );
  const minGapMs = (schedule.minGapMinutes ?? 60) * 60 * 1000;
  const leadTimeMs = (schedule.leadTimeHours ?? 24) * 3600 * 1000;
  const maxFutureTime = fromDate.getTime() + leadTimeMs;

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const slots: Date[] = [];
  let daysAhead = 0;
  const maxDays = Math.ceil((schedule.leadTimeHours ?? 24) / 24) + 14;

  while (slots.length < maxSlots && daysAhead < maxDays) {
    const refDate = new Date(fromDate.getTime() + daysAhead * 86400000);
    const dateParts = tzFormatter.formatToParts(refDate);
    const y = parseInt(dateParts.find((p) => p.type === 'year')!.value, 10);
    const m = parseInt(dateParts.find((p) => p.type === 'month')!.value, 10);
    const d = parseInt(dateParts.find((p) => p.type === 'day')!.value, 10);
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    if (schedule.startDate && dateStr < schedule.startDate) {
      daysAhead++;
      continue;
    }
    if (schedule.endDate && dateStr > schedule.endDate) {
      break;
    }
    if (schedule.pauseStart && schedule.pauseEnd && dateStr >= schedule.pauseStart && dateStr <= schedule.pauseEnd) {
      daysAhead++;
      continue;
    }

    const midday = createDateInTimezone(y, m, d, 12, 0, targetTimezone);
    const jsDay = midday.getDay();
    const isoDayOfWeek = jsDay === 0 ? 7 : jsDay;

    if (activeDays.has(isoDayOfWeek)) {
      const minLeadMs = ((schedule as any).minLeadMinutes ?? 15) * 60 * 1000;
      const minSlotTime = fromDate.getTime() + minLeadMs;
      for (const timeStr of times) {
        const { hours, minutes } = parseTimeString(timeStr);
        const slotDate = createDateInTimezone(y, m, d, hours, minutes, targetTimezone);

        if (slotDate.getTime() >= minSlotTime && slotDate.getTime() <= maxFutureTime) {
          const lastSlot = slots[slots.length - 1];
          if (!lastSlot || slotDate.getTime() - lastSlot.getTime() >= minGapMs) {
            slots.push(slotDate);
            if (slots.length >= maxSlots) break;
          }
        }
      }
    }

    daysAhead++;
  }

  return slots;
}
