export interface PageScheduleConfig {
  postsPerDay?: number;
  postingTimes?: string[]; // e.g. ["09:00", "14:00", "20:00"]
  timezone?: string; // default 'UTC'
  minGapMinutes?: number; // default 180 (3 hours)
  leadTimeHours?: number; // default 48 hours
  activeDays?: number[]; // [0,1,2,3,4,5,6] (0 = Sunday)
  dailyCap?: number; // default 5
}

/**
 * Parses "HH:mm" time string into hours and minutes
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map((s) => parseInt(s, 10));
  return {
    hours: isNaN(h) ? 12 : Math.min(Math.max(h, 0), 23),
    minutes: isNaN(m) ? 0 : Math.min(Math.max(m, 0), 59),
  };
}

/**
 * Calculates upcoming post slots based on schedule configuration.
 */
export function calculateNextSlots(
  config: PageScheduleConfig,
  fromDate = new Date(),
  slotCount = 10
): Date[] {
  const times = config.postingTimes && config.postingTimes.length > 0
    ? [...config.postingTimes].sort()
    : ['10:00', '15:00', '20:00'];

  const activeDays = new Set(config.activeDays && config.activeDays.length > 0
    ? config.activeDays
    : [0, 1, 2, 3, 4, 5, 6]);

  const minGapMs = (config.minGapMinutes ?? 180) * 60 * 1000;
  const slots: Date[] = [];

  let currentDate = new Date(fromDate);
  // Start from beginning of the day in UTC
  currentDate.setUTCHours(0, 0, 0, 0);

  let attempts = 0;
  const maxAttempts = 60; // Max 60 days ahead

  while (slots.length < slotCount && attempts < maxAttempts) {
    const dayOfWeek = currentDate.getUTCDay();

    if (activeDays.has(dayOfWeek)) {
      for (const timeStr of times) {
        const { hours, minutes } = parseTimeString(timeStr);
        const slotDate = new Date(currentDate);
        slotDate.setUTCHours(hours, minutes, 0, 0);

        // Slot must be strictly in the future relative to fromDate
        if (slotDate.getTime() > fromDate.getTime()) {
          // Check minGap with the last slot
          const lastSlot = slots[slots.length - 1];
          if (!lastSlot || slotDate.getTime() - lastSlot.getTime() >= minGapMs) {
            slots.push(slotDate);
            if (slots.length >= slotCount) break;
          }
        }
      }
    }

    // Advance to next day
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    attempts++;
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

