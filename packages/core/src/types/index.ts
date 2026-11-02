export type ContentProfileType = 'factual' | 'fiction' | 'true_story' | 'evergreen';

export type PublishingMode = 'auto' | 'review' | 'hybrid';

export type PostStatus =
  | 'planned'
  | 'researching'
  | 'topic_selected'
  | 'outlining'
  | 'writing'
  | 'qa'
  | 'imaging'
  | 'composing'
  | 'ready'
  | 'pending_review'
  | 'scheduled_on_fb'
  | 'published'
  | 'failed'
  | 'skipped';

export type ReviewState = 'n/a' | 'pending' | 'approved' | 'rejected';

export type EmojiPolicy = 'none' | 'minimal' | 'moderate';

export type EndingStyle = 'cliffhanger' | 'twist' | 'moral' | 'question' | 'to_be_continued';

export type PipelineStage =
  | 'idea'
  | 'topic'
  | 'fact_extraction'
  | 'outline'
  | 'write'
  | 'polish'
  | 'qa'
  | 'image'
  | 'vision_check';

export type ProviderAdapterKind =
  | 'openai_compatible_chat'
  | 'openai_compatible_images'
  | 'gemini_native'
  | 'cloudflare_workers_ai'
  | 'huggingface_inference'
  | 'pollinations'
  | 'custom_http';

export type ChainStrategy =
  | 'priority'
  | 'round_robin'
  | 'least_used_today'
  | 'weighted_by_remaining_budget';

export interface StageTemplates {
  ideaPrompt?: string;
  topicPrompt?: string;
  factExtractionPrompt?: string;
  outlinePrompt?: string;
  captionPrompt: string;
  polishPrompt?: string;
  headlinePrompt?: string;
  hashtagPrompt?: string;
  qaPrompt?: string;
  imagePromptTemplate: string;
  negativeImagePrompt?: string;
}

export interface CaptionSettings {
  unit: 'words' | 'characters';
  min: number;
  target: number;
  max: number;
  structure?: string[];
  hookRule: boolean;
  maxSentencesPerParagraph: number;
  voice: {
    tone: string;
    pov: string;
    readingLevel?: string;
    humorLevel?: string;
    emojiPolicy: EmojiPolicy;
    bannedPhrases: string[];
    requiredPhrases: string[];
  };
  endingStyle: EndingStyle;
  includeQuestion: boolean;
  questionStyle?: string;
  formatSourceLine: boolean;
  disclaimerLine?: string;
}

export interface HashtagSettings {
  count: number;
  bannedHashtags: string[];
  fixedHashtags: string[];
  style: 'niche' | 'broad' | 'mixed';
}

export interface ImageSettings {
  template: string;
  negativePrompt?: string;
  aspectRatio: '4:5' | '1:1' | '16:9';
  width: number;
  height: number;
  style: string;
  keySceneMode: 'opening' | 'climax' | 'mood' | 'character';
  allowTextInImage: boolean;
  allowRealPeople: boolean;
  allowLogos: boolean;
  headlinePanel: {
    enabled: boolean;
    heightPercent: number; // e.g. 25-35%
    backgroundColor: string; // e.g. '#000000'
    textColor: string;
    fontSize?: number;
  };
  seriesStyleBible?: string;
}

export interface TopicSettings {
  sources: {
    autoTopicsWeight: number;
    ownerQueueWeight: number;
    researchWeight: number;
    seriesWeight: number;
  };
  categories: Array<{
    name: string;
    weight: number;
  }>;
  preventConsecutiveCategory: boolean;
  dedupWindowDays: number;
  dedupWindowPosts: number;
  bannedTopics: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
}

export interface TopicQueueItem {
  id: string;
  page_id?: string | null;
  profile_id?: string | null;
  text: string;
  category?: string | null;
  status: 'pending' | 'used' | 'skipped';
  sort_order: number;
  created_at: string;
  used_at?: string | null;
}

export interface PostingSchedule {
  timezone: string;
  postsPerDay: number;
  times: string[]; // ['09:00', '15:00', '21:00']
  daysOfWeek: number[]; // 0-6 (Sun-Sat)
  jitterMinutes: number; // default +/-10
  minimumGapHours: number; // default 2
  leadTimeHours: number; // how far ahead to plan slots
  vacationPause?: {
    startDate: string;
    endDate: string;
  };
}

