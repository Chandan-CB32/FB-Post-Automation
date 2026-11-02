import {
  ContentProfile,
  EffectiveSettings,
  PromptInterpolator,
  injectSafetyBaseline,
  TokenUsage,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';
import { planSectionBudgets, formatParagraphs, countWords, SectionOutline } from './chunker.js';

export interface WrittenSection {
  index: number;
  title: string;
  content: string;
  words: number;
}

export interface WriteStageInput {
  profile: ContentProfile;
  effectiveSettings: EffectiveSettings;
  router: ProviderRouter;
  topic: string;
  category?: string;
  premise?: string;
  facts?: string[] | string;
  sourceLine?: string;
  storyBible?: string;
  storySoFar?: string;
  episodeNumber?: number;
}

export interface WriteStageResult {
  title: string;
  caption: string;
  wordCount: number;
  sections: WrittenSection[];
  outline: SectionOutline[];
  hashtags: string[];
  disclaimer: string | null;
  sourceLine: string | null;
  isChunked: boolean;
  providerId: string;
  modelUsed: string;
  totalTokens: TokenUsage;
  latencyMs: number;
}

/**
 * Stage 04: Write Pipeline & Long-Form Chunker
 * Supports direct single-pass generation for short posts (<250 words)
 * and structured 4-phase chunking (Outline → Sections → Stitch → Polish) for long posts (250–2,500 words).
 */
export async function executeWriteStage(input: WriteStageInput): Promise<WriteStageResult> {
  const startTime = Date.now();
  const targetWords = input.effectiveSettings.caption.target || 180;
  const isFiction = input.profile.type === 'fiction';
  const isChunked = targetWords >= 250;

  const totalTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let primaryProviderId = '';
  let primaryModelUsed = '';

  const factsText = Array.isArray(input.facts) ? input.facts.join('\n') : input.facts || '';

  // --------------------------------------------------------------------------
  // PATH A: Short-Form Direct Writing (<250 words)
  // --------------------------------------------------------------------------
  if (!isChunked) {
    const rawTemplate =
      input.effectiveSettings.templates.captionPrompt ||
      'Write a captivating Facebook post about {{topic}}.\n' +
      'Background / Facts / Premise:\n{{facts}}\n\n' +
      'Target length: around {{word_target}} words (minimum {{word_min}}, maximum {{word_max}}).\n' +
      'Tone: {{tone}}. POV: {{pov}}.\n' +
      'Ensure a scroll-stopping opening hook, short readable paragraphs (max 3 sentences), and reflective closing.';

    const interpolated = PromptInterpolator.interpolate(rawTemplate, {
      topic: input.topic,
      category: input.category || 'General',
      facts: factsText,
      premise: input.premise || '',
      word_target: targetWords,
      word_min: input.effectiveSettings.caption.min || Math.round(targetWords * 0.75),
      word_max: input.effectiveSettings.caption.max || Math.round(targetWords * 1.3),
      tone: input.effectiveSettings.caption.voice.tone,
      pov: input.effectiveSettings.caption.voice.pov,
      audience: input.profile.audience,
      language: input.profile.language || 'en',
      series_bible: input.storyBible,
      story_so_far: input.storySoFar,
      episode_number: input.episodeNumber,
      ...input.effectiveSettings.customVariables,
    });

    const safePrompt = injectSafetyBaseline(interpolated, 'text');
    const writeResult = await input.router.executeText('write', {
      prompt: safePrompt,
      maxTokens: 1500,
    });

    primaryProviderId = writeResult.providerId;
    primaryModelUsed = writeResult.modelUsed;
    totalTokens.promptTokens += writeResult.tokens.promptTokens;
    totalTokens.completionTokens += writeResult.tokens.completionTokens;
    totalTokens.totalTokens += writeResult.tokens.totalTokens;

    let prose = writeResult.text.trim();
    prose = formatParagraphs(prose, input.effectiveSettings.caption.maxSentencesPerParagraph || 3);

    const wordCount = countWords(prose);
    const hashtags = extractAndEnforceHashtags(prose, input.effectiveSettings);
    const disclaimer = isFiction
      ? input.effectiveSettings.caption.disclaimerLine || 'Note: This is an original fictional story for entertainment purposes.'
      : null;

    return {
      title: input.topic,
      caption: prose,
      wordCount,
      sections: [{ index: 1, title: 'Main Story', content: prose, words: wordCount }],
      outline: [{ index: 1, title: 'Main Story', focus: 'Direct single-pass short post', targetWords }],
      hashtags,
      disclaimer,
      sourceLine: input.sourceLine || null,
      isChunked: false,
      providerId: primaryProviderId,
      modelUsed: primaryModelUsed,
      totalTokens,
      latencyMs: Date.now() - startTime,
    };
  }

  // --------------------------------------------------------------------------
  // PATH B: Long-Form Multi-Stage Chunking (>=250 words)
  // --------------------------------------------------------------------------
  // Step 1: Outline & Section Budgets
  const plannedOutline = planSectionBudgets(targetWords, 4);

  // Step 2: Sequential Section Generation with Running Summary
  const writtenSections: WrittenSection[] = [];
  let runningSummary = input.premise || input.topic;

  for (const section of plannedOutline) {
    const sectionPrompt =
      `Write section ${section.index} of ${plannedOutline.length}: "${section.title}".\n` +
      `Focus of this section: ${section.focus}\n` +
      `Target section length: approximately ${section.targetWords} words.\n` +
      `Overall Topic: ${input.topic}\n` +
      `Tone: ${input.effectiveSettings.caption.voice.tone}, POV: ${input.effectiveSettings.caption.voice.pov}\n` +
      (factsText ? `Facts / Background to weave in:\n${factsText}\n` : '') +
      (input.storyBible ? `Series Bible: ${input.storyBible}\n` : '') +
      `Story so far from prior sections:\n${runningSummary}\n\n` +
      `INSTRUCTIONS:\n` +
      `1. Write ONLY the prose for this section. Do not include section headings or meta-commentary.\n` +
      `2. Keep paragraphs short (1-3 sentences) for mobile readability.\n` +
      `3. Maintain continuous flow and emotional suspense from the previous section.`;

    const safeSectionPrompt = injectSafetyBaseline(sectionPrompt, 'text');
    const sectionResult = await input.router.executeText('write', {
      prompt: safeSectionPrompt,
      maxTokens: Math.max(1000, Math.round(section.targetWords * 2.5)),
    });

    if (!primaryProviderId) {
      primaryProviderId = sectionResult.providerId;
      primaryModelUsed = sectionResult.modelUsed;
    }

    totalTokens.promptTokens += sectionResult.tokens.promptTokens;
    totalTokens.completionTokens += sectionResult.tokens.completionTokens;
    totalTokens.totalTokens += sectionResult.tokens.totalTokens;

    const sectionContent = sectionResult.text.replace(/^#+.*$/gm, '').trim();
    const sectionWordCount = countWords(sectionContent);

    writtenSections.push({
      index: section.index,
      title: section.title,
      content: sectionContent,
      words: sectionWordCount,
    });

    // Update running summary for next section
    const firstTwoLines = sectionContent.split('\n').filter(Boolean).slice(0, 2).join(' ');
    runningSummary += `\nSection ${section.index}: ${firstTwoLines.slice(0, 150)}...`;
  }

  // Step 3: Stitch Sections
  const stitchedProse = writtenSections.map((s) => s.content).join('\n\n');

  // Step 4: Polish Pass (if polish prompt customized or length needs transition smoothing)
  let polishedProse = stitchedProse;
  const currentTotalWords = countWords(stitchedProse);

  if (input.effectiveSettings.templates.polishPrompt || Math.abs(currentTotalWords - targetWords) > targetWords * 0.35) {
    const rawPolishPrompt =
      input.effectiveSettings.templates.polishPrompt ||
      'You are a senior developmental editor for viral narrative Facebook posts.\n' +
      'Review and polish this full story draft.\n' +
      'Topic: {{topic}}\n' +
      'Target word count: around {{word_target}} words.\n' +
      'Draft:\n{{caption}}\n\n' +
      'Tasks:\n' +
      '1. Ensure seamless transitions between stitched sections so there are no repetitive seams.\n' +
      '2. Ensure short mobile paragraphs (max 3 sentences per paragraph).\n' +
      '3. Retain emotional tension, opening hook, and ending punch.\n' +
      'Return strictly the polished story post with no commentary.';

    const interpolatedPolish = PromptInterpolator.interpolate(rawPolishPrompt, {
      topic: input.topic,
      caption: stitchedProse,
      word_target: targetWords,
      tone: input.effectiveSettings.caption.voice.tone,
      pov: input.effectiveSettings.caption.voice.pov,
    });

    const safePolishPrompt = injectSafetyBaseline(interpolatedPolish, 'text');
    try {
      const polishResult = await input.router.executeText('polish', {
        prompt: safePolishPrompt,
        maxTokens: Math.max(2500, Math.round(targetWords * 2.5)),
      });

      totalTokens.promptTokens += polishResult.tokens.promptTokens;
      totalTokens.completionTokens += polishResult.tokens.completionTokens;
      totalTokens.totalTokens += polishResult.tokens.totalTokens;

      if (polishResult.text && countWords(polishResult.text) >= targetWords * 0.5) {
        polishedProse = polishResult.text.trim();
      }
    } catch (err: unknown) {
      // If polish fails, keep clean stitched prose
      console.warn('[WriteStage] Polish pass failed, falling back to stitched prose:', err);
    }
  }

  // Final paragraph formatting
  const finalCaption = formatParagraphs(
    polishedProse,
    input.effectiveSettings.caption.maxSentencesPerParagraph || 3
  );

  const finalWordCount = countWords(finalCaption);
  const hashtags = extractAndEnforceHashtags(finalCaption, input.effectiveSettings);
  const disclaimer = isFiction
    ? input.effectiveSettings.caption.disclaimerLine || 'Note: This is an original fictional story for entertainment purposes.'
    : null;

  return {
    title: input.topic,
    caption: finalCaption,
    wordCount: finalWordCount,
    sections: writtenSections,
    outline: plannedOutline,
    hashtags,
    disclaimer,
    sourceLine: input.sourceLine || null,
    isChunked: true,
    providerId: primaryProviderId,
    modelUsed: primaryModelUsed,
    totalTokens,
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Extracts hashtags from post text and appends fixed hashtags up to the configured limit.
 */
function extractAndEnforceHashtags(text: string, settings: EffectiveSettings): string[] {
  const extracted: string[] = [];
  const matches = text.match(/#[A-Za-z0-9_]+/g);
  if (matches) {
    for (const tag of matches) {
      if (!extracted.includes(tag)) {
        extracted.push(tag);
      }
    }
  }

  if (settings.hashtags.fixedHashtags && settings.hashtags.fixedHashtags.length > 0) {
    for (const tag of settings.hashtags.fixedHashtags) {
      const formatted = tag.startsWith('#') ? tag : `#${tag}`;
      if (!extracted.includes(formatted)) {
        extracted.push(formatted);
      }
    }
  }

  const limit = settings.hashtags.count || 5;
  return extracted.slice(0, Math.max(limit, 8));
}
