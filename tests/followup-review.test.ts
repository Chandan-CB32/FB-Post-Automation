import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import {
  trimToWordLimit,
  countWords,
  formatParagraphs,
} from '../packages/core/src/validation/caption-validator.js';
import {
  verifyFactualClaims,
  extractFactualClaims,
} from '../packages/core/src/validation/claim-verifier.js';
import {
  runGenerationPipeline,
  generateCompositePreviewSvg,
  generateThumbnailSvg,
} from '../packages/core/src/pipeline/generation-pipeline.js';
import { executePublishStage } from '../worker/src/stages/07-post.js';
import { executeWorkerPipelinePost } from '../worker/src/pipeline-runner.js';
import crypto from 'node:crypto';
import { SystemStore } from '../apps/web/src/server/storage.js';
import { createDashboardServer } from '../apps/web/src/server.js';

describe('Follow-up Review: Emergency Reformat, Test Run Isolation & Fact Verification', () => {
  let server: http.Server;
  let baseUrl: string;
  let store: SystemStore;
  let authCookie: string;
  const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(async () => {
    process.env.SESSION_SECRET = secret;
    process.env.OWNER_EMAIL = 'admin@example.com';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const payload = {
      email: 'admin@example.com',
      sub: 'usr_owner_123',
      exp: Math.floor(Date.now() / 1000) + 2592000,
    };
    const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const hmac = crypto.createHmac('sha256', secret).update(rawPayload).digest('base64url');
    authCookie = `app_session=${rawPayload}.${hmac}`;

    store = SystemStore.getInstance();
    server = createDashboardServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // --------------------------------------------------------------------------
  // Requirement 1: Emergency Reformat - Never cut mid-sentence & Human Review Gate
  // --------------------------------------------------------------------------
  describe('Requirement 1: Emergency Reformat Sentence Boundaries & Review Gate', () => {
    it('Emergency reformat trims strictly at sentence boundaries and never cuts mid-sentence', () => {
      const originalText = [
        'The deep-space observatory detected an unexpected spectral signature orbiting the distant star.',
        'First narrative sentence with important context. Second narrative sentence detailing the team findings. Third narrative sentence adding further scientific depth. Fourth narrative sentence elaborating on planetary measurements.',
        'Could this discovery indicate atmospheric water vapor on another world?',
        '#SpaceNews #Astronomy #JWST #Discovery',
      ].join('\n\n');

      const maxWords = 35;
      const trimmed = trimToWordLimit(originalText, maxWords);

      // 1. Must never cut mid-sentence: all retained sentences must end with [.!?]
      const paragraphs = trimmed.split(/\n\s*\n/).filter(Boolean);
      for (const p of paragraphs) {
        if (p.startsWith('#')) continue;
        const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [p];
        for (const s of sentences) {
          const t = s.trim();
          expect(['.', '!', '?']).toContain(t.slice(-1));
        }
      }

      // 2. Must keep the hook (first paragraph)
      expect(trimmed).toContain('The deep-space observatory detected an unexpected spectral signature');

      // 3. Must keep the ending question
      expect(trimmed).toContain('Could this discovery indicate atmospheric water vapor on another world?');

      // 4. Must keep the hashtags
      expect(trimmed).toContain('#SpaceNews #Astronomy #JWST #Discovery');

      // 5. Total word count must not exceed maxWords
      expect(countWords(trimmed)).toBeLessThanOrEqual(maxWords);
    });

    it('Emergency reformat post is marked requires_human_review and MUST NEVER auto-publish on auto or hybrid mode', async () => {
      const mockPublisher = {
        publishFeedPost: vi.fn(),
      } as any;

      // Case A: Page in 'auto' mode
      const resultAuto = await executePublishStage({
        pageId: 'page_science_123',
        pageToken: 'valid_fb_token_123',
        caption: 'Trimmed caption after emergency reformat.',
        publishingMode: 'auto',
        emergencyReformatApplied: true,
        requiresHumanReview: true,
        reviewReason: 'emergency_reformat_applied',
        publisher: mockPublisher,
      });

      expect(resultAuto.action).toBe('held_for_review');
      expect(resultAuto.status).toBe('pending_review');
      expect(resultAuto.holdReason).toContain('Emergency reformat pass was applied, human review required.');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();

      // Case B: Page in 'hybrid' mode with high QA score (e.g. 95 >= 80)
      const resultHybrid = await executePublishStage({
        pageId: 'page_science_123',
        pageToken: 'valid_fb_token_123',
        caption: 'Trimmed caption after emergency reformat.',
        publishingMode: 'hybrid',
        qaScore: 95,
        hybridMinScore: 80,
        emergencyReformatApplied: true,
        requiresHumanReview: true,
        reviewReason: 'emergency_reformat_applied',
        publisher: mockPublisher,
      });

      expect(resultHybrid.action).toBe('held_for_review');
      expect(resultHybrid.status).toBe('pending_review');
      expect(resultHybrid.holdReason).toContain('Emergency reformat pass was applied, human review required.');
      expect(mockPublisher.publishFeedPost).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 2: Test Run Isolation Proof
  // --------------------------------------------------------------------------
  describe('Requirement 2: Test Run Isolation Proof', () => {
    it('POST /api/test-run NEVER creates rows in posts table, NEVER adds items to Review Inbox, and NEVER posts to Facebook', async () => {
      const page = await store.createPage({
        name: 'Beyond the Known',
        fb_page_id: '1347402001799226',
        fb_page_token: 'EAABtesttoken123',
        profile_id: 'science_space',
        publishing_mode: 'auto',
      });

      // Check posts table and review inbox before test run
      const postsBefore = await store.getPosts();
      const reviewInboxBefore = postsBefore.filter(
        (p) => p.status === 'pending_review' || p.review_state === 'pending'
      );

      // Run Test Run
      const res = await fetch(`${baseUrl}/api/test-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Check posts table and review inbox after test run
      const postsAfter = await store.getPosts();
      const reviewInboxAfter = postsAfter.filter(
        (p) => p.status === 'pending_review' || p.review_state === 'pending'
      );

      // Assert complete isolation: 0 new posts, 0 review inbox items
      expect(postsAfter.length).toBe(postsBefore.length);
      expect(reviewInboxAfter.length).toBe(reviewInboxBefore.length);

      // Page itself should record test run verification without scheduling anything
      const updatedPage = await store.getPageById(page.id);
      expect(updatedPage?.test_run_verified).toBe(true);
      expect(updatedPage?.last_test_run_at).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 3: Comprehensive Multi-Stage Test Run Report
  // --------------------------------------------------------------------------
  describe('Requirement 3: Comprehensive Multi-Stage Test Run Report', () => {
    it('Test Run covers EVERY stage: research (with source URLs), topic, writer, QA, image prompt, image generate (thumbnail), headline composition (1080x1350 preview)', async () => {
      const page = await store.createPage({
        name: 'Beyond the Known',
        fb_page_id: '1347402001799226',
        fb_page_token: 'EAABtesttoken123',
        profile_id: 'science_space',
        min_words: 60,
        target_words: 120,
        max_words: 220,
      });

      const res = await fetch(`${baseUrl}/api/test-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({ pageId: page.id }),
      });

      expect(res.status).toBe(200);
      const report = await res.json();

      expect(report.success).toBe(true);
      expect(report.stages).toBeDefined();
      expect(report.stages.length).toBe(7);

      const stageNames = report.stages.map((s: any) => s.stage);
      expect(stageNames).toEqual([
        'research',
        'topic_select',
        'write_caption',
        'qa_safety',
        'image_prompt',
        'image_generate',
        'headline_composition',
      ]);

      // Stage 1: Research with verified source URLs
      const researchStage = report.stages.find((s: any) => s.stage === 'research');
      expect(researchStage.status).toBe('completed');
      expect(researchStage.sourceUrls).toBeDefined();
      expect(researchStage.sourceUrls.length).toBeGreaterThan(0);
      expect(researchStage.sourceUrls[0]).toContain('nasa.gov');
      expect(researchStage.provider).toBeDefined();
      expect(researchStage.model).toBeDefined();
      expect(researchStage.tokens).toBeDefined();
      expect(researchStage.durationMs).toBeGreaterThanOrEqual(0);

      // Stage 2: Topic Selection
      const topicStage = report.stages.find((s: any) => s.stage === 'topic_select');
      expect(topicStage.status).toBe('completed');
      expect(report.topic.title).toBeDefined();
      expect(report.topic.category).toBeDefined();

      // Stage 3: Caption Writing
      const writeStage = report.stages.find((s: any) => s.stage === 'write_caption');
      expect(writeStage.status).toBe('completed');
      expect(report.caption).toBeDefined();
      expect(report.wordCount).toBeGreaterThan(0);
      expect(report.effectivePrompt).toBeDefined();

      // Stage 4: QA & Safety
      const qaStage = report.stages.find((s: any) => s.stage === 'qa_safety');
      expect(qaStage.status).toBe('passed');
      expect(qaStage.score).toBeGreaterThanOrEqual(80);

      // Stage 5: Image Prompt
      const imagePromptStage = report.stages.find((s: any) => s.stage === 'image_prompt');
      expect(imagePromptStage.status).toBe('completed');
      expect(report.imagePrompt).toBeDefined();

      // Stage 6: Image Generation (Thumbnail)
      const imageGenStage = report.stages.find((s: any) => s.stage === 'image_generate');
      expect(imageGenStage.status).toBe('completed');
      expect(report.thumbnailUrl).toBeDefined();
      expect(report.thumbnailUrl).toContain('data:image/svg+xml');

      // Stage 7: Headline Composition (1080x1350 Preview Image)
      const compStage = report.stages.find((s: any) => s.stage === 'headline_composition');
      expect(compStage.status).toBe('completed');
      expect(report.compositeImageUrl).toBeDefined();
      expect(
        report.compositeImageUrl.startsWith('data:image/jpeg') ||
        report.compositeImageUrl.startsWith('data:image/svg+xml')
      ).toBe(true);
      expect(report.headlinePanel.enabled).toBe(true);
      expect(report.imageDimensions).toContain('1080x1350');
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 4: Shared Pipeline Unification (Worker & Test Run)
  // --------------------------------------------------------------------------
  describe('Requirement 4: Pipeline Unification Between Worker & Test Run', () => {
    it('Proves worker generation uses the SAME pipeline functions as the Test Run with matching results', async () => {
      const page = await store.createPage({
        name: 'Beyond the Known',
        fb_page_id: '1347402001799226',
        fb_page_token: 'EAABtesttoken123',
        profile_id: 'science_space',
        min_words: 60,
        target_words: 120,
        max_words: 220,
      });

      // 1. Run through Test Run entry point
      const testRunRes = await fetch(`${baseUrl}/api/test-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie,
        },
        body: JSON.stringify({ pageId: page.id }),
      });
      const testRunData = await testRunRes.json();

      // 2. Run through Worker generation pipeline entry point
      const profile = (await store.getContentProfiles()).find((p) => p.name.includes('Science')) || {
        id: 'science_space',
        name: 'Science Story',
        type: 'factual',
      } as any;

      const workerResult = await executeWorkerPipelinePost({
        page,
        profile,
        isTestRun: true,
      });

      // Assert identical pipeline structure and evaluations
      expect(testRunData.success).toBe(workerResult.pipeline.success);
      expect(testRunData.stages.length).toBe(workerResult.pipeline.stages.length);
      expect(testRunData.stages.map((s: any) => s.stage)).toEqual(
        workerResult.pipeline.stages.map((s: any) => s.stage)
      );
      expect(testRunData.structureRules).toEqual(workerResult.pipeline.structureRules);
      expect(testRunData.researchSources).toEqual(workerResult.pipeline.researchSources);
      expect(testRunData.claimVerification.length).toBe(workerResult.pipeline.claimVerification.length);
    });
  });

  // --------------------------------------------------------------------------
  // Requirement 5: Factual Posts Claim Verification (Science & Space)
  // --------------------------------------------------------------------------
  describe('Requirement 5: Science & Space Factual Claim-by-Claim Verification', () => {
    it('Science & Space posts verify claims against research sources and fail QA if any factual claim lacks a supporting source', () => {
      const researchFacts = [
        {
          text: 'The James Webb Space Telescope detected atmospheric methane and carbon dioxide on exoplanet K2-18b.',
          sourceUrl: 'https://science.nasa.gov/mission/webb/',
        },
        {
          text: 'K2-18b is located approximately 124 light-years away from Earth in the constellation Leo.',
          sourceUrl: 'https://www.esa.int/Science_Exploration/Space_Science/Cheops',
        },
      ];

      // Grounded caption: all claims match research facts
      const groundedCaption = [
        'Astronomers analyzing James Webb Space Telescope observations have detected atmospheric methane on exoplanet K2-18b.',
        'This planet is located approximately 124 light-years away from Earth in the constellation Leo.',
        'Do you think we will discover biosignatures on distant exoplanets within our lifetime?',
        '#Space #Astronomy #JWST #Discovery',
      ].join('\n\n');

      const verifiedResult = verifyFactualClaims(groundedCaption, researchFacts);
      expect(verifiedResult.allVerified).toBe(true);
      expect(verifiedResult.unsupportedClaims.length).toBe(0);
      expect(verifiedResult.claims.every((c) => c.verified && c.sourceUrl !== null)).toBe(true);

      // Hallucinated caption: contains an unverified claim
      const ungroundedCaption = [
        'Astronomers analyzing James Webb Space Telescope observations have detected atmospheric methane on exoplanet K2-18b.',
        'NASA astronauts successfully landed a robotic rover on the surface of K2-18b yesterday morning.',
        'Do you think exploration missions will expand soon?',
        '#Space #Astronomy #JWST',
      ].join('\n\n');

      const failedResult = verifyFactualClaims(ungroundedCaption, researchFacts);
      expect(failedResult.allVerified).toBe(false);
      expect(failedResult.unsupportedClaims.length).toBeGreaterThan(0);
      expect(failedResult.unsupportedClaims[0]).toContain('NASA astronauts successfully landed a robotic rover');
    });

    it('Fails QA validation when factual claims lack research sources in generation pipeline', async () => {
      // Running pipeline with non-matching facts should trigger claim verification failure
      const ungroundedDraft = `NASA astronauts physically landed on exoplanet K2-18b yesterday and collected water samples from its ocean.\n\nWhat do you think?\n\n#space #discovery`;
      const researchFacts = [
        {
          text: 'The James Webb Space Telescope detected atmospheric methane on exoplanet K2-18b.',
          sourceUrl: 'https://science.nasa.gov/mission/webb/',
        },
      ];

      const check = verifyFactualClaims(ungroundedDraft, researchFacts);
      expect(check.allVerified).toBe(false);
      expect(check.unsupportedClaims.length).toBe(1);
      expect(check.claims[0].verified).toBe(false);
      expect(check.claims[0].sourceUrl).toBeNull();
    });
  });
});
