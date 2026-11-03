/**
 * Time budget parser and execution deadline tracker for the worker.
 */

export interface TimeBudgetTracker {
  budgetMs: number;
  startTime: number;
  deadline: number;
  safetyBufferMs: number;
  hasTimeRemaining: () => boolean;
  getRemainingMs: () => number;
  getElapsedMs: () => number;
}

/**
 * Parses time budget strings like "11m", "600s", "1h", "15" into milliseconds.
 * Defaults to 11 minutes (660,000 ms) if not specified or invalid.
 */
export function parseTimeBudget(input?: string): number {
  if (!input || typeof input !== 'string') {
    return 11 * 60 * 1000; // default 11 minutes
  }

  const trimmed = input.trim().toLowerCase();
  
  // Format: "11m", "600s", "1h", "500ms"
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (!match) {
    return 11 * 60 * 1000;
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || 'm';

  switch (unit) {
    case 's':
    case 'sec':
    case 'secs':
    case 'seconds':
      return Math.round(value * 1000);
    case 'm':
    case 'min':
    case 'mins':
    case 'minutes':
      return Math.round(value * 60 * 1000);
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hours':
      return Math.round(value * 60 * 60 * 1000);
    case 'ms':
    case 'milliseconds':
      return Math.round(value);
    default:
      // If pure number without unit: if > 60 treat as seconds, else minutes
      return value > 60 ? Math.round(value * 1000) : Math.round(value * 60 * 1000);
  }
}

/**
 * Creates a time budget tracker with a safety buffer (default 30 seconds).
 */
export function createTimeBudgetTracker(
  budgetMsOrString?: number | string,
  safetyBufferMs = 30000
): TimeBudgetTracker {
  const budgetMs =
    typeof budgetMsOrString === 'number'
      ? budgetMsOrString
      : parseTimeBudget(budgetMsOrString);

  const startTime = Date.now();
  const deadline = startTime + budgetMs;

  return {
    budgetMs,
    startTime,
    deadline,
    safetyBufferMs,
    hasTimeRemaining: () => Date.now() + safetyBufferMs < deadline,
    getRemainingMs: () => Math.max(0, deadline - Date.now()),
    getElapsedMs: () => Date.now() - startTime,
  };
}

