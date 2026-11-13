import {
  ContentProfile,
  EffectiveSettings,
  PromptInterpolator,
  IMAGE_SAFETY_BASELINE,
  buildConcreteImagePrompt,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';

export type KeySceneMode = 'opening' | 'climax' | 'mood' | 'character';

export interface ImagePromptStageInput {
  profile: ContentProfile;
  effectiveSettings: EffectiveSettings;
  topic: string;
  caption: string;
  visualConcept?: string;
  keySceneMode?: KeySceneMode;
  router?: ProviderRouter;
}

export interface ImagePromptStageResult {
  keyScene: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  aspectRatio: '4:5' | '1:1' | '16:9';
  style: string;
}

const DEFAULT_NEGATIVE_PROMPT =
  'blurry, low quality, distorted, extra limbs, deformed anatomy, disfigured face, cartoon, 3d render, illustration, bad proportions, watermark, text inside image, logo, signature, gore, blood, violent, duplicate elements';

/**
 * Extracts a key scene from caption prose based on the selected mode:
 * - 'opening': setting and initial hook from opening sentences
 * - 'climax': dramatic turning point from middle-to-late section
 * - 'mood': atmospheric environment, lighting, and weather
 * - 'character': figure, attire, expression, and posture
 */
export function extractKeySceneFromProse(
  caption: string,
  topic: string,
  mode: KeySceneMode = 'climax',
  seedConcept?: string
): string {
  if (seedConcept && seedConcept.trim().length > 15) {
    return seedConcept.trim();
  }

  const rawParagraphs = caption
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        Boolean(p) &&
        !p.toLowerCase().startsWith('source:') &&
        !p.toLowerCase().startsWith('note:') &&
        !p.startsWith('*') &&
        !p.startsWith('#')
    );

  if (rawParagraphs.length === 0) {
    return `Cinematic scene depicting ${topic}`;
  }

  if (mode === 'opening') {
    const firstP = rawParagraphs[0];
    const sentences = firstP.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [firstP];
    const firstTwo = sentences.slice(0, 2).join(' ').trim();
    return cleanSceneText(firstTwo || firstP);
  }

  if (mode === 'climax') {
    // Climax is typically in the second half of the story
    const targetIndex = rawParagraphs.length > 2 ? Math.floor(rawParagraphs.length * 0.65) : rawParagraphs.length - 1;
    const climaxP = rawParagraphs[targetIndex];
    const sentences = climaxP.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [climaxP];
    const keySentence = sentences[Math.floor(sentences.length / 2)] || climaxP;
    return cleanSceneText(keySentence);
  }

  if (mode === 'mood') {
    // Search for environmental or atmospheric keywords
    const moodKeywords = [
      'fog', 'mist', 'shadow', 'twilight', 'midnight', 'rain', 'storm', 'ocean',
      'darkness', 'amber', 'neon', 'glow', 'abandoned', 'frost', 'snow', 'desert',
      'sunlight', 'starlight', 'ancient', 'tower', 'corridor', 'forest'
    ];

    for (const p of rawParagraphs) {
      const lower = p.toLowerCase();
      if (moodKeywords.some((k) => lower.includes(k))) {
        return cleanSceneText(p.slice(0, 150));
      }
    }

    return cleanSceneText(rawParagraphs[0]);
  }

  if (mode === 'character') {
    // Search for character/figure keywords
    const charKeywords = [
      'man', 'woman', 'figure', 'stranger', 'detective', 'astronomer',
      'sailor', 'scientist', 'shadowy figure', 'captain', 'officer',
      'driver', 'pilot', 'eyes', 'face', 'coat', 'attire', 'person'
    ];
    for (const p of rawParagraphs) {
      const lower = p.toLowerCase();
      if (charKeywords.some((k) => lower.includes(k))) {
        return cleanSceneText(p.slice(0, 150));
      }
    }
    return cleanSceneText(`Central figure involved in ${topic}`);
  }

  return cleanSceneText(rawParagraphs[0]);
}

/**
 * Strips conversational filler and cleans scene descriptions for image prompts.
 */
function cleanSceneText(text: string): string {
  return text
    .replace(/^["'#\s]+|["'\s]+$/g, '')
    .replace(/^(however|meanwhile|suddenly|eventually|moreover|furthermore|in fact|surprisingly)[,\s]+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Stage 06: Image Prompt Template Builder
 * Extracts key scene, interpolates templates with visual styles,
 * and permanently attaches mandatory safety directives and negative prompts.
 */
export async function executeImagePromptStage(
  input: ImagePromptStageInput
): Promise<ImagePromptStageResult> {
  const concreteResult = buildConcreteImagePrompt({
    headline: input.topic,
    caption: input.caption,
    facts: [],
    topic: input.topic,
    visualConcept: input.visualConcept,
  });

  const rawTemplate =
    input.effectiveSettings.image.template ||
    input.effectiveSettings.templates.imagePromptTemplate;

  let finalPrompt = concreteResult.prompt;
  let style = concreteResult.style;

  if (rawTemplate && rawTemplate !== 'A high-contrast cinematic photograph of {{key_scene}}, dramatic lighting, {{image_style}}.') {
    style = input.effectiveSettings.image.style || 'cinematic, photorealistic photography';
    const interpolated = PromptInterpolator.interpolate(rawTemplate, {
      key_scene: concreteResult.concreteSubject,
      topic: input.topic,
      image_style: style,
      audience: input.profile.audience,
      ...input.effectiveSettings.customVariables,
    });
    let base = interpolated;
    if (!rawTemplate.includes('{{image_style}}') && style && !interpolated.toLowerCase().includes(style.toLowerCase())) {
      base = `${interpolated}, ${style}`;
    }
    finalPrompt = `${base}. Composition: Place main subject in upper 65% of frame, keep bottom 35% calm and dark for headline overlay.`;
  }

  // Permanently append mandatory image safety directives
  finalPrompt = finalPrompt.includes(IMAGE_SAFETY_BASELINE)
    ? finalPrompt
    : `${finalPrompt}\n\n${IMAGE_SAFETY_BASELINE}`;

  // Assemble negative prompt
  const userNegative =
    input.effectiveSettings.image.negativePrompt ||
    input.effectiveSettings.templates.negativeImagePrompt ||
    '';

  const negativePromptTokens = new Set<string>();
  const addTokens = (str: string) => {
    str.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => negativePromptTokens.add(t));
  };

  addTokens(concreteResult.negativePrompt);
  if (userNegative) {
    addTokens(userNegative);
  }

  const consolidatedNegativePrompt = Array.from(negativePromptTokens).join(', ');

  // Dimensions by aspect ratio
  const aspectRatio = input.effectiveSettings.image.aspectRatio || '4:5';
  let width = input.effectiveSettings.image.width || 1080;
  let height = input.effectiveSettings.image.height || 1350;

  if (aspectRatio === '1:1') {
    width = 1080;
    height = 1080;
  } else if (aspectRatio === '16:9') {
    width = 1920;
    height = 1080;
  } else if (aspectRatio === '4:5') {
    width = 1080;
    height = 1350;
  }

  return {
    keyScene: concreteResult.concreteSubject,
    prompt: finalPrompt,
    negativePrompt: consolidatedNegativePrompt,
    width,
    height,
    aspectRatio,
    style,
  };
}
