import { describe, it, expect, vi } from 'vitest';
import {
  runContentIntegrityCheck,
  checkScientificSpelling,
  checkContentConsistency,
  checkFactGrounding,
  checkHashtags,
  checkFluffAndOverstatement,
} from '../packages/core/src/validation/content-integrity.js';
import {
  buildConcreteImagePrompt,
  checkPromptVariety,
  computePromptSimilarity,
} from '../packages/core/src/pipeline/image-prompt-builder.js';
import { GeminiNativeAdapter } from '../packages/core/src/adapters/gemini.js';
import { ProviderError } from '../packages/core/src/adapters/types.js';

describe('Regression Fixtures: 4 Real Published Posts Quality Guard', () => {
  // Post 1: Antarctic Rock Extremophiles
  it('Fixture 1: Rejects EXTREMOPOLES spelling typo and 1.5B year rock/microbe logic mix-up', () => {
    const headline = 'ANTARCTIC ROCKS HARBOR 1.5 BILLION YEAR EXTREMOPOLES THRIVING';
    const caption = `Imagine tiny microbes surviving in rocks older than the dinosaurs, hidden in Antarctica's driest valleys 🧊
Scientists extracted these organisms from 1.5-billion-year-old peridotite, a rock that mirrors conditions on Mars.
The microbes oxidize iron to generate ATP, powering them even when water is frozen solid.
Could similar extremophiles be lurking in the depths of our own planet, waiting to be discovered?
#Extremophiles #Antarctica #Astrobiology #Microbes #SpaceLife`;

    const facts = [
      {
        text: 'Scientists extracted living microbes from 1.5-billion-year-old peridotite rock in Antarctica.',
        sourceUrl: 'https://nature.com/articles/s41561-antarctic-peridotite',
      },
    ];

    const result = runContentIntegrityCheck({
      headline,
      caption,
      facts,
      configuredHashtagsCount: 5,
    });

    expect(result.valid).toBe(false);

    // Verify spelling typo detected
    const typoViolation = result.violations.find((v) => v.code === 'SPELLING_TYPO');
    expect(typoViolation).toBeDefined();
    expect(typoViolation?.offendingText).toBe('EXTREMOPOLES');
    expect(typoViolation?.expectedValue).toBe('EXTREMOPHILES');

    // Verify headline logic attribution error detected
    const logicViolation = result.violations.find((v) => v.code === 'HEADLINE_LOGIC_ATTRIBUTION');
    expect(logicViolation).toBeDefined();
    expect(logicViolation?.message).toContain('1.5-billion-year-old rock');

    // Verify corrected headline remediation
    expect(result.correctedHeadline).toBeDefined();
    expect(result.correctedHeadline).toContain('EXTREMOPHILES');
  });

  // Post 2: Blue Whale Heart
  it('Fixture 2: Rejects blue whale numerical contradiction, ungrounded heart rate claims, hashtag count, and fluff opening', () => {
    const headline = 'BLUE WHALE HEART PUMPS 150 LITERS OF BLOOD EVERY MINUTE';
    const caption = `Recent observations have revealed fascinating new insights into Blue Whale Heart Pumps 150 Liters of Blood Every Minute, providing researchers and enthusiasts with unprecedented clarity into this phenomenon.

The heart rate averages 8-10 beats per minute and weighs approximately 600 kg, comparable to a small car.. Each beat circulates about 150 liters of blood, moving roughly 1.2 km of blood through the circulatory system.. The enormous heart is essential for delivering oxygen to the whale’s massive body and supporting its deep-diving lifestyle. These detailed findings represent years of meticulous investigation and collaborative exploration across the scientific community.

These verified discoveries mark an exciting new milestone in our ongoing exploration of the natural world and the cosmos, opening up fresh avenues for deeper scientific inquiry.

What do you find most intriguing about this incredible breakthrough?
#discovery`;

    const facts = [
      {
        text: 'Goldbogen et al. 2019 PNAS: blue whale heart rate drops to 4-8 bpm during dives, down to 2 bpm, and reaches 25-37 bpm at surface.',
        sourceUrl: 'https://www.pnas.org/doi/10.1073/pnas.1914273116',
      },
    ];

    const result = runContentIntegrityCheck({
      headline,
      caption,
      facts,
      configuredHashtagsCount: 5,
    });

    expect(result.valid).toBe(false);

    // 1. Contradiction: 150 liters EVERY MINUTE in headline vs 150 liters per beat in caption
    const contradiction = result.violations.find((v) => v.code === 'CONTRADICTION');
    expect(contradiction).toBeDefined();

    // 2. Fact Grounding: 8-10 bpm rejected against Goldbogen 2019 PNAS study
    const ungrounded = result.violations.find((v) => v.code === 'UNGROUNDED_CLAIM');
    expect(ungrounded).toBeDefined();
    expect(ungrounded?.message).toContain('Goldbogen et al. 2019 PNAS');

    // 3. Hashtags: Exactly 1 hashtag found, but 5 required
    const hashtagViolation = result.violations.find((v) => v.code === 'HASHTAG_COUNT_MISMATCH');
    expect(hashtagViolation).toBeDefined();
    expect(hashtagViolation?.offendingText).toBe('#discovery');

    // 4. Fluff Opening: pasting headline into "fascinating new insights into [Headline]..."
    const fluffOpening = result.violations.find((v) => v.code === 'FLUFF_OPENING');
    expect(fluffOpening).toBeDefined();

    // 5. Filler Phrases rejected
    const filler = result.violations.filter((v) => v.code === 'FILLER_PHRASE');
    expect(filler.length).toBeGreaterThan(0);
    expect(filler.some((f) => f.offendingText?.includes('exciting new milestone'))).toBe(true);
  });

  // Post 3: ECoG Brain-Computer Interface (Thoughts vs Intended Speech)
  it('Fixture 3: Enforces BCI wording guard rejecting "thoughts" / "mind reading"', () => {
    const headline = 'NEURAL INTERFACE DECODES SPEECH SIGNALS DIRECTLY FROM BRAIN';
    const badCaption = `Researchers have unveiled a breakthrough in ECoG brain-computer neural interface technology that can hear your thoughts directly without vocal cord movement. By placing a high-density sensor grid over the speech cortex, the device transforms thoughts into real-time synthesized audio.
#Neuroscience #BCI #BrainTech #Biomedical #Science`;

    const violations = checkFluffAndOverstatement(headline, badCaption);
    const bciViolation = violations.find((v) => v.code === 'BCI_THOUGHTS_MISUSE');
    expect(bciViolation).toBeDefined();
    expect(bciViolation?.message).toContain('decodes attempted or intended speech');

    // Now verify compliant caption passes
    const goodCaption = `Researchers have unveiled a breakthrough in ECoG brain-computer neural interface technology that decodes intended speech signals directly from the motor cortex before muscle articulation.
#Neuroscience #BCI #BrainTech #Biomedical #Science`;
    const goodViolations = checkFluffAndOverstatement(headline, goodCaption);
    expect(goodViolations.find((v) => v.code === 'BCI_THOUGHTS_MISUSE')).toBeUndefined();
  });

  // Post 4: Planck's Constant Numerical Mismatch
  it('Fixture 4: Catches numerical mismatch (0.1% in headline vs 0.08% in caption)', () => {
    const headline = "NEW QUANTUM EXPERIMENT TESTS PLANCK'S CONSTANT WITH 0.1% ACCURACY";
    const caption = `Physicists operating a cryogenic optical table have measured the quantum mechanical photon interaction, establishing that the fundamental physical constant holds with a relative uncertainty of 0.08%.
#Physics #Quantum #Photon #Laser #Optics`;

    const violations = checkContentConsistency(headline, caption, []);
    const numMismatch = violations.find((v) => v.code === 'NUMERICAL_MISMATCH');
    expect(numMismatch).toBeDefined();
    expect(numMismatch?.message).toContain('0.1%');
  });
});

describe('Image Relevance & Style Variety Engine', () => {
  it('names concrete physical subjects and enforces calm bottom 35% zone', () => {
    const promptResult = buildConcreteImagePrompt({
      headline: 'BLUE WHALE HEART PUMPS 150 LITERS PER BEAT',
      caption: 'The blue whale heart circulates blood across deep oceanic dives.',
      facts: ['PNAS 2019 study demonstrates 4-8 bpm during dives.'],
      topic: 'Blue Whale Cardiovascular Dynamics',
    });

    expect(promptResult.concreteSubject).toContain('blue whale');
    expect(promptResult.prompt).toContain('Composition Rule: Place the main focal subject in the upper 65%');
    expect(promptResult.prompt).toContain('Keep the bottom 35% calm');
    expect(promptResult.prompt).toContain('NO generic glowing blue energy');
    expect(promptResult.negativePrompt).toContain('generic blue glow');
    expect(promptResult.negativePrompt).toContain('text, letters, words');
  });

  it('rejects consecutive blue-glow visuals and enforces variety', () => {
    const recentPrompts = [
      'A glowing blue sphere with cyan vortex and blue light rays',
      'Abstract blue energy field glowing in dark deep space with blue highlights',
    ];

    const varietyCheck = checkPromptVariety('Blue glow energy vortex with neon blue light', recentPrompts);
    expect(varietyCheck.ok).toBe(false);
    expect(varietyCheck.reason).toContain('Repeated blue-glow');
  });

  it('computes prompt similarity and rejects near-identical visual compositions', () => {
    const prompt1 = 'macro photograph of rough green peridotite rock crystal in McMurdo dry valley polar terrain';
    const prompt2 = 'macro photograph of rough green peridotite rock crystal in McMurdo polar terrain';

    const similarity = computePromptSimilarity(prompt1, prompt2);
    expect(similarity).toBeGreaterThan(0.6);

    const variety = checkPromptVariety(prompt1, [prompt2]);
    expect(variety.ok).toBe(false);
  });
});

describe('Gemini Native Image Provider & Free-Tier Detection', () => {
  it('detects free-tier limit: 0 or billing errors and returns exact actionable guidance', async () => {
    const adapter = new GeminiNativeAdapter({
      apiKey: 'test-fake-key',
      model: 'gemini-2.5-flash-image',
    });

    // Mock fetch returning Gemini 403 free-tier error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () =>
        JSON.stringify({
          error: {
            code: 403,
            message:
              'The Gemini API free tier is not available for this project. To use the Gemini API, please set up billing to upgrade to the paid tier in Google Cloud Console. limit: 0.',
            status: 'PERMISSION_DENIED',
          },
        }),
    } as any);

    try {
      await expect(
        adapter.generateImage({
          prompt: 'A blue whale swimming side-view underwater',
          aspectRatio: '4:5',
        })
      ).rejects.toThrow(
        'This model is not available on the free tier. Enable billing on the Google project or use another provider.'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('evaluates image relevance with vision-capable analysis', async () => {
    const adapter = new GeminiNativeAdapter({
      apiKey: 'test-fake-key',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    passed: true,
                    relevanceScore: 92,
                    subjectIdentified: 'Blue whale swimming underwater in natural lighting',
                    hasDeformities: false,
                    hasUnwantedText: false,
                    isGenericGlow: false,
                    feedback: 'Accurate biological representation.',
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as any);

    try {
      const evaluation = await adapter.evaluateImageRelevance({
        imageBuffer: Buffer.from('fake-image-bytes'),
        headline: 'BLUE WHALE HEART PUMPS 150 LITERS PER BEAT',
        caption: 'The blue whale heart circulates blood across oceanic dives.',
      });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.relevanceScore).toBe(92);
      expect(evaluation.hasDeformities).toBe(false);
      expect(evaluation.isGenericGlow).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
