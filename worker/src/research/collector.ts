import crypto from 'node:crypto';
import { getSupabaseClient } from '@fb-auto/core';
import { fetchAndParseFeed, ParsedFeedItem, FetchFeedOptions } from './rss-fetcher.js';

export interface ResearchSourceRecord {
  id: string;
  name: string;
  type: 'rss' | 'api' | 'wikipedia' | 'custom_http';
  url: string;
  config?: Record<string, unknown>;
  trust_level?: number;
  interval_minutes?: number;
  last_fetched_at?: string | null;
  active?: boolean;
}

export interface ResearchItemRecord {
  id?: string;
  source_id: string;
  title: string;
  url: string;
  excerpt: string;
  content_hash: string;
  published_at?: string | null;
  created_at?: string;
}

export interface IngestionResult {
  sourceId: string;
  sourceName: string;
  totalFetched: number;
  newItemsStored: number;
  duplicatesSkipped: number;
  items: ResearchItemRecord[];
  error?: string;
}

export interface PollingReport {
  timestamp: string;
  sourcesChecked: number;
  sourcesPolled: number;
  totalNewItems: number;
  totalDuplicates: number;
  results: IngestionResult[];
}

export class ResearchCollector {
  private inMemoryHashSet = new Set<string>();

  /**
   * Clears the in-memory deduplication set (used primarily for testing).
   */
  clearMemoryCache(): void {
    this.inMemoryHashSet.clear();
  }

  /**
   * Checks whether a research source is due for polling based on its interval.
   */
  isSourceDue(source: ResearchSourceRecord, now = new Date()): boolean {
    if (source.active === false) {
      return false;
    }
    if (!source.last_fetched_at) {
      return true;
    }
    const lastFetch = new Date(source.last_fetched_at).getTime();
    if (isNaN(lastFetch)) {
      return true;
    }
    const intervalMs = (source.interval_minutes || 360) * 60 * 1000;
    return now.getTime() - lastFetch >= intervalMs;
  }

  /**
   * Ingests items from a single research source.
   */
  async ingestSource(
    source: ResearchSourceRecord,
    options: FetchFeedOptions & { dbClient?: any } = {}
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      sourceId: source.id,
      sourceName: source.name,
      totalFetched: 0,
      newItemsStored: 0,
      duplicatesSkipped: 0,
      items: [],
    };

    if (source.active === false) {
      return result;
    }

    try {
      let parsedItems: ParsedFeedItem[] = [];

      if (source.type === 'rss') {
        const feedResult = await fetchAndParseFeed(source.url, {
          allowHttpForTesting: options.allowHttpForTesting,
          maxItems: options.maxItems || 30,
        });
        parsedItems = feedResult.items;
      } else {
        // Fallback for custom or unsupported source types
        return {
          ...result,
          error: `Unsupported research source type '${source.type}' in collector.`,
        };
      }

      result.totalFetched = parsedItems.length;
      const db = options.dbClient || getSupabaseClient();
      const nowIso = new Date().toISOString();

      for (const item of parsedItems) {
        let isDuplicate = false;

        if (db) {
          try {
            const { data: existing } = await db
              .from('research_items')
              .select('id')
              .eq('content_hash', item.contentHash)
              .maybeSingle();

            if (existing) {
              isDuplicate = true;
            }
          } catch {
            // If query fails, fall back to in-memory check
            isDuplicate = this.inMemoryHashSet.has(item.contentHash);
          }
        } else {
          isDuplicate = this.inMemoryHashSet.has(item.contentHash);
        }

        if (isDuplicate) {
          result.duplicatesSkipped += 1;
          continue;
        }

        // New item found
        this.inMemoryHashSet.add(item.contentHash);
        const itemRecord: ResearchItemRecord = {
          id: crypto.randomUUID(),
          source_id: source.id,
          title: item.title,
          url: item.url,
          excerpt: item.excerpt,
          content_hash: item.contentHash,
          published_at: item.publishedAt,
          created_at: nowIso,
        };

        if (db) {
          try {
            await db.from('research_items').insert(itemRecord);
          } catch (err: unknown) {
            console.warn(`[ResearchCollector] Failed to insert research item:`, err);
          }
        }

        result.newItemsStored += 1;
        result.items.push(itemRecord);
      }

      // Update last_fetched_at timestamp
      source.last_fetched_at = nowIso;
      if (db) {
        try {
          await db
            .from('research_sources')
            .update({ last_fetched_at: nowIso })
            .eq('id', source.id);
        } catch (err: unknown) {
          console.warn(`[ResearchCollector] Failed to update source last_fetched_at:`, err);
        }
      }

      return result;
    } catch (err: unknown) {
      result.error = err instanceof Error ? err.message : String(err);
      return result;
    }
  }

  /**
   * Polls all due sources from the provided list or Supabase database.
   */
  async pollDueSources(
    sources: ResearchSourceRecord[],
    options: FetchFeedOptions & { dbClient?: any } = {}
  ): Promise<PollingReport> {
    const report: PollingReport = {
      timestamp: new Date().toISOString(),
      sourcesChecked: sources.length,
      sourcesPolled: 0,
      totalNewItems: 0,
      totalDuplicates: 0,
      results: [],
    };

    for (const source of sources) {
      if (this.isSourceDue(source)) {
        report.sourcesPolled += 1;
        const res = await this.ingestSource(source, options);
        report.totalNewItems += res.newItemsStored;
        report.totalDuplicates += res.duplicatesSkipped;
        report.results.push(res);
      }
    }

    return report;
  }
}
