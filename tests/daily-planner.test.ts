import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaTracker } from '../worker/src/router/quota-tracker.js';
import {
  DailyDemandPlanner,
  PageDemandInput,
  ProviderCapacityInput,
} from '../worker/src/schedulers/daily-planner.js';

describe('QuotaTracker & DailyDemandPlanner', () => {
  describe('QuotaTracker', () => {
    let tracker: QuotaTracker;

    beforeEach(() => {
      tracker = new QuotaTracker();
    });

    it('records requests, tokens, and calculates percentage', async () => {
      await tracker.recordUsage({
        providerId: 'prov-1',
        tokens: 1500,
        cost: 0.002,
      });

      const usage = tracker.getDailyUsage('prov-1');
      expect(usage.requestsCount).toBe(1);
      expect(usage.tokensCount).toBe(1500);
      expect(usage.estimatedCost).toBe(0.002);

      const status = tracker.checkQuotaStatus('prov-1', { rpdLimit: 10 });
      expect(status.percentUsed).toBe(10);
      expect(status.isWarning).toBe(false);
      expect(status.isExceeded).toBe(false);
      expect(status.remainingRequests).toBe(9);
    });

    it('flags warning when quota reaches 80%', async () => {
      // 8 requests out of 10
      for (let i = 0; i < 8; i++) {
        await tracker.recordUsage({ providerId: 'prov-gemini' });
      }

      const status = tracker.checkQuotaStatus('prov-gemini', { rpdLimit: 10 });
      expect(status.percentUsed).toBe(80);
      expect(status.isWarning).toBe(true);
      expect(status.isExceeded).toBe(false);
    });

    it('flags exceeded when quota reaches 100%', async () => {
      for (let i = 0; i < 10; i++) {
        await tracker.recordUsage({ providerId: 'prov-groq' });
      }

      const status = tracker.checkQuotaStatus('prov-groq', { rpdLimit: 10 });
      expect(status.percentUsed).toBe(100);
      expect(status.isWarning).toBe(true);
      expect(status.isExceeded).toBe(true);
      expect(status.remainingRequests).toBe(0);
    });
  });

  describe('DailyDemandPlanner', () => {
    let planner: DailyDemandPlanner;

    beforeEach(() => {
      planner = new DailyDemandPlanner();
    });

    it('evaluates healthy capacity when quotas comfortably exceed demand', () => {
      const pages: PageDemandInput[] = [
        {
          pageId: 'page-1',
          pageName: 'Science Page',
          postsPerDay: 5,
          captionLengthPreset: 'standard', // 800 tokens * 5 = 4,000 tokens
        },
      ];

      const capacities: ProviderCapacityInput[] = [
        {
          providerId: 'prov-gemini',
          name: 'Gemini',
          kind: 'text',
          remainingRequests: 500,
        },
        {
          providerId: 'prov-flux',
          name: 'Pollinations',
          kind: 'image',
          remainingRequests: 50,
        },
      ];

      const result = planner.evaluateDailyDemand(pages, capacities);

      expect(result.estimatedPostsToday).toBe(5);
      expect(result.estimatedImagesToday).toBe(6); // 5 * 1.2 = 6
      expect(result.estimatedTokensToday).toBe(4000);
      expect(result.status).toBe('healthy');
      expect(result.shouldThrottle).toBe(false);
      expect(result.warnings.length).toBe(0);
      expect(result.suggestedSlotGapMinutes).toBe(120);
    });

    it('triggers throttled status when demand exceeds available provider capacity', () => {
      const pages: PageDemandInput[] = [
        {
          pageId: 'page-1',
          pageName: 'Horror Stories Page',
          postsPerDay: 10,
          captionLengthPreset: 'epic', // 7,500 tokens * 10 = 75,000 tokens
        },
      ];

      const capacities: ProviderCapacityInput[] = [
        {
          providerId: 'prov-groq',
          name: 'Groq',
          kind: 'text',
          remainingRequests: 10, // Need 10 * 3 = 30 requests -> insufficient!
        },
        {
          providerId: 'prov-cf',
          name: 'Cloudflare FLUX',
          kind: 'image',
          remainingRequests: 5, // Need 12 images -> insufficient!
        },
      ];

      const result = planner.evaluateDailyDemand(pages, capacities);

      expect(result.estimatedPostsToday).toBe(10);
      expect(result.estimatedTokensToday).toBe(75000);
      expect(result.status).toBe('throttled');
      expect(result.shouldThrottle).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.suggestedSlotGapMinutes).toBe(240); // 4-hour delay
    });

    it('flags tight capacity when remaining budget is close to daily demand', () => {
      const pages: PageDemandInput[] = [
        {
          pageId: 'page-1',
          pageName: 'Vintage Cars',
          postsPerDay: 4,
          captionLengthPreset: 'short',
        },
      ];

      const capacities: ProviderCapacityInput[] = [
        {
          providerId: 'prov-text',
          name: 'Text Prov',
          kind: 'text',
          remainingRequests: 13, // 4 * 3 = 12 needed; 13 < 12 * 1.25 = 15
        },
        {
          providerId: 'prov-img',
          name: 'Img Prov',
          kind: 'image',
          remainingRequests: 10, // 4 * 1.2 = 5 needed
        },
      ];

      const result = planner.evaluateDailyDemand(pages, capacities);
      expect(result.status).toBe('tight');
      expect(result.shouldThrottle).toBe(false);
      expect(result.suggestedSlotGapMinutes).toBe(180);
    });
  });
});

