import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeQaSafetyStage,
} from '../worker/src/stages/05-qa-safety.js';
import { ProviderRouter } from '../worker/src/router/provider-router.js';
import {
  createHorrorStoryProfile,
  createScienceStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';

describe('QA Scoring & Content Safety Classifier (Step 7.4)', () => {
  let router: ProviderRouter;

  beforeEach(() => {
    router = new ProviderRouter();
    vi.restoreAllMocks();
  });

  it('accurately evaluates high-quality clean post and approves for auto-publishing', async () => {
    const scienceProfile = createScienceStoryProfile();
    const settings = resolveSettings({ profile: scienceProfile });

    const mockQaOutput = JSON.stringify({
      breakdown: {
        hookScore: 23,
        flowVoiceScore: 24,
        groundingScore: 25,
        complianceScore: 25,
      },
      sensitiveFlags: [],
      feedback: 'Excellent scroll-stopping hook, scientifically accurate facts, and clean mobile paragraph pacing.',
      remediationSuggestions: [],
    });

    const executeSpy = vi.spyOn(router, 'executeText').mockResolvedValue({
      text: mockQaOutput,
      providerId: 'p-qa',
      providerName: 'Mock QA Model',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 150, completionTokens: 80, totalTokens: 230 },
      latencyMs: 300,
    });

    const result = await executeQaSafetyStage({
      profile: scienceProfile,
      effectiveSettings: settings,
      router,
      topic: 'The Discovery of Cosmic Microwave Background',
      caption: 'In 1965, two astronomers detected the echo of creation.',
      wordCount: 150,
      publishingMode: 'auto',
      hybridMinScore: 80,
    });

    expect(executeSpy).toHaveBeenCalledWith('qa', expect.objectContaining({ jsonMode: true }));
    expect(result.score).toBe(97); // 23 + 24 + 25 + 25
    expect(result.breakdown.hookScore).toBe(23);
    expect(result.passed).toBe(true);
    expect(result.isSensitive).toBe(false);
    expect(result.sensitiveFlags.length).toBe(0);
    // On auto mode with clean high score, mustHoldForReview is false
    expect(result.mustHoldForReview).toBe(false);
  });

  it('MANDATORY SAFETY: holds sensitive post in review EVEN IF publishingMode is auto', async () => {
    const horrorProfile = createHorrorStoryProfile();
    const settings = resolveSettings({ profile: horrorProfile });

    const mockSensitiveOutput = JSON.stringify({
      breakdown: {
        hookScore: 20,
        flowVoiceScore: 18,
        groundingScore: 15,
        complianceScore: 5,
      },
      sensitiveFlags: ['gore_violence'],
      feedback: 'Story contains graphic description of severe physical trauma violating platform anti-gore policy.',
      remediationSuggestions: [
        'Remove explicit descriptions of blood and physical mutilation.',
        'Focus on psychological suspense and atmospheric dread instead.',
      ],
    });

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: mockSensitiveOutput,
      providerId: 'p-qa',
      providerName: 'Mock QA Model',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 180, completionTokens: 90, totalTokens: 270 },
      latencyMs: 320,
    });

    const result = await executeQaSafetyStage({
      profile: horrorProfile,
      effectiveSettings: settings,
      router,
      topic: 'The Red Basement',
      caption: 'Graphic bloody descriptions of violence...',
      wordCount: 200,
      publishingMode: 'auto', // Auto mode configured
      hybridMinScore: 80,
    });

    expect(result.isSensitive).toBe(true);
    expect(result.sensitiveFlags).toContain('gore_violence');
    expect(result.passed).toBe(false);

    // CRITICAL PRD REQUIREMENT:
    // Any sensitive flag MUST hold the post for review, even on fully automatic Pages!
    expect(result.mustHoldForReview).toBe(true);
    expect(result.remediationSuggestions.length).toBe(2);
  });

  it('holds post in review under hybrid mode when score is below threshold', async () => {
    const horrorProfile = createHorrorStoryProfile();
    const settings = resolveSettings({ profile: horrorProfile });

    const mockSubparOutput = JSON.stringify({
      breakdown: {
        hookScore: 16,
        flowVoiceScore: 18,
        groundingScore: 18,
        complianceScore: 20,
      },
      sensitiveFlags: [],
      feedback: 'Weak opening hook and disjointed narrative pacing.',
      remediationSuggestions: ['Strengthen first two lines before the fold.'],
    });

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: mockSubparOutput,
      providerId: 'p-qa',
      providerName: 'Mock QA Model',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      latencyMs: 200,
    });

    const result = await executeQaSafetyStage({
      profile: horrorProfile,
      effectiveSettings: settings,
      router,
      topic: 'The Old Mill',
      caption: 'Something strange happened at the mill.',
      wordCount: 180,
      publishingMode: 'hybrid',
      hybridMinScore: 80,
    });

    expect(result.score).toBe(72); // 16 + 18 + 18 + 20
    expect(result.passed).toBe(false);
    expect(result.isSensitive).toBe(false);
    // Hybrid mode holds posts scoring below 80
    expect(result.mustHoldForReview).toBe(true);
  });

  it('holds every post in review when publishingMode is review', async () => {
    const scienceProfile = createScienceStoryProfile();
    const settings = resolveSettings({ profile: scienceProfile });

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: JSON.stringify({
        breakdown: { hookScore: 25, flowVoiceScore: 25, groundingScore: 25, complianceScore: 25 },
        sensitiveFlags: [],
        feedback: 'Flawless post.',
      }),
      providerId: 'p-qa',
      providerName: 'Mock QA Model',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      latencyMs: 150,
    });

    const result = await executeQaSafetyStage({
      profile: scienceProfile,
      effectiveSettings: settings,
      router,
      topic: 'Hubble Telescope Anniversary',
      caption: 'Celebrating 35 years of cosmic exploration.',
      wordCount: 100,
      publishingMode: 'review',
    });

    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    // In review mode, all posts are held regardless of score
    expect(result.mustHoldForReview).toBe(true);
  });

  it('gracefully handles unparseable LLM output without throwing', async () => {
    const scienceProfile = createScienceStoryProfile();
    const settings = resolveSettings({ profile: scienceProfile });

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: 'Malformed non-JSON output from provider',
      providerId: 'p-qa',
      providerName: 'Mock QA Model',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      latencyMs: 120,
    });

    const result = await executeQaSafetyStage({
      profile: scienceProfile,
      effectiveSettings: settings,
      router,
      topic: 'Black Hole Event Horizon',
      caption: 'Light cannot escape.',
      wordCount: 80,
      publishingMode: 'hybrid',
      hybridMinScore: 80,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.feedback).toBeDefined();
    expect(result.isSensitive).toBe(false);
  });
});
