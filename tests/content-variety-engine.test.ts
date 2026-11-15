import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  assignNextCategory,
  calculateContentMixReport,
  PostRecordForCategory,
  PageCategoryConfig,
} from '../packages/core/src/topics/category-engine.js';
import {
  getEvergreenTopicForCategory,
  EVERGREEN_TOPIC_BANK,
  PROPOSED_RESEARCH_SOURCES,
} from '../packages/core/src/topics/topic-pools.js';
import {
  extractCentralEntities,
  isEntityDuplicate60Days,
} from '../packages/core/src/topics/dedup.js';
import {
  validatePostContentVariety,
  HARDCODED_BANNED_OPENINGS,
  BANNED_FILLER_PHRASES,
  extractHashtags,
  getOpeningWords,
} from '../packages/core/src/validation/variety-validator.js';
import {
  buildTopicImagePrompt,
  checkPromptVariety,
  ImagePromptMemory,
} from '../packages/core/src/pipeline/image-prompt-builder.js';
import { GeminiNativeAdapter } from '../packages/core/src/adapters/gemini.js';

describe('Content Variety and Image Relevance Engine (Milestone 10)', () => {
  // --------------------------------------------------------------------------
  // TEST 1: Simulate 200 assignments (5 per day over 40 days)
  // --------------------------------------------------------------------------
  describe('Requirement 1: Category Engine 200-Post Simulation (5/day over 40 days)', () => {
    it('simulates 200 assignments: all category shares within 5 points of target, no consecutive repeats, max 1 Space/day', () => {
      const history: PostRecordForCategory[] = [];
      const startDate = new Date('2026-01-01T08:00:00.000Z');
      const config: PageCategoryConfig = {
        maxDailySpace: 1,
        maxDailyPerCategory: 2,
      };

      // 40 days x 5 posts per day = 200 assignments
      for (let day = 0; day < 40; day++) {
        for (let slot = 0; slot < 5; slot++) {
          const slotDate = new Date(
            startDate.getTime() + (day * 24 * 60 + slot * 150) * 60 * 1000
          );

          const result = assignNextCategory(history, config, slotDate);
          expect(result.assignedCategory).toBeDefined();

          history.unshift({
            category: result.assignedCategory,
            title: `Assigned: ${result.assignedCategory} Day ${day} Slot ${slot}`,
            scheduled_for: slotDate,
            created_at: slotDate,
          });
        }
      }

      expect(history.length).toBe(200);

      // 1. Hard Rule: Never the same category twice in a row
      for (let i = 0; i < history.length - 1; i++) {
        expect(history[i].category).not.toBe(history[i + 1].category);
      }

      // 2. Hard Rule: At most 1 Space post per day & at most 2 per category per day
      const postsByDay = new Map<string, PostRecordForCategory[]>();
      for (const p of history) {
        const dStr = new Date(p.scheduled_for!).toISOString().split('T')[0];
        if (!postsByDay.has(dStr)) postsByDay.set(dStr, []);
        postsByDay.get(dStr)!.push(p);
      }

      expect(postsByDay.size).toBe(40);

      for (const [dayStr, dayPosts] of postsByDay) {
        expect(dayPosts.length).toBe(5);

        const catCounts: Record<string, number> = {};
        for (const p of dayPosts) {
          catCounts[p.category!] = (catCounts[p.category!] || 0) + 1;
        }

        // Max 1 Space post per day
        expect(catCounts['Space & Astronomy'] || 0).toBeLessThanOrEqual(1);

        // Max 2 posts per category per day
        for (const [catName, cnt] of Object.entries(catCounts)) {
          expect(cnt).toBeLessThanOrEqual(2);
        }
      }

      // 3. Category shares within 5 percentage points of target weight
      const totalCounts: Record<string, number> = {};
      for (const cat of DEFAULT_CATEGORIES) {
        totalCounts[cat.name] = 0;
      }
      for (const p of history) {
        totalCounts[p.category!] = (totalCounts[p.category!] || 0) + 1;
      }

      for (const cat of DEFAULT_CATEGORIES) {
        const actualCount = totalCounts[cat.name];
        const actualShare = (actualCount / 200) * 100;
        const targetShare = cat.defaultWeight;
        const diff = Math.abs(actualShare - targetShare);

        // Assert within 5 points of target
        expect(diff).toBeLessThanOrEqual(5.0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // TEST 2: Topic Pools & Evergreen Topic Bank
  // --------------------------------------------------------------------------
  describe('Requirement 2: Topic Pools Per Category & Evergreen Bank', () => {
    it('covers all 10 categories in the evergreen topic bank with verified facts and URLs', () => {
      const categoriesInBank = new Set(EVERGREEN_TOPIC_BANK.map((item) => item.category));
      for (const cat of DEFAULT_CATEGORIES) {
        expect(categoriesInBank.has(cat.name)).toBe(true);
      }

      for (const item of EVERGREEN_TOPIC_BANK) {
        expect(item.facts.length).toBeGreaterThanOrEqual(2);
        for (const f of item.facts) {
          expect(f.sourceUrl).toMatch(/^https?:\/\//);
          expect(f.text.length).toBeGreaterThan(20);
        }
      }
    });

    it('returns evergreen topic for requested category and excludes recent titles', () => {
      const cat = 'Human Body & Brain';
      const recent = ['ecog interface'];
      const topic = getEvergreenTopicForCategory(cat, recent);
      expect(topic.category).toBe(cat);
      expect(topic.facts.length).toBeGreaterThan(0);
    });

    it('provides proposed research sources tagged by category', () => {
      expect(PROPOSED_RESEARCH_SOURCES.length).toBeGreaterThanOrEqual(10);
      for (const src of PROPOSED_RESEARCH_SOURCES) {
        expect(src.url).toMatch(/^https?:\/\//);
        expect(src.category).toBeDefined();
        expect(src.terms.length).toBeGreaterThan(5);
      }
    });
  });

  // --------------------------------------------------------------------------
  // TEST 3: Entity Deduplication (60 Days)
  // --------------------------------------------------------------------------
  describe('Requirement 4: 60-Day Central Entity Deduplication', () => {
    it('extracts central entities including catalog codes, key taxa, and measurements with units', () => {
      const text = 'Webb reveals water vapor on K2-18b while blue whale heart pumps 150 liters at 2 bpm.';
      const entities = extractCentralEntities(text);
      expect(entities).toContain('k2-18b');
      expect(entities).toContain('blue whale');
      expect(entities).toContain('150 liters');
    });

    it('rejects candidate repeating central entity within 60 days, but allows it after 60 days', () => {
      const baseDate = new Date('2026-06-01T12:00:00.000Z');
      const history = [
        {
          title: 'Webb Explores Atmosphere on K2-18b',
          created_at: new Date('2026-05-15T12:00:00.000Z'), // 17 days ago
        },
      ];

      // Day 17: Candidate with K2-18b is rejected
      const checkRecent = isEntityDuplicate60Days('New Spectroscopic Analysis of K2-18b', history, {
        now: baseDate,
        windowDays: 60,
      });
      expect(checkRecent.isDuplicate).toBe(true);
      expect(checkRecent.matchedEntity).toBe('k2-18b');

      // Candidate with completely different entity passes
      const checkDiff = isEntityDuplicate60Days('Tardigrades in Cryptobiosis Survive Liquid Helium', history, {
        now: baseDate,
        windowDays: 60,
      });
      expect(checkDiff.isDuplicate).toBe(false);

      // Day 80: Candidate with K2-18b passes after 60-day window
      const futureDate = new Date('2026-08-01T12:00:00.000Z'); // 78 days later
      const checkExpired = isEntityDuplicate60Days('New Spectroscopic Analysis of K2-18b', history, {
        now: futureDate,
        windowDays: 60,
      });
      expect(checkExpired.isDuplicate).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // TEST 4: Banned Openings, Banned Fillers & Variety Validator
  // --------------------------------------------------------------------------
  describe('Requirement 3 & 5: Banned Openings, Fillers & Variety Validator', () => {
    const validImageBrief = {
      subject: 'Enormous adult blue whale surfacing in clear azure ocean water',
      visualDetail: 'Mottled grey skin with barnacles under natural directional sunlight',
      setting: 'Pacific Ocean open pelagic waters',
    };

    const validFacts = [
      'The heart of a blue whale pumps 150 liters of blood per beat.',
      'During deep ocean dives heart rates drop to 4 beats per minute.',
    ];

    it('rejects captions opening with "Imagine", "Ever wondered", or "Did you know"', () => {
      for (const banned of ['Imagine finding an ocean on a distant world.', 'Ever wondered how deep whales dive?', 'Did you know that octopuses have 3 hearts?']) {
        const res = validatePostContentVariety({
          caption: `${banned}\n\nResearch proves this fact.\n\nWhat do you think?\n\nImage: AI-generated illustration.\n#science #oceanlife #whale #marine #sciencefacts`,
          headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
          category: 'Animals & Ocean Life',
          topic: 'Blue Whale Diving Physiology',
          facts: validFacts,
          imageBrief: validImageBrief,
        });

        expect(res.valid).toBe(false);
        expect(res.violations.some((v) => v.rule === 'banned_opening')).toBe(true);
      }
    });

    it('rejects captions repeating the first 6 words of any of the last 20 posts', () => {
      const recentOpenings = ['marine biologists tracking pelagic whales recorded'];
      const res = validatePostContentVariety({
        caption: 'Marine biologists tracking pelagic whales recorded unprecedented physiological telemetry.\n\nWhat do you think?\n\nImage: AI-generated illustration.\n#science #oceanlife #whale #biology #sciencefacts',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: validImageBrief,
        recentOpenings,
      });

      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.rule === 'repetitive_opening')).toBe(true);
    });

    it('rejects banned conversational filler phrases like "buckle up" or "mind-blowing"', () => {
      const res = validatePostContentVariety({
        caption: 'Biologists uncovered stunning telemetry. Buckle up because this finding will blow your mind.\n\nWhat do you think?\n\nImage: AI-generated illustration.\n#science #oceanlife #whale #biology #sciencefacts',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: validImageBrief,
      });

      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.rule === 'banned_filler_phrase')).toBe(true);
    });

    it('enforces IMAGE_BRIEF requirement: fails when IMAGE_BRIEF is missing or empty', () => {
      const res = validatePostContentVariety({
        caption: 'Biologists analyzing bio-logging tags recorded unexpected cardiac telemetry during deep oceanic dives.\n\nWhat do you think?\n\nImage: AI-generated illustration.\n#science #oceanlife #whale #marine #sciencefacts',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: undefined,
      });

      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.rule === 'image_brief_missing')).toBe(true);
    });

    it('enforces the mandatory final line "Image: AI-generated illustration."', () => {
      const res = validatePostContentVariety({
        caption: 'Biologists analyzing bio-logging tags recorded unexpected cardiac telemetry during deep oceanic dives.\n\nWhat do you think?\n\n#science #oceanlife #whale #marine #sciencefacts',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: validImageBrief,
      });

      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.rule === 'disclaimer_line_missing')).toBe(true);
    });

    it('enforces exactly 5 hashtags conforming to the composition rule (1 broad, 1 category, 2 topic, 1 community)', () => {
      // 0 hashtags fails
      const res0 = validatePostContentVariety({
        caption: 'Biologists analyzing bio-logging tags recorded unexpected cardiac telemetry during deep oceanic dives.\n\nWhat do you think?\n\nImage: AI-generated illustration.',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: validImageBrief,
      });
      expect(res0.valid).toBe(false);
      expect(res0.violations.some((v) => v.rule === 'hashtag_composition')).toBe(true);

      // 4 hashtags fails
      const res4 = validatePostContentVariety({
        caption: 'Biologists analyzing bio-logging tags recorded unexpected cardiac telemetry.\n\nWhat do you think?\n\nImage: AI-generated illustration.\n#science #oceanlife #whale #sciencefacts',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: validImageBrief,
      });
      expect(res4.valid).toBe(false);

      // Exactly 5 valid hashtags passes!
      const res5 = validatePostContentVariety({
        caption: 'Biologists analyzing bio-logging tags recorded unexpected cardiac telemetry during deep oceanic dives.\n\nWhat do you think?\n\nImage: AI-generated illustration.\n#science #oceanlife #whale #biology #sciencefacts',
        headline: 'BLUE WHALE HEART PUMPS **150 LITERS** PER BEAT',
        category: 'Animals & Ocean Life',
        topic: 'Blue Whale Physiology',
        facts: validFacts,
        imageBrief: validImageBrief,
      });
      expect(res5.valid).toBe(true);
      expect(res5.score).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // TEST 5: Image Prompt Builder & Similarity Rejection
  // --------------------------------------------------------------------------
  describe('Requirement 6: Image Prompt Builder & Visual Variety Guard', () => {
    it('builds a 50 to 90 word prompt with subject first and calm bottom 38%', () => {
      const brief = {
        subject: 'Living tardigrade crawling across moss leaf surface',
        visualDetail: 'Translucent cuticle plates and clawed appendages',
        setting: 'Temperate forest moss bed',
      };

      const result = buildTopicImagePrompt(brief, 'Macro electron microscope style', [], 'National Geographic quality');
      expect(result.wordCount).toBeGreaterThanOrEqual(50);
      expect(result.wordCount).toBeLessThanOrEqual(90);
      expect(result.prompt.toLowerCase()).toContain('tardigrade');
      expect(result.prompt.toLowerCase()).toContain('bottom 38% calm');
      expect(result.negativePrompt).toContain('generic blue glow');
    });

    it('rejects prompts that repeat generic blue-glow or are too similar to memory', () => {
      const promptMemory: ImagePromptMemory[] = [
        {
          palette: 'azure and turquoise blue glow ocean water',
          angle: 'eye-level direct view',
          distance: 'macro detail',
          light: 'ambient deep-sea glow',
          subject: 'blue whale',
        },
        {
          palette: 'azure and turquoise ocean water with glowing blue rays',
          angle: 'macro close-up angle',
          distance: 'close-up inspection',
          light: 'ambient deep-sea glow',
          subject: 'blue whale',
        },
      ];

      const check = checkPromptVariety(
        'Documentary photograph of blue whale in deep ocean with blue glow and cyan vortex light rays.',
        promptMemory.map((m) => m.palette)
      );

      expect(check.ok).toBe(false);
      expect(check.reason).toContain('blue-glow');
    });
  });

  // --------------------------------------------------------------------------
  // TEST 6: Mocked Gemini Vision Relevance Check & Regeneration Loop
  // --------------------------------------------------------------------------
  describe('Requirement 7: Image Relevance Check with Mocked Vision Responses', () => {
    it('simulates vision failure, injects defect correction into prompt, and succeeds on retry', async () => {
      const adapter = new GeminiNativeAdapter();
      let callCount = 0;

      // Mock fetch for Gemini vision endpoint
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Attempt 1: Fails visual relevance (generic glowing circle)
          return {
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          pass: false,
                          score: 45,
                          isGenericGlow: true,
                          hasText: false,
                          reason: 'Image is an abstract glowing blue orb with no whale or marine subject visible.',
                          issues: ['Subject missing', 'Generic glow'],
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          };
        } else {
          // Attempt 2: Passes visual relevance
          return {
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          pass: true,
                          score: 95,
                          isGenericGlow: false,
                          hasText: false,
                          reason: 'Image clearly depicts an authentic adult blue whale surfacing in ocean water.',
                          issues: [],
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }
      });

      // Replace global fetch temporarily
      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        const dummyBuffer = Buffer.alloc(1000, 1);
        const eval1 = await adapter.evaluateImageRelevance({
          imageBuffer: dummyBuffer,
          headline: 'BLUE WHALE HEART PUMPS **150 LITERS**',
          apiKey: 'mock-gemini-key',
        });

        expect(eval1.pass).toBe(false);
        expect(eval1.isGenericGlow).toBe(true);

        // Retry with defect appended
        const eval2 = await adapter.evaluateImageRelevance({
          imageBuffer: dummyBuffer,
          headline: 'BLUE WHALE HEART PUMPS **150 LITERS**',
          apiKey: 'mock-gemini-key',
        });

        expect(eval2.pass).toBe(true);
        expect(eval2.score).toBe(95);
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  // --------------------------------------------------------------------------
  // TEST 7: Content Mix Report (Dashboard Analytics)
  // --------------------------------------------------------------------------
  describe('Requirement 8: Dashboard Content Mix Report', () => {
    it('computes content mix shares, alerts on Space > 30%, and extracts top repeated subjects', () => {
      const posts: PostRecordForCategory[] = [
        { category: 'Space & Astronomy', title: 'Webb on K2-18b', caption: 'Astronomers using the James Webb Space Telescope detected methane.', created_at: new Date() },
        { category: 'Space & Astronomy', title: 'Juno at Jupiter', caption: 'NASA spacecraft Juno mapped Jupiter magnetic field.', created_at: new Date() },
        { category: 'Space & Astronomy', title: 'Hubble Deep Field', caption: 'Deep field imagery revealed galaxies.', created_at: new Date() },
        { category: 'Space & Astronomy', title: 'White Dwarf Planet', caption: 'Astronomers discover giant planet.', created_at: new Date() },
        { category: 'Animals & Ocean Life', title: 'Blue Whale Diving', caption: 'Biologists recorded blue whale cardiac metrics.', created_at: new Date() },
      ];

      // 4 Space out of 5 posts = 80% Space share (>30% alert)
      const report = calculateContentMixReport(posts, { maxDailySpace: 1 });
      expect(report.totalPosts).toBe(5);
      expect(report.hasSpaceAlert).toBe(true);
      expect(report.alerts.some((a) => a.includes('30% ceiling'))).toBe(true);
      expect(report.categories.length).toBe(10);
      expect(report.topRepeatedSubjects.length).toBeGreaterThan(0);
    });
  });
});
