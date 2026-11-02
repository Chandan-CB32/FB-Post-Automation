import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FacebookGraphClient,
  FacebookPublisher,
  validateSchedulingWindow,
  computePostContentHash,
  encryptPageToken,
} from '../packages/core/src/index.js';
import { executePublishStage } from '../worker/src/stages/07-post.js';

describe('Facebook Photo Scheduling & Publishing Engine (Step 9.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('Scheduling Window Validation (validateSchedulingWindow)', () => {
    const fixedNow = new Date('2026-11-02T12:00:00Z').getTime();

    it('accepts scheduled time within the valid 10 min to 30 days window', () => {
      // 2 hours in future
      const scheduledTime = new Date('2026-11-02T14:00:00Z');
      const result = validateSchedulingWindow(scheduledTime, fixedNow);

      expect(result.valid).toBe(true);
      expect(result.scheduledTimeSeconds).toBe(Math.floor(scheduledTime.getTime() / 1000));
      expect(result.error).toBeUndefined();
    });

    it('rejects scheduled time less than 10 minutes in the future', () => {
      // 5 minutes in future
      const scheduledTime = new Date('2026-11-02T12:05:00Z');
      const result = validateSchedulingWindow(scheduledTime, fixedNow);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be at least 10 minutes in the future');
    });

    it('rejects past scheduled time', () => {
      const pastTime = new Date('2026-11-02T11:00:00Z');
      const result = validateSchedulingWindow(pastTime, fixedNow);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be at least 10 minutes in the future');
    });

    it('rejects scheduled time more than 30 days in the future', () => {
      // 35 days in future
      const scheduledTime = new Date('2026-12-08T12:00:00Z');
      const result = validateSchedulingWindow(scheduledTime, fixedNow);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be more than 30 days in the future');
    });
  });

  describe('Content Hash Generation (computePostContentHash)', () => {
    it('produces identical deterministic hash for same content and phash', () => {
      const caption = 'A deep look into the Carina Nebula\n#space #astronomy';
      const phash = '0123456789abcdef';

      const hash1 = computePostContentHash(caption, phash);
      const hash2 = computePostContentHash(caption, phash);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hash for modified caption or phash', () => {
      const hashA = computePostContentHash('Caption A', '0123456789abcdef');
      const hashB = computePostContentHash('Caption B', '0123456789abcdef');
      const hashC = computePostContentHash('Caption A', 'fedcba9876543210');

      expect(hashA).not.toBe(hashB);
      expect(hashA).not.toBe(hashC);
    });
  });

  describe('FacebookPublisher Workflows', () => {
    it('executes two-step scheduled photo post: upload unpublished photo then schedule feed', async () => {
      const mockCalls: { url: string; body: any }[] = [];

      const mockFetch = vi.fn().mockImplementation((url: string, init: any) => {
        mockCalls.push({ url, body: init.body });
        if (url.includes('/photos')) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'photo_99999' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        if (url.includes('/feed')) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'page_123_post_88888' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const publisher = new FacebookPublisher(client);

      const fakeImageBuffer = Buffer.from('fake image binary content');
      const futureDate = new Date(Date.now() + 3600 * 1000 * 2); // 2 hours in future

      const result = await publisher.publishFeedPost('page_123', 'fake_page_token', {
        message: 'Fascinating discovery in deep space!',
        photo: { buffer: fakeImageBuffer, filename: 'space.jpg' },
        scheduledPublishTime: futureDate,
      });

      expect(result.postId).toBe('page_123_post_88888');
      expect(result.photoId).toBe('photo_99999');
      expect(result.isScheduled).toBe(true);
      expect(result.permalinkUrl).toContain('facebook.com');

      expect(mockCalls).toHaveLength(2);
      expect(mockCalls[0].url).toContain('page_123/photos');
      expect(mockCalls[1].url).toContain('page_123/feed');

      const feedBody = JSON.parse(mockCalls[1].body);
      expect(feedBody.published).toBe(false);
      expect(feedBody.scheduled_publish_time).toBeGreaterThan(0);
      expect(feedBody.attached_media).toEqual([{ media_fbid: 'photo_99999' }]);
    });

    it('publishes immediately when published: true is specified', async () => {
      const mockCalls: { url: string; body: any }[] = [];

      const mockFetch = vi.fn().mockImplementation((url: string, init: any) => {
        mockCalls.push({ url, body: init.body });
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'post_immediate_123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const publisher = new FacebookPublisher(client);

      const result = await publisher.publishFeedPost('page_123', 'fake_page_token', {
        message: 'Breaking science update!',
        published: true,
      });

      expect(result.postId).toBe('post_immediate_123');
      expect(result.isScheduled).toBe(false);

      const feedBody = JSON.parse(mockCalls[0].body);
      expect(feedBody.published).toBe(true);
      expect(feedBody.scheduled_publish_time).toBeUndefined();
    });

    it('supports rescheduling and deleting posts', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string, init: any) => {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      const client = new FacebookGraphClient({ fetchFn: mockFetch });
      const publisher = new FacebookPublisher(client);

      // Reschedule
      const futureDate = new Date(Date.now() + 3600 * 1000 * 4); // 4 hours in future
      const rescheduleRes = await publisher.reschedulePost('post_123', 'token', futureDate);
      expect(rescheduleRes).toBe(true);

      // Delete
      const deleteRes = await publisher.deletePost('post_123', 'token');
      expect(deleteRes).toBe(true);
    });
  });

  describe('Worker Stage 7 Integration (executePublishStage)', () => {
    it('holds for review when mustHoldForReview is true even under auto publishing mode', async () => {
      const mockPublisher = {
        publishFeedPost: vi.fn(),
      } as any;

      const result = await executePublishStage({
        pageId: 'page_100',
        pageToken: 'raw_token',
        caption: 'Dark psychological horror story',
        publishingMode: 'auto',
        mustHoldForReview: true,
        publisher: mockPublisher,
      });

      expect(result.action).toBe('held_for_review');
      expect(result.status).toBe('pending_review');
      expect(result.holdReason).toContain('Mandatory hold');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();
    });

    it('holds for review when sensitive flags are present', async () => {
      const mockPublisher = {
        publishFeedPost: vi.fn(),
      } as any;

      const result = await executePublishStage({
        pageId: 'page_100',
        pageToken: 'raw_token',
        caption: 'Story with graphic violence',
        publishingMode: 'auto',
        sensitiveFlags: ['gore_violence'],
        publisher: mockPublisher,
      });

      expect(result.action).toBe('held_for_review');
      expect(result.status).toBe('pending_review');
      expect(result.holdReason).toContain('gore_violence');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();
    });

    it('holds for review when publishingMode is review', async () => {
      const mockPublisher = {
        publishFeedPost: vi.fn(),
      } as any;

      const result = await executePublishStage({
        pageId: 'page_100',
        pageToken: 'raw_token',
        caption: 'Clean science article',
        publishingMode: 'review',
        qaScore: 95,
        publisher: mockPublisher,
      });

      expect(result.action).toBe('held_for_review');
      expect(result.status).toBe('pending_review');
      expect(result.holdReason).toContain('manual review');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();
    });

    it('holds in hybrid mode when qaScore is below hybrid threshold', async () => {
      const mockPublisher = {
        publishFeedPost: vi.fn(),
      } as any;

      const result = await executePublishStage({
        pageId: 'page_100',
        pageToken: 'raw_token',
        caption: 'Average quality post',
        publishingMode: 'hybrid',
        qaScore: 74,
        hybridMinScore: 80,
        publisher: mockPublisher,
      });

      expect(result.action).toBe('held_for_review');
      expect(result.status).toBe('pending_review');
      expect(result.holdReason).toContain('below required threshold');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();
    });

    it('publishes/schedules in hybrid mode when score meets threshold and decrypts token', async () => {
      const rawToken = 'EAABvalidToken12345';
      const encryptedToken = encryptPageToken(rawToken);

      const mockPublisher = {
        publishFeedPost: vi.fn().mockResolvedValue({
          postId: 'page_100_post_555',
          photoId: 'photo_777',
          scheduledPublishTime: 1700000000,
          isScheduled: true,
          permalinkUrl: 'https://www.facebook.com/page_100/posts/555',
        }),
      } as any;

      const futureDate = new Date(Date.now() + 7200 * 1000);

      const result = await executePublishStage({
        pageId: 'page_100',
        pageToken: encryptedToken,
        caption: 'Super high quality astronomy post',
        imageBuffer: Buffer.from('jpeg image data'),
        imagePhash: 'abcdef0123456789',
        publishingMode: 'hybrid',
        qaScore: 92,
        hybridMinScore: 80,
        scheduledFor: futureDate,
        publisher: mockPublisher,
      });

      expect(result.action).toBe('scheduled');
      expect(result.status).toBe('scheduled_on_fb');
      expect(result.fbPostId).toBe('page_100_post_555');
      expect(result.fbPhotoId).toBe('photo_777');
      expect(mockPublisher.publishFeedPost).toHaveBeenCalledTimes(1);

      // Verify decrypted token was passed to publisher
      const [calledPageId, calledToken] = mockPublisher.publishFeedPost.mock.calls[0];
      expect(calledPageId).toBe('page_100');
      expect(calledToken).toBe(rawToken);
    });
  });
});

