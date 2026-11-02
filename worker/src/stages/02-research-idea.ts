import {
  ContentProfile,
  EffectiveSettings,
  PromptInterpolator,
  injectSafetyBaseline,
  extractJsonFromText,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';
import { ResearchCollector, ResearchItemRecord } from '../research/collector.js';

export interface IdeaCandidate {
  topic: string;
  category?: string;
  premise?: string;
  sourceType: 'auto_idea' | 'research_feed' | 'owner_queue' | 'series';
  sourceUrl?: string;
  facts?: string[];
  rawItem?: ResearchItemRecord;
}

export interface ResearchIdeaStageInput {
  profile: ContentProfile;
  effectiveSettings: EffectiveSettings;
  router: ProviderRouter;
  recentResearchItems?: ResearchItemRecord[];
  storyBible?: string;
  storySoFar?: string;
  bannedTopics?: string[];
}

export interface ResearchIdeaStageResult {
  sourceType: 'auto_idea' | 'research_feed' | 'series';
  candidates: IdeaCandidate[];
  providerId?: string;
  model?: string;
  tokensUsed?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Stage 02: Research or Idea Generation
 * - For factual / true_story: retrieves and normalizes candidate stories from fresh research feeds.
 * - For fiction: prompts LLM for creative story premises adhering to tone, genre, and series continuity.
 */
export async function executeResearchIdeaStage(
  input: ResearchIdeaStageInput
): Promise<ResearchIdeaStageResult> {
  const profileType = input.profile.type;

  // 1. If factual or true_story with available research items, build candidates from feeds
  if (
    (profileType === 'factual' || profileType === 'true_story') &&
    input.recentResearchItems &&
    input.recentResearchItems.length > 0
  ) {
    const candidates: IdeaCandidate[] = input.recentResearchItems.map((item) => ({
      topic: item.title,
      category: 'Research Feed',
      premise: item.excerpt,
      sourceType: 'research_feed',
      sourceUrl: item.url,
      facts: [item.excerpt],
      rawItem: item,
    }));

    return {
      sourceType: 'research_feed',
      candidates,
    };
  }

  // 2. Otherwise (fiction, evergreen, or factual without feed items), generate fresh ideas via LLM
  const categoriesList = input.effectiveSettings.topic.categories.map((c) =>
    typeof c === 'string' ? c : c.name
  );
  const categoriesStr =
    categoriesList.length > 0 ? categoriesList.join(', ') : 'Trending Stories, Engaging Curiosities';

  const defaultIdeaPrompt =
    'Brainstorm 3 unique, high-engagement story premises in one of these categories: {{categories}}.\n' +
    'Tone: {{tone}}.\n' +
    'Audience: {{audience}}.\n' +
    (input.bannedTopics && input.bannedTopics.length > 0
      ? `Avoid these recent topics: ${input.bannedTopics.join(', ')}.\n`
      : '') +
    'Return strictly a JSON array of objects:\n' +
    '[\n' +
    '  { "topic": "Brief catchy title", "category": "Category name", "premise": "1-2 sentence hook and conflict" }\n' +
    ']';

  const rawTemplate = input.effectiveSettings.templates.ideaPrompt || defaultIdeaPrompt;

  const interpolatedPrompt = PromptInterpolator.interpolate(rawTemplate, {
    category: categoriesStr,
    categories: categoriesStr,
    tone: input.effectiveSettings.caption.voice.tone,
    audience: input.profile.audience,
    series_bible: input.storyBible,
    story_so_far: input.storySoFar,
    ...input.effectiveSettings.customVariables,
  });

  const safePrompt = injectSafetyBaseline(interpolatedPrompt, 'text');

  const routerResult = await input.router.executeText('idea', {
    prompt: safePrompt,
    jsonMode: true,
  });

  let parsed: Array<{ topic?: string; category?: string; premise?: string }> = [];
  try {
    const json = extractJsonFromText(routerResult.text);
    if (Array.isArray(json)) {
      parsed = json;
    } else if (json && typeof json === 'object' && 'topic' in json) {
      parsed = [json as any];
    }
  } catch {
    // If JSON parsing fails, extract line-by-line fallback
    parsed = [
      {
        topic: routerResult.text.split('\n')[0].replace(/^[0-9.-]+\s*/, '').trim().slice(0, 100),
        premise: routerResult.text.slice(0, 200),
      },
    ];
  }

  const candidates: IdeaCandidate[] = parsed
    .filter((p) => p.topic && p.topic.trim().length > 0)
    .map((p) => ({
      topic: p.topic!.trim(),
      category: p.category || 'General',
      premise: p.premise,
      sourceType: profileType === 'fiction' && input.storyBible ? 'series' : 'auto_idea',
    }));

  return {
    sourceType: profileType === 'fiction' && input.storyBible ? 'series' : 'auto_idea',
    candidates: candidates.length > 0 ? candidates : [
      {
        topic: 'Curious Historical Anomaly',
        category: 'History',
        premise: 'An unexpected discovery in the archives.',
        sourceType: 'auto_idea',
      },
    ],
    providerId: routerResult.providerId,
    model: routerResult.modelUsed,
    tokensUsed: routerResult.tokens,
  };
}
