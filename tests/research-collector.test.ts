import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import {
  stripHtml,
  truncateExcerpt,
  generateContentHash,
  parseFeedXml,
  fetchAndParseFeed,
  SSRFError,
} from '../worker/src/research/rss-fetcher.js';
import {
  ResearchCollector,
  ResearchSourceRecord,
} from '../worker/src/research/collector.js';
import {
  executeResearchIdeaStage,
} from '../worker/src/stages/02-research-idea.js';
import { ProviderRouter } from '../worker/src/router/provider-router.js';
import {
  createHorrorStoryProfile,
  createScienceStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';
import { resolveSettings } from '../packages/core/src/settings-resolver/resolver.js';

describe('Research Collector & Feed Fetcher (Step 6.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTML Sanitization & Excerpt Truncation', () => {
    it('strips script, style, html tags and decodes entities cleanly', () => {
      const dirtyHtml = `
        <div>
          <script>alert('xss');</script>
          <style>body { color: red; }</style>
          <h1>Mysterious Deep Sea Discovery &amp; Exploration</h1>
          <p>Scientists uncovered a <strong>rare species</strong> living at &quot;extreme depths&#39;.</p>
        </div>
      `;
      const cleaned = stripHtml(dirtyHtml);
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('alert');
      expect(cleaned).not.toContain('color: red');
      expect(cleaned).not.toContain('<h1>');
      expect(cleaned).toContain('Mysterious Deep Sea Discovery & Exploration');
      expect(cleaned).toContain('rare species living at "extreme depths\'.');
    });

    it('truncates text cleanly at word boundaries around 2000 characters', () => {
      const longText = 'word '.repeat(500); // 2500 chars
      const truncated = truncateExcerpt(longText, 2000);
      expect(truncated.length).toBeLessThanOrEqual(2000);
      expect(truncated.endsWith('...')).toBe(true);
      expect(truncated.endsWith(' ...')).toBe(false);

      const shortText = 'Short and concise excerpt.';
      expect(truncateExcerpt(shortText, 2000)).toBe(shortText);
    });

    it('generates consistent deterministic SHA-256 content hashes', () => {
      const hash1 = generateContentHash('Title One', 'https://example.com/article1');
      const hash2 = generateContentHash('title one', 'https://example.com/article1');
      const hash3 = generateContentHash('Title Two', 'https://example.com/article2');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('XML Feed Parsing (RSS 2.0 & Atom)', () => {
    it('parses standard RSS 2.0 feeds with CDATA and pubDate', () => {
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Science Daily Oddities</title>
          <description>Latest fascinating research discoveries</description>
          <item>
            <title><![CDATA[Astronomers Detect Unexplained Radio Pulse from Deep Space]]></title>
            <link>https://example.com/news/radio-pulse-2026</link>
            <content:encoded><![CDATA[<p>A fast radio burst repeating every 16 days has been recorded by radio telescopes.</p>]]></content:encoded>
            <pubDate>Mon, 02 Nov 2026 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Ancient Roman Aqueduct Discovered Under Vineyards</title>
            <link>https://example.com/news/roman-aqueduct</link>
            <description>Excavators in southern France uncovered a remarkably preserved aqueduct channel.</description>
            <pubDate>Sun, 01 Nov 2026 09:30:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

      const result = parseFeedXml(rssXml);
      expect(result.feedTitle).toBe('Science Daily Oddities');
      expect(result.items.length).toBe(2);

      const item1 = result.items[0];
      expect(item1.title).toBe('Astronomers Detect Unexplained Radio Pulse from Deep Space');
      expect(item1.url).toBe('https://example.com/news/radio-pulse-2026');
      expect(item1.excerpt).toContain('fast radio burst repeating every 16 days');
      expect(item1.publishedAt).toBe('2026-11-02T12:00:00.000Z');
      expect(item1.contentHash).toBeDefined();

      const item2 = result.items[1];
      expect(item2.title).toBe('Ancient Roman Aqueduct Discovered Under Vineyards');
      expect(item2.excerpt).toContain('Excavators in southern France');
      expect(item2.publishedAt).toBe('2026-11-01T09:30:00.000Z');
    });

    it('parses Atom feeds with entry, link href, and updated timestamp', () => {
      const atomXml = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Tech &amp; Space Dispatch</title>
        <entry>
          <title>Fusion Reactor Sustains Record 100M-Degree Plasma</title>
          <link rel="alternate" type="text/html" href="https://example.com/tech/fusion-record"/>
          <summary>Experimental reactor maintained stable high-confinement mode for over six minutes.</summary>
          <updated>2026-11-02T14:15:00Z</updated>
        </entry>
      </feed>`;

      const result = parseFeedXml(atomXml);
      expect(result.feedTitle).toBe('Tech & Space Dispatch');
      expect(result.items.length).toBe(1);

      const item = result.items[0];
      expect(item.title).toBe('Fusion Reactor Sustains Record 100M-Degree Plasma');
      expect(item.url).toBe('https://example.com/tech/fusion-record');
      expect(item.excerpt).toContain('Experimental reactor maintained stable high-confinement');
      expect(item.publishedAt).toBe('2026-11-02T14:15:00.000Z');
    });
  });

  describe('SSRF Protection in Feed Fetching', () => {
    it('blocks loopback and link-local cloud metadata IPs', async () => {
      await expect(
        fetchAndParseFeed('http://127.0.0.1/feed.xml')
      ).rejects.toThrow(SSRFError);

      await expect(
        fetchAndParseFeed('http://169.254.169.254/latest/meta-data')
      ).rejects.toThrow(SSRFError);

      await expect(
        fetchAndParseFeed('ftp://example.com/feed.xml')
      ).rejects.toThrow(SSRFError);
    });
  });

  describe('ResearchCollector Ingestion & Deduplication', () => {
    let collector: ResearchCollector;

    beforeEach(() => {
      collector = new ResearchCollector();
      collector.clearMemoryCache();
    });

    it('ingests items from a source and skips duplicates on subsequent runs', async () => {
      const source: ResearchSourceRecord = {
        id: crypto.randomUUID(),
        name: 'Space Discoveries Feed',
        type: 'rss',
        url: 'https://news.example.com/rss.xml',
        interval_minutes: 180,
      };

      const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Space News</title>
          <item>
            <title>James Webb Spots Oldest Known Spiral Galaxy</title>
            <link>https://news.example.com/jwst-spiral-galaxy</link>
            <description>A massive spiral galaxy formed just 800 million years after the Big Bang.</description>
          </item>
          <item>
            <title>Subsurface Ocean Detected on Enceladus</title>
            <link>https://news.example.com/enceladus-ocean</link>
            <description>Spectroscopy reveals hydrogen molecules consistent with hydrothermal vents.</description>
          </item>
        </channel>
      </rss>`;

      // Mock DNS resolution to public IP
      vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

      // Mock global fetch for the feed URL (fresh response per call)
      vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(
          new Response(mockXml, {
            status: 200,
            headers: { 'Content-Type': 'application/rss+xml' },
          })
        )
      );

      // First run: both items are new
      const run1 = await collector.ingestSource(source, { allowHttpForTesting: true });
      expect(run1.totalFetched).toBe(2);
      expect(run1.newItemsStored).toBe(2);
      expect(run1.duplicatesSkipped).toBe(0);
      expect(run1.items.length).toBe(2);
      expect(source.last_fetched_at).toBeDefined();

      // Second run with the same feed: all items should be detected as duplicates
      const run2 = await collector.ingestSource(source, { allowHttpForTesting: true });
      expect(run2.totalFetched).toBe(2);
      expect(run2.newItemsStored).toBe(0);
      expect(run2.duplicatesSkipped).toBe(2);
      expect(run2.items.length).toBe(0);
    });

    it('accurately evaluates whether a source is due for polling', () => {
      const now = new Date('2026-11-02T12:00:00Z');
      const source: ResearchSourceRecord = {
        id: crypto.randomUUID(),
        name: 'Test Source',
        type: 'rss',
        url: 'https://example.com/rss',
        interval_minutes: 120, // 2 hours
        last_fetched_at: '2026-11-02T11:00:00Z', // 1 hour ago
      };

      // 1 hour elapsed out of 2 hours -> NOT due
      expect(collector.isSourceDue(source, now)).toBe(false);

      // 3 hours elapsed out of 2 hours -> IS due
      source.last_fetched_at = '2026-11-02T08:00:00Z';
      expect(collector.isSourceDue(source, now)).toBe(true);

      // Inactive source -> NOT due
      source.active = false;
      expect(collector.isSourceDue(source, now)).toBe(false);

      // Never fetched before -> IS due
      source.active = true;
      source.last_fetched_at = null;
      expect(collector.isSourceDue(source, now)).toBe(true);
    });
  });

  describe('Stage 02 Research & Idea Generation Execution', () => {
    let router: ProviderRouter;

    beforeEach(() => {
      router = new ProviderRouter();
    });

    it('supplies research feed candidates for factual profiles when available', async () => {
      const scienceProfile = createScienceStoryProfile();
      const settings = resolveSettings({ profile: scienceProfile });

      const feedItem = {
        id: crypto.randomUUID(),
        source_id: 'src-1',
        title: 'Deep Ice Core Reveals 1.5-Million-Year Climate History',
        url: 'https://news.example.com/antarctic-ice-core',
        excerpt: 'Scientists in Antarctica have retrieved a continuous ice core reaching bedrock.',
        content_hash: 'abc123hash',
      };

      const result = await executeResearchIdeaStage({
        profile: scienceProfile,
        effectiveSettings: settings,
        router,
        recentResearchItems: [feedItem],
      });

      expect(result.sourceType).toBe('research_feed');
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].topic).toBe(feedItem.title);
      expect(result.candidates[0].sourceUrl).toBe(feedItem.url);
      expect(result.candidates[0].facts).toContain(feedItem.excerpt);
    });

    it('generates creative story premises via LLM for fiction profiles', async () => {
      const horrorProfile = createHorrorStoryProfile();
      const settings = resolveSettings({ profile: horrorProfile });

      vi.spyOn(router, 'executeText').mockResolvedValue({
        text: JSON.stringify([
          {
            topic: 'The Bell in the Fog',
            category: 'Supernatural Phenomena',
            premise: 'A coastal village bell rings only when phantom ships navigate the shoals.',
          },
          {
            topic: 'The Clockmaker of Prague',
            category: 'Cursed Objects & Relics',
            premise: 'A mechanical clock subtracts an hour of life from anyone who winds it.',
          },
        ]),
        providerId: 'prov-mock',
        providerName: 'Mock Provider',
        keyMasked: 'sk-...1234',
        modelUsed: 'mock-gpt-4o',
        tokens: { promptTokens: 100, completionTokens: 60, totalTokens: 160 },
        latencyMs: 300,
      });

      const result = await executeResearchIdeaStage({
        profile: horrorProfile,
        effectiveSettings: settings,
        router,
      });

      expect(result.sourceType).toBe('auto_idea');
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].topic).toBe('The Bell in the Fog');
      expect(result.candidates[0].category).toBe('Supernatural Phenomena');
      expect(result.tokensUsed?.totalTokens).toBe(160);
    });
  });
});
