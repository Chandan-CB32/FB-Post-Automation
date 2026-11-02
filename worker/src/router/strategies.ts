import { ChainStrategy } from '@fb-auto/core';

export interface ProviderCandidateMeta {
  providerId: string;
  name: string;
  status: 'active' | 'cooling' | 'disabled';
  cooldownUntil?: Date | null;
  requestsToday: number;
  dailyLimit: number;
}

let roundRobinCounter = 0;

export function resetRoundRobinCounter(): void {
  roundRobinCounter = 0;
}

/**
 * Filters out unavailable providers (disabled, in cooldown, or at/over daily quota).
 */
export function filterEligibleCandidates<T extends ProviderCandidateMeta>(
  candidates: T[],
  now = new Date()
): T[] {
  return candidates.filter((c) => {
    if (c.status === 'disabled') return false;
    if (c.status === 'cooling') {
      if (c.cooldownUntil && c.cooldownUntil <= now) {
        c.status = 'active';
        c.cooldownUntil = null;
        return true;
      }
      return false;
    }
    if (c.dailyLimit > 0 && c.requestsToday >= c.dailyLimit) {
      return false;
    }
    return true;
  });
}

/**
 * Orders eligible provider candidates according to the specified chain strategy.
 */
export function orderCandidatesByStrategy<T extends ProviderCandidateMeta>(
  candidates: T[],
  strategy: ChainStrategy,
  now = new Date()
): T[] {
  const eligible = filterEligibleCandidates(candidates, now);
  if (eligible.length <= 1) {
    return eligible;
  }

  switch (strategy) {
    case 'priority': {
      // Retain declared order
      return [...eligible];
    }

    case 'round_robin': {
      const offset = roundRobinCounter % eligible.length;
      roundRobinCounter = (roundRobinCounter + 1) % 100000;
      return [...eligible.slice(offset), ...eligible.slice(0, offset)];
    }

    case 'least_used_today': {
      return [...eligible].sort((a, b) => a.requestsToday - b.requestsToday);
    }

    case 'weighted_by_remaining_budget': {
      return [...eligible].sort((a, b) => {
        const remainingA = Math.max(0, a.dailyLimit - a.requestsToday);
        const remainingB = Math.max(0, b.dailyLimit - b.requestsToday);
        return remainingB - remainingA; // Descending (most remaining capacity first)
      });
    }

    default:
      return [...eligible];
  }
}

