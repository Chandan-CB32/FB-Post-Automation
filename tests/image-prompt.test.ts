import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractKeySceneFromProse,
  executeImagePromptStage,
} from '../worker/src/stages/06-image-prompt.js';
import {
  createHorrorStoryProfile,
  createScienceStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';
import { IMAGE_SAFETY_BASELINE } from '../packages/core/src/prompt-engine/safety-baseline.js';

describe('Key Scene Extractor & Image Prompt Builder (Step 8.1)', () => {
  const sampleStory = `
The salt-crusted lantern flickered over the rusted dock as midnight arrived in Blackwood Bay.

Old captain Vance adjusted his heavy wool pea coat, staring out into the churning sea where no ships were supposed to sail.

Suddenly, a massive 19th-century schooner emerged silently through the violet sea mist, its black sails glowing with pale luminescence.

The phantom vessel drifted toward the rocks, leaving no wake in the dark waters.
  `.trim();

  describe('Key Scene Extraction Modes', () => {
    it('extracts setting and opening hook under opening mode', () => {
      const scene = extractKeySceneFromProse(sampleStory, 'The Ghost Ship of Blackwood Bay', 'opening');
      expect(scene).toContain('salt-crusted lantern flickered');
    });

    it('extracts dramatic revelation under climax mode', () => {
      const scene = extractKeySceneFromProse(sampleStory, 'The Ghost Ship of Blackwood Bay', 'climax');
      expect(scene).toContain('schooner emerged silently through the violet sea mist');
    });

    it('extracts atmospheric ambience under mood mode', () => {
      const scene = extractKeySceneFromProse(sampleStory, 'The Ghost Ship of Blackwood Bay', 'mood');
      expect(scene).toContain('midnight');
    });

    it('extracts central figure under character mode', () => {
      const scene = extractKeySceneFromProse(sampleStory, 'The Ghost Ship of Blackwood Bay', 'character');
      expect(scene).toContain('captain Vance adjusted his heavy wool pea coat');
    });

    it('prioritizes seedConcept when provided', () => {
      const customConcept = 'A glowing phantom galleon trapped inside an iceberg in the Arctic';
      const scene = extractKeySceneFromProse(
        sampleStory,
        'The Ghost Ship of Blackwood Bay',
        'climax',
        customConcept
      );
      expect(scene).toBe(customConcept);
    });
  });

  describe('Image Prompt Assembly & Safety Baseline', () => {
    it('interpolates key scene and style, permanently appending mandatory image safety baseline', async () => {
      const horrorProfile = createHorrorStoryProfile();
      const settings = resolveSettings({
        profile: horrorProfile,
        page: {
          overrides: {
            'image.style': 'dark atmospheric 35mm film photography, cold color grading',
          },
        },
      });

      const result = await executeImagePromptStage({
        profile: horrorProfile,
        effectiveSettings: settings,
        topic: 'The Phantom Schooner',
        caption: sampleStory,
        keySceneMode: 'climax',
      });

      expect(result.prompt).toContain(result.keyScene);
      expect(result.prompt).toContain('dark atmospheric 35mm film photography');
      // Verifies mandatory safety baseline
      expect(result.prompt).toContain(IMAGE_SAFETY_BASELINE);
      expect(result.prompt).toContain('no text inside the image');
      expect(result.prompt).toContain('no graphic violence, no gore');
    });

    it('consolidates negative prompt terms without duplicate keywords', async () => {
      const scienceProfile = createScienceStoryProfile();
      const settings = resolveSettings({
        profile: scienceProfile,
        page: {
          overrides: {
            'image.negativePrompt': 'oversaturated, blurry, cartoon, extra fingers',
          },
        },
      });

      const result = await executeImagePromptStage({
        profile: scienceProfile,
        effectiveSettings: settings,
        topic: 'Neutron Star Collision',
        caption: 'Two neutron stars spiraled together in a cosmic burst of gold.',
      });

      expect(result.negativePrompt).toContain('blurry');
      expect(result.negativePrompt).toContain('extra fingers');
      expect(result.negativePrompt).toContain('watermark');
      // Verify deduplication
      const tokens = result.negativePrompt.split(',').map((t) => t.trim());
      const uniqueTokens = new Set(tokens);
      expect(tokens.length).toBe(uniqueTokens.size);
    });

    it('correctly sets dimensions for 4:5, 1:1, and 16:9 aspect ratios', async () => {
      const profile = createScienceStoryProfile();

      // 4:5 portrait (default)
      const res45 = await executeImagePromptStage({
        profile,
        effectiveSettings: resolveSettings({
          profile,
          page: { overrides: { 'image.aspectRatio': '4:5' } },
        }),
        topic: 'Topic',
        caption: 'Story text here.',
      });
      expect(res45.aspectRatio).toBe('4:5');
      expect(res45.width).toBe(1080);
      expect(res45.height).toBe(1350);

      // 1:1 square
      const res11 = await executeImagePromptStage({
        profile,
        effectiveSettings: resolveSettings({
          profile,
          page: { overrides: { 'image.aspectRatio': '1:1' } },
        }),
        topic: 'Topic',
        caption: 'Story text here.',
      });
      expect(res11.aspectRatio).toBe('1:1');
      expect(res11.width).toBe(1080);
      expect(res11.height).toBe(1080);

      // 16:9 landscape
      const res169 = await executeImagePromptStage({
        profile,
        effectiveSettings: resolveSettings({
          profile,
          page: { overrides: { 'image.aspectRatio': '16:9' } },
        }),
        topic: 'Topic',
        caption: 'Story text here.',
      });
      expect(res169.aspectRatio).toBe('16:9');
      expect(res169.width).toBe(1920);
      expect(res169.height).toBe(1080);
    });
  });
});
