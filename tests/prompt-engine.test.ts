import { describe, it, expect } from 'vitest';
import { interpolatePrompt } from '../packages/core/src/prompt-engine/interpolator.js';
import {
  injectSafetyBaseline,
  TEXT_SAFETY_BASELINE,
  IMAGE_SAFETY_BASELINE,
  QA_SAFETY_CRITERIA,
} from '../packages/core/src/prompt-engine/safety-baseline.js';

describe('Prompt Engine & Safety Baseline Injection', () => {
  describe('Safety Baseline Injection', () => {
    it('injects text safety baseline permanently', () => {
      const userPrompt = 'Write a horror story about an abandoned hospital.';
      const injected = injectSafetyBaseline(userPrompt, 'text');

      expect(injected).toContain(userPrompt);
      expect(injected).toContain(TEXT_SAFETY_BASELINE);
      expect(injected).toContain('no graphic gore or gratuitous violence');
      expect(injected).toContain('Never invent fabricated quotes');
    });

    it('injects image safety baseline', () => {
      const imgPrompt = 'Cinematic photograph of a foggy Victorian alleyway';
      const injected = injectSafetyBaseline(imgPrompt, 'image');

      expect(injected).toContain(imgPrompt);
      expect(injected).toContain(IMAGE_SAFETY_BASELINE);
      expect(injected).toContain('no real living persons likeness');
    });

    it('injects QA safety criteria', () => {
      const qaPrompt = 'Evaluate caption quality';
      const injected = injectSafetyBaseline(qaPrompt, 'qa');

      expect(injected).toContain(QA_SAFETY_CRITERIA);
    });

    it('does not duplicate safety baseline if already present', () => {
      const prompt = `Write a post.\n\n${TEXT_SAFETY_BASELINE}`;
      const injected = injectSafetyBaseline(prompt, 'text');

      expect(injected).toBe(prompt);
    });
  });

  describe('Prompt Interpolation', () => {
    it('replaces all standard variables and appends safety baseline', () => {
      const template =
        'Write a {{tone}} post for {{audience}} about {{topic}} targeting {{word_target}} words. Page: {{page_name}}.';

      const result = interpolatePrompt(template, {
        tone: 'mysterious and suspenseful',
        audience: 'History Buffs',
        topic: 'The Amber Room disappearance',
        word_target: 650,
        page_name: 'Historical Enigmas',
      });

      expect(result.prompt).toContain(
        'Write a mysterious and suspenseful post for History Buffs about The Amber Room disappearance targeting 650 words. Page: Historical Enigmas.'
      );
      expect(result.prompt).toContain(TEXT_SAFETY_BASELINE);
      expect(result.unresolvedVariables).toEqual([]);
    });

    it('formats array variables as structured bullet points', () => {
      const template = 'Use only these verified facts:\n{{facts}}\n\nSources:\n{{sources}}';

      const result = interpolatePrompt(template, {
        facts: [
          'James Webb discovered 6 massive candidate galaxies.',
          'The galaxies existed 500-700 million years after the Big Bang.',
        ],
        sources: [
          'https://nasa.gov/webb-early-galaxies',
          'https://nature.com/articles/s41586-023-05786-2',
        ],
      });

      expect(result.prompt).toContain('- James Webb discovered 6 massive candidate galaxies.');
      expect(result.prompt).toContain('- The galaxies existed 500-700 million years after the Big Bang.');
      expect(result.prompt).toContain('- https://nasa.gov/webb-early-galaxies');
    });

    it('interpolates owner-defined custom variables ({{custom.<name>}})', () => {
      const template = 'Story about {{topic}}. Call to action: {{custom.footer_cta}}';

      const result = interpolatePrompt(template, {
        topic: 'Ghost Ship Mary Celeste',
        custom: {
          footer_cta: 'Follow our page for daily maritime mysteries!',
        },
      });

      expect(result.prompt).toContain('Story about Ghost Ship Mary Celeste.');
      expect(result.prompt).toContain('Call to action: Follow our page for daily maritime mysteries!');
      expect(result.unresolvedVariables).toEqual([]);
    });

    it('identifies unresolved variables and flags them cleanly', () => {
      const template = 'Generate post about {{topic}} with {{undefined_var_123}}.';

      const result = interpolatePrompt(template, {
        topic: 'Black Hole Echoes',
      });

      expect(result.prompt).toContain('Generate post about Black Hole Echoes with {{undefined_var_123}}.');
      expect(result.unresolvedVariables).toEqual(['undefined_var_123']);
    });
  });
});
