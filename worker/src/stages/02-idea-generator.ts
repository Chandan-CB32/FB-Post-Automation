import {
  ContentProfile,
  EffectiveSettings,
  PromptInterpolator,
  injectSafetyBaseline,
  extractJsonFromText,
  TokenUsage,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';

export interface GeneratedIdeaCandidate {
  topic: string;
  category: string;
  premise: string;
  visualConcept: string;
  hookScore: number;
  sourceType: 'auto_idea' | 'series';
}

export interface IdeaGenerationResult {
  ideas: GeneratedIdeaCandidate[];
  providerId: string;
  modelUsed: string;
  tokensUsed: TokenUsage;
}

export interface IdeaGeneratorOptions {
  profile: ContentProfile;
  router: ProviderRouter;
  effectiveSettings: EffectiveSettings;
  count?: number;
  category?: string;
  bannedTopics?: string[];
  seriesBible?: string;
  storySoFar?: string;
  episodeNumber?: number;
}

export class IdeaGenerator {
  /**
   * Generates a batch of creative story ideas or premises using the configured ProviderRouter.
   */
  async generateIdeas(options: IdeaGeneratorOptions): Promise<IdeaGenerationResult> {
    const count = options.count ?? 3;
    const isSeries = Boolean(options.seriesBible || options.storySoFar);

    // Pick categories
    let targetCategory = options.category;
    if (!targetCategory) {
      const cats = options.effectiveSettings.topic.categories.map((c) =>
        typeof c === 'string' ? c : c.name
      );
      targetCategory = cats.length > 0 ? cats.join(', ') : 'Trending & Fascinating Stories';
    }

    const defaultPrompt =
      'Brainstorm {{count}} unique, highly engaging and captivating post premises.\n' +
      'Category / Domain: {{category}}\n' +
      'Target Audience: {{audience}}\n' +
      'Voice & Tone: {{tone}}\n' +
      'Point of View: {{pov}}\n' +
      (isSeries
        ? 'Series Bible:\n{{series_bible}}\nRolling Summary of Previous Episodes:\n{{story_so_far}}\nEpisode Number: {{episode_number}}\n'
        : '') +
      (options.bannedTopics && options.bannedTopics.length > 0
        ? 'Avoid these recent topics and cliches: {{avoid_list}}\n'
        : '') +
      '\nEach idea must have a strong hook, suspense/curiosity gap, and one vivid visual scene for an accompanying image.\n' +
      'Return STRICTLY a JSON array of objects:\n' +
      '[\n' +
      '  {\n' +
      '    "topic": "Catchy headline / title",\n' +
      '    "category": "Selected category",\n' +
      '    "premise": "1-2 sentence compelling summary of the hook and climax",\n' +
      '    "visualConcept": "A vivid description of 1 cinematic key scene",\n' +
      '    "hookScore": <integer 1-10>\n' +
      '  }\n' +
      ']';

    const rawTemplate = options.effectiveSettings.templates.ideaPrompt || defaultPrompt;

    const interpolated = PromptInterpolator.interpolate(rawTemplate, {
      count,
      category: targetCategory,
      categories: targetCategory,
      audience: options.profile.audience,
      tone: options.effectiveSettings.caption.voice.tone,
      pov: options.effectiveSettings.caption.voice.pov,
      series_bible: options.seriesBible,
      story_so_far: options.storySoFar,
      episode_number: options.episodeNumber,
      avoid_list: options.bannedTopics?.join(', '),
      ...options.effectiveSettings.customVariables,
    });

    const safePrompt = injectSafetyBaseline(interpolated, 'text');

    const routerResult = await options.router.executeText('idea', {
      prompt: safePrompt,
      jsonMode: true,
    });

    let rawParsed: unknown;
    try {
      rawParsed = extractJsonFromText(routerResult.text);
    } catch {
      rawParsed = null;
    }

    const candidates: GeneratedIdeaCandidate[] = [];

    if (Array.isArray(rawParsed)) {
      for (const item of rawParsed) {
        if (item && typeof item === 'object' && 'topic' in item && typeof item.topic === 'string') {
          candidates.push({
            topic: item.topic.trim(),
            category: typeof item.category === 'string' ? item.category.trim() : targetCategory,
            premise: typeof item.premise === 'string' ? item.premise.trim() : 'Captivating story premise.',
            visualConcept:
              typeof item.visualConcept === 'string'
                ? item.visualConcept.trim()
                : `A striking visual depiction of ${item.topic.trim()}`,
            hookScore:
              typeof item.hookScore === 'number' && item.hookScore >= 1 && item.hookScore <= 10
                ? Math.round(item.hookScore)
                : 8,
            sourceType: isSeries ? 'series' : 'auto_idea',
          });
        }
      }
    } else if (rawParsed && typeof rawParsed === 'object' && 'topic' in rawParsed) {
      const item = rawParsed as any;
      candidates.push({
        topic: String(item.topic).trim(),
        category: typeof item.category === 'string' ? item.category.trim() : targetCategory,
        premise: typeof item.premise === 'string' ? item.premise.trim() : 'Captivating story premise.',
        visualConcept:
          typeof item.visualConcept === 'string'
            ? item.visualConcept.trim()
            : `A striking visual depiction of ${String(item.topic).trim()}`,
        hookScore: typeof item.hookScore === 'number' ? Math.round(item.hookScore) : 8,
        sourceType: isSeries ? 'series' : 'auto_idea',
      });
    }

    // Fallback if parsing returned no valid objects
    if (candidates.length === 0) {
      const firstLine = routerResult.text.split('\n')[0].replace(/^["'0-9.-]+\s*/, '').trim().slice(0, 100);
      candidates.push({
        topic: firstLine || 'The Enigmatic Discovery',
        category: targetCategory,
        premise: routerResult.text.slice(0, 200).trim() || 'An enigmatic discovery that defies conventional wisdom.',
        visualConcept: 'Dramatic cinematic depiction of the discovery with moody lighting.',
        hookScore: 7,
        sourceType: isSeries ? 'series' : 'auto_idea',
      });
    }

    return {
      ideas: candidates,
      providerId: routerResult.providerId,
      modelUsed: routerResult.modelUsed,
      tokensUsed: routerResult.tokens,
    };
  }
}
