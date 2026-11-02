import {
  StageTemplates,
  CaptionSettings,
  HashtagSettings,
  ImageSettings,
  TopicSettings,
  PostingSchedule,
  PublishingMode,
} from '../types/index.js';

export type SettingSource = 'global' | 'profile' | 'page' | 'page (appended)' | 'post';

export interface ProvenanceRecord {
  key: string;
  value: unknown;
  source: SettingSource;
}

export interface EffectiveSettings {
  templates: StageTemplates;
  caption: CaptionSettings;
  hashtags: HashtagSettings;
  image: ImageSettings;
  topic: TopicSettings;
  schedule: PostingSchedule;
  publishingMode: PublishingMode;
  hybridMinScore: number;
  autoApproveAfterHours?: number;
  customVariables: Record<string, string>;
  provenance: Record<string, ProvenanceRecord>;
}

// Global System Defaults
export const GLOBAL_DEFAULTS: {
  templates: StageTemplates;
  caption: CaptionSettings;
  hashtags: HashtagSettings;
  image: ImageSettings;
  topic: TopicSettings;
  schedule: PostingSchedule;
  publishingMode: PublishingMode;
  hybridMinScore: number;
} = {
  templates: {
    captionPrompt: 'Write an engaging post about {{topic}} for {{audience}} in {{language}}.',
    imagePromptTemplate: 'A high quality photograph of {{key_scene}}, cinematic lighting.',
  },
  caption: {
    unit: 'words',
    min: 120,
    target: 180,
    max: 250,
    hookRule: true,
    maxSentencesPerParagraph: 3,
    voice: {
      tone: 'conversational, informative, engaging',
      pov: 'third-person',
      emojiPolicy: 'minimal',
      bannedPhrases: [],
      requiredPhrases: [],
    },
    endingStyle: 'twist',
    includeQuestion: true,
    formatSourceLine: false,
  },
  hashtags: {
    count: 5,
    bannedHashtags: [],
    fixedHashtags: [],
    style: 'mixed',
  },
  image: {
    template: 'A high quality photograph of {{key_scene}}, cinematic lighting.',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    style: 'cinematic photograph',
    keySceneMode: 'climax',
    allowTextInImage: false,
    allowRealPeople: false,
    allowLogos: false,
    headlinePanel: {
      enabled: false,
      heightPercent: 25,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
    },
  },
  topic: {
    sources: {
      autoTopicsWeight: 50,
      ownerQueueWeight: 50,
      researchWeight: 0,
      seriesWeight: 0,
    },
    categories: [],
    preventConsecutiveCategory: true,
    dedupWindowDays: 90,
    dedupWindowPosts: 200,
    bannedTopics: [],
    includeKeywords: [],
    excludeKeywords: [],
  },
  schedule: {
    timezone: 'UTC',
    postsPerDay: 3,
    times: ['09:00', '15:00', '21:00'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    jitterMinutes: 10,
    minimumGapHours: 2,
    leadTimeHours: 24,
  },
  publishingMode: 'review',
  hybridMinScore: 80,
};

export interface ResolveSettingsInput {
  globalDefaults?: typeof GLOBAL_DEFAULTS;
  profile?: {
    templates?: Partial<StageTemplates>;
    captionSettings?: Partial<CaptionSettings>;
    hashtagSettings?: Partial<HashtagSettings>;
    imageSettings?: Partial<ImageSettings>;
    topicSettings?: Partial<TopicSettings>;
    customVariables?: Record<string, string>;
  };
  page?: {
    overrides?: Record<string, unknown>;
    customCaptionPrompt?: string;
    customCaptionPromptMode?: 'append' | 'replace';
    customImagePrompt?: string;
    customImagePromptMode?: 'append' | 'replace';
    schedule?: Partial<PostingSchedule>;
    publishingMode?: PublishingMode;
    hybridMinScore?: number;
    autoApproveAfterHours?: number;
  };
  postOverrides?: {
    captionSettings?: Partial<CaptionSettings>;
    imageSettings?: Partial<ImageSettings>;
    templates?: Partial<StageTemplates>;
    customVariables?: Record<string, string>;
  };
}

/**
 * Resolves settings through the 4-tier hierarchy:
 * Global Defaults → Profile → Page Overrides → Post Overrides
 * Builds an audit trail map (provenance) tracking the source of every setting.
 */
export function resolveSettings(input: ResolveSettingsInput): EffectiveSettings {
  const provenance: Record<string, ProvenanceRecord> = {};

  function resolveValue<T>(
    keyPath: string,
    globalVal: T,
    profileVal: T | undefined,
    pageVal: T | undefined,
    postVal: T | undefined
  ): T {
    if (postVal !== undefined && postVal !== null) {
      provenance[keyPath] = { key: keyPath, value: postVal, source: 'post' };
      return postVal;
    }
    if (pageVal !== undefined && pageVal !== null) {
      provenance[keyPath] = { key: keyPath, value: pageVal, source: 'page' };
      return pageVal;
    }
    if (profileVal !== undefined && profileVal !== null) {
      provenance[keyPath] = { key: keyPath, value: profileVal, source: 'profile' };
      return profileVal;
    }
    provenance[keyPath] = { key: keyPath, value: globalVal, source: 'global' };
    return globalVal;
  }

  const global = input.globalDefaults || GLOBAL_DEFAULTS;
  const prof = input.profile;
  const page = input.page;
  const post = input.postOverrides;
  const pageOverrides = page?.overrides || {};

  // 1. Resolve Templates
  let captionPrompt = resolveValue(
    'templates.captionPrompt',
    global.templates.captionPrompt,
    prof?.templates?.captionPrompt,
    undefined,
    post?.templates?.captionPrompt
  );

  // Apply Page custom caption prompt if configured
  if (page?.customCaptionPrompt && page.customCaptionPrompt.trim()) {
    const mode = page.customCaptionPromptMode || 'append';
    if (mode === 'append') {
      captionPrompt = `${captionPrompt}\n\n${page.customCaptionPrompt.trim()}`;
      provenance['templates.captionPrompt'] = {
        key: 'templates.captionPrompt',
        value: captionPrompt,
        source: 'page (appended)',
      };
    } else {
      captionPrompt = page.customCaptionPrompt.trim();
      provenance['templates.captionPrompt'] = {
        key: 'templates.captionPrompt',
        value: captionPrompt,
        source: 'page',
      };
    }
  }

  let imagePromptTemplate = resolveValue(
    'templates.imagePromptTemplate',
    global.templates.imagePromptTemplate,
    prof?.templates?.imagePromptTemplate,
    undefined,
    post?.templates?.imagePromptTemplate
  );

  if (page?.customImagePrompt && page.customImagePrompt.trim()) {
    const mode = page.customImagePromptMode || 'append';
    if (mode === 'append') {
      imagePromptTemplate = `${imagePromptTemplate}\n\n${page.customImagePrompt.trim()}`;
      provenance['templates.imagePromptTemplate'] = {
        key: 'templates.imagePromptTemplate',
        value: imagePromptTemplate,
        source: 'page (appended)',
      };
    } else {
      imagePromptTemplate = page.customImagePrompt.trim();
      provenance['templates.imagePromptTemplate'] = {
        key: 'templates.imagePromptTemplate',
        value: imagePromptTemplate,
        source: 'page',
      };
    }
  }

  const templates: StageTemplates = {
    captionPrompt,
    imagePromptTemplate,
    ideaPrompt: resolveValue('templates.ideaPrompt', global.templates.ideaPrompt, prof?.templates?.ideaPrompt, undefined, post?.templates?.ideaPrompt),
    topicPrompt: resolveValue('templates.topicPrompt', global.templates.topicPrompt, prof?.templates?.topicPrompt, undefined, post?.templates?.topicPrompt),
    factExtractionPrompt: resolveValue('templates.factExtractionPrompt', global.templates.factExtractionPrompt, prof?.templates?.factExtractionPrompt, undefined, post?.templates?.factExtractionPrompt),
    outlinePrompt: resolveValue('templates.outlinePrompt', global.templates.outlinePrompt, prof?.templates?.outlinePrompt, undefined, post?.templates?.outlinePrompt),
    polishPrompt: resolveValue('templates.polishPrompt', global.templates.polishPrompt, prof?.templates?.polishPrompt, undefined, post?.templates?.polishPrompt),
    headlinePrompt: resolveValue('templates.headlinePrompt', global.templates.headlinePrompt, prof?.templates?.headlinePrompt, undefined, post?.templates?.headlinePrompt),
    hashtagPrompt: resolveValue('templates.hashtagPrompt', global.templates.hashtagPrompt, prof?.templates?.hashtagPrompt, undefined, post?.templates?.hashtagPrompt),
    qaPrompt: resolveValue('templates.qaPrompt', global.templates.qaPrompt, prof?.templates?.qaPrompt, undefined, post?.templates?.qaPrompt),
    negativeImagePrompt: resolveValue('templates.negativeImagePrompt', global.templates.negativeImagePrompt, prof?.templates?.negativeImagePrompt, undefined, post?.templates?.negativeImagePrompt),
  };

  // 2. Resolve Caption Settings
  const caption: CaptionSettings = {
    unit: resolveValue('caption.unit', global.caption.unit, prof?.captionSettings?.unit, pageOverrides['caption.unit'] as any, post?.captionSettings?.unit),
    min: resolveValue('caption.min', global.caption.min, prof?.captionSettings?.min, pageOverrides['caption.min'] as any, post?.captionSettings?.min),
    target: resolveValue('caption.target', global.caption.target, prof?.captionSettings?.target, pageOverrides['caption.target'] as any, post?.captionSettings?.target),
    max: resolveValue('caption.max', global.caption.max, prof?.captionSettings?.max, pageOverrides['caption.max'] as any, post?.captionSettings?.max),
    hookRule: resolveValue('caption.hookRule', global.caption.hookRule, prof?.captionSettings?.hookRule, pageOverrides['caption.hookRule'] as any, post?.captionSettings?.hookRule),
    maxSentencesPerParagraph: resolveValue('caption.maxSentencesPerParagraph', global.caption.maxSentencesPerParagraph, prof?.captionSettings?.maxSentencesPerParagraph, pageOverrides['caption.maxSentencesPerParagraph'] as any, post?.captionSettings?.maxSentencesPerParagraph),
    voice: {
      tone: resolveValue('caption.voice.tone', global.caption.voice.tone, prof?.captionSettings?.voice?.tone, pageOverrides['caption.voice.tone'] as any, post?.captionSettings?.voice?.tone),
      pov: resolveValue('caption.voice.pov', global.caption.voice.pov, prof?.captionSettings?.voice?.pov, pageOverrides['caption.voice.pov'] as any, post?.captionSettings?.voice?.pov),
      readingLevel: resolveValue('caption.voice.readingLevel', global.caption.voice.readingLevel, prof?.captionSettings?.voice?.readingLevel, pageOverrides['caption.voice.readingLevel'] as any, post?.captionSettings?.voice?.readingLevel),
      humorLevel: resolveValue('caption.voice.humorLevel', global.caption.voice.humorLevel, prof?.captionSettings?.voice?.humorLevel, pageOverrides['caption.voice.humorLevel'] as any, post?.captionSettings?.voice?.humorLevel),
      emojiPolicy: resolveValue('caption.voice.emojiPolicy', global.caption.voice.emojiPolicy, prof?.captionSettings?.voice?.emojiPolicy, pageOverrides['caption.voice.emojiPolicy'] as any, post?.captionSettings?.voice?.emojiPolicy),
      bannedPhrases: resolveValue('caption.voice.bannedPhrases', global.caption.voice.bannedPhrases, prof?.captionSettings?.voice?.bannedPhrases, pageOverrides['caption.voice.bannedPhrases'] as any, post?.captionSettings?.voice?.bannedPhrases),
      requiredPhrases: resolveValue('caption.voice.requiredPhrases', global.caption.voice.requiredPhrases, prof?.captionSettings?.voice?.requiredPhrases, pageOverrides['caption.voice.requiredPhrases'] as any, post?.captionSettings?.voice?.requiredPhrases),
    },
    endingStyle: resolveValue('caption.endingStyle', global.caption.endingStyle, prof?.captionSettings?.endingStyle, pageOverrides['caption.endingStyle'] as any, post?.captionSettings?.endingStyle),
    includeQuestion: resolveValue('caption.includeQuestion', global.caption.includeQuestion, prof?.captionSettings?.includeQuestion, pageOverrides['caption.includeQuestion'] as any, post?.captionSettings?.includeQuestion),
    questionStyle: resolveValue('caption.questionStyle', global.caption.questionStyle, prof?.captionSettings?.questionStyle, pageOverrides['caption.questionStyle'] as any, post?.captionSettings?.questionStyle),
    formatSourceLine: resolveValue('caption.formatSourceLine', global.caption.formatSourceLine, prof?.captionSettings?.formatSourceLine, pageOverrides['caption.formatSourceLine'] as any, post?.captionSettings?.formatSourceLine),
    disclaimerLine: resolveValue('caption.disclaimerLine', global.caption.disclaimerLine, prof?.captionSettings?.disclaimerLine, pageOverrides['caption.disclaimerLine'] as any, post?.captionSettings?.disclaimerLine),
  };

  // 3. Resolve Hashtag Settings
  const hashtags: HashtagSettings = {
    count: resolveValue('hashtags.count', global.hashtags.count, prof?.hashtagSettings?.count, pageOverrides['hashtags.count'] as any, undefined),
    bannedHashtags: resolveValue('hashtags.bannedHashtags', global.hashtags.bannedHashtags, prof?.hashtagSettings?.bannedHashtags, pageOverrides['hashtags.bannedHashtags'] as any, undefined),
    fixedHashtags: resolveValue('hashtags.fixedHashtags', global.hashtags.fixedHashtags, prof?.hashtagSettings?.fixedHashtags, pageOverrides['hashtags.fixedHashtags'] as any, undefined),
    style: resolveValue('hashtags.style', global.hashtags.style, prof?.hashtagSettings?.style, pageOverrides['hashtags.style'] as any, undefined),
  };

  // 4. Resolve Image Settings
  const image: ImageSettings = {
    template: imagePromptTemplate,
    negativePrompt: resolveValue('image.negativePrompt', global.image.negativePrompt, prof?.imageSettings?.negativePrompt, pageOverrides['image.negativePrompt'] as any, post?.imageSettings?.negativePrompt),
    aspectRatio: resolveValue('image.aspectRatio', global.image.aspectRatio, prof?.imageSettings?.aspectRatio, pageOverrides['image.aspectRatio'] as any, post?.imageSettings?.aspectRatio),
    width: resolveValue('image.width', global.image.width, prof?.imageSettings?.width, pageOverrides['image.width'] as any, post?.imageSettings?.width),
    height: resolveValue('image.height', global.image.height, prof?.imageSettings?.height, pageOverrides['image.height'] as any, post?.imageSettings?.height),
    style: resolveValue('image.style', global.image.style, prof?.imageSettings?.style, pageOverrides['image.style'] as any, post?.imageSettings?.style),
    keySceneMode: resolveValue('image.keySceneMode', global.image.keySceneMode, prof?.imageSettings?.keySceneMode, pageOverrides['image.keySceneMode'] as any, post?.imageSettings?.keySceneMode),
    allowTextInImage: resolveValue('image.allowTextInImage', global.image.allowTextInImage, prof?.imageSettings?.allowTextInImage, pageOverrides['image.allowTextInImage'] as any, post?.imageSettings?.allowTextInImage),
    allowRealPeople: resolveValue('image.allowRealPeople', global.image.allowRealPeople, prof?.imageSettings?.allowRealPeople, pageOverrides['image.allowRealPeople'] as any, post?.imageSettings?.allowRealPeople),
    allowLogos: resolveValue('image.allowLogos', global.image.allowLogos, prof?.imageSettings?.allowLogos, pageOverrides['image.allowLogos'] as any, post?.imageSettings?.allowLogos),
    headlinePanel: {
      enabled: resolveValue('image.headlinePanel.enabled', global.image.headlinePanel.enabled, prof?.imageSettings?.headlinePanel?.enabled, pageOverrides['image.headlinePanel.enabled'] as any, post?.imageSettings?.headlinePanel?.enabled),
      heightPercent: resolveValue('image.headlinePanel.heightPercent', global.image.headlinePanel.heightPercent, prof?.imageSettings?.headlinePanel?.heightPercent, pageOverrides['image.headlinePanel.heightPercent'] as any, post?.imageSettings?.headlinePanel?.heightPercent),
      backgroundColor: resolveValue('image.headlinePanel.backgroundColor', global.image.headlinePanel.backgroundColor, prof?.imageSettings?.headlinePanel?.backgroundColor, pageOverrides['image.headlinePanel.backgroundColor'] as any, post?.imageSettings?.headlinePanel?.backgroundColor),
      textColor: resolveValue('image.headlinePanel.textColor', global.image.headlinePanel.textColor, prof?.imageSettings?.headlinePanel?.textColor, pageOverrides['image.headlinePanel.textColor'] as any, post?.imageSettings?.headlinePanel?.textColor),
    },
    seriesStyleBible: resolveValue('image.seriesStyleBible', global.image.seriesStyleBible, prof?.imageSettings?.seriesStyleBible, pageOverrides['image.seriesStyleBible'] as any, post?.imageSettings?.seriesStyleBible),
  };

  // 5. Resolve Topic Settings
  const topic: TopicSettings = {
    sources: {
      autoTopicsWeight: resolveValue('topic.sources.autoTopicsWeight', global.topic.sources.autoTopicsWeight, prof?.topicSettings?.sources?.autoTopicsWeight, pageOverrides['topic.sources.autoTopicsWeight'] as any, undefined),
      ownerQueueWeight: resolveValue('topic.sources.ownerQueueWeight', global.topic.sources.ownerQueueWeight, prof?.topicSettings?.sources?.ownerQueueWeight, pageOverrides['topic.sources.ownerQueueWeight'] as any, undefined),
      researchWeight: resolveValue('topic.sources.researchWeight', global.topic.sources.researchWeight, prof?.topicSettings?.sources?.researchWeight, pageOverrides['topic.sources.researchWeight'] as any, undefined),
      seriesWeight: resolveValue('topic.sources.seriesWeight', global.topic.sources.seriesWeight, prof?.topicSettings?.sources?.seriesWeight, pageOverrides['topic.sources.seriesWeight'] as any, undefined),
    },
    categories: resolveValue('topic.categories', global.topic.categories, prof?.topicSettings?.categories, pageOverrides['topic.categories'] as any, undefined),
    preventConsecutiveCategory: resolveValue('topic.preventConsecutiveCategory', global.topic.preventConsecutiveCategory, prof?.topicSettings?.preventConsecutiveCategory, pageOverrides['topic.preventConsecutiveCategory'] as any, undefined),
    dedupWindowDays: resolveValue('topic.dedupWindowDays', global.topic.dedupWindowDays, prof?.topicSettings?.dedupWindowDays, pageOverrides['topic.dedupWindowDays'] as any, undefined),
    dedupWindowPosts: resolveValue('topic.dedupWindowPosts', global.topic.dedupWindowPosts, prof?.topicSettings?.dedupWindowPosts, pageOverrides['topic.dedupWindowPosts'] as any, undefined),
    bannedTopics: resolveValue('topic.bannedTopics', global.topic.bannedTopics, prof?.topicSettings?.bannedTopics, pageOverrides['topic.bannedTopics'] as any, undefined),
    includeKeywords: resolveValue('topic.includeKeywords', global.topic.includeKeywords, prof?.topicSettings?.includeKeywords, pageOverrides['topic.includeKeywords'] as any, undefined),
    excludeKeywords: resolveValue('topic.excludeKeywords', global.topic.excludeKeywords, prof?.topicSettings?.excludeKeywords, pageOverrides['topic.excludeKeywords'] as any, undefined),
  };

  // 6. Schedule & Publishing Mode
  const schedule: PostingSchedule = {
    timezone: resolveValue('schedule.timezone', global.schedule.timezone, undefined, page?.schedule?.timezone, undefined),
    postsPerDay: resolveValue('schedule.postsPerDay', global.schedule.postsPerDay, undefined, page?.schedule?.postsPerDay, undefined),
    times: resolveValue('schedule.times', global.schedule.times, undefined, page?.schedule?.times, undefined),
    daysOfWeek: resolveValue('schedule.daysOfWeek', global.schedule.daysOfWeek, undefined, page?.schedule?.daysOfWeek, undefined),
    jitterMinutes: resolveValue('schedule.jitterMinutes', global.schedule.jitterMinutes, undefined, page?.schedule?.jitterMinutes, undefined),
    minimumGapHours: resolveValue('schedule.minimumGapHours', global.schedule.minimumGapHours, undefined, page?.schedule?.minimumGapHours, undefined),
    leadTimeHours: resolveValue('schedule.leadTimeHours', global.schedule.leadTimeHours, undefined, page?.schedule?.leadTimeHours, undefined),
    vacationPause: page?.schedule?.vacationPause,
  };

  const publishingMode: PublishingMode = resolveValue(
    'publishingMode',
    global.publishingMode,
    undefined,
    page?.publishingMode,
    undefined
  );

  const hybridMinScore = resolveValue(
    'hybridMinScore',
    global.hybridMinScore,
    undefined,
    page?.hybridMinScore,
    undefined
  );

  const customVariables = {
    ...(prof?.customVariables || {}),
    ...(post?.customVariables || {}),
  };

  return {
    templates,
    caption,
    hashtags,
    image,
    topic,
    schedule,
    publishingMode,
    hybridMinScore,
    autoApproveAfterHours: page?.autoApproveAfterHours,
    customVariables,
    provenance,
  };
}

