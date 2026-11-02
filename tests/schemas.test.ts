import { describe, it, expect } from 'vitest';
import {
  ContentProfileSchema,
  PageSchema,
  PostSchema,
  PostingScheduleSchema,
  CaptionSettingsSchema,
} from '../packages/core/src/validation/schemas.js';

describe('Validation Schemas', () => {
  it('validates a valid ContentProfile', () => {
    const profileData = {
      name: 'Horror Stories',
      type: 'fiction',
      masterPrompt: 'You are a master horror storyteller...',
      templates: {
        captionPrompt: 'Write a terrifying story about {{topic}}',
        imagePromptTemplate: 'Dark atmospheric photo of {{key_scene}}',
      },
      captionSettings: {
        unit: 'words',
        min: 500,
        target: 700,
        max: 900,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'creepy, suspenseful',
          pov: 'first-person',
          emojiPolicy: 'none',
          bannedPhrases: ['suddenly', 'little did he know'],
          requiredPhrases: [],
        },
        endingStyle: 'cliffhanger',
        includeQuestion: false,
        formatSourceLine: false,
        disclaimerLine: 'Fictional story.',
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: ['#gore'],
        fixedHashtags: ['#HorrorStories'],
        style: 'niche',
      },
      imageSettings: {
        template: 'Cinematic photograph of {{key_scene}}',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'dark moody',
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
      topicSettings: {
        sources: {
          autoTopicsWeight: 50,
          ownerQueueWeight: 50,
          researchWeight: 0,
          seriesWeight: 0,
        },
        categories: [
          { name: 'Haunted Places', weight: 40 },
          { name: 'Urban Legends', weight: 60 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    };

    const parsed = ContentProfileSchema.parse(profileData);
    expect(parsed.name).toBe('Horror Stories');
    expect(parsed.type).toBe('fiction');
    expect(parsed.captionSettings.min).toBe(500);
  });

  it('rejects invalid profile data when required fields are missing', () => {
    expect(() =>
      ContentProfileSchema.parse({
        name: '',
        type: 'invalid_type',
      })
    ).toThrow();
  });

  it('validates PostingSchedule with time regex and jitter defaults', () => {
    const schedule = PostingScheduleSchema.parse({
      timezone: 'America/New_York',
      postsPerDay: 2,
      times: ['10:00', '18:30'],
    });

    expect(schedule.jitterMinutes).toBe(10);
    expect(schedule.times.length).toBe(2);
  });

  it('rejects invalid time formats in PostingSchedule', () => {
    expect(() =>
      PostingScheduleSchema.parse({
        times: ['25:00'], // Invalid hour
      })
    ).toThrow();
  });

  it('validates Post status transitions and default flags', () => {
    const post = PostSchema.parse({
      pageId: '123e4567-e89b-12d3-a456-426614174000',
      profileVersion: 1,
      scheduledFor: new Date().toISOString(),
      status: 'planned',
    });

    expect(post.status).toBe('planned');
    expect(post.sensitiveFlags).toEqual([]);
    expect(post.tokensUsed).toBe(0);
  });
});

