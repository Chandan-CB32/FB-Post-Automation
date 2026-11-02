import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDashboardOverviewMetrics,
  handlePromptStudioPreview,
  handleBatchApproveReviewPosts,
  handleRejectReviewPost,
  handleEditReviewPost,
  formatPageViewModel,
  formatReviewCard,
  formatProviderViewModel,
  DASHBOARD_NAV_ITEMS,
} from '../apps/web/src/index.js';

describe('Web Dashboard & UI Views (Milestone 11)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('Overview View & Metrics (Step 11.1)', () => {
    it('computes live status counts and healthy worker badge', () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 60 * 1000).toISOString(); // 1 min ago

      const metrics = getDashboardOverviewMetrics({
        lastHeartbeat: recentHeartbeat,
        killSwitchActive: false,
        pages: [{ id: 'p1' }, { id: 'p2' }],
        posts: [
          { status: 'planned' },
          { status: 'pending_review' },
          { status: 'scheduled_on_fb' },
          { status: 'published' },
        ],
        providerDailyUsage: [
          { provider_id: 'gemini', requests_count: 50, daily_limit: 100 },
        ],
      });

      expect(metrics.workerStatus).toBe('healthy');
      expect(metrics.killSwitchActive).toBe(false);
      expect(metrics.pagesCount).toBe(2);
      expect(metrics.postCounts.planned).toBe(1);
      expect(metrics.postCounts.pendingReview).toBe(1);
      expect(metrics.postCounts.scheduled).toBe(1);
      expect(metrics.postCounts.published).toBe(1);
      expect(metrics.providerQuotas[0].percentUsed).toBe(50);
    });

    it('reports worker as paused when kill switch is active', () => {
      const metrics = getDashboardOverviewMetrics({
        killSwitchActive: true,
      });
      expect(metrics.workerStatus).toBe('paused');
    });

    it('reports worker as stale when last heartbeat was >5 min ago', () => {
      const oldHeartbeat = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const metrics = getDashboardOverviewMetrics({
        lastHeartbeat: oldHeartbeat,
      });
      expect(metrics.workerStatus).toBe('stale');
    });

    it('has all required navigation routes', () => {
      const routeIds = DASHBOARD_NAV_ITEMS.map((item) => item.id);
      expect(routeIds).toContain('overview');
      expect(routeIds).toContain('pages');
      expect(routeIds).toContain('profiles');
      expect(routeIds).toContain('review');
      expect(routeIds).toContain('calendar');
      expect(routeIds).toContain('providers');
      expect(routeIds).toContain('settings');
    });
  });

  describe('Pages View & Effective Settings Viewer (Step 11.2)', () => {
    it('formats PageViewModel with schedule summary', () => {
      const page = {
        id: 'page_1',
        name: 'Space Explorers',
        fb_page_id: '123456789',
        token_status: 'valid',
        publishing_mode: 'hybrid',
        hybrid_min_score: 85,
        daily_cap: 3,
        active: true,
        profile_id: 'prof_space',
        schedule: {
          postsPerDay: 3,
          postingTimes: ['09:00', '15:00', '21:00'],
          timezone: 'America/New_York',
        },
      };

      const viewModel = formatPageViewModel(page, 'Science & Space');
      expect(viewModel.name).toBe('Space Explorers');
      expect(viewModel.publishingMode).toBe('hybrid');
      expect(viewModel.hybridMinScore).toBe(85);
      expect(viewModel.scheduleSummary).toContain('3 posts/day');
      expect(viewModel.scheduleSummary).toContain('America/New_York');
      expect(viewModel.linkedProfileName).toBe('Science & Space');
    });

    it('resolves effective prompt settings for Prompt Studio preview', () => {
      const preview = handlePromptStudioPreview({
        profile: {
          captionSettings: { min: 100, max: 300 },
        },
        page: {
          overrides: {
            'caption.target': 200,
          },
        },
      });

      expect(preview.effectiveSettings.caption.min).toBe(100);
      expect(preview.effectiveSettings.caption.target).toBe(200);
      expect(preview.provenance['caption.target'].source).toBe('page');
    });
  });

  describe('Review Inbox View & Actions (Step 11.3)', () => {
    const post = {
      id: 'post_100',
      page_id: 'page_1',
      title: 'Voyager Interstellar Mission',
      headline: 'VOYAGER SENDS NEW DATA FROM INTERSTELLAR SPACE',
      caption: 'The Voyager probe is still active after 47 years.\n#voyager #space',
      scheduled_for: new Date(Date.now() + 86400 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      qa_score: 92,
      review_state: 'pending' as const,
      status: 'pending_review',
    };

    it('formats ReviewCardViewModel with QA score badge', () => {
      const card = formatReviewCard(post, 'Astronomy Daily');
      expect(card.postId).toBe('post_100');
      expect(card.pageName).toBe('Astronomy Daily');
      expect(card.qaScore).toBe(92);
      expect(card.caption).toContain('Voyager');
    });

    it('handles batch approve review posts', () => {
      const batchResult = handleBatchApproveReviewPosts([post]);
      expect(batchResult.approvedCount).toBe(1);
      expect(batchResult.results[0].post.review_state).toBe('approved');
      expect(batchResult.results[0].post.status).toBe('ready');
    });

    it('handles reject review post', () => {
      const rejected = handleRejectReviewPost(post, 'Off topic for page');
      expect(rejected.review_state).toBe('rejected');
      expect(rejected.status).toBe('skipped');
    });

    it('handles edit review post and updates caption', () => {
      const edited = handleEditReviewPost(post, {
        caption: 'Updated new caption text with seven words.',
      });
      expect(edited.caption_word_count).toBe(7);
      expect(edited.content_hash).toBeDefined();
    });
  });

  describe('Providers, Keys & Bench UI (Step 11.4)', () => {
    it('formats provider view model with masked keys', () => {
      const provider = {
        id: 'openai_main',
        name: 'OpenAI GPT-4o',
        adapter_kind: 'openai_compatible_chat',
        enabled: true,
        daily_limit: 1000,
        used_today: 400,
      };

      const keys = [
        {
          provider_id: 'openai_main',
          key_value: 'sk-proj-1234567890abcdefghijklmn',
          is_active: true,
        },
      ];

      const viewModel = formatProviderViewModel(provider, keys);
      expect(viewModel.name).toBe('OpenAI GPT-4o');
      expect(viewModel.keyCount).toBe(1);
      expect(viewModel.maskedKeys[0]).toMatch(/^sk-...klmn$/);
      expect(viewModel.quotaPercentUsed).toBe(40);
    });
  });
});
