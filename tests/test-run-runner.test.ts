import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TestRunRunner,
} from '../worker/src/stages/test-run-runner.js';
import {
  ProviderRouter,
  ProviderRouterError,
} from '../worker/src/router/provider-router.js';
import {
  createHorrorStoryProfile,
  createScienceStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';

describe('TestRunRunner (Pipeline Simulation without Posting)', () => {
  let runner: TestRunRunner;
  let router: ProviderRouter;

  beforeEach(() => {
    runner = new TestRunRunner();
    router = new ProviderRouter();
    vi.restoreAllMocks();
  });

  it('runs full end-to-end simulation for a fiction profile with auto topic generation', async () => {
    const horrorProfile = createHorrorStoryProfile();

    vi.spyOn(router, 'executeText').mockImplementation(async (stage, opts) => {
      const prompt = opts.prompt || '';
      if (stage === 'topic') {
        return {
          text: JSON.stringify({
            topic: 'The Whispering Mirror of Blackwood Manor',
            category: 'Cursed Objects & Relics',
          }),
          providerId: 'prov-mock-text',
          providerName: 'Mock Provider',
          keyMasked: 'sk-...1234',
          modelUsed: 'mock-gpt-4o',
          tokens: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
          latencyMs: 120,
        };
      }
      if (stage === 'outline') {
        return {
          text: '1. Antique collector buys silver mirror. 2. Reflections begin lagging behind. 3. Climax in the dark.',
          providerId: 'prov-mock-text',
          providerName: 'Mock Provider',
          keyMasked: 'sk-...1234',
          modelUsed: 'mock-gpt-4o',
          tokens: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          latencyMs: 250,
        };
      }
      if (stage === 'write') {
        return {
          text: 'The mirror was bought at an estate sale in 1923. At first, Julian only noticed a faint flicker in the glass. But by midnight, his reflection smiled while he remained frozen in terror. #HorrorStories #ParanormalMystery #DarkFiction',
          providerId: 'prov-mock-text',
          providerName: 'Mock Provider',
          keyMasked: 'sk-...1234',
          modelUsed: 'mock-gpt-4o',
          tokens: { promptTokens: 500, completionTokens: 250, totalTokens: 750 },
          latencyMs: 600,
        };
      }
      if (stage === 'qa') {
        return {
          text: JSON.stringify({
            score: 92,
            passed: true,
            feedback: 'Strong atmospheric hook and well-paced tension.',
            sensitive: false,
            sensitiveReasons: [],
          }),
          providerId: 'prov-mock-text',
          providerName: 'Mock Provider',
          keyMasked: 'sk-...1234',
          modelUsed: 'mock-gpt-4o',
          tokens: { promptTokens: 350, completionTokens: 80, totalTokens: 430 },
          latencyMs: 200,
        };
      }
      throw new Error(`Unexpected stage: ${stage}`);
    });

    vi.spyOn(router, 'executeImage').mockResolvedValue({
      imageUrl: 'https://images.example.com/whispering-mirror.png',
      imageBuffer: Buffer.from('fake-image-bytes'),
      mimeType: 'image/png',
      width: 1080,
      height: 1350,
      latencyMs: 1200,
      providerId: 'prov-mock-image',
      providerName: 'Mock Image Provider',
      modelUsed: 'flux-schnell',
    });

    const result = await runner.run({
      profile: horrorProfile,
      router,
    });

    expect(result.status).toBe('success');
    expect(result.testRunId).toBeDefined();
    expect(result.profileName).toBe('Horror Story');
    expect(result.stages.length).toBe(5);

    // Verify stage names
    expect(result.stages.map((s) => s.stageName)).toEqual([
      'topic_select',
      'outline_extract',
      'write_caption',
      'qa_safety',
      'image_generate',
    ]);

    // Check final post assembly
    expect(result.finalPost.topic).toBe('The Whispering Mirror of Blackwood Manor');
    expect(result.finalPost.wordCount).toBeGreaterThan(20);
    expect(result.finalPost.hashtags).toContain('#HorrorStories');
    expect(result.finalPost.hashtags).toContain('#ParanormalMystery');
    expect(result.finalPost.disclaimer).toContain('Fictional story');
    expect(result.finalPost.qaScore).toBe(92);
    expect(result.finalPost.isSensitive).toBe(false);
    expect(result.finalPost.imageUrl).toBe('https://images.example.com/whispering-mirror.png');

    // Token and timing calculations
    expect(result.totalTokens).toBe(160 + 300 + 750 + 430);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('honors user-provided custom topic and skips LLM topic selection', async () => {
    const horrorProfile = createHorrorStoryProfile();

    const executeTextSpy = vi.spyOn(router, 'executeText').mockImplementation(async (stage) => {
      if (stage === 'outline' || stage === 'write') {
        return {
          text: 'Story about the abandoned lighthouse.',
          providerId: 'mock-p',
          providerName: 'Mock P',
          keyMasked: 'sk-...1234',
          modelUsed: 'mock-m',
          tokens: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
          latencyMs: 100,
        };
      }
      return {
        text: JSON.stringify({ score: 88, passed: true, feedback: 'Great topic' }),
        providerId: 'mock-p',
        providerName: 'Mock P',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-m',
        tokens: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        latencyMs: 100,
      };
    });

    vi.spyOn(router, 'executeImage').mockResolvedValue({
      imageUrl: 'https://images.example.com/lighthouse.png',
      imageBuffer: Buffer.from('fake-image-bytes'),
      mimeType: 'image/png',
      width: 1080,
      height: 1350,
      latencyMs: 500,
      providerId: 'mock-image',
      providerName: 'Mock Image Provider',
      modelUsed: 'flux-schnell',
    });

    const result = await runner.run({
      profile: horrorProfile,
      router,
      userTopic: 'The Cursed Lighthouse of Cape Ann',
    });

    expect(result.status).toBe('success');
    expect(result.finalPost.topic).toBe('The Cursed Lighthouse of Cape Ann');

    const topicStage = result.stages.find((s) => s.stageName === 'topic_select');
    expect(topicStage?.providerId).toBe('manual');
    expect(topicStage?.model).toBe('user_provided');
    expect(topicStage?.tokensUsed.totalTokens).toBe(0);

    // executeText should not have been called with 'topic' stage
    expect(executeTextSpy).not.toHaveBeenCalledWith('topic', expect.anything());
  });

  it('runs factual profile simulation with fact extraction and no fiction disclaimer', async () => {
    const scienceProfile = createScienceStoryProfile();

    vi.spyOn(router, 'executeText').mockImplementation(async (stage) => {
      if (stage === 'topic') {
        return {
          text: JSON.stringify({ topic: 'The Discovery of Cosmic Microwave Background Radiation' }),
          providerId: 'p-text',
          providerName: 'Mock P',
          keyMasked: 'sk-...1234',
          modelUsed: 'm-text',
          tokens: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          latencyMs: 50,
        };
      }
      if (stage === 'fact_extraction') {
        return {
          text: '- Discovered in 1965 by Penzias and Wilson.\n- Leftover thermal radiation from the Big Bang.',
          providerId: 'p-text',
          providerName: 'Mock P',
          keyMasked: 'sk-...1234',
          modelUsed: 'm-text',
          tokens: { promptTokens: 20, completionTokens: 20, totalTokens: 40 },
          latencyMs: 50,
        };
      }
      if (stage === 'write') {
        return {
          text: 'In 1965, two radio astronomers accidentally discovered the echo of creation. Their antenna kept detecting a strange background hum that came from every direction in the sky.',
          providerId: 'p-text',
          providerName: 'Mock P',
          keyMasked: 'sk-...1234',
          modelUsed: 'm-text',
          tokens: { promptTokens: 40, completionTokens: 40, totalTokens: 80 },
          latencyMs: 100,
        };
      }
      return {
        text: JSON.stringify({ score: 95, passed: true, feedback: 'Factually sound' }),
        providerId: 'p-text',
        providerName: 'Mock P',
        keyMasked: 'sk-...1234',
        modelUsed: 'm-text',
        tokens: { promptTokens: 20, completionTokens: 20, totalTokens: 40 },
        latencyMs: 50,
      };
    });

    const result = await runner.run({
      profile: scienceProfile,
      router,
      skipImage: true,
    });

    expect(result.status).toBe('success');
    // Factual profile should NOT have a fiction disclaimer
    expect(result.finalPost.disclaimer).toBeNull();
    // Image stage was skipped
    expect(result.stages.some((s) => s.stageName === 'image_generate')).toBe(false);
    expect(result.finalPost.imageUrl).toBeNull();
  });

  it('incorporates page-level overrides and reflects them in effective settings', async () => {
    const horrorProfile = createHorrorStoryProfile();

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: JSON.stringify({ score: 85, feedback: 'Good', topic: 'Shadow in the Mist' }),
      providerId: 'p1',
      providerName: 'Mock P1',
      keyMasked: 'sk-...1234',
      modelUsed: 'm1',
      tokens: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      latencyMs: 50,
    });

    const result = await runner.run({
      profile: horrorProfile,
      router,
      skipImage: true,
      pageOverrides: {
        'caption.target': 450,
        'caption.min': 400,
        'caption.max': 550,
      },
    });

    expect(result.status).toBe('success');
    expect(result.effectiveSettings.caption.target).toBe(450);
    expect(result.effectiveSettings.caption.min).toBe(400);
    expect(result.effectiveSettings.caption.max).toBe(550);
    expect(result.effectiveSettings.provenance['caption.target'].source).toBe('page');
  });

  it('gracefully captures failures if router execution throws', async () => {
    const horrorProfile = createHorrorStoryProfile();

    vi.spyOn(router, 'executeText').mockRejectedValue(
      new ProviderRouterError('All providers exhausted', [
        { provider: 'p1', error: '429 Rate Limit', kind: 'openai_compatible_chat' },
      ])
    );

    const result = await runner.run({
      profile: horrorProfile,
      router,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('All providers exhausted');
    expect(result.finalPost.caption).toBe('');
    expect(result.finalPost.qaScore).toBe(0);
  });
});
