import { describe, it, expect } from 'vitest';
import {
  validateCaption,
  repairCaption,
  countEmojis,
} from '../packages/core/src/validation/caption-validator.js';
import { CaptionSettings } from '../packages/core/src/types/index.js';

describe('Programmatic Caption Validator (Step 7.3)', () => {
  const baseSettings: CaptionSettings = {
    unit: 'words',
    min: 50,
    target: 100,
    max: 150,
    hookRule: true,
    maxSentencesPerParagraph: 3,
    voice: {
      tone: 'dramatic',
      pov: 'third-person',
      emojiPolicy: 'minimal',
      bannedPhrases: ["in today's fast-paced world", 'game changer'],
      requiredPhrases: [],
    },
    endingStyle: 'cliffhanger',
    includeQuestion: true,
    formatSourceLine: false,
  };

  describe('Length Boundaries', () => {
    it('flags captions below the minimum word count', () => {
      const shortText = 'This is far too short to meet the minimum threshold.';
      const result = validateCaption(shortText, baseSettings);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'length_min')).toBe(true);
      expect(result.score).toBeLessThan(100);
    });

    it('flags captions exceeding the maximum word count', () => {
      const longText = 'word '.repeat(200);
      const result = validateCaption(longText, baseSettings);

      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'length_max')).toBe(true);
    });

    it('passes captions within the configured range', () => {
      const validText =
        'The antique mirror was discovered in a secluded attic in Maine.\n\n' +
        'Local historians were shocked to find that every reflection seemed delayed by three seconds.\n\n' +
        'By midnight, the delay grew even longer, revealing spectral figures that had vanished centuries ago into the darkness. ' +
        'What secrets remain hidden behind the cursed silver glass?';

      const result = validateCaption(validText, baseSettings);
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
      expect(result.score).toBe(100);
    });
  });

  describe('Hook Rule & Opening Lines', () => {
    it('flags generic greeting filler in the opening line', () => {
      const textWithGreeting =
        'Hello everyone! Welcome to today\'s post about an antique mirror found in Maine.\n\n' +
        'Local historians were shocked by the bizarre reflections inside the glass.\n\n' +
        'By midnight, the shadows refused to leave.';

      const result = validateCaption(textWithGreeting, { ...baseSettings, min: 20 });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'hook_rule')).toBe(true);
    });
  });

  describe('Paragraph Sentence Length & Mobile Readability', () => {
    it('warns when a paragraph contains more than the allowed sentences', () => {
      const wallOfText =
        'The clock struck twelve. The lights flickered across the corridor. A cold draft swept the room. ' +
        'Footsteps sounded on the floorboards above. The cellar door creaked open slowly.'; // 5 sentences

      const result = validateCaption(wallOfText, { ...baseSettings, min: 20, maxSentencesPerParagraph: 3 });
      expect(result.violations.some((v) => v.rule === 'paragraph_length')).toBe(true);
      expect(result.maxSentencesFound).toBe(5);
    });
  });

  describe('Emoji Policy Enforcement', () => {
    it('counts emojis accurately', () => {
      expect(countEmojis('No emojis here.')).toBe(0);
      expect(countEmojis('Spooky ghost 👻 in the house 🏚️!')).toBe(2);
    });

    it('flags any emoji when policy is none', () => {
      const text = 'A terrifying shadow appeared 👻 in the mist.';
      const noEmojiSettings: CaptionSettings = {
        ...baseSettings,
        min: 5,
        voice: { ...baseSettings.voice, emojiPolicy: 'none' },
      };

      const result = validateCaption(text, noEmojiSettings);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'emoji_policy')).toBe(true);
    });

    it('warns when minimal policy is exceeded (>2 emojis)', () => {
      const text = 'Spooky 👻 shadows 💀 in the dark 😱 night!';
      const result = validateCaption(text, { ...baseSettings, min: 5 });
      expect(result.violations.some((v) => v.rule === 'emoji_policy')).toBe(true);
    });
  });

  describe('Banned & Required Phrases', () => {
    it('flags forbidden cliches', () => {
      const text =
        'In today\'s fast-paced world, an ancient relic was found in the mountains.\n\n' +
        'It was an absolute game changer for local researchers.';

      const result = validateCaption(text, { ...baseSettings, min: 20 });
      expect(result.valid).toBe(false);
      const bannedViolations = result.violations.filter((v) => v.rule === 'banned_phrases');
      expect(bannedViolations.length).toBe(2);
    });

    it('flags when required phrases are missing', () => {
      const requiredSettings: CaptionSettings = {
        ...baseSettings,
        min: 10,
        voice: {
          ...baseSettings.voice,
          requiredPhrases: ['Read the full story below', 'Comment your thoughts'],
        },
      };

      const text = 'An eerie sound was heard in the woods. Nobody could explain the glowing lights.';
      const result = validateCaption(text, requiredSettings);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'required_phrases')).toBe(true);
    });
  });

  describe('Fiction Disclaimer Validation', () => {
    it('flags missing disclaimer when isFiction is true', () => {
      const fictionText =
        'The vampire walked through the crowded streets of London unnoticed.\n\n' +
        'He smiled as the clock struck midnight, vanishing into the fog.';

      const result = validateCaption(fictionText, { ...baseSettings, min: 20 }, { isFiction: true });
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.rule === 'disclaimer_missing')).toBe(true);
    });

    it('passes when fiction disclaimer is included', () => {
      const fictionText =
        'The vampire walked through the crowded streets of London unnoticed.\n\n' +
        'He smiled as the clock struck midnight, vanishing into the fog.\n\n' +
        '*Note: This is an original fictional story for entertainment purposes.*';

      const result = validateCaption(fictionText, { ...baseSettings, min: 20 }, { isFiction: true });
      expect(result.valid).toBe(true);
      expect(result.violations.some((v) => v.rule === 'disclaimer_missing')).toBe(false);
    });
  });

  describe('Caption Repair Utility', () => {
    it('splits bloated paragraphs, strips emojis under none policy, and appends missing disclaimer', () => {
      const messyCaption =
        'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five. 🔥\n\n' +
        'Sentence six. Sentence seven. Sentence eight. Sentence nine.';

      const settings: CaptionSettings = {
        ...baseSettings,
        maxSentencesPerParagraph: 2,
        voice: { ...baseSettings.voice, emojiPolicy: 'none' },
      };

      const repaired = repairCaption(messyCaption, settings, { isFiction: true });

      // No emojis remain
      expect(countEmojis(repaired)).toBe(0);

      // Paragraphs were split into smaller chunks
      const paragraphs = repaired.split(/\n\s*\n/);
      expect(paragraphs.length).toBeGreaterThanOrEqual(4);

      // Fiction disclaimer was appended
      expect(repaired).toContain('fictional story');
    });
  });
});
