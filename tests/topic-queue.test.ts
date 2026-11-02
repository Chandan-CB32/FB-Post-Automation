import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseTopicImport,
  enqueueTopics,
  getNextTopic,
  markTopicStatus,
  getQueueStats,
} from '../packages/core/src/topics/queue-manager.js';
import {
  IdeaGenerator,
} from '../worker/src/stages/02-idea-generator.js';
import { ProviderRouter } from '../worker/src/router/provider-router.js';
import { createHorrorStoryProfile } from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';

describe('Owner Topic Queue & Idea Generator (Step 6.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Topic Queue Parser & Importer', () => {
    it('parses plain line-by-line topic text ignoring empty lines and comments', () => {
      const rawText = `
        # My Horror Topics
        The Whispering Well of St. Jude
        
        // Next batch
        The Painting That Blinks
        The Midnight Passenger
      `;

      const parsed = parseTopicImport(rawText, 'Urban Legends');
      expect(parsed.length).toBe(3);
      expect(parsed[0]).toEqual({
        text: 'The Whispering Well of St. Jude',
        category: 'Urban Legends',
      });
      expect(parsed[1].text).toBe('The Painting That Blinks');
      expect(parsed[2].text).toBe('The Midnight Passenger');
    });

    it('parses standard CSV with header and quoted fields containing commas', () => {
      const csv = `topic,category
"The Lost Flight 19, Over the Atlantic",Maritime Mysteries
"The Winchester Mystery House, San Jose",Haunted Places
"The Dyatlov Pass Incident, 1959",Unexplained Mysteries`;

      const parsed = parseTopicImport(csv);
      expect(parsed.length).toBe(3);
      expect(parsed[0].text).toBe('The Lost Flight 19, Over the Atlantic');
      expect(parsed[0].category).toBe('Maritime Mysteries');
      expect(parsed[1].text).toBe('The Winchester Mystery House, San Jose');
      expect(parsed[1].category).toBe('Haunted Places');
    });

    it('parses comma-separated lines without header', () => {
      const input = `
        The Ghost Ship Mary Celeste, Maritime
        The Black Forest Witch, Folklore
      `;

      const parsed = parseTopicImport(input);
      expect(parsed.length).toBe(2);
      expect(parsed[0].text).toBe('The Ghost Ship Mary Celeste');
      expect(parsed[0].category).toBe('Maritime');
      expect(parsed[1].text).toBe('The Black Forest Witch');
      expect(parsed[1].category).toBe('Folklore');
    });
  });

  describe('Queue Operations (FIFO, Random, Category Filter, Stats)', () => {
    it('enqueues parsed items with sequential sort order and retrieves next FIFO item', () => {
      const entries = [
        { text: 'Topic A', category: 'Cat 1' },
        { text: 'Topic B', category: 'Cat 2' },
        { text: 'Topic C', category: 'Cat 1' },
      ];

      const queue = enqueueTopics(entries, { startingOrder: 10 });
      expect(queue.length).toBe(3);
      expect(queue[0].sort_order).toBe(10);
      expect(queue[1].sort_order).toBe(11);
      expect(queue[2].sort_order).toBe(12);

      // FIFO returns lowest sort_order pending item
      const next1 = getNextTopic(queue, 'fifo');
      expect(next1?.text).toBe('Topic A');

      // Mark Topic A as used
      if (next1) {
        markTopicStatus(next1, 'used');
        expect(next1.status).toBe('used');
        expect(next1.used_at).toBeDefined();
      }

      // Next FIFO is Topic B
      const next2 = getNextTopic(queue, 'fifo');
      expect(next2?.text).toBe('Topic B');
    });

    it('filters topic retrieval by category', () => {
      const queue = enqueueTopics([
        { text: 'Haunted Mansion', category: 'Haunted Places' },
        { text: 'Skinwalker Ranch', category: 'Cryptids' },
        { text: 'The Cecil Hotel', category: 'Haunted Places' },
      ]);

      const cryptid = getNextTopic(queue, 'fifo', 'Cryptids');
      expect(cryptid?.text).toBe('Skinwalker Ranch');

      const haunted = getNextTopic(queue, 'fifo', 'Haunted Places');
      expect(haunted?.text).toBe('Haunted Mansion');

      const nonExistent = getNextTopic(queue, 'fifo', 'Aliens');
      expect(nonExistent).toBeNull();
    });

    it('retrieves random pending topic', () => {
      const queue = enqueueTopics([
        { text: 'Topic 1' },
        { text: 'Topic 2' },
        { text: 'Topic 3' },
      ]);

      const picked = getNextTopic(queue, 'random');
      expect(picked).toBeDefined();
      expect(['Topic 1', 'Topic 2', 'Topic 3']).toContain(picked?.text);
    });

    it('computes queue statistics accurately across statuses and categories', () => {
      const queue = enqueueTopics([
        { text: 'T1', category: 'Horror' },
        { text: 'T2', category: 'Horror' },
        { text: 'T3', category: 'Mystery' },
        { text: 'T4', category: 'Sci-Fi' },
      ]);

      markTopicStatus(queue[0], 'used');
      markTopicStatus(queue[1], 'skipped');

      const stats = getQueueStats(queue);
      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(2);
      expect(stats.used).toBe(1);
      expect(stats.skipped).toBe(1);
      expect(stats.categories['Horror']).toBe(2);
      expect(stats.categories['Mystery']).toBe(1);
      expect(stats.categories['Sci-Fi']).toBe(1);
    });
  });

  describe('IdeaGenerator Execution', () => {
    let ideaGenerator: IdeaGenerator;
    let router: ProviderRouter;

    beforeEach(() => {
      ideaGenerator = new IdeaGenerator();
      router = new ProviderRouter();
    });

    it('prompts router and parses structured idea candidates', async () => {
      const profile = createHorrorStoryProfile();
      const settings = resolveSettings({ profile });

      const mockLlmResponse = JSON.stringify([
        {
          topic: 'The Cursed Gramophone of New Orleans',
          category: 'Cursed Objects',
          premise: 'Playing the record backwards opens a rift in the attic.',
          visualConcept: 'An antique brass gramophone glowing with faint spectral mist.',
          hookScore: 9,
        },
        {
          topic: 'The Fog That Remembers Names',
          category: 'Supernatural Phenomena',
          premise: 'A sea fog repeats words spoken by drowned sailors.',
          visualConcept: 'Dense violet fog rolling over a rocky cliffside lighthouse.',
          hookScore: 8,
        },
      ]);

      const executeSpy = vi.spyOn(router, 'executeText').mockResolvedValue({
        text: mockLlmResponse,
        providerId: 'p-mock',
        providerName: 'Mock Provider',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-gpt-4o',
        tokens: { promptTokens: 150, completionTokens: 90, totalTokens: 240 },
        latencyMs: 350,
      });

      const result = await ideaGenerator.generateIdeas({
        profile,
        router,
        effectiveSettings: settings,
        count: 2,
        bannedTopics: ['Dracula', 'Frankenstein'],
      });

      expect(executeSpy).toHaveBeenCalledWith('idea', expect.objectContaining({ jsonMode: true }));
      expect(result.ideas.length).toBe(2);
      expect(result.ideas[0].topic).toBe('The Cursed Gramophone of New Orleans');
      expect(result.ideas[0].hookScore).toBe(9);
      expect(result.ideas[0].visualConcept).toContain('antique brass gramophone');
      expect(result.tokensUsed.totalTokens).toBe(240);
      expect(result.ideas[0].sourceType).toBe('auto_idea');
    });

    it('incorporates series bible and marks ideas as series source', async () => {
      const profile = createHorrorStoryProfile();
      const settings = resolveSettings({ profile });

      vi.spyOn(router, 'executeText').mockResolvedValue({
        text: JSON.stringify([
          {
            topic: 'Episode 4: The Hollow Gate',
            category: 'The Blackwood Chronicles',
            premise: 'Elena discovers the iron key fits into the cemetery mausoleum.',
            visualConcept: 'Elena holding an ornate rusted key before a stone crypt door.',
            hookScore: 9,
          },
        ]),
        providerId: 'p-mock',
        providerName: 'Mock Provider',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-gpt-4o',
        tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        latencyMs: 200,
      });

      const result = await ideaGenerator.generateIdeas({
        profile,
        router,
        effectiveSettings: settings,
        seriesBible: 'Series: The Blackwood Chronicles. Protagonist: Elena.',
        storySoFar: 'Elena found the journal in episode 3.',
        episodeNumber: 4,
      });

      expect(result.ideas[0].sourceType).toBe('series');
      expect(result.ideas[0].topic).toBe('Episode 4: The Hollow Gate');
    });

    it('gracefully handles unstructured LLM text with fallback candidate', async () => {
      const profile = createHorrorStoryProfile();
      const settings = resolveSettings({ profile });

      vi.spyOn(router, 'executeText').mockResolvedValue({
        text: 'The Phantom Train of Silver Creek\nEvery November, a spectral steam train crosses the abandoned trestle.',
        providerId: 'p-mock',
        providerName: 'Mock Provider',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-gpt-4o',
        tokens: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        latencyMs: 150,
      });

      const result = await ideaGenerator.generateIdeas({
        profile,
        router,
        effectiveSettings: settings,
      });

      expect(result.ideas.length).toBe(1);
      expect(result.ideas[0].topic).toBe('The Phantom Train of Silver Creek');
      expect(result.ideas[0].hookScore).toBeDefined();
    });
  });
});
