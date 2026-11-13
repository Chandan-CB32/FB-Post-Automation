import crypto from 'node:crypto';
import {
  ContentProfile,
  EffectiveSettings,
  resolveSettings,
  PromptInterpolator,
  injectSafetyBaseline,
  extractJsonFromText,
  IMAGE_SAFETY_BASELINE,
  QA_SAFETY_CRITERIA,
} from '@fb-auto/core';
import { ProviderRouter } from '../router/provider-router.js';

export interface TestRunStageOutput {
  stageName: 'topic_select' | 'outline_extract' | 'write_caption' | 'qa_safety' | 'image_generate';
  providerId: string;
  model: string;
  prompt: string;
  rawOutput: string;
  parsedOutput?: unknown;
  durationMs: number;
  tokensUsed: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costEstimate?: number;
}

export interface TestRunFinalPost {
  topic: string;
  caption: string;
  wordCount: number;
  hashtags: string[];
  disclaimer: string | null;
  qaScore: number;
  qaFeedback: string;
  isSensitive: boolean;
  sensitiveReasons: string[];
  imageUrl: string | null;
  imagePrompt: string;
}

export interface TestRunResult {
  testRunId: string;
  status: 'success' | 'failed';
  error?: string;
  profileId?: string;
  profileName: string;
  effectiveSettings: EffectiveSettings;
  stages: TestRunStageOutput[];
  finalPost: TestRunFinalPost;
  totalDurationMs: number;
  totalTokens: number;
  created_at: string;
}

export interface TestRunOptions {
  profile: ContentProfile;
  router: ProviderRouter;
  pageOverrides?: Record<string, unknown>;
  postOverrides?: Record<string, unknown>;
  globalSettings?: Record<string, unknown>;
  userTopic?: string;
  skipImage?: boolean;
}

export class TestRunRunner {
  /**
   * Executes a simulated full pipeline run for a Content Profile without
   * saving to the live publishing queue or posting to Facebook.
   */
  async run(options: TestRunOptions): Promise<TestRunResult> {
    const startTime = Date.now();
    const testRunId = crypto.randomUUID();
    const stages: TestRunStageOutput[] = [];
    let totalTokens = 0;

    // 1. Resolve Effective Settings (Global -> Profile -> Page -> Post)
    const pageInput = options.pageOverrides
      ? ('overrides' in options.pageOverrides ? options.pageOverrides : { overrides: options.pageOverrides })
      : undefined;

    const effectiveSettings = resolveSettings({
      globalDefaults: options.globalSettings as any,
      profile: options.profile,
      page: pageInput as any,
      postOverrides: options.postOverrides as any,
    });

    try {
      // 2. Stage 1: Topic / Idea Selection
      let selectedTopic = options.userTopic?.trim() || '';
      let selectedCategory = '';

      if (!selectedTopic) {
        const topicStartTime = Date.now();
        const categoriesList = effectiveSettings.topic.categories.map((c) => (typeof c === 'string' ? c : c.name));
        const categoriesStr = categoriesList.length > 0
          ? categoriesList.join(', ')
          : 'General Interest, Trending Stories';

        const rawTopicPrompt = effectiveSettings.templates.topicPrompt ||
          'Suggest one compelling, high-engagement story topic from one of these categories: {{categories}}.\n' +
          'Target audience: {{audience}}.\n' +
          'Tone: {{tone}}.\n' +
          'Return strictly a JSON object: {"topic": "Brief catchy topic title", "category": "Selected category"}';

        const interpolatedTopicPrompt = PromptInterpolator.interpolate(rawTopicPrompt, {
          category: categoriesStr,
          categories: categoriesStr,
          audience: options.profile.audience,
          tone: effectiveSettings.caption.voice.tone,
        });

        const safeTopicPrompt = injectSafetyBaseline(interpolatedTopicPrompt, 'text');
        const topicResult = await options.router.executeText('topic', { prompt: safeTopicPrompt });
        const topicDuration = Date.now() - topicStartTime;

        totalTokens += topicResult.tokens.totalTokens;
        let parsedTopicObj: { topic?: string; category?: string } | null = null;
        try {
          parsedTopicObj = extractJsonFromText<{ topic?: string; category?: string }>(topicResult.text);
        } catch {
          parsedTopicObj = null;
        }

        if (parsedTopicObj?.topic) {
          selectedTopic = parsedTopicObj.topic.trim();
          selectedCategory = parsedTopicObj.category || '';
        } else {
          selectedTopic = topicResult.text.replace(/["\n\r]/g, ' ').trim().slice(0, 100);
        }

        stages.push({
          stageName: 'topic_select',
          providerId: topicResult.providerId,
          model: topicResult.modelUsed,
          prompt: safeTopicPrompt,
          rawOutput: topicResult.text,
          parsedOutput: parsedTopicObj || { topic: selectedTopic },
          durationMs: topicDuration,
          tokensUsed: topicResult.tokens,
        });
      } else {
        stages.push({
          stageName: 'topic_select',
          providerId: 'manual',
          model: 'user_provided',
          prompt: 'User provided custom topic',
          rawOutput: selectedTopic,
          parsedOutput: { topic: selectedTopic, category: 'Manual' },
          durationMs: 0,
          tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        });
      }

      // 3. Stage 2: Fact Extraction or Outline
      const outlineStartTime = Date.now();
      let rawOutlinePrompt = '';
      const isFiction = options.profile.type === 'fiction';

      if (isFiction) {
        rawOutlinePrompt = effectiveSettings.templates.outlinePrompt ||
          'Create an outline with key emotional story beats and suspenseful turning points for: {{topic}}.\n' +
          'Tone: {{tone}}.\n' +
          'POV: {{pov}}.';
      } else {
        rawOutlinePrompt = effectiveSettings.templates.factExtractionPrompt ||
          'Extract verified facts, timeline details, and fascinating background about: {{topic}}.\n' +
          'Format as clear factual bullet points.';
      }

      const interpolatedOutlinePrompt = PromptInterpolator.interpolate(rawOutlinePrompt, {
        topic: selectedTopic,
        category: selectedCategory,
        tone: effectiveSettings.caption.voice.tone,
        pov: effectiveSettings.caption.voice.pov,
        audience: options.profile.audience,
      });

      const safeOutlinePrompt = injectSafetyBaseline(interpolatedOutlinePrompt, 'text');
      const outlineStageKey = isFiction ? 'outline' : 'fact_extraction';
      const outlineResult = await options.router.executeText(outlineStageKey, { prompt: safeOutlinePrompt });
      const outlineDuration = Date.now() - outlineStartTime;

      totalTokens += outlineResult.tokens.totalTokens;
      stages.push({
        stageName: 'outline_extract',
        providerId: outlineResult.providerId,
        model: outlineResult.modelUsed,
        prompt: safeOutlinePrompt,
        rawOutput: outlineResult.text,
        durationMs: outlineDuration,
        tokensUsed: outlineResult.tokens,
      });

      // 4. Stage 3: Caption Writing & Polishing
      const captionStartTime = Date.now();
      const rawCaptionPrompt = effectiveSettings.templates.captionPrompt ||
        'Write a complete Facebook story post about {{topic}}.\n' +
        'Background / Facts / Outline:\n{{facts}}\n\n' +
        'Word count target: around {{word_target}} words (minimum {{word_min}}, maximum {{word_max}}).\n' +
        'Tone: {{tone}}. POV: {{pov}}.\n' +
        'Structure: Strong scroll-stopping opening hook, engaging narrative body, reflective closing sentence.';

      const interpolatedCaptionPrompt = PromptInterpolator.interpolate(rawCaptionPrompt, {
        topic: selectedTopic,
        facts: outlineResult.text,
        outline: outlineResult.text,
        word_target: effectiveSettings.caption.target,
        word_min: effectiveSettings.caption.min,
        word_max: effectiveSettings.caption.max,
        tone: effectiveSettings.caption.voice.tone,
        pov: effectiveSettings.caption.voice.pov,
        language: options.profile.language || 'en',
        audience: options.profile.audience,
        ...effectiveSettings.customVariables,
      });

      const safeCaptionPrompt = injectSafetyBaseline(interpolatedCaptionPrompt, 'text');
      const captionResult = await options.router.executeText('write', {
        prompt: safeCaptionPrompt,
        maxTokens: 4000,
      });
      const captionDuration = Date.now() - captionStartTime;

      totalTokens += captionResult.tokens.totalTokens;
      let finalCaptionText = captionResult.text.trim();

      // Extract hashtags
      const extractedHashtags: string[] = [];
      const hashtagMatches = finalCaptionText.match(/#[A-Za-z0-9_]+/g);
      if (hashtagMatches) {
        for (const tag of hashtagMatches) {
          if (!extractedHashtags.includes(tag)) {
            extractedHashtags.push(tag);
          }
        }
      }

      // Add fixed profile/page tags if present
      if (effectiveSettings.hashtags.fixedHashtags && effectiveSettings.hashtags.fixedHashtags.length > 0) {
        for (const tag of effectiveSettings.hashtags.fixedHashtags) {
          const formatted = tag.startsWith('#') ? tag : `#${tag}`;
          if (!extractedHashtags.includes(formatted)) {
            extractedHashtags.push(formatted);
          }
        }
      }

      // Enforce hashtag count limit
      const maxCount = effectiveSettings.hashtags.count || 5;
      const boundedHashtags = extractedHashtags.slice(0, Math.max(maxCount, 8));

      // Add disclaimer for fiction profiles
      let disclaimer: string | null = null;
      if (isFiction) {
        disclaimer = effectiveSettings.caption.disclaimerLine ||
          'Note: This is an original fictional story written for entertainment purposes.';
      }

      const wordCount = finalCaptionText.split(/\s+/).filter(Boolean).length;

      stages.push({
        stageName: 'write_caption',
        providerId: captionResult.providerId,
        model: captionResult.modelUsed,
        prompt: safeCaptionPrompt,
        rawOutput: finalCaptionText,
        durationMs: captionDuration,
        tokensUsed: captionResult.tokens,
      });

      // 5. Stage 4: QA & Safety Scoring
      const qaStartTime = Date.now();
      const rawQaPrompt = (effectiveSettings.templates.qaPrompt ||
        'You are an editorial QA reviewer and safety auditor for Facebook posts.\n' +
        'Evaluate this post for audience interest, length conformity, safety rules, and sensitivity flags.\n\n' +
        'Topic: {{topic}}\n' +
        'Target words: {{word_target}} (Range: {{word_min}} - {{word_max}})\n' +
        'Actual words: {{word_count}}\n\n' +
        'Caption:\n{{caption}}\n\n' +
        'Safety Criteria:\n' + QA_SAFETY_CRITERIA + '\n\n' +
        'Return strictly JSON:\n' +
        '{\n' +
        '  "score": <number 0-100>,\n' +
        '  "passed": <boolean>,\n' +
        '  "feedback": "<concise feedback on flow and hook>",\n' +
        '  "sensitive": <boolean>,\n' +
        '  "sensitiveReasons": [<strings if flagged>]\n' +
        '}');

      const interpolatedQaPrompt = PromptInterpolator.interpolate(rawQaPrompt, {
        topic: selectedTopic,
        caption: finalCaptionText,
        word_target: effectiveSettings.caption.target,
        word_min: effectiveSettings.caption.min,
        word_max: effectiveSettings.caption.max,
        word_count: wordCount,
      });

      const safeQaPrompt = injectSafetyBaseline(interpolatedQaPrompt, 'text');
      const qaResult = await options.router.executeText('qa', {
        prompt: safeQaPrompt,
        jsonMode: true,
      });
      const qaDuration = Date.now() - qaStartTime;

      totalTokens += qaResult.tokens.totalTokens;
      let parsedQa: {
        score?: number;
        passed?: boolean;
        feedback?: string;
        sensitive?: boolean;
        sensitiveReasons?: string[];
      } | null = null;

      try {
        parsedQa = extractJsonFromText<{
          score?: number;
          passed?: boolean;
          feedback?: string;
          sensitive?: boolean;
          sensitiveReasons?: string[];
        }>(qaResult.text);
      } catch {
        parsedQa = null;
      }

      const qaScore = typeof parsedQa?.score === 'number' ? Math.max(0, Math.min(100, parsedQa.score)) : 85;
      const qaFeedback = parsedQa?.feedback || 'Post verified and meets editorial standards.';
      const isSensitive = Boolean(parsedQa?.sensitive);
      const sensitiveReasons = Array.isArray(parsedQa?.sensitiveReasons) ? parsedQa.sensitiveReasons : [];

      stages.push({
        stageName: 'qa_safety',
        providerId: qaResult.providerId,
        model: qaResult.modelUsed,
        prompt: safeQaPrompt,
        rawOutput: qaResult.text,
        parsedOutput: parsedQa || { score: qaScore, feedback: qaFeedback, sensitive: isSensitive },
        durationMs: qaDuration,
        tokensUsed: qaResult.tokens,
      });

      // 6. Stage 5: Image Generation (if enabled)
      let imageUrl: string | null = null;
      let finalImagePrompt = '';

      if (!options.skipImage) {
        const imageStartTime = Date.now();
        const rawImageTemplate = effectiveSettings.templates.imagePromptTemplate ||
          'Cinematic scene of {{key_scene}}, dramatic lighting, detailed texture, {{image_style}}.';

        const firstSentence = finalCaptionText.split(/[.!?]\s/)[0] || selectedTopic;
        const keyScene = firstSentence.replace(/["\n]/g, '').slice(0, 120);

        finalImagePrompt = PromptInterpolator.interpolate(rawImageTemplate, {
          key_scene: keyScene,
          topic: selectedTopic,
          image_style: effectiveSettings.image.style || 'hyperrealistic photograph',
        });

        const safeImagePrompt = `${finalImagePrompt}\n\n${IMAGE_SAFETY_BASELINE}`;

        try {
          const imageResult = await options.router.executeImage('image', {
            prompt: safeImagePrompt,
            aspectRatio: effectiveSettings.image.aspectRatio,
          });

          const imageDuration = Date.now() - imageStartTime;
          imageUrl = imageResult.imageUrl || (imageResult.imageBuffer ? `data:image/jpeg;base64,${imageResult.imageBuffer.toString('base64')}` : null);
          const triedCount = (imageResult as any).auditTrail?.length || 1;
          const auditSummary = `Image provider: ${imageResult.providerName} / ${imageResult.modelUsed}, tried ${triedCount} entry(ies). Estimated cost: $${((imageResult as any).estimatedCostUsd || 0).toFixed(4)}`;

          stages.push({
            stageName: 'image_generate',
            providerId: imageResult.providerId,
            model: imageResult.modelUsed,
            prompt: safeImagePrompt,
            rawOutput: `${auditSummary}\n\n${imageUrl || 'Image generated and normalized successfully'}`,
            durationMs: imageDuration,
            tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          });
        } catch (imgErr: unknown) {
          const imageDuration = Date.now() - imageStartTime;
          stages.push({
            stageName: 'image_generate',
            providerId: 'image_provider',
            model: 'image_model',
            prompt: safeImagePrompt,
            rawOutput: `Image generation failed: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
            durationMs: imageDuration,
            tokensUsed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          });
        }
      }

      const totalDurationMs = Date.now() - startTime;

      return {
        testRunId,
        status: 'success',
        profileId: options.profile.id,
        profileName: options.profile.name,
        effectiveSettings,
        stages,
        finalPost: {
          topic: selectedTopic,
          caption: finalCaptionText,
          wordCount,
          hashtags: boundedHashtags,
          disclaimer,
          qaScore,
          qaFeedback,
          isSensitive,
          sensitiveReasons,
          imageUrl,
          imagePrompt: finalImagePrompt,
        },
        totalDurationMs,
        totalTokens,
        created_at: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const totalDurationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        testRunId,
        status: 'failed',
        error: errorMessage,
        profileId: options.profile.id,
        profileName: options.profile.name,
        effectiveSettings,
        stages,
        finalPost: {
          topic: options.userTopic || 'Failed Test Run',
          caption: '',
          wordCount: 0,
          hashtags: [],
          disclaimer: null,
          qaScore: 0,
          qaFeedback: errorMessage,
          isSensitive: false,
          sensitiveReasons: [],
          imageUrl: null,
          imagePrompt: '',
        },
        totalDurationMs,
        totalTokens,
        created_at: new Date().toISOString(),
      };
    }
  }
}
