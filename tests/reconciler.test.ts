import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateNextRetry,
  isRetryablePublishError,
  reconcileSinglePost,
  reconcileScheduledPosts,
  ReconciliationPostItem,
} from '../worker/src/schedulers/reconciler.js';
import { FacebookGraphError, encryptPageToken } from '../packages/core/src/index.js';

process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Publishing Status Reconciliation & Failure Retries (Step 9.3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('Retry Backoff Calculator (calculateNextRetry)', () => {
    it('calculates exponential delay based on attempts', () => {
      const retry0 = calculateNextRetry(0, { baseDelayMs: 60000, backoffFactor: 2 });
      expect(retry0.nextAttempt).toBe(1);
      expect(retry0.delayMs).toBe(60000); // 1 min
      expect(retry0.isExhausted).toBe(false);

      const retry1 = calculateNextRetry(1, { baseDelayMs: 60000, backoffFactor: 2 });
      expect(retry1.nextAttempt).toBe(2);
      expect(retry1.delayMs).toBe(120000); // 2 min

      const retry2 = calculateNextRetry(2, { baseDelayMs: 60000, backoffFactor: 2 });
      expect(retry2.nextAttempt).toBe(3);
      expect(retry2.delayMs).toBe(240000); // 4 min
    });

    it('caps delay at maxDelayMs', () => {
      const retry = calculateNextRetry(10, {
        baseDelayMs: 60000,
        maxDelayMs: 300000, // 5 min max
        maxAttempts: 15,
      });
      expect(retry.delayMs).toBe(300000);
      expect(retry.isExhausted).toBe(false);
    });

    it('marks retry as exhausted when maxAttempts is reached', () => {
      const retry = calculateNextRetry(5, { maxAttempts: 5 });
      expect(retry.nextAttempt).toBe(6);
      expect(retry.isExhausted).toBe(true);
      expect(retry.nextRetryAt).toBeNull();
    });
  });

  describe('Retryable Error Classifier (isRetryablePublishError)', () => {
    it('treats network timeouts and server 5xx as retryable', () => {
      const networkErr = new Error('connect ETIMEDOUT');
      expect(isRetryablePublishError(networkErr)).toBe(true);

      const fbServerErr = new FacebookGraphError({ code: 2, message: 'Unexpected server error', type: 'OAuthException' }, 500);
      expect(isRetryablePublishError(fbServerErr)).toBe(true);

      const rateLimitErr = new FacebookGraphError({ code: 4, message: 'Request limit reached', type: 'OAuthException' }, 403);
      expect(isRetryablePublishError(rateLimitErr)).toBe(true);
    });

    it('treats authentication and permission errors as non-retryable', () => {
      const authErr = new FacebookGraphError({ code: 190, message: 'Access token expired', type: 'OAuthException' }, 400);
      expect(isRetryablePublishError(authErr)).toBe(false);

      const permErr = new FacebookGraphError({ code: 200, message: 'Requires pages_manage_posts', type: 'OAuthException' }, 403);
      expect(isRetryablePublishError(permErr)).toBe(false);

      const code100Err = new FacebookGraphError({ code: 100, message: 'Object does not exist', type: 'OAuthException' }, 400);
      expect(isRetryablePublishError(code100Err)).toBe(false);
    });
  });

  describe('Single Post Status Reconciler (reconcileSinglePost)', () => {
    const samplePost: ReconciliationPostItem = {
      id: 'post_uuid_100',
      page_id: 'page_uuid_200',
      topic_key: 'james_webb_exoplanet',
      topic_title: 'Webb Detects Atmospheric Methane',
      category: 'Space Exploration',
      fb_post_id: 'page_200_post_300',
      status: 'scheduled_on_fb',
      scheduled_for: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour ago
      page_token: encryptPageToken('EAABvalidSecretToken'),
    };

    it('reconciles published post when Facebook reports is_published: true', async () => {
      const mockPublisher = {
        getPostDetails: vi.fn().mockResolvedValue({
          id: 'page_200_post_300',
          isPublished: true,
          permalinkUrl: 'https://www.facebook.com/page_200/posts/300',
        }),
      } as any;

      const result = await reconcileSinglePost(samplePost, mockPublisher);

      expect(result.action).toBe('published');
      expect(result.newStatus).toBe('published');
      expect(result.permalinkUrl).toBe('https://www.facebook.com/page_200/posts/300');
      expect(result.publishedAt).toBeDefined();
      expect(mockPublisher.getPostDetails).toHaveBeenCalledWith('page_200_post_300', 'EAABvalidSecretToken');
    });

    it('keeps status scheduled_on_fb when Facebook reports post is still scheduled', async () => {
      const mockPublisher = {
        getPostDetails: vi.fn().mockResolvedValue({
          id: 'page_200_post_300',
          isPublished: false,
        }),
      } as any;

      const result = await reconcileSinglePost(samplePost, mockPublisher);

      expect(result.action).toBe('still_scheduled');
      expect(result.newStatus).toBe('scheduled_on_fb');
      expect(result.isOverdueWarning).toBe(false);
    });

    it('flags overdue warning when post is more than 3 hours overdue without publishing', async () => {
      const overduePost: ReconciliationPostItem = {
        ...samplePost,
        scheduled_for: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), // 4 hours ago
      };

      const mockPublisher = {
        getPostDetails: vi.fn().mockResolvedValue({
          id: 'page_200_post_300',
          isPublished: false,
        }),
      } as any;

      const result = await reconcileSinglePost(overduePost, mockPublisher);

      expect(result.action).toBe('still_scheduled');
      expect(result.isOverdueWarning).toBe(true);
      expect(result.error).toContain('hours overdue');
    });

    it('marks post as failed when Facebook reports it was deleted (Code 100 / does not exist)', async () => {
      const mockPublisher = {
        getPostDetails: vi.fn().mockRejectedValue(
          new FacebookGraphError(
            {
              code: 100,
              message: 'Unsupported get request. Object with ID page_200_post_300 does not exist.',
              type: 'GraphMethodException',
            },
            400
          )
        ),
      } as any;

      const result = await reconcileSinglePost(samplePost, mockPublisher);

      expect(result.action).toBe('failed');
      expect(result.newStatus).toBe('failed');
      expect(result.error).toContain('deleted or removed');
    });

    it('handles expired token cleanly with error status', async () => {
      const mockPublisher = {
        getPostDetails: vi.fn().mockRejectedValue(
          new FacebookGraphError(
            {
              code: 190,
              message: 'Error validating access token: Session expired.',
              type: 'OAuthException',
            },
            400
          )
        ),
      } as any;

      const result = await reconcileSinglePost(samplePost, mockPublisher);

      expect(result.action).toBe('error');
      expect(result.error).toContain('token expired or revoked');
    });
  });

  describe('Batch Scheduled Posts Reconciler (reconcileScheduledPosts)', () => {
    it('processes scheduled posts, updates posts table, and inserts topic_history', async () => {
      const mockPosts = [
        {
          id: 'post_1',
          page_id: 'page_10',
          topic_key: 'quantum_computing',
          topic_title: 'Quantum Supremacy Milestone',
          category: 'Physics',
          fb_post_id: 'fb_post_100',
          status: 'scheduled_on_fb',
          scheduled_for: new Date(Date.now() - 1800 * 1000).toISOString(),
          pages: {
            fb_page_token: 'raw_test_token',
          },
        },
      ];

      const updateCalls: { table: string; data: any; match: any }[] = [];
      const insertCalls: { table: string; data: any }[] = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'posts') {
            return {
              select: () => ({
                eq: () => ({
                  not: () => ({
                    lte: () => ({
                      limit: () => Promise.resolve({ data: mockPosts, error: null }),
                    }),
                  }),
                }),
              }),
              update: (data: any) => ({
                eq: (col: string, val: any) => {
                  updateCalls.push({ table: 'posts', data, match: { [col]: val } });
                  return Promise.resolve({ error: null });
                },
              }),
            };
          }
          if (table === 'topic_history') {
            return {
              insert: (data: any) => {
                insertCalls.push({ table: 'topic_history', data });
                return Promise.resolve({ error: null });
              },
            };
          }
          return {};
        },
      };

      const mockPublisher = {
        getPostDetails: vi.fn().mockResolvedValue({
          id: 'fb_post_100',
          isPublished: true,
          permalinkUrl: 'https://facebook.com/page_10/posts/100',
        }),
      } as any;

      const summary = await reconcileScheduledPosts(mockSupabase, {
        publisher: mockPublisher,
      });

      expect(summary.processedCount).toBe(1);
      expect(summary.publishedCount).toBe(1);
      expect(summary.failedCount).toBe(0);

      // Verify posts update
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].data.status).toBe('published');
      expect(updateCalls[0].data.fb_permalink).toBe('https://facebook.com/page_10/posts/100');

      // Verify topic history insert for 90-day deduplication
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0].data.topic_key).toBe('quantum_computing');
      expect(insertCalls[0].data.title).toBe('Quantum Supremacy Milestone');
      expect(insertCalls[0].data.page_id).toBe('page_10');
    });
  });
});
