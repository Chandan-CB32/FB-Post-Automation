import {
  ContentProfile,
  EffectiveSettings,
  PromptInterpolator,
  injectSafetyBaseline,
  extractJsonFromText,
  isTopicDuplicate,
  selectTargetCategory,
  TopicHistoryEntry,
  TopicQueueItem,
  markTopicStatus,
  getNextTopic,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';
import { ResearchItemRecord } from '../research/collector.js';
import { GeneratedIdeaCandidate } from './02-idea-generator.js';

export interface TopicCandidate {
  topic: string;
  category: string;
  premise: string;
  visualConcept?: string;
  sourceType: 'owner_queue' | 'auto_topics' | 'research' | 'series';
  sourceUrl?: string;
  facts?: string[];
  queueItemId?: string;
  baseScore?: number;
}

export interface TopicSelectStageInput {
  profile: ContentProfile;
  effectiveSettings: EffectiveSettings;
  router: ProviderRouter;
  history?: TopicHistoryEntry[];
  queueItems?: TopicQueueItem[];
  researchItems?: ResearchItemRecord[];
  generatedIdeas?: GeneratedIdeaCandidate[];
  seriesBible?: string;
  storySoFar?: string;
}

export interface SelectedTopicResult {
  topic: string;
  category: string;
  sourceType: 'owner_queue' | 'auto_topics' | 'research' | 'series';
  premise: string;
  visualConcept: string;
  score: number;
  rationale: string;
  sourceUrl?: string;
  facts?: string[];
  queueItemId?: string;
}

/**
 * Stage 03: Topic Selection, Category Weighting & Deduplication
 * Aggregates candidates from all enabled sources, filters duplicates and banned terms,
 * and uses secondary evaluation scoring to pick the optimal topic.
 */
export async function executeTopicSelectStage(
  input: TopicSelectStageInput
): Promise<SelectedTopicResult> {
  const history = input.history || [];
  const candidatePool: TopicCandidate[] = [];

  // 1. Pick target category enforcing weighting & preventConsecutive rule
  const targetCategory = selectTargetCategory(
    input.effectiveSettings.topic.categories,
    history,
    { preventConsecutive: input.effectiveSettings.topic.preventConsecutiveCategory }
  );

  // 2. Pool from Owner Topic Queue (if available and weighted)
  if (
    input.queueItems &&
    input.queueItems.length > 0 &&
    (input.effectiveSettings.topic.sources.ownerQueueWeight > 0 || !input.generatedIdeas)
  ) {
    const queueTopic = getNextTopic(input.queueItems, 'fifo', targetCategory) ||
      getNextTopic(input.queueItems, 'fifo');

    if (queueTopic) {
      candidatePool.push({
        topic: queueTopic.text,
        category: queueTopic.category || targetCategory,
        premise: queueTopic.text,
        visualConcept: `Striking visual depiction of ${queueTopic.text}`,
        sourceType: 'owner_queue',
        queueItemId: queueTopic.id,
        baseScore: 8.5,
      });
    }
  }

  // 3. Pool from Research Items (for factual / true_story)
  if (
    input.researchItems &&
    input.researchItems.length > 0 &&
    input.effectiveSettings.topic.sources.researchWeight > 0
  ) {
    for (const item of input.researchItems.slice(0, 3)) {
      candidatePool.push({
        topic: item.title,
        category: targetCategory,
        premise: item.excerpt,
        visualConcept: `Realistic photographic scene representing ${item.title}`,
        sourceType: 'research',
        sourceUrl: item.url,
        facts: [item.excerpt],
        baseScore: 8.0,
      });
    }
  }

  // 4. Pool from Autonomous Generated Ideas
  if (input.generatedIdeas && input.generatedIdeas.length > 0) {
    for (const idea of input.generatedIdeas) {
      candidatePool.push({
        topic: idea.topic,
        category: idea.category || targetCategory,
        premise: idea.premise,
        visualConcept: idea.visualConcept,
        sourceType: idea.sourceType === 'series' ? 'series' : 'auto_topics',
        baseScore: idea.hookScore,
      });
    }
  }

  // 5. Filter Candidates against Deduplication Window and Exclusions
  const bannedTopicsLower = (input.effectiveSettings.topic.bannedTopics || []).map((t) =>
    t.toLowerCase().trim()
  );
  const excludeKeywordsLower = (input.effectiveSettings.topic.excludeKeywords || []).map((k) =>
    k.toLowerCase().trim()
  );

  const eligibleCandidates = candidatePool.filter((candidate) => {
    const titleLower = candidate.topic.toLowerCase();

    // Check banned topics
    if (bannedTopicsLower.some((b) => titleLower.includes(b))) {
      return false;
    }

    // Check exclude keywords
    if (excludeKeywordsLower.some((e) => titleLower.includes(e))) {
      return false;
    }

    // Check 90-day / 200-post dedup window
    const dedupResult = isTopicDuplicate(candidate.topic, history, {
      windowDays: input.effectiveSettings.topic.dedupWindowDays,
      maxPosts: input.effectiveSettings.topic.dedupWindowPosts,
    });

    return !dedupResult.isDuplicate;
  });

  // If all candidate ideas were filtered, fallback to a fresh unique topic
  if (eligibleCandidates.length === 0) {
    const fallbackTitle = `Curious Oddities of ${targetCategory}`;
    return {
      topic: fallbackTitle,
      category: targetCategory,
      sourceType: 'auto_topics',
      premise: `A fascinating exploration into ${targetCategory} and its unexpected origins.`,
      visualConcept: `Cinematic moody scene depicting the mysteries of ${targetCategory}`,
      score: 7.5,
      rationale: 'Generated fresh fallback candidate because all queued candidates were duplicates or excluded.',
    };
  }

  // If only 1 eligible candidate, select it directly
  if (eligibleCandidates.length === 1) {
    const chosen = eligibleCandidates[0];
    return {
      topic: chosen.topic,
      category: chosen.category,
      sourceType: chosen.sourceType,
      premise: chosen.premise,
      visualConcept: chosen.visualConcept || `Visual representation of ${chosen.topic}`,
      score: chosen.baseScore || 8.0,
      rationale: 'Selected sole eligible non-duplicate candidate.',
      sourceUrl: chosen.sourceUrl,
      facts: chosen.facts,
      queueItemId: chosen.queueItemId,
    };
  }

  // 6. Multi-Candidate LLM Evaluation & Scoring
  const scoringPrompt =
    'You are an editorial topic judge for viral Facebook posts.\n' +
    'Evaluate these candidate topics for audience interest, curiosity gap, emotional hook, and visual image potential.\n\n' +
    'Candidate Topics:\n' +
    eligibleCandidates
      .map(
        (c, idx) =>
          `${idx + 1}. Title: "${c.topic}" | Category: ${c.category}\n   Premise: ${c.premise}`
      )
      .join('\n\n') +
    '\n\nReturn strictly a JSON object with the index (1-based) of the best winning topic, its composite score (1-10), and rationale:\n' +
    '{\n' +
    '  "winningIndex": <number 1 to N>,\n' +
    '  "score": <number 1-10>,\n' +
    '  "rationale": "<concise reason why this topic will engage readers best>"\n' +
    '}';

  const safeScoringPrompt = injectSafetyBaseline(scoringPrompt, 'text');

  let chosenIndex = 0;
  let finalScore = eligibleCandidates[0].baseScore || 8.5;
  let rationale = 'Selected highest-potential topic.';

  try {
    const evalResult = await input.router.executeText('topic', {
      prompt: safeScoringPrompt,
      jsonMode: true,
    });

    const parsedEval = extractJsonFromText<{ winningIndex?: number; score?: number; rationale?: string }>(
      evalResult.text
    );

    if (
      parsedEval &&
      typeof parsedEval.winningIndex === 'number' &&
      parsedEval.winningIndex >= 1 &&
      parsedEval.winningIndex <= eligibleCandidates.length
    ) {
      chosenIndex = parsedEval.winningIndex - 1;
      finalScore = parsedEval.score || finalScore;
      rationale = parsedEval.rationale || rationale;
    }
  } catch {
    // If scoring call fails or returns unparseable JSON, default to the first eligible candidate
    chosenIndex = 0;
  }

  const winner = eligibleCandidates[chosenIndex];

  return {
    topic: winner.topic,
    category: winner.category,
    sourceType: winner.sourceType,
    premise: winner.premise,
    visualConcept: winner.visualConcept || `Cinematic visual depicting ${winner.topic}`,
    score: finalScore,
    rationale,
    sourceUrl: winner.sourceUrl,
    facts: winner.facts,
    queueItemId: winner.queueItemId,
  };
}
