import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  encrypt,
  decrypt,
  maskSecret,
  isPrivateOrBlockedIP,
  resolveSettings,
  createScienceStoryProfile,
  validateCaption,
  computePostContentHash,
  FacebookPublisher,
  validateSchedulingWindow,
} from '../packages/core/src/index.js';
import {
  evaluateStorageCapacity,
  identifyImagesToPrune,
  executeRetentionPrune,
} from '../worker/src/schedulers/retention-cleaner.js';
import { composePostImage } from '../worker/src/image/compositor.js';
import { validateImageBuffer } from '../worker/src/image/image-qa.js';
import { executePublishStage } from '../worker/src/stages/07-post.js';

describe('Final End-to-End Acceptance Test Suite (Milestone 12 & PRD Section 21)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('Criterion 1: Cryptographic Security & SSRF Protection', () => {
    it('encrypts and decrypts secrets with AES-256-GCM and masks keys in logs', () => {
      const rawSecret = 'EAABcdef1234567890abcdefghijklmnopqrstuvwxyz';
      const encrypted = encrypt(rawSecret);

      expect(encrypted).not.toBe(rawSecret);
      expect(encrypted.split(':')).toHaveLength(3);
      expect(decrypt(encrypted)).toBe(rawSecret);

      const masked = maskSecret(rawSecret, 6, 4);
      expect(masked).toBe('EAABcd...wxyz');
    });

    it('blocks SSRF attempts on internal, loopback, and metadata IP addresses', () => {
      expect(isPrivateOrBlockedIP('127.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('169.254.169.254')).toBe(true);
      expect(isPrivateOrBlockedIP('10.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('192.168.1.1')).toBe(true);
      expect(isPrivateOrBlockedIP('8.8.8.8')).toBe(false);
    });
  });

  describe('Criterion 2: Multi-Tier Inheritance & Content Safety Baseline', () => {
    it('resolves settings across Global -> Profile -> Page hierarchy with audit provenance', () => {
      const profile = createScienceStoryProfile();
      const resolved = resolveSettings({
        profile: {
          ...profile,
          captionSettings: {
            min: 150,
            target: 200,
            max: 300,
          },
        },
        page: {
          overrides: {
            'caption.target': 250,
          },
        },
      });

      expect(resolved.caption.min).toBe(150);
      expect(resolved.caption.target).toBe(250);
      expect(resolved.provenance['caption.target'].source).toBe('page');
      expect(resolved.provenance['caption.min'].source).toBe('profile');
    });
  });

  describe('Criterion 3: Deterministic Caption Validation & Repair', () => {
    it('validates word count, paragraph structure, and content rules', () => {
      const text =
        'The James Webb Space Telescope has discovered signs of water vapor in the atmosphere of a rocky exoplanet orbiting a distant red dwarf star.\n\n' +
        'This observation offers astronomers unprecedented insights into planetary evolution across the cosmos.\n\n' +
        'What secrets do you think lie hidden in these alien skies?';

      const validation = validateCaption(text, {
        unit: 'words',
        min: 20,
        target: 40,
        max: 80,
        hookRule: false,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'informative',
          pov: 'third-person',
          emojiPolicy: 'none',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: false,
      });

      expect(validation.valid).toBe(true);
      expect(validation.wordCount).toBeGreaterThanOrEqual(20);
      expect(validation.violations).toHaveLength(0);
    });
  });

  describe('Criterion 4: Image QA, Perceptual Hashing & Sharp Compositing', () => {
    it('renders clean 1080x1350 JPEG with high-contrast headline panel overlay', async () => {
      // Synthesize test pattern image
      const svg = `
        <svg width="800" height="800">
          <rect width="800" height="800" fill="navy" />
          <circle cx="400" cy="400" r="250" fill="gold" />
        </svg>
      `;
      const inputBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

      // 1. Run Image QA
      const qaResult = await validateImageBuffer(inputBuffer);
      expect(qaResult.valid).toBe(true);
      expect(qaResult.isBlank).toBe(false);
      expect(qaResult.phash).toMatch(/^[0-9a-f]{16}$/);

      // 2. Compose 1080x1350 JPEG with headline panel
      const composed = await composePostImage(inputBuffer, {
        aspectRatio: '4:5',
        quality: 85,
        panel: {
          enabled: true,
          headlineText: 'DEEP SPACE TELESCOPE DETECTS NEW MOLECULES IN DISTANT NEBULA',
          heightPercent: 25,
          sourceText: 'NASA / ESA / CSA',
        },
      });

      expect(composed.width).toBe(1080);
      expect(composed.height).toBe(1350);
      expect(composed.format).toBe('jpeg');
      expect(composed.hasPanel).toBe(true);
      expect(composed.byteSize).toBeGreaterThan(1000);

      const metadata = await sharp(composed.buffer).metadata();
      expect(metadata.width).toBe(1080);
      expect(metadata.height).toBe(1350);
    });
  });

  describe('Criterion 5: Two-Step Facebook Publishing & Mandatory Safety Rule', () => {
    it('enforces mandatory review hold for sensitive content even in auto mode', async () => {
      const mockPublisher = {
        publishFeedPost: vi.fn(),
      } as any;

      const result = await executePublishStage({
        pageId: 'page_test_101',
        pageToken: 'token_123',
        caption: 'Story mentioning graphic violence',
        publishingMode: 'auto',
        sensitiveFlags: ['gore_violence'],
        publisher: mockPublisher,
      });

      expect(result.action).toBe('held_for_review');
      expect(result.status).toBe('pending_review');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();
    });

    it('schedules clean posts in Facebook 10m-30d window', async () => {
      const futureDate = new Date(Date.now() + 3600 * 1000 * 5); // 5 hours in future
      const windowValidation = validateSchedulingWindow(futureDate);
      expect(windowValidation.valid).toBe(true);

      const mockPublisher = {
        publishFeedPost: vi.fn().mockResolvedValue({
          postId: 'page_101_post_777',
          photoId: 'photo_888',
          scheduledPublishTime: Math.floor(futureDate.getTime() / 1000),
          isScheduled: true,
          permalinkUrl: 'https://www.facebook.com/page_101/posts/777',
        }),
      } as any;

      const result = await executePublishStage({
        pageId: 'page_test_101',
        pageToken: 'valid_token',
        caption: 'Fascinating space science discovery',
        publishingMode: 'auto',
        scheduledFor: futureDate,
        publisher: mockPublisher,
      });

      expect(result.action).toBe('scheduled');
      expect(result.status).toBe('scheduled_on_fb');
      expect(result.fbPostId).toBe('page_101_post_777');
    });
  });

  describe('Criterion 6: Storage Retention, Pruning & Capacity Meter', () => {
    it('identifies published images older than 24 hours for pruning per PRD Section 16', () => {
      const now = Date.now();
      const oldPublishedAt = new Date(now - 25 * 3600 * 1000).toISOString(); // 25 hours ago
      const recentPublishedAt = new Date(now - 2 * 3600 * 1000).toISOString(); // 2 hours ago

      const posts = [
        {
          id: 'post_old',
          status: 'published',
          published_at: oldPublishedAt,
          created_at: oldPublishedAt,
          composed_image_path: '/storage/images/old_post.jpg',
        },
        {
          id: 'post_recent',
          status: 'published',
          published_at: recentPublishedAt,
          created_at: recentPublishedAt,
          composed_image_path: '/storage/images/recent_post.jpg',
        },
      ];

      const { publishedPostImagePaths } = identifyImagesToPrune(posts, {}, now);
      expect(publishedPostImagePaths).toContain('/storage/images/old_post.jpg');
      expect(publishedPostImagePaths).not.toContain('/storage/images/recent_post.jpg');
    });

    it('triggers warning at 70% and safe-mode at 90% disk capacity', () => {
      const normal = evaluateStorageCapacity(50, 100);
      expect(normal.isWarning).toBe(false);
      expect(normal.isSafeMode).toBe(false);

      const warning = evaluateStorageCapacity(75, 100);
      expect(warning.isWarning).toBe(true);
      expect(warning.isSafeMode).toBe(false);

      const safeMode = evaluateStorageCapacity(92, 100);
      expect(safeMode.isWarning).toBe(true);
      expect(safeMode.isSafeMode).toBe(true);
    });
  });
});
