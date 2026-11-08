import { describe, it, expect } from 'vitest';
import {
  formatPageTextSummary,
  analyzePageNiche,
  generateDraftProfileFromPage,
  RawPageProfileData,
} from '../packages/core/src/index.js';

describe('Automatic Niche Detection & Profile Synthesis', () => {
  const sampleProfiles = [
    {
      id: 'science-space-deep-facts',
      name: 'Science & Space Deep Facts',
      audience: 'Space enthusiasts, astronomy lovers, science students',
      master_prompt: 'Deep educational astrophysics facts and planetary revelations.',
    },
    {
      id: 'horror-creepy-folklore',
      name: 'Dark Folklore & Horror Relics',
      audience: 'Fans of eerie legends, haunted mysteries, paranormal history',
      master_prompt: 'Spine-chilling folklore tales, cursed items, and unexplained eerie phenomena.',
    },
    {
      id: 'true-crime-forensics',
      name: 'Historical Crime & Forensics',
      audience: 'True crime readers, forensic history lovers',
      master_prompt: 'Documentary style cold case forensic breakdowns.',
    },
  ];

  describe('Privacy & Text Summary Formatting', () => {
    it('formats public page summary without any tokens or secrets', () => {
      const pageData: RawPageProfileData = {
        id: '1347402001799226',
        name: 'Beyond the Known',
        category: 'Science & Technology',
        about: 'Exploring the outer limits of astrophysics and the mysteries of the cosmos.',
        posts: [
          'The James Webb Space Telescope captured a massive ring galaxy 500 million light years away.',
          'Black holes do not just consume matter; their relativistic jets can ignite starbursts in distant nebulae.',
        ],
        totalPostsFound: 2,
      };

      const summary = formatPageTextSummary(pageData);
      expect(summary).toContain('Page Name: Beyond the Known');
      expect(summary).toContain('Primary Category: Science & Technology');
      expect(summary).toContain('James Webb Space Telescope');
      expect(summary).not.toContain('access_token');
      expect(summary).not.toContain('EAA');
    });

    it('handles brand new pages with 0 posts gracefully', () => {
      const pageData: RawPageProfileData = {
        id: '1000999',
        name: 'New Unknown Page',
        category: 'Media',
        posts: [],
        totalPostsFound: 0,
      };

      const summary = formatPageTextSummary(pageData);
      expect(summary).toContain('No public posts found on this Page yet');
    });
  });

  describe('AI Niche Analysis Engine', () => {
    it('returns notConfigured status gracefully when no AI provider call is supplied', async () => {
      const pageData: RawPageProfileData = {
        id: '1347402001799226',
        name: 'Beyond the Known',
        category: 'Science',
        posts: ['Space discovery'],
        totalPostsFound: 1,
      };

      const result = await analyzePageNiche(pageData, sampleProfiles);
      expect(result.success).toBe(false);
      expect(result.notConfigured).toBe(true);
      expect(result.reasoning).toContain('AI Provider is not configured yet');
    });

    it('evaluates niche and returns structured JSON with confidence and recommendations', async () => {
      const pageData: RawPageProfileData = {
        id: '1347402001799226',
        name: 'Beyond the Known',
        category: 'Astrophysics & Science',
        about: 'Deep cosmos explorations and astronomy breakdowns.',
        posts: [
          'Spectroscopic analysis of exoplanet atmospheres reveals complex carbon chemistry.',
          'Supermassive black hole mergers produce gravitational waves rippling across spacetime.',
        ],
        totalPostsFound: 2,
      };

      const mockLlm = async () => {
        return JSON.stringify({
          suggested_profile_id: 'science-space-deep-facts',
          confidence: 0.94,
          reasoning: 'The page content is intensely focused on astronomy, black holes, and spectroscopy data matching Science & Space.',
          detected_tone: 'Curious, authoritative, and awe-inspiring',
          caption_length_preference: 'standard',
          hashtag_habits: '#BeyondTheKnown #Astrophysics #Space',
          suggested_posts_per_day: 2,
          not_enough_info: false,
          alternative_profile_ids: ['true-crime-forensics'],
        });
      };

      const result = await analyzePageNiche(pageData, sampleProfiles, mockLlm);
      expect(result.success).toBe(true);
      expect(result.suggested_profile_id).toBe('science-space-deep-facts');
      expect(result.suggested_profile_name).toBe('Science & Space Deep Facts');
      expect(result.confidence).toBe(0.94);
      expect(result.detected_tone).toBe('Curious, authoritative, and awe-inspiring');
      expect(result.suggested_posts_per_day).toBe(2);
      expect(result.not_enough_info).toBe(false);
    });

    it('flags not_enough_info when Page has no posts and generic name', async () => {
      const pageData: RawPageProfileData = {
        id: '99999999',
        name: 'Brand New Blank Page',
        posts: [],
        totalPostsFound: 0,
      };

      const mockLlm = async () => {
        return JSON.stringify({
          suggested_profile_id: null,
          confidence: 0.2,
          reasoning: 'Zero posts and minimal metadata available to determine niche reliably.',
          detected_tone: 'Neutral',
          not_enough_info: true,
          suggested_posts_per_day: 1,
        });
      };

      const result = await analyzePageNiche(pageData, sampleProfiles, mockLlm);
      expect(result.not_enough_info).toBe(true);
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('Draft Profile Synthesis from Page', () => {
    it('creates a draft profile blueprint ready for Page Prompt Studio review', async () => {
      const pageData: RawPageProfileData = {
        id: '1347402001799226',
        name: 'Beyond the Known',
        category: 'Science & Technology',
        about: 'Deep dives into astrophysical wonders.',
        posts: ['Galaxies collide in deep space.'],
        totalPostsFound: 1,
      };

      const draft = await generateDraftProfileFromPage(pageData);
      expect(draft.name).toBe('Beyond the Known Voice');
      expect(draft.niche).toBe('Science & Technology');
      expect(draft.master_prompt).toContain('Beyond the Known');
      expect(draft.categories.length).toBeGreaterThanOrEqual(3);
    });
  });
});
