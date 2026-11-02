import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateNextSlots,
  enforceDailyCap,
  planMissingSlots,
} from '../worker/src/schedulers/slot-planner.js';
import {
  approveReviewPost,
  rejectReviewPost,
  editReviewPost,
  evaluateAutoApproveEligiblePosts,
  formatSeriesStorySoFar,
  buildSeriesPromptContext,
  updateSeriesMemory,
} from '../packages/core/src/index.js';

describe('Orchestration, Slot Planning & Review Inbox (Milestone 10)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('Slot Planner & Schedule Engine (Step 10.1)', () => {
    const fixedNow = new Date('2026-11-02T08:00:00Z'); // 08:00 UTC Monday

    it('generates upcoming slots at configured daily posting times', () => {
      const slots = calculateNextSlots(
        {
          postingTimes: ['10:00', '15:00', '20:00'],
          minGapMinutes: 180,
          dailyCap: 3,
        },
        fixedNow,
        5
      );

      expect(slots).toHaveLength(5);
      // First slot should be today at 10:00 UTC
      expect(slots[0].toISOString()).toBe('2026-11-02T10:00:00.000Z');
      expect(slots[1].toISOString()).toBe('2026-11-02T15:00:00.000Z');
      expect(slots[2].toISOString()).toBe('2026-11-02T20:00:00.000Z');
      // Fourth slot should be tomorrow at 10:00 UTC
      expect(slots[3].toISOString()).toBe('2026-11-03T10:00:00.000Z');
    });

    it('skips inactive days of the week', () => {
      // 2026-11-02 is Monday (day 1). Restrict activeDays to Wednesday (3) and Friday (5).
      const slots = calculateNextSlots(
        {
          postingTimes: ['12:00'],
          activeDays: [3, 5],
          dailyCap: 1,
        },
        fixedNow,
        2
      );

      expect(slots).toHaveLength(2);
      expect(slots[0].getUTCDay()).toBe(3); // Wednesday
      expect(slots[1].getUTCDay()).toBe(5); // Friday
    });

    it('enforces maximum dailyCap per calendar day', () => {
      const excessiveSlots = [
        new Date('2026-11-02T09:00:00Z'),
        new Date('2026-11-02T12:00:00Z'),
        new Date('2026-11-02T15:00:00Z'),
        new Date('2026-11-02T18:00:00Z'),
        new Date('2026-11-02T21:00:00Z'),
        new Date('2026-11-02T23:00:00Z'), // 6th slot on same day
      ];

      const capped = enforceDailyCap(excessiveSlots, 4);
      expect(capped).toHaveLength(4);
    });

    it('identifies unfulfilled post slots within the lead-time window', () => {
      const existing = [
        new Date('2026-11-02T10:00:00Z'), // Already covered
      ];

      const missing = planMissingSlots(
        existing,
        {
          postingTimes: ['10:00', '16:00'],
          leadTimeHours: 24,
        },
        24,
        fixedNow
      );

      // Should identify 16:00 today and tomorrow's 10:00 as missing
      expect(missing.length).toBeGreaterThanOrEqual(1);
      expect(missing.some((d) => d.toISOString().includes('16:00:00'))).toBe(true);
      expect(missing.some((d) => d.toISOString() === '2026-11-02T10:00:00.000Z')).toBe(false);
    });
  });

  describe('Review Inbox State Machine (Step 10.2)', () => {
    const samplePost = {
      id: 'post_1',
      page_id: 'page_1',
      status: 'pending_review',
      review_state: 'pending' as const,
      title: 'Ancient Deep Sea Creature',
      headline: 'SCIENTISTS DISCOVER 500-YEAR-OLD SHARK',
      caption: 'A Greenland shark swimming slowly in icy waters.\n#ocean #science',
      scheduled_for: new Date(Date.now() + 86400 * 1000).toISOString(), // tomorrow
      created_at: new Date(Date.now() - 3600 * 1000 * 14).toISOString(), // 14 hours ago
      image_phash: '0123456789abcdef',
    };

    it('approves post and transitions status to ready', () => {
      const result = approveReviewPost(samplePost);
      expect(result.action).toBe('approved');
      expect(result.post.review_state).toBe('approved');
      expect(result.post.status).toBe('ready');
      expect(result.wasRescheduled).toBe(false);
    });

    it('reschedules approved post forward if scheduled time is in past', () => {
      const pastPost = {
        ...samplePost,
        scheduled_for: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour ago
      };

      const result = approveReviewPost(pastPost);
      expect(result.wasRescheduled).toBe(true);
      expect(new Date(result.scheduledFor).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects post and marks status as skipped with review note', () => {
      const rejected = rejectReviewPost(samplePost, 'Visual quality subpar');
      expect(rejected.review_state).toBe('rejected');
      expect(rejected.status).toBe('skipped');
      expect(rejected.review_note).toBe('Visual quality subpar');
    });

    it('edits post and recalculates word count and content hash', () => {
      const originalHash = samplePost.image_phash;
      const edited = editReviewPost(samplePost, {
        caption: 'An updated exciting caption with eight distinct words.',
        title: 'New Title',
      });

      expect(edited.title).toBe('New Title');
      expect(edited.caption_word_count).toBe(8);
      expect(edited.content_hash).toBeDefined();
    });

    it('identifies eligible posts for auto-approval after N hours', () => {
      const eligible = evaluateAutoApproveEligiblePosts([samplePost], 12);
      expect(eligible).toHaveLength(1);

      const notYetEligible = evaluateAutoApproveEligiblePosts([samplePost], 24);
      expect(notYetEligible).toHaveLength(0);
    });
  });

  describe('Series Continuity Engine & Story Memory (Step 10.3)', () => {
    const series = {
      id: 'series_1',
      page_id: 'page_1',
      name: 'The Lighthouse of Blackwood Bay',
      premise: 'A keeper encounters supernatural maritime occurrences on a forgotten island.',
      total_episodes: 5,
      current_episode_number: 2,
      status: 'active' as const,
      visual_bible: 'Eerie ocean fog, 19th-century oil lamps, dark moody maritime lighting.',
    };

    const episodes = [
      {
        series_id: 'series_1',
        episode_number: 1,
        title: 'Arrival at the Reef',
        summary: 'Keeper Thomas arrives on Blackwood rock as storm clouds gather.',
        cliffhanger: 'A strange green glow flickers deep beneath the waves.',
      },
      {
        series_id: 'series_1',
        episode_number: 2,
        title: 'Whispers in the Lantern Room',
        summary: 'The main beacon light fails and footsteps echo on the iron stairs.',
        cliffhanger: 'The door to the locked cellar clicks open.',
      },
    ];

    it('formats running story-so-far summary chronologically', () => {
      const summary = formatSeriesStorySoFar(episodes);
      expect(summary).toContain('Episode 1: "Arrival at the Reef"');
      expect(summary).toContain('Episode 2: "Whispers in the Lantern Room"');
      expect(summary).toContain('green glow');
      expect(summary).toContain('locked cellar');
    });

    it('builds series prompt context for the next episode', () => {
      const context = buildSeriesPromptContext(series, episodes);
      expect(context.series_name).toBe('The Lighthouse of Blackwood Bay');
      expect(context.episode_number).toBe(3);
      expect(context.total_episodes).toBe(5);
      expect(context.is_finale).toBe(false);
      expect(context.previous_cliffhanger).toContain('locked cellar clicks open');
      expect(context.series_bible).toContain('Eerie ocean fog');
    });

    it('identifies series finale episode correctly', () => {
      const finaleSeries = { ...series, current_episode_number: 4 };
      const context = buildSeriesPromptContext(finaleSeries, episodes);
      expect(context.episode_number).toBe(5);
      expect(context.is_finale).toBe(true);
    });

    it('updates series memory after completing an episode', () => {
      const updated = updateSeriesMemory(series, {
        episode_number: 3,
        title: 'The Drowned Bell',
        summary: 'Thomas discovers an ancient brass bell.',
      });

      expect(updated.nextEpisodeNumber).toBe(3);
      expect(updated.isCompleted).toBe(false);

      const finalEp = updateSeriesMemory(series, {
        episode_number: 5,
        title: 'Dawn Over Blackwood',
        summary: 'The sun rises over the quiet bay.',
      });
      expect(finalEp.isCompleted).toBe(true);
    });
  });
});
