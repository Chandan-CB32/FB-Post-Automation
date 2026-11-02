import { CaptionSettings } from '../types/index.js';

export interface CaptionValidationViolation {
  rule:
    | 'length_min'
    | 'length_max'
    | 'hook_rule'
    | 'paragraph_length'
    | 'emoji_policy'
    | 'banned_phrases'
    | 'required_phrases'
    | 'disclaimer_missing';
  message: string;
  severity: 'error' | 'warning';
  currentValue?: unknown;
  expectedValue?: unknown;
}

export interface CaptionValidationResult {
  valid: boolean;
  score: number;
  wordCount: number;
  charCount: number;
  emojiCount: number;
  paragraphCount: number;
  maxSentencesFound: number;
  violations: CaptionValidationViolation[];
  suggestedFixes: string[];
}

export interface ValidateCaptionOptions {
  isFiction?: boolean;
  disclaimerLine?: string;
}

// Unicode regex for emojis
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

const BORING_GREETINGS = [
  'hello everyone',
  'hey guys',
  'hey everyone',
  'welcome back',
  'in today\'s post',
  'in this post',
  'today we will',
  'today i want to talk about',
  'let\'s talk about',
  'buckle up',
  'in today\'s fast-paced world',
];

/**
 * Counts words by splitting on whitespace.
 */
function getWordCount(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Counts emojis using Unicode Extended Pictographic property.
 */
export function countEmojis(text: string): number {
  if (!text) return 0;
  const matches = text.match(EMOJI_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Splits text into paragraphs and returns sentence counts per paragraph.
 */
function analyzeParagraphs(text: string): { paragraphs: string[]; maxSentences: number } {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  let maxSentences = 0;

  for (const p of paragraphs) {
    // Exclude disclaimer or source lines from paragraph sentence checks
    if (p.toLowerCase().startsWith('source:') || p.toLowerCase().startsWith('note:') || p.startsWith('*')) {
      continue;
    }
    const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    const count = sentences ? sentences.length : 1;
    if (count > maxSentences) {
      maxSentences = count;
    }
  }

  return { paragraphs, maxSentences };
}

/**
 * Pure deterministic validator for Facebook post captions.
 * Catches length violations, paragraph bloat, emoji overages, cliches, and missing disclaimers
 * without burning LLM tokens.
 */
export function validateCaption(
  caption: string,
  settings: CaptionSettings,
  options: ValidateCaptionOptions = {}
): CaptionValidationResult {
  const violations: CaptionValidationViolation[] = [];
  const suggestedFixes: string[] = [];

  const rawText = (caption || '').trim();
  const wordCount = getWordCount(rawText);
  const charCount = rawText.length;
  const emojiCount = countEmojis(rawText);

  const { paragraphs, maxSentences } = analyzeParagraphs(rawText);
  const paragraphCount = paragraphs.length;

  const unit = settings.unit || 'words';
  const currentCount = unit === 'characters' ? charCount : wordCount;
  const minTarget = settings.min;
  const maxTarget = settings.max;

  // 1. Length Checks
  if (minTarget !== undefined && currentCount < minTarget) {
    violations.push({
      rule: 'length_min',
      message: `Caption length (${currentCount} ${unit}) is below minimum target of ${minTarget} ${unit}.`,
      severity: 'error',
      currentValue: currentCount,
      expectedValue: minTarget,
    });
    suggestedFixes.push(`Expand post narrative with deeper sensory details to reach at least ${minTarget} ${unit}.`);
  }

  if (maxTarget !== undefined && currentCount > maxTarget) {
    violations.push({
      rule: 'length_max',
      message: `Caption length (${currentCount} ${unit}) exceeds maximum target of ${maxTarget} ${unit}.`,
      severity: 'error',
      currentValue: currentCount,
      expectedValue: maxTarget,
    });
    suggestedFixes.push(`Trim extraneous exposition to stay under ${maxTarget} ${unit}.`);
  }

  // 2. Hook Rule Check (Opening lines)
  if (settings.hookRule && paragraphs.length > 0) {
    const firstParagraph = paragraphs[0].toLowerCase();
    const hasBoringGreeting = BORING_GREETINGS.some((g) => firstParagraph.startsWith(g));
    if (hasBoringGreeting) {
      violations.push({
        rule: 'hook_rule',
        message: 'Opening hook starts with a generic greeting or conversational filler.',
        severity: 'error',
        currentValue: paragraphs[0].slice(0, 50),
      });
      suggestedFixes.push('Replace opening greeting with an immediate scroll-stopping hook statement or mystery.');
    }
  }

  // 3. Max Sentences Per Paragraph (Mobile Readability)
  const maxAllowedSentences = settings.maxSentencesPerParagraph || 3;
  if (maxSentences > maxAllowedSentences) {
    violations.push({
      rule: 'paragraph_length',
      message: `Found wall-of-text paragraph with ${maxSentences} sentences (max allowed is ${maxAllowedSentences}).`,
      severity: 'warning',
      currentValue: maxSentences,
      expectedValue: maxAllowedSentences,
    });
    suggestedFixes.push(`Split paragraphs containing more than ${maxAllowedSentences} sentences into smaller 1-3 sentence blocks.`);
  }

  // 4. Emoji Policy Check
  const emojiPolicy = settings.voice?.emojiPolicy || 'minimal';
  if (emojiPolicy === 'none' && emojiCount > 0) {
    violations.push({
      rule: 'emoji_policy',
      message: `Emoji policy is 'none', but found ${emojiCount} emoji(s).`,
      severity: 'error',
      currentValue: emojiCount,
      expectedValue: 0,
    });
    suggestedFixes.push('Strip all emojis from caption prose.');
  } else if (emojiPolicy === 'minimal' && emojiCount > 2) {
    violations.push({
      rule: 'emoji_policy',
      message: `Emoji policy is 'minimal' (max 2), but found ${emojiCount} emoji(s).`,
      severity: 'warning',
      currentValue: emojiCount,
      expectedValue: 2,
    });
    suggestedFixes.push('Reduce emoji usage to at most 1 or 2 subtle accents.');
  } else if (emojiPolicy === 'moderate' && emojiCount > Math.max(paragraphCount, 5)) {
    violations.push({
      rule: 'emoji_policy',
      message: `Emoji count (${emojiCount}) is excessive for 'moderate' policy.`,
      severity: 'warning',
      currentValue: emojiCount,
      expectedValue: paragraphCount,
    });
    suggestedFixes.push('Tone down emoji frequency to at most 1 per paragraph.');
  }

  // 5. Banned Phrases Check
  const bannedList = settings.voice?.bannedPhrases || [];
  const lowerCaption = rawText.toLowerCase();

  for (const phrase of bannedList) {
    const cleanPhrase = phrase.trim().toLowerCase();
    if (cleanPhrase && lowerCaption.includes(cleanPhrase)) {
      violations.push({
        rule: 'banned_phrases',
        message: `Forbidden phrase detected: "${phrase}".`,
        severity: 'error',
        currentValue: phrase,
      });
      suggestedFixes.push(`Remove or rephrase forbidden cliche: "${phrase}".`);
    }
  }

  // 6. Required Phrases Check
  const requiredList = settings.voice?.requiredPhrases || [];
  for (const phrase of requiredList) {
    const cleanPhrase = phrase.trim().toLowerCase();
    if (cleanPhrase && !lowerCaption.includes(cleanPhrase)) {
      violations.push({
        rule: 'required_phrases',
        message: `Required phrase missing: "${phrase}".`,
        severity: 'error',
        currentValue: null,
        expectedValue: phrase,
      });
      suggestedFixes.push(`Incorporate required phrase: "${phrase}".`);
    }
  }

  // 7. Fiction Disclaimer Check
  if (options.isFiction) {
    const hasDisclaimer =
      lowerCaption.includes('fictional') ||
      lowerCaption.includes('fiction') ||
      lowerCaption.includes('resemblance to real') ||
      (options.disclaimerLine && lowerCaption.includes(options.disclaimerLine.toLowerCase()));

    if (!hasDisclaimer) {
      violations.push({
        rule: 'disclaimer_missing',
        message: 'Fiction profile post is missing the mandatory fiction disclaimer line.',
        severity: 'error',
        expectedValue: options.disclaimerLine || 'Note: This is an original fictional story for entertainment purposes.',
      });
      suggestedFixes.push('Append the mandatory fiction disclaimer to the footer of the post.');
    }
  }

  // Calculate deterministic score (0 - 100)
  let score = 100;
  for (const v of violations) {
    score -= v.severity === 'error' ? 25 : 10;
  }
  score = Math.max(0, Math.min(100, score));

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const valid = errorCount === 0;

  return {
    valid,
    score,
    wordCount,
    charCount,
    emojiCount,
    paragraphCount,
    maxSentencesFound: maxSentences,
    violations,
    suggestedFixes,
  };
}

/**
 * Automatically repairs minor formatting defects:
 * - Strips emojis if policy is 'none'
 * - Splits paragraphs exceeding max sentences
 * - Appends missing fiction disclaimer
 */
export function repairCaption(
  caption: string,
  settings: CaptionSettings,
  options: ValidateCaptionOptions = {}
): string {
  let text = (caption || '').trim();

  // Strip emojis if none allowed
  if (settings.voice?.emojiPolicy === 'none') {
    text = text.replace(EMOJI_REGEX, '').replace(/\s{2,}/g, ' ');
  }

  // Split bloated paragraphs
  const maxSentences = settings.maxSentencesPerParagraph || 3;
  const rawParagraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const repairedParagraphs: string[] = [];

  for (const p of rawParagraphs) {
    if (p.toLowerCase().startsWith('source:') || p.toLowerCase().startsWith('note:') || p.startsWith('*')) {
      repairedParagraphs.push(p);
      continue;
    }
    const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    if (!sentences || sentences.length <= maxSentences) {
      repairedParagraphs.push(p);
      continue;
    }
    for (let i = 0; i < sentences.length; i += maxSentences) {
      const chunk = sentences.slice(i, i + maxSentences).join('').trim();
      if (chunk) {
        repairedParagraphs.push(chunk);
      }
    }
  }

  text = repairedParagraphs.join('\n\n');

  // Append disclaimer if fiction and missing
  if (options.isFiction) {
    const lower = text.toLowerCase();
    const hasDisclaimer =
      lower.includes('fictional') ||
      lower.includes('fiction') ||
      lower.includes('resemblance to real');

    if (!hasDisclaimer) {
      const disclaimer =
        options.disclaimerLine ||
        settings.disclaimerLine ||
        '*Note: This is an original fictional story for entertainment purposes.*';
      text = `${text}\n\n${disclaimer}`;
    }
  }

  return text;
}
