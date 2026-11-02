import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeFactExtractorStage,
} from '../worker/src/stages/04-fact-extractor.js';
import { ProviderRouter } from '../worker/src/router/provider-router.js';
import {
  createScienceStoryProfile,
  createCrimeStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';

describe('Fact Extractor Pipeline (Step 7.1)', () => {
  let router: ProviderRouter;

  beforeEach(() => {
    router = new ProviderRouter();
    vi.restoreAllMocks();
  });

  it('extracts structured confirmed facts, chronological timeline, and source line', async () => {
    const scienceProfile = createScienceStoryProfile();
    const settings = resolveSettings({ profile: scienceProfile });

    const mockLlmResponse = JSON.stringify({
      topic: 'The Discovery of Cosmic Microwave Background Radiation',
      summary: 'In 1965, Arno Penzias and Robert Wilson accidentally discovered the residual thermal echo of the Big Bang.',
      confirmedFacts: [
        'Discovered at Bell Labs in Holmdel, New Jersey using a 20-foot horn reflector antenna.',
        'Antenna detected an isotropic 3 Kelvin background noise that could not be attributed to local interference.',
        'Penzias and Wilson shared the 1978 Nobel Prize in Physics for this breakthrough.',
      ],
      timeline: [
        { time: '1948', event: 'Ralph Alpher and Robert Herman predict cosmic microwave background radiation.' },
        { time: '1965', event: 'Penzias and Wilson detect the signal and confirm cosmological origin with Princeton physicists.' },
        { time: '1978', event: 'Awarded Nobel Prize in Physics.' },
      ],
      hypotheticalOrAlleged: [
        'Initially suspected pigeon droppings in the antenna cone were causing the signal.',
      ],
      sourceLine: 'Source: NobelPrize.org & NASA Astrophysics Archives',
    });

    const executeSpy = vi.spyOn(router, 'executeText').mockResolvedValue({
      text: mockLlmResponse,
      providerId: 'p-text',
      providerName: 'Mock Provider',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 200, completionTokens: 120, totalTokens: 320 },
      latencyMs: 400,
    });

    const result = await executeFactExtractorStage({
      profile: scienceProfile,
      effectiveSettings: settings,
      router,
      topic: 'The Discovery of Cosmic Microwave Background Radiation',
      category: 'Cosmology & Space',
      sourceUrl: 'https://nasa.gov/cmb-discovery',
      rawResearchExcerpt: 'In 1965, Bell Labs radio astronomers found a steady hum from all parts of the sky.',
    });

    // Verify stage called with 'fact_extraction'
    expect(executeSpy).toHaveBeenCalledWith('fact_extraction', expect.objectContaining({ jsonMode: true }));

    // Verify prompt had safety baseline injected
    const callArgs = executeSpy.mock.calls[0][1];
    expect(callArgs.prompt).toContain('MANDATORY PLATFORM SAFETY BASELINE');

    // Verify parsed structure
    expect(result.summary).toContain('Arno Penzias and Robert Wilson');
    expect(result.confirmedFacts.length).toBe(3);
    expect(result.confirmedFacts[0]).toContain('Bell Labs');
    expect(result.timeline.length).toBe(3);
    expect(result.timeline[0].time).toBe('1948');
    expect(result.hypotheticalOrAlleged.length).toBe(1);
    expect(result.sourceLine).toContain('NobelPrize.org');
    expect(result.sourceUrl).toBe('https://nasa.gov/cmb-discovery');

    // Verify allFactBullets includes facts, timeline, and alleged points
    expect(result.allFactBullets.length).toBe(7);
    expect(result.allFactBullets.some((b) => b.includes('Timeline (1965):'))).toBe(true);
    expect(result.allFactBullets.some((b) => b.includes('Theorized/Alleged:'))).toBe(true);

    expect(result.tokensUsed.totalTokens).toBe(320);
  });

  it('handles true-crime profile fact grounding with cautious language', async () => {
    const crimeProfile = createCrimeStoryProfile();
    const settings = resolveSettings({ profile: crimeProfile });

    const mockResponse = JSON.stringify({
      topic: 'The Isabella Stewart Gardner Museum Heist',
      summary: 'On March 18, 1990, 13 works of art were stolen from the museum in Boston by thieves disguised as police officers.',
      confirmedFacts: [
        'Thieves tied up security guards and spent 81 minutes inside the galleries.',
        'Stolen artworks include masterpieces by Vermeer, Rembrandt, and Manet.',
        'FBI maintains an active $10 million reward for information leading to recovery.',
      ],
      timeline: [
        { time: 'March 18, 1990', event: 'Two men disguised as Boston police enter the museum at 1:24 AM.' },
        { time: 'March 18, 1990 2:45 AM', event: 'Thieves make two trips to their vehicle and flee with 13 artworks.' },
      ],
      hypotheticalOrAlleged: [
        'FBI identified suspected thieves as deceased associates of a Boston organized crime syndicate.',
        'Paintings were allegedly moved to Connecticut and Philadelphia in the early 2000s.',
      ],
      sourceLine: 'Source: FBI Art Crime Team & Gardner Museum Public Archives',
    });

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: mockResponse,
      providerId: 'p-crime',
      providerName: 'Mock Provider',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 180, completionTokens: 110, totalTokens: 290 },
      latencyMs: 350,
    });

    const result = await executeFactExtractorStage({
      profile: crimeProfile,
      effectiveSettings: settings,
      router,
      topic: 'The Isabella Stewart Gardner Museum Heist',
      category: 'Art Heists',
    });

    expect(result.hypotheticalOrAlleged.length).toBe(2);
    expect(result.hypotheticalOrAlleged[0]).toContain('suspected');
    expect(result.hypotheticalOrAlleged[1]).toContain('allegedly');
    expect(result.confirmedFacts[0]).toContain('81 minutes');
  });

  it('gracefully falls back when LLM outputs plain bulleted text instead of JSON', async () => {
    const scienceProfile = createScienceStoryProfile();
    const settings = resolveSettings({ profile: scienceProfile });

    const plainTextResponse = `
- The speed of light in a vacuum is exactly 299,792,458 meters per second.
- It was first measured with reasonable accuracy by Ole Rømer in 1676 using Jupiter's moon Io.
- Albert Einstein published his Special Theory of Relativity in 1905 establishing light speed as the universal speed limit.
- Lasers and atomic clocks enabled the modern definition established in 1983.
    `.trim();

    vi.spyOn(router, 'executeText').mockResolvedValue({
      text: plainTextResponse,
      providerId: 'p-text',
      providerName: 'Mock Provider',
      keyMasked: 'sk-...1234',
      modelUsed: 'mock-gpt-4o',
      tokens: { promptTokens: 80, completionTokens: 60, totalTokens: 140 },
      latencyMs: 200,
    });

    const result = await executeFactExtractorStage({
      profile: scienceProfile,
      effectiveSettings: settings,
      router,
      topic: 'The Speed of Light',
    });

    expect(result.confirmedFacts.length).toBeGreaterThanOrEqual(3);
    expect(result.confirmedFacts[0]).toContain('299,792,458 meters per second');
    expect(result.summary).toBeDefined();
    expect(result.allFactBullets.length).toBeGreaterThanOrEqual(3);
  });
});
