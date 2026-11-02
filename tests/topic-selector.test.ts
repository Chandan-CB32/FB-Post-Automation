import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  normalizeTopic,
  computeTopicSimilarity,
  isTopicDuplicate,
  TopicHistoryEntry,
} from '../packages/core/src/topics/dedup.js';
import {
  selectTargetCategory,
} from '../packages/core/src/topics/category-selector.js';
import {
  executeTopicSelectStage,
} from '../worker/src/stages/03-topic-select.js';
import { ProviderRouter } from '../worker/src/router/provider-router.js';
import { createHorrorStoryProfile } from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';

describe('Topic Selector, Category Weights & Dedup (Step 6.3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Topic Normalization & Similarity Deduplication', () => {
    it('normalizes topics by lowercasing, stripping punctuation, and removing noise stop words', () => {
      const raw = 'The Mystery of the Mary Celeste, in 1872!';
      const normalized = normalizeTopic(raw);
      expect(normalized).toBe('mystery mary celeste 1872');
    });

    it('computes high similarity for near-duplicates and low similarity for distinct topics', () => {
      const t1 = 'The Disappearance of the Mary Celeste';
      const t2 = 'Mystery of the Mary Celeste Disappearance';
      const similarityHigh = computeTopicSimilarity(t1, t2);
      expect(similarityHigh).toBeGreaterThanOrEqual(0.65);

      const t3 = 'Quantum Computing Breakthrough in Silicon Valley';
      const similarityLow = computeTopicSimilarity(t1, t3);
      expect(similarityLow).toBeLessThan(0.2);
    });

    it('detects duplicate topics against history within 90-day window', () => {
      const now = new Date('2026-11-02T12:00:00Z');
      const history: TopicHistoryEntry[] = [
        {
          title: 'The Winchester Mystery House',
          category: 'Haunted Places',
          created_at: '2026-10-15T10:00:00Z', // 18 days ago
        },
        {
          title: 'The Bell Witch Haunting',
          category: 'Folklore',
          created_at: '2026-06-01T10:00:00Z', // ~150 days ago (outside 90-day window)
        },
      ];

      // Near-duplicate of 18-day old post -> flagged as duplicate
      const check1 = isTopicDuplicate(
        'Winchester Mystery House and Its Phantom Stairs',
        history,
        { windowDays: 90, now }
      );
      expect(check1.isDuplicate).toBe(true);
      expect(check1.matchedTitle).toBe('The Winchester Mystery House');

      // Exact match of old post outside 90-day window -> NOT flagged
      const check2 = isTopicDuplicate(
        'The Bell Witch Haunting',
        history,
        { windowDays: 90, now }
      );
      expect(check2.isDuplicate).toBe(false);

      // Completely new topic -> NOT flagged
      const check3 = isTopicDuplicate(
        'The Curse of the Hope Diamond',
        history,
        { windowDays: 90, now }
      );
      expect(check3.isDuplicate).toBe(false);
    });
  });

  describe('Category Selection & Weighting', () => {
    it('prevents consecutive repetition of the same category', () => {
      const categories = [
        { name: 'Haunted Places', weight: 50 },
        { name: 'Cursed Relics', weight: 50 },
      ];

      // If last post was 'Haunted Places', selectTargetCategory must pick 'Cursed Relics'
      const recentHistory = [{ category: 'Haunted Places' }];
      const chosen = selectTargetCategory(categories, recentHistory, { preventConsecutive: true });
      expect(chosen).toBe('Cursed Relics');
    });

    it('falls back to General if no categories are configured', () => {
      const chosen = selectTargetCategory([]);
      expect(chosen).toBe('General');
    });
  });

  describe('Stage 03 Topic Selector Execution', () => {
    let router: ProviderRouter;

    beforeEach(() => {
      router = new ProviderRouter();
    });

    it('pools candidates, filters duplicates & banned terms, and uses LLM scoring to select winner', async () => {
      const profile = createHorrorStoryProfile();
      const settings = resolveSettings({
        profile,
        page: {
          overrides: {
            'topic.bannedTopics': ['Banned Vampire Story'],
          },
        },
      });

      const history: TopicHistoryEntry[] = [
        {
          title: 'The Ghost Ship of Cape May',
          category: 'Maritime',
          created_at: '2026-10-30T10:00:00Z',
        },
      ];

      // Candidate 1: Near duplicate of past post (should be filtered)
      // Candidate 2: Contains banned topic (should be filtered)
      // Candidate 3: Valid high potential topic
      // Candidate 4: Valid alternate topic
      const generatedIdeas = [
        {
          topic: 'Ghost Ship of Cape May Lighthouse',
          category: 'Maritime',
          premise: 'A ghost ship appears near Cape May.',
          visualConcept: 'Ghostly schooner in fog',
          hookScore: 9,
          sourceType: 'auto_idea' as const,
        },
        {
          topic: 'A Banned Vampire Story in London',
          category: 'Creatures',
          premise: 'Vampire stalking foggy alleys.',
          visualConcept: 'Shadowy figure in cloak',
          hookScore: 9,
          sourceType: 'auto_idea' as const,
        },
        {
          topic: 'The Whispering Doll of Key West',
          category: 'Cursed Objects',
          premise: 'A sailor leaves a carved doll that speaks to visitors in the night.',
          visualConcept: 'Antique porcelain doll on a velvet armchair in candlelight',
          hookScore: 9,
          sourceType: 'auto_idea' as const,
        },
        {
          topic: 'The Abandoned Hospital on North Brother Island',
          category: 'Haunted Places',
          premise: 'Explorers enter a quarantine station where radio signals still broadcast.',
          visualConcept: 'Decaying stone hospital overtaken by ivy with twilight sky',
          hookScore: 8,
          sourceType: 'auto_idea' as const,
        },
      ];

      // Mock LLM scoring
      vi.spyOn(router, 'executeText').mockResolvedValue({
        text: JSON.stringify({
          winningIndex: 1, // Winner between Candidate 3 and 4
          score: 9.5,
          rationale: 'The Whispering Doll has the strongest emotional curiosity gap.',
        }),
        providerId: 'p-scoring',
        providerName: 'Mock Provider',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-gpt-4o',
        tokens: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
        latencyMs: 180,
      });

      const result = await executeTopicSelectStage({
        profile,
        effectiveSettings: settings,
        router,
        history,
        generatedIdeas,
      });

      expect(result.topic).toBe('The Whispering Doll of Key West');
      expect(result.score).toBe(9.5);
      expect(result.rationale).toContain('Whispering Doll');
      expect(result.sourceType).toBe('auto_topics');
    });

    it('generates a clean fallback candidate when all pooled candidates are duplicates', async () => {
      const profile = createHorrorStoryProfile();
      const settings = resolveSettings({ profile });

      const history: TopicHistoryEntry[] = [
        {
          title: 'The Blackwood Mirror',
          category: 'Cursed Objects',
          created_at: '2026-10-31T12:00:00Z',
        },
      ];

      const generatedIdeas = [
        {
          topic: 'The Blackwood Mirror', // Exact duplicate
          category: 'Cursed Objects',
          premise: 'A mirror that reflects horrors.',
          visualConcept: 'Dark mirror',
          hookScore: 8,
          sourceType: 'auto_idea' as const,
        },
      ];

      const result = await executeTopicSelectStage({
        profile,
        effectiveSettings: settings,
        router,
        history,
        generatedIdeas,
      });

      expect(result.topic).not.toBe('The Blackwood Mirror');
      expect(result.rationale).toContain('fallback');
      expect(result.score).toBeGreaterThan(0);
    });
  });
});
