import { injectSafetyBaseline } from './safety-baseline.js';

export interface PromptContext {
  page_name?: string;
  niche?: string;
  topic?: string;
  topic_title?: string;
  category?: string;
  categories?: string | string[];
  facts?: string | string[];
  outline?: string | string[];
  sources?: string | string[];
  premise?: string;
  title?: string;
  caption?: string;
  caption_summary?: string;
  key_scene?: string;
  tone?: string;
  pov?: string;
  audience?: string;
  language?: string;
  profile_type?: string;
  count?: number | string;
  word_min?: number | string;
  word_max?: number | string;
  word_target?: number | string;
  word_count?: number | string;
  hashtag_count?: number | string;
  story_so_far?: string;
  series_bible?: string;
  episode_number?: number | string;
  recent_titles?: string | string[];
  avoid_list?: string | string[];
  required_phrases?: string | string[];
  image_style?: string;
  date?: string;
  custom?: Record<string, string>;
}

export interface InterpolationResult {
  prompt: string;
  unresolvedVariables: string[];
}

export interface InterpolateOptions {
  injectSafety?: boolean;
  safetyKind?: 'text' | 'image' | 'qa';
}

/**
 * Normalizes array inputs into clean strings for prompt inclusion.
 */
function formatValue(val: unknown): string {
  if (val === undefined || val === null) {
    return '';
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '';
    return val.map((item) => `- ${String(item)}`).join('\n');
  }
  return String(val);
}

/**
 * Interpolates variables into a prompt template and injects the mandatory safety baseline.
 */
export function interpolatePrompt(
  template: string,
  context: PromptContext,
  options: InterpolateOptions = { injectSafety: true, safetyKind: 'text' }
): InterpolationResult {
  if (!template || typeof template !== 'string') {
    return { prompt: '', unresolvedVariables: [] };
  }

  // Pre-populate standard fallback variables
  const now = new Date();
  const contextMap: Record<string, string> = {
    date: context.date || now.toISOString().split('T')[0],
    language: context.language || 'English',
    audience: context.audience || 'General Facebook English-speaking audience',
    profile_type: formatValue(context.profile_type),
    page_name: formatValue(context.page_name),
    niche: formatValue(context.niche),
    topic: formatValue(context.topic),
    topic_title: formatValue(context.topic_title || context.topic),
    category: formatValue(context.category),
    categories: formatValue(context.categories),
    facts: formatValue(context.facts),
    outline: formatValue(context.outline),
    sources: formatValue(context.sources),
    premise: formatValue(context.premise),
    title: formatValue(context.title),
    caption: formatValue(context.caption),
    caption_summary: formatValue(context.caption_summary),
    key_scene: formatValue(context.key_scene),
    tone: formatValue(context.tone || 'engaging, conversational'),
    pov: formatValue(context.pov || 'third-person'),
    word_min: formatValue(context.word_min),
    word_max: formatValue(context.word_max),
    word_target: formatValue(context.word_target),
    word_count: formatValue(context.word_count),
    count: formatValue(context.count),
    hashtag_count: formatValue(context.hashtag_count || 5),
    story_so_far: formatValue(context.story_so_far),
    series_bible: formatValue(context.series_bible),
    episode_number: formatValue(context.episode_number),
    recent_titles: formatValue(context.recent_titles),
    avoid_list: formatValue(context.avoid_list),
    required_phrases: formatValue(context.required_phrases),
    image_style: formatValue(context.image_style),
  };

  // Merge custom variables: {{custom.<name>}}
  if (context.custom) {
    for (const [k, v] of Object.entries(context.custom)) {
      contextMap[`custom.${k}`] = formatValue(v);
    }
  }

  const unresolved = new Set<string>();

  let interpolated = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, varName) => {
    if (Object.prototype.hasOwnProperty.call(contextMap, varName)) {
      const val = contextMap[varName];
      // If variable value is empty string, count as provided (empty)
      return val;
    }
    unresolved.add(varName);
    return match; // Keep unchanged so caller can detect unresolved
  });

  // Permanently inject safety baseline if enabled
  if (options.injectSafety !== false) {
    interpolated = injectSafetyBaseline(interpolated, options.safetyKind || 'text');
  }

  return {
    prompt: interpolated,
    unresolvedVariables: Array.from(unresolved),
  };
}

export const PromptInterpolator = {
  interpolate: (template: string, context: PromptContext, options?: InterpolateOptions) =>
    interpolatePrompt(template, context, options).prompt,
  interpolateWithResult: interpolatePrompt,
};

