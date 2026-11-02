import {
  ContentProfile,
  EffectiveSettings,
  PromptInterpolator,
  injectSafetyBaseline,
  extractJsonFromText,
  TokenUsage,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';

export interface TimelineEntry {
  time: string;
  event: string;
}

export interface FactSheet {
  topic: string;
  summary: string;
  confirmedFacts: string[];
  timeline: TimelineEntry[];
  hypotheticalOrAlleged: string[];
  sourceLine: string;
  sourceUrl?: string;
  allFactBullets: string[];
  providerId: string;
  modelUsed: string;
  tokensUsed: TokenUsage;
}

export interface FactExtractorInput {
  profile: ContentProfile;
  effectiveSettings: EffectiveSettings;
  router: ProviderRouter;
  topic: string;
  category?: string;
  sourceUrl?: string;
  rawResearchExcerpt?: string;
}

const DEFAULT_FACT_EXTRACTION_PROMPT =
  'You are a meticulous factual research auditor.\n' +
  'Extract verified facts, chronological timeline, and background details for this topic:\n' +
  'Topic: {{topic}}\n' +
  'Category: {{category}}\n' +
  ( 'Research Material / Excerpt:\n{{facts}}\n' ) +
  '\nSTRICT RULES:\n' +
  '1. Extract ONLY facts supported by verified evidence or the provided research excerpt.\n' +
  '2. DO NOT invent dates, numbers, quotes, or people. If an exact date is unknown, give the approximate era or state unknown.\n' +
  '3. Clearly separate confirmed facts from disputed theories or alleged claims.\n' +
  '4. Use cautious wording ("alleged", "claimed", "theorized", "according to") for unconfirmed elements.\n\n' +
  'Return STRICTLY a JSON object with this shape:\n' +
  '{\n' +
  '  "topic": "{{topic}}",\n' +
  '  "summary": "1-2 sentence core factual summary",\n' +
  '  "confirmedFacts": [\n' +
  '    "Verified fact bullet 1",\n' +
  '    "Verified fact bullet 2"\n' +
  '  ],\n' +
  '  "timeline": [\n' +
  '    { "time": "Year/Date/Phase", "event": "What happened" }\n' +
  '  ],\n' +
  '  "hypotheticalOrAlleged": [\n' +
  '    "Disputed or theorized point (if any)"\n' +
  '  ],\n' +
  '  "sourceLine": "Source name or publication attribution"\n' +
  '}';

/**
 * Stage 04: Fact Extractor Pipeline
 * Generates structured, verified fact sheets for factual and true_story posts.
 * Downstream writers may use ONLY these facts to prevent hallucinations.
 */
export async function executeFactExtractorStage(
  input: FactExtractorInput
): Promise<FactSheet> {
  const rawTemplate =
    input.effectiveSettings.templates.factExtractionPrompt || DEFAULT_FACT_EXTRACTION_PROMPT;

  const interpolated = PromptInterpolator.interpolate(rawTemplate, {
    topic: input.topic,
    category: input.category || 'Factual Science & History',
    facts: input.rawResearchExcerpt || 'Explore established public record, scientific literature, and historical archives.',
    sources: input.sourceUrl || '',
    audience: input.profile.audience,
    tone: input.effectiveSettings.caption.voice.tone,
    ...input.effectiveSettings.customVariables,
  });

  const safePrompt = injectSafetyBaseline(interpolated, 'text');

  const routerResult = await input.router.executeText('fact_extraction', {
    prompt: safePrompt,
    jsonMode: true,
  });

  let rawJson: any = null;
  try {
    rawJson = extractJsonFromText(routerResult.text);
  } catch {
    rawJson = null;
  }

  let summary = '';
  const confirmedFacts: string[] = [];
  const timeline: TimelineEntry[] = [];
  const hypotheticalOrAlleged: string[] = [];
  let sourceLine = input.sourceUrl ? `Source: ${input.sourceUrl}` : 'Source: Public Record / Scientific Archives';

  if (rawJson && typeof rawJson === 'object') {
    if (typeof rawJson.summary === 'string' && rawJson.summary.trim()) {
      summary = rawJson.summary.trim();
    }

    if (Array.isArray(rawJson.confirmedFacts)) {
      for (const item of rawJson.confirmedFacts) {
        if (typeof item === 'string' && item.trim()) {
          confirmedFacts.push(item.trim());
        }
      }
    }

    if (Array.isArray(rawJson.timeline)) {
      for (const t of rawJson.timeline) {
        if (t && typeof t === 'object' && typeof t.event === 'string' && t.event.trim()) {
          timeline.push({
            time: typeof t.time === 'string' ? t.time.trim() : 'Date uncertain',
            event: t.event.trim(),
          });
        }
      }
    }

    if (Array.isArray(rawJson.hypotheticalOrAlleged)) {
      for (const h of rawJson.hypotheticalOrAlleged) {
        if (typeof h === 'string' && h.trim()) {
          hypotheticalOrAlleged.push(h.trim());
        }
      }
    }

    if (typeof rawJson.sourceLine === 'string' && rawJson.sourceLine.trim()) {
      sourceLine = rawJson.sourceLine.trim();
    }
  }

  // Fallback parsing if LLM output was plain text / bullet points
  if (confirmedFacts.length === 0) {
    const lines = routerResult.text
      .split('\n')
      .map((l) => l.replace(/^[-*•0-9.)]+\s*/, '').trim())
      .filter((l) => l.length > 15 && !l.startsWith('{') && !l.startsWith('}'));

    if (lines.length > 0) {
      summary = lines[0];
      confirmedFacts.push(...lines.slice(0, 8));
    } else {
      summary = `Verified historical and scientific facts regarding ${input.topic}.`;
      confirmedFacts.push(summary);
    }
  }

  // Assemble allFactBullets for prompt interpolation in the writer stage
  const allFactBullets: string[] = [...confirmedFacts];
  for (const t of timeline) {
    allFactBullets.push(`Timeline (${t.time}): ${t.event}`);
  }
  for (const h of hypotheticalOrAlleged) {
    allFactBullets.push(`Theorized/Alleged: ${h}`);
  }

  return {
    topic: input.topic,
    summary,
    confirmedFacts,
    timeline,
    hypotheticalOrAlleged,
    sourceLine,
    sourceUrl: input.sourceUrl,
    allFactBullets,
    providerId: routerResult.providerId,
    modelUsed: routerResult.modelUsed,
    tokensUsed: routerResult.tokens,
  };
}
