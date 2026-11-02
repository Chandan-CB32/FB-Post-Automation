import { describe, it, expect, beforeEach } from 'vitest';
import {
  orderCandidatesByStrategy,
  filterEligibleCandidates,
  resetRoundRobinCounter,
  ProviderCandidateMeta,
} from '../worker/src/router/strategies.js';

describe('Chain Strategy Ordering & Filtering', () => {
  beforeEach(() => {
    resetRoundRobinCounter();
  });

  const sampleCandidates: ProviderCandidateMeta[] = [
    {
      providerId: 'prov-1',
      name: 'Gemini Flash',
      status: 'active',
      requestsToday: 10,
      dailyLimit: 1500,
    },
    {
      providerId: 'prov-2',
      name: 'Groq Llama',
      status: 'active',
      requestsToday: 5,
      dailyLimit: 14400,
    },
    {
      providerId: 'prov-3',
      name: 'OpenRouter Free',
      status: 'active',
      requestsToday: 195,
      dailyLimit: 200,
    },
  ];

  it('filters out disabled and over-limit providers', () => {
    const list: ProviderCandidateMeta[] = [
      ...sampleCandidates,
      {
        providerId: 'prov-disabled',
        name: 'Disabled Provider',
        status: 'disabled',
        requestsToday: 0,
        dailyLimit: 100,
      },
      {
        providerId: 'prov-overlimit',
        name: 'Over-limit Provider',
        status: 'active',
        requestsToday: 100,
        dailyLimit: 100, // Reached limit
      },
    ];

    const eligible = filterEligibleCandidates(list);
    expect(eligible.length).toBe(3);
    expect(eligible.map((p) => p.providerId)).not.toContain('prov-disabled');
    expect(eligible.map((p) => p.providerId)).not.toContain('prov-overlimit');
  });

  it('filters out cooling providers until cooldown has elapsed', () => {
    const now = new Date();
    const list: ProviderCandidateMeta[] = [
      {
        providerId: 'prov-cooling',
        name: 'Cooling Provider',
        status: 'cooling',
        cooldownUntil: new Date(now.getTime() + 60000),
        requestsToday: 10,
        dailyLimit: 100,
      },
    ];

    expect(filterEligibleCandidates(list, now).length).toBe(0);

    const future = new Date(now.getTime() + 61000);
    const result = filterEligibleCandidates(list, future);
    expect(result.length).toBe(1);
    expect(result[0].status).toBe('active');
  });

  it('applies priority strategy in declared order', () => {
    const ordered = orderCandidatesByStrategy(sampleCandidates, 'priority');
    expect(ordered.map((p) => p.providerId)).toEqual(['prov-1', 'prov-2', 'prov-3']);
  });

  it('applies least_used_today strategy ascending by requestsToday', () => {
    const ordered = orderCandidatesByStrategy(sampleCandidates, 'least_used_today');
    expect(ordered.map((p) => p.providerId)).toEqual(['prov-2', 'prov-1', 'prov-3']);
  });

  it('applies weighted_by_remaining_budget strategy descending by remaining budget', () => {
    const ordered = orderCandidatesByStrategy(sampleCandidates, 'weighted_by_remaining_budget');
    // Remaining: prov-2 (14395), prov-1 (1490), prov-3 (5)
    expect(ordered.map((p) => p.providerId)).toEqual(['prov-2', 'prov-1', 'prov-3']);
  });

  it('applies round_robin strategy rotating starting candidate', () => {
    const firstCall = orderCandidatesByStrategy(sampleCandidates, 'round_robin');
    expect(firstCall.map((p) => p.providerId)).toEqual(['prov-1', 'prov-2', 'prov-3']);

    const secondCall = orderCandidatesByStrategy(sampleCandidates, 'round_robin');
    expect(secondCall.map((p) => p.providerId)).toEqual(['prov-2', 'prov-3', 'prov-1']);

    const thirdCall = orderCandidatesByStrategy(sampleCandidates, 'round_robin');
    expect(thirdCall.map((p) => p.providerId)).toEqual(['prov-3', 'prov-1', 'prov-2']);
  });
});
