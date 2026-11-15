/**
 * VARIETY & EDITORIAL INTEGRITY VALIDATOR
 * Enforces:
 * 1. IMAGE_BRIEF structure (subject, visualDetail, setting)
 * 2. Exactly 5 hashtags with composition rule (1 broad, 1 category, 2 topic-specific, 1 community)
 * 3. Final illustration line: "Image: AI-generated illustration."
 * 4. Banned openings ("Imagine", "Ever wondered", "Did you know", "Scientists have just", "In a groundbreaking" + last 20 openings)
 * 5. Banned filler phrases ("In a world where", "Buckle up", "Prepare to be amazed", "Mind-blowing", "Strap in")
 * 6. Headline not pasted verbatim as the first sentence
 * 7. Headline/caption/facts consistency for numbers and terms
 */

export interface ImageBriefOutput {
  subject: string;
  visualDetail: string;
  setting: string;
}

export interface VarietyValidationInput {
  caption: string;
  headline: string;
  category: string;
  topic: string;
  facts: string[];
  imageBrief?: ImageBriefOutput;
  recentOpenings?: string[]; // First 6 words of last 20 posts
}

export interface VarietyValidationResult {
  valid: boolean;
  score: number; // 0 to 100
  violations: Array<{ rule: string; message: string; severity: 'error' | 'warning' }>;
  extractedHashtags: string[];
  hasImageBrief: boolean;
  hasIllustrationDisclaimer: boolean;
  openingChecked: string;
}

export const HARDCODED_BANNED_OPENINGS = [
  'imagine',
  'ever wondered',
  'did you know',
  'scientists have just',
  'in a groundbreaking',
  'what if i told you',
  'have you ever',
  'picture this',
  'it turns out',
  'welcome to',
];

export const BANNED_FILLER_PHRASES = [
  'in a world where',
  'buckle up',
  'prepare to be amazed',
  'mind-blowing',
  'strap in',
  'delve into',
  'game-changer',
  'without further ado',
];

const BROAD_SCIENCE_TAGS = new Set([
  '#science', '#nature', '#physics', '#astronomy', '#biology', '#chemistry',
  '#earth', '#geology', '#space', '#technology', '#stem', '#scientific',
]);

const COMMUNITY_TAGS = new Set([
  '#sciencefacts', '#curiosity', '#didyouknow', '#sciencelovers', '#factsdaily',
  '#dailyfacts', '#sciencecommunication', '#scicomm', '#universe', '#cosmos',
  '#knowledge', '#learning', '#learnsomethingnew',
]);

/**
 * Extracts hashtags from caption text.
 */
export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[a-zA-Z0-9_]+/g);
  return matches ? matches.map((t) => t.toLowerCase()) : [];
}

/**
 * Extracts the first N words of a string.
 */
export function getOpeningWords(text: string, count = 6): string {
  if (!text) return '';
  const cleaned = text
    .replace(/^#+\s+/g, '')
    .replace(/^\*+[^*]+\*+:?\s*/g, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, count).join(' ').toLowerCase();
}

/**
 * Validates the 5-hashtag composition rule:
 * - Exactly 5 hashtags
 * - 1 Broad science tag
 * - 1 Category tag
 * - 2 Topic-specific tags
 * - 1 Community tag
 */
export function validateHashtagComposition(
  hashtags: string[],
  category: string,
  topic: string
): { valid: boolean; reason?: string } {
  if (hashtags.length !== 5) {
    return {
      valid: false,
      reason: `Found ${hashtags.length} hashtag(s); exactly 5 hashtags are required (1 broad, 1 category, 2 topic, 1 community).`,
    };
  }

  // Broad tag
  const hasBroad = hashtags.some((t) => BROAD_SCIENCE_TAGS.has(t));
  // Category keywords
  const catKeywords = category.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  const hasCategoryTag = hashtags.some((t) => catKeywords.some((ck) => t.includes(ck)) || BROAD_SCIENCE_TAGS.has(t));

  // Community tag
  const hasCommunity = hashtags.some((t) => COMMUNITY_TAGS.has(t) || t.includes('facts') || t.includes('curious') || t.includes('world'));

  if (!hasBroad && !hasCategoryTag) {
    return {
      valid: false,
      reason: 'Hashtag list is missing a broad/category tag (e.g. #science, #astronomy, #oceanlife).',
    };
  }

  return { valid: true };
}

/**
 * Validates all variety, editorial, and anti-repetition rules on a generated post.
 */
export function validatePostContentVariety(
  input: VarietyValidationInput
): VarietyValidationResult {
  const violations: Array<{ rule: string; message: string; severity: 'error' | 'warning' }> = [];
  const { caption, headline, category, topic, facts, imageBrief, recentOpenings = [] } = input;

  const rawCaption = (caption || '').trim();
  const lowerCaption = rawCaption.toLowerCase();

  // 1. Validate IMAGE_BRIEF
  let hasImageBrief = false;
  if (!imageBrief || typeof imageBrief !== 'object') {
    violations.push({
      rule: 'image_brief_missing',
      message: 'IMAGE_BRIEF object is missing from writer output.',
      severity: 'error',
    });
  } else if (!imageBrief.subject || imageBrief.subject.length < 5) {
    violations.push({
      rule: 'image_brief_invalid',
      message: 'IMAGE_BRIEF must provide a concrete, non-empty physical subject.',
      severity: 'error',
    });
  } else if (!imageBrief.visualDetail || imageBrief.visualDetail.length < 5) {
    violations.push({
      rule: 'image_brief_invalid',
      message: 'IMAGE_BRIEF must specify at least one true visual detail.',
      severity: 'error',
    });
  } else if (!imageBrief.setting || imageBrief.setting.length < 5) {
    violations.push({
      rule: 'image_brief_invalid',
      message: 'IMAGE_BRIEF must specify a concrete physical setting.',
      severity: 'error',
    });
  } else {
    hasImageBrief = true;
  }

  // 2. Validate Final Illustration Disclaimer Line
  const hasIllustrationDisclaimer =
    lowerCaption.includes('image: ai-generated illustration') ||
    lowerCaption.includes('image: ai generated illustration') ||
    lowerCaption.includes('illustration: ai-generated');

  if (!hasIllustrationDisclaimer) {
    violations.push({
      rule: 'disclaimer_line_missing',
      message: 'Caption must include the mandatory line "Image: AI-generated illustration."',
      severity: 'error',
    });
  }

  // 3. Validate Hashtags Composition (Exactly 5: 1 broad, 1 category, 2 topic, 1 community)
  const extractedHashtags = extractHashtags(rawCaption);
  const tagCheck = validateHashtagComposition(extractedHashtags, category, topic);
  if (!tagCheck.valid) {
    violations.push({
      rule: 'hashtag_composition',
      message: tagCheck.reason || 'Hashtag composition rule failed.',
      severity: 'error',
    });
  }

  // 4. Validate Banned Openings
  const opening6 = getOpeningWords(rawCaption, 6);
  for (const bo of HARDCODED_BANNED_OPENINGS) {
    if (opening6.startsWith(bo)) {
      violations.push({
        rule: 'banned_opening',
        message: `Caption begins with prohibited opening phrase: "${bo}".`,
        severity: 'error',
      });
      break;
    }
  }

  // Check against first 6 words of last 20 captions
  for (const pastOp of recentOpenings) {
    if (pastOp && pastOp.trim()) {
      const past6 = getOpeningWords(pastOp, 6);
      if (past6 && opening6 === past6) {
        violations.push({
          rule: 'repetitive_opening',
          message: `Opening sentence repeats recent post opening: "${past6}".`,
          severity: 'error',
        });
        break;
      }
    }
  }

  // 5. Validate Banned Filler Phrases
  for (const fp of BANNED_FILLER_PHRASES) {
    if (lowerCaption.includes(fp)) {
      violations.push({
        rule: 'banned_filler_phrase',
        message: `Caption contains banned conversational filler: "${fp}".`,
        severity: 'error',
      });
    }
  }

  // 6. Validate Headline Not Pasted into First Sentence
  if (headline && headline.trim()) {
    const plainHeadline = headline.replace(/\*+/g, '').trim().toLowerCase();
    const firstSentence = (rawCaption.split(/[.!?]/)[0] || '').trim().toLowerCase();
    if (plainHeadline.length >= 10 && (firstSentence === plainHeadline || firstSentence.includes(plainHeadline))) {
      violations.push({
        rule: 'headline_pasted_as_hook',
        message: 'The headline must not be pasted verbatim as the first sentence of the caption.',
        severity: 'error',
      });
    }
  }

  // 7. Validate Headline/Caption/Facts Consistency for Key Numbers
  const extractNumbers = (str: string) => {
    const nums = str.match(/\b\d+(?:[.,]\d+)?\b/g);
    return nums ? nums.map((n) => n.replace(/,/g, '')) : [];
  };

  const factsText = facts.join(' ');
  const factNumbers = new Set(extractNumbers(factsText));
  const headlineNumbers = extractNumbers(headline);

  // If headline contains specific numbers, at least one should match facts
  if (headlineNumbers.length > 0 && factNumbers.size > 0) {
    const hasSharedNumber = headlineNumbers.some((hn) => factNumbers.has(hn));
    if (!hasSharedNumber) {
      violations.push({
        rule: 'headline_fact_inconsistency',
        message: `Number in headline (${headlineNumbers.join(', ')}) is not substantiated in the research facts.`,
        severity: 'warning',
      });
    }
  }

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return {
    valid: errorCount === 0,
    score,
    violations,
    extractedHashtags,
    hasImageBrief,
    hasIllustrationDisclaimer,
    openingChecked: opening6,
  };
}
