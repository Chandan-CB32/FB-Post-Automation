import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  countWords,
  planSectionBudgets,
  formatParagraphs,
} from '../worker/src/stages/chunker.js';
import {
  executeWriteStage,
} from '../worker/src/stages/04-write.js';
import { ProviderRouter } from '../worker/src/router/provider-router.js';
import {
  createHorrorStoryProfile,
  createScienceStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';

describe('Long-Form Writer & Chunker Pipeline (Step 7.2)', () => {
  let router: ProviderRouter;

  beforeEach(() => {
    router = new ProviderRouter();
    vi.restoreAllMocks();
  });

  describe('Chunker Utilities', () => {
    it('accurately counts words across diverse spacing', () => {
      expect(countWords('The quick brown fox jumps over the lazy dog.')).toBe(9);
      expect(countWords('   Multiple   spaces \n\n and tabs \t here.  ')).toBe(5);
      expect(countWords('')).toBe(0);
    });

    it('plans section budgets distributing target words across 4 narrative phases', () => {
      const outline = planSectionBudgets(800, 4);
      expect(outline.length).toBe(4);
      const totalBudget = outline.reduce((sum, s) => sum + s.targetWords, 0);
      expect(totalBudget).toBe(800);
      expect(outline[0].title).toContain('Hook');
      expect(outline[2].title).toContain('Climactic');
      expect(outline[3].title).toContain('Aftermath');
    });

    it('formats paragraphs into max N sentences for mobile readability', () => {
      const longParagraph =
        'Sentence one is here. Sentence two follows it closely! Sentence three wraps the first part? ' +
        'Sentence four begins a new thought. Sentence five continues that thought. Sentence six concludes it.';

      const formatted = formatParagraphs(longParagraph, 3);
      const paragraphs = formatted.split(/\n\s*\n/);
      expect(paragraphs.length).toBe(2);
      expect(paragraphs[0]).toContain('Sentence one');
      expect(paragraphs[0]).toContain('Sentence three');
      expect(paragraphs[1]).toContain('Sentence four');
      expect(paragraphs[1]).toContain('Sentence six');
    });
  });

  describe('Short-Form Direct Generation (<250 words)', () => {
    it('executes direct single-pass generation when target is below 250 words', async () => {
      const scienceProfile = createScienceStoryProfile();
      const settings = resolveSettings({
        profile: scienceProfile,
        page: {
          overrides: {
            'caption.target': 150,
          },
        },
      });

      const mockText =
        'In 1977, the Big Ear radio telescope in Ohio detected an anomalous 72-second signal from deep space. ' +
        'Astronomer Jerry Ehman circled the data and wrote "Wow!" in the margin. ' +
        'To this day, the signal has never repeated, remaining one of astrophysics\' greatest enigmas. #SpaceFacts #Astronomy';

      const executeSpy = vi.spyOn(router, 'executeText').mockResolvedValue({
        text: mockText,
        providerId: 'p-writer',
        providerName: 'Mock Provider',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-gpt-4o',
        tokens: { promptTokens: 100, completionTokens: 60, totalTokens: 160 },
        latencyMs: 250,
      });

      const result = await executeWriteStage({
        profile: scienceProfile,
        effectiveSettings: settings,
        router,
        topic: 'The Wow! Signal',
        category: 'Astrophysics',
        facts: ['Detected on August 15, 1977', 'Lasted 72 seconds', 'Never repeated'],
        sourceLine: 'Source: Ohio State University Radio Observatory Archives',
      });

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(result.isChunked).toBe(false);
      expect(result.sections.length).toBe(1);
      expect(result.wordCount).toBeGreaterThan(30);
      expect(result.hashtags).toContain('#SpaceFacts');
      expect(result.sourceLine).toContain('Ohio State University');
      expect(result.disclaimer).toBeNull(); // Factual profile has no fiction disclaimer
    });
  });

  describe('Long-Form Chunked Writing (>=250 words)', () => {
    it('executes 4-section sequential chunking, stitching, and polish for long stories', async () => {
      const horrorProfile = createHorrorStoryProfile();
      const settings = resolveSettings({
        profile: horrorProfile,
        page: {
          overrides: {
            'caption.target': 600,
          },
        },
      });

      // Mock 4 section generations + 1 polish pass
      let callCount = 0;
      const executeSpy = vi.spyOn(router, 'executeText').mockImplementation(async (stage, opts) => {
        callCount++;
        const prompt = opts.prompt || '';

        // Verify safety baseline was injected into prompt
        expect(prompt).toContain('MANDATORY PLATFORM SAFETY BASELINE');

        if (stage === 'write') {
          return {
            text: `Section prose ${callCount}. The shadows stretched across Blackwood Manor as midnight arrived. Unexplained whispers echoed from the locked grandfather clock.`,
            providerId: 'p-writer',
            providerName: 'Mock Writer',
            keyMasked: 'sk-...1234',
            modelUsed: 'mock-gpt-4o',
            tokens: { promptTokens: 150, completionTokens: 80, totalTokens: 230 },
            latencyMs: 300,
          };
        }

        if (stage === 'polish') {
          return {
            text: `The shadows stretched across Blackwood Manor as midnight arrived.\n\nUnexplained whispers echoed from the locked grandfather clock in the study.\n\nBy dawn, the clock was ticking backwards. #HorrorStories #DarkTales`,
            providerId: 'p-polish',
            providerName: 'Mock Polisher',
            keyMasked: 'sk-...1234',
            modelUsed: 'mock-gpt-4o',
            tokens: { promptTokens: 400, completionTokens: 150, totalTokens: 550 },
            latencyMs: 400,
          };
        }

        throw new Error(`Unexpected stage: ${stage}`);
      });

      const result = await executeWriteStage({
        profile: horrorProfile,
        effectiveSettings: settings,
        router,
        topic: 'The Grandfather Clock of Blackwood Manor',
        category: 'Cursed Relics',
        premise: 'A clock that ticks backward whenever someone is about to disappear.',
      });

      // 4 sections + 1 polish = 5 calls
      expect(executeSpy).toHaveBeenCalledTimes(5);
      expect(result.isChunked).toBe(true);
      expect(result.sections.length).toBe(4);
      expect(result.outline.length).toBe(4);
      expect(result.disclaimer).toContain('Fictional story');
      expect(result.hashtags).toContain('#HorrorStories');
      expect(result.totalTokens.totalTokens).toBe(230 * 4 + 550);
      expect(result.caption).toContain('Blackwood Manor');
    });

    it('passes series continuity memory into section generation', async () => {
      const horrorProfile = createHorrorStoryProfile();
      const settings = resolveSettings({
        profile: horrorProfile,
        page: {
          overrides: {
            'caption.target': 400,
          },
        },
      });

      const promptsCaptured: string[] = [];
      vi.spyOn(router, 'executeText').mockImplementation(async (stage, opts) => {
        promptsCaptured.push(opts.prompt || '');
        return {
          text: 'Episode 5 narrative section text.',
          providerId: 'p-writer',
          providerName: 'Mock Provider',
          keyMasked: 'sk-...1234',
          modelUsed: 'mock-gpt-4o',
          tokens: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
          latencyMs: 100,
        };
      });

      await executeWriteStage({
        profile: horrorProfile,
        effectiveSettings: settings,
        router,
        topic: 'Episode 5: The Crypt Door',
        storyBible: 'Series Bible: Protagonist Elena searching for her missing brother.',
        storySoFar: 'In Episode 4, Elena found the key in the cemetery.',
        episodeNumber: 5,
      });

      expect(promptsCaptured.length).toBeGreaterThanOrEqual(4);
      // Section prompts should receive series bible
      expect(promptsCaptured[0]).toContain('Protagonist Elena searching for her missing brother');
    });
  });
});
