import { z } from 'zod';

export const ContentProfileTypeEnum = z.enum(['factual', 'fiction', 'true_story', 'evergreen']);
export const PublishingModeEnum = z.enum(['auto', 'review', 'hybrid']);
export const PostStatusEnum = z.enum([
  'planned',
  'researching',
  'topic_selected',
  'outlining',
  'writing',
  'qa',
  'imaging',
  'composing',
  'ready',
  'pending_review',
  'scheduled_on_fb',
  'published',
  'failed',
  'skipped',
]);
export const ReviewStateEnum = z.enum(['n/a', 'pending', 'approved', 'rejected']);
export const EmojiPolicyEnum = z.enum(['none', 'minimal', 'moderate']);
export const EndingStyleEnum = z.enum(['cliffhanger', 'twist', 'moral', 'question', 'to_be_continued']);
export const PipelineStageEnum = z.enum([
  'idea',
  'topic',
  'fact_extraction',
  'outline',
  'write',
  'polish',
  'qa',
  'image',
  'vision_check',
]);
export const ChainStrategyEnum = z.enum([
  'priority',
  'round_robin',
  'least_used_today',
  'weighted_by_remaining_budget',
]);

export const CaptionSettingsSchema = z.object({
  unit: z.enum(['words', 'characters']).default('words'),
  min: z.number().int().min(10).default(120),
  target: z.number().int().min(20).default(180),
  max: z.number().int().max(63000).default(250),
  structure: z.array(z.string()).optional(),
  hookRule: z.boolean().default(true),
  maxSentencesPerParagraph: z.number().int().min(1).max(10).default(3),
  voice: z.object({
    tone: z.string().default('engaging, conversational, authoritative'),
    pov: z.string().default('third-person'),
    readingLevel: z.string().optional(),
    humorLevel: z.string().optional(),
    emojiPolicy: EmojiPolicyEnum.default('minimal'),
    bannedPhrases: z.array(z.string()).default([]),
    requiredPhrases: z.array(z.string()).default([]),
  }),
  endingStyle: EndingStyleEnum.default('twist'),
  includeQuestion: z.boolean().default(true),
  questionStyle: z.string().optional(),
  formatSourceLine: z.boolean().default(false),
  disclaimerLine: z.string().optional(),
});

export const HashtagSettingsSchema = z.object({
  count: z.number().int().min(0).max(30).default(5),
  bannedHashtags: z.array(z.string()).default([]),
  fixedHashtags: z.array(z.string()).default([]),
  style: z.enum(['niche', 'broad', 'mixed']).default('mixed'),
});

export const ImageSettingsSchema = z.object({
  template: z.string().min(1).default('Visual scene of {{key_scene}}, high quality'),
  negativePrompt: z.string().optional(),
  aspectRatio: z.enum(['4:5', '1:1', '16:9']).default('4:5'),
  width: z.number().int().min(256).max(4096).default(1080),
  height: z.number().int().min(256).max(4096).default(1350),
  style: z.string().default('cinematic, photorealistic'),
  keySceneMode: z.enum(['opening', 'climax', 'mood', 'character']).default('climax'),
  allowTextInImage: z.boolean().default(false),
  allowRealPeople: z.boolean().default(false),
  allowLogos: z.boolean().default(false),
  headlinePanel: z.object({
    enabled: z.boolean().default(false),
    heightPercent: z.number().min(10).max(50).default(25),
    backgroundColor: z.string().default('#000000'),
    textColor: z.string().default('#FFFFFF'),
    fontSize: z.number().optional(),
  }),
  seriesStyleBible: z.string().optional(),
});

export const TopicSettingsSchema = z.object({
  sources: z.object({
    autoTopicsWeight: z.number().min(0).max(100).default(50),
    ownerQueueWeight: z.number().min(0).max(100).default(50),
    researchWeight: z.number().min(0).max(100).default(0),
    seriesWeight: z.number().min(0).max(100).default(0),
  }),
  categories: z.array(
    z.object({
      name: z.string().min(1),
      weight: z.number().min(0).max(100),
    })
  ).default([]),
  preventConsecutiveCategory: z.boolean().default(true),
  dedupWindowDays: z.number().int().min(1).default(90),
  dedupWindowPosts: z.number().int().min(1).default(200),
  bannedTopics: z.array(z.string()).default([]),
  includeKeywords: z.array(z.string()).default([]),
  excludeKeywords: z.array(z.string()).default([]),
});

export const PostingScheduleSchema = z.object({
  timezone: z.string().default('UTC'),
  postsPerDay: z.number().int().min(1).max(24).default(3),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)).default(['09:00', '15:00', '21:00']),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  jitterMinutes: z.number().int().min(0).max(60).default(10),
  minimumGapHours: z.number().min(0).max(24).default(2),
  leadTimeHours: z.number().int().min(1).max(168).default(24),
  vacationPause: z
    .object({
      startDate: z.string(),
      endDate: z.string(),
    })
    .optional(),
});

export const ContentProfileSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Profile name is required'),
  description: z.string().optional(),
  type: ContentProfileTypeEnum,
  language: z.string().default('en'),
  audience: z.string().default('General Facebook English-speaking audience'),
  masterPrompt: z.string().min(1, 'Master prompt cannot be empty'),
  templates: z.object({
    ideaPrompt: z.string().optional(),
    topicPrompt: z.string().optional(),
    factExtractionPrompt: z.string().optional(),
    outlinePrompt: z.string().optional(),
    captionPrompt: z.string().min(1, 'Caption prompt is required'),
    polishPrompt: z.string().optional(),
    headlinePrompt: z.string().optional(),
    hashtagPrompt: z.string().optional(),
    qaPrompt: z.string().optional(),
    imagePromptTemplate: z.string().min(1, 'Image template is required'),
    negativeImagePrompt: z.string().optional(),
  }),
  captionSettings: CaptionSettingsSchema,
  hashtagSettings: HashtagSettingsSchema,
  imageSettings: ImageSettingsSchema,
  topicSettings: TopicSettingsSchema,
  customVariables: z.record(z.string(), z.string()).default({}),
  version: z.number().int().min(1).default(1),
});

export type ContentProfile = z.infer<typeof ContentProfileSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Post = z.infer<typeof PostSchema>;

export const PageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  fbPageId: z.string().min(1),
  fbPageTokenEncrypted: z.string().min(1),
  tokenStatus: z.enum(['valid', 'expired', 'revoked', 'rate_limited']).default('valid'),
  profileId: z.string().uuid(),
  overrides: z.record(z.string(), z.unknown()).default({}),
  customCaptionPrompt: z.string().optional(),
  customCaptionPromptMode: z.enum(['append', 'replace']).default('append'),
  customImagePrompt: z.string().optional(),
  customImagePromptMode: z.enum(['append', 'replace']).default('append'),
  schedule: PostingScheduleSchema,
  publishingMode: PublishingModeEnum.default('review'),
  hybridMinScore: z.number().min(0).max(100).default(80),
  autoApproveAfterHours: z.number().min(0).optional(),
  dailyCap: z.number().int().min(1).default(5),
  active: z.boolean().default(true),
});

export const PostSchema = z.object({
  id: z.string().uuid().optional(),
  pageId: z.string().uuid(),
  profileVersion: z.number().int().min(1),
  status: PostStatusEnum.default('planned'),
  scheduledFor: z.string().datetime(),
  topicKey: z.string().optional(),
  topicTitle: z.string().optional(),
  category: z.string().optional(),
  facts: z.array(z.string()).optional(),
  outline: z.array(z.string()).optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  caption: z.string().optional(),
  captionWordCount: z.number().int().optional(),
  hashtags: z.array(z.string()).default([]),
  sourceLine: z.string().optional(),
  disclosureLine: z.string().optional(),
  qaScore: z.number().min(0).max(100).optional(),
  qaResult: z.record(z.string(), z.unknown()).optional(),
  sensitiveFlags: z.array(z.string()).default([]),
  imagePrompt: z.string().optional(),
  imageProviderUsed: z.string().optional(),
  textProvidersUsed: z.array(z.string()).default([]),
  tokensUsed: z.number().int().default(0),
  rawImagePath: z.string().optional(),
  composedImagePath: z.string().optional(),
  imagePhash: z.string().optional(),
  contentHash: z.string().optional(),
  reviewState: ReviewStateEnum.default('n/a'),
  reviewNote: z.string().optional(),
  fbPostId: z.string().optional(),
  fbPermalink: z.string().optional(),
  error: z.string().optional(),
});
