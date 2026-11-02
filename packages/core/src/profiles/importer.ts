import crypto from 'node:crypto';
import {
  ContentProfileType,
  StageTemplates,
  CaptionSettings,
  ImageSettings,
  TopicSettings,
  HashtagSettings,
} from '../types/index.js';
import { ContentProfile } from '../validation/schemas.js';
import { GLOBAL_DEFAULTS } from '../settings-resolver/resolver.js';

export interface ImportOptions {
  name: string;
  niche: string;
  type?: ContentProfileType;
  headlinePanel?: boolean;
  minWords?: number;
  maxWords?: number;
}

/**
 * Strips manual/interactive-only rules from master prompts.
 * Removes sections discussing:
 * - "When I enter any number"
 * - "LARGE BATCH HANDLING"
 * - "FINAL COMMAND RULE"
 * - "CONTINUE" / batch pagination
 * and removes provenance markdown header blocks.
 */
export function stripInteractiveRules(rawContent: string): string {
  let cleaned = rawContent.trim();

  // 1. Remove provenance header block if present (starts before the first '---')
  if (cleaned.includes('---')) {
    const dashIndex = cleaned.indexOf('---');
    if (dashIndex !== -1 && dashIndex < 1200) {
      cleaned = cleaned.substring(dashIndex + 3).trim();
    }
  }

  // 2. Remove section 1 (Interaction Rule: When I enter any number...)
  cleaned = cleaned.replace(/#+\s*\**\s*1\\[.\s].*?INTERACTION RULE[\s\S]*?(?=#+\s*\**\s*2\\[.\s])/i, '');

  // 3. Remove batch handling and final command rules at the end of the file
  cleaned = cleaned.replace(/#+\s*\**\s*9\\[.\s].*?BATCH HANDLING[\s\S]*?(?=#+\s*\**\s*10\\[.\s]|$)/i, '');
  cleaned = cleaned.replace(/#+\s*\**\s*10\\[.\s].*?FINAL COMMAND RULE[\s\S]*/i, '');

  // 4. Strip leftover explicit interactive sentences
  cleaned = cleaned
    .replace(/When I enter any number[\s\S]*?Do not ask unnecessary questions[^\n]*/gi, '')
    .replace(/If the entire batch cannot be delivered at once[\s\S]*?never silently reduce the requested total[^\n]*/gi, '')
    .replace(/Type "CONTINUE"[\s\S]*?to generate more[^\n]*/gi, '');

  return cleaned.trim();
}

/**
 * Extracts named categories from the prompt text (e.g. CATEGORY A: SPACE AND ASTRONOMY).
 */
export function extractCategoriesFromPrompt(promptText: string): Array<{ name: string; weight: number }> {
  const categories: Array<{ name: string; weight: number }> = [];
  const categoryRegex = /\**CATEGORY\s+([A-Z0-9]+)\s*:\s*([^*\n\r]+)\**/gi;
  let match: RegExpExecArray | null;

  while ((match = categoryRegex.exec(promptText)) !== null) {
    const categoryName = match[2].trim();
    if (categoryName && !categories.some((c) => c.name.toLowerCase() === categoryName.toLowerCase())) {
      categories.push({ name: categoryName, weight: 0 });
    }
  }

  // Distribute equal weights across detected categories
  if (categories.length > 0) {
    const equalWeight = Math.floor(100 / categories.length);
    let remainder = 100 - equalWeight * categories.length;
    for (let i = 0; i < categories.length; i++) {
      categories[i].weight = equalWeight + (remainder > 0 ? 1 : 0);
      remainder -= 1;
    }
  }

  return categories;
}

/**
 * Imports a master prompt markdown file into a validated ContentProfile structure.
 */
export function importMasterPrompt(
  rawContent: string,
  options: ImportOptions
): ContentProfile {
  const masterPrompt = stripInteractiveRules(rawContent);
  const categories = extractCategoriesFromPrompt(rawContent);

  const isScience = options.niche === 'science_space';
  const hasHeadlinePanel = options.headlinePanel ?? isScience;

  const templates: StageTemplates = {
    captionPrompt: `{{master_prompt}}\n\nTopic for this post: {{topic}}\nTarget word count: {{word_target}} words.\nLanguage: {{language}}. Audience: {{audience}}.`,
    imagePromptTemplate: isScience
      ? `Photorealistic, scientifically accurate rendering of {{key_scene}}, 8k detail, vivid deep space colors.`
      : `Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.`,
    negativeImagePrompt: 'text, watermark, logo, deformed anatomy, blurry, modern artifacts',
    ideaPrompt: `Based on the profile categories, propose 3 fresh, unique post premises for {{niche}}. Avoid: {{recent_titles}}.`,
    topicPrompt: `Select the single strongest topic from the candidate pool for {{niche}} with maximum visual and storytelling potential.`,
    factExtractionPrompt: `Extract verified, factual claims from the following sources for topic '{{topic}}'. Include source attributions: {{sources}}.`,
    qaPrompt: `Review the post caption for {{niche}}. Score 0-100 on historical/scientific accuracy, coherence, hook strength, and safety baseline compliance.`,
  };

  const captionSettings: CaptionSettings = {
    unit: 'words',
    min: options.minWords || (isScience ? 120 : 150),
    target: options.minWords ? Math.round(options.minWords * 1.3) : 200,
    max: options.maxWords || (isScience ? 250 : 300),
    hookRule: true,
    maxSentencesPerParagraph: 3,
    voice: {
      tone: isScience ? 'awe-inspiring, scientifically accurate' : 'nostalgic, historical storytelling',
      pov: 'third-person',
      emojiPolicy: 'minimal',
      bannedPhrases: ['you won’t believe', 'mind-blowing clickbait'],
      requiredPhrases: [],
    },
    endingStyle: isScience ? 'question' : 'twist',
    includeQuestion: true,
    formatSourceLine: true,
  };

  const hashtagSettings: HashtagSettings = {
    count: 5,
    bannedHashtags: [],
    fixedHashtags: isScience ? ['#Science', '#Space'] : ['#History', '#Vintage'],
    style: 'mixed',
  };

  const imageSettings: ImageSettings = {
    template: templates.imagePromptTemplate,
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    style: isScience ? 'scientifically accurate rendering' : 'archival vintage photograph',
    keySceneMode: 'climax',
    allowTextInImage: false,
    allowRealPeople: false,
    allowLogos: false,
    headlinePanel: {
      enabled: hasHeadlinePanel,
      heightPercent: 28,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
    },
  };

  const topicSettings: TopicSettings = {
    sources: {
      autoTopicsWeight: 50,
      ownerQueueWeight: 50,
      researchWeight: 0,
      seriesWeight: 0,
    },
    categories: categories.length > 0 ? categories : [
      { name: 'Core Archive', weight: 100 },
    ],
    preventConsecutiveCategory: true,
    dedupWindowDays: 90,
    dedupWindowPosts: 200,
    bannedTopics: [],
    includeKeywords: [],
    excludeKeywords: [],
  };

  return {
    id: crypto.randomUUID(),
    name: options.name,
    description: `Master prompt profile for ${options.name} (${options.niche})`,
    type: options.type || 'factual',
    language: 'en',
    audience: 'General Facebook English-speaking audience',
    masterPrompt,
    templates,
    captionSettings,
    hashtagSettings,
    imageSettings,
    topicSettings,
    customVariables: {
      niche: options.niche,
    },
    version: 1,
  };
}
