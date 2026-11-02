import crypto from 'node:crypto';
import { TopicQueueItem } from '../types/index.js';

export interface ParsedTopicEntry {
  text: string;
  category?: string;
}

export interface EnqueueOptions {
  startingOrder?: number;
  pageId?: string;
  profileId?: string;
}

export interface QueueStats {
  total: number;
  pending: number;
  used: number;
  skipped: number;
  categories: Record<string, number>;
}

/**
 * Splits a single CSV line into fields respecting double-quoted values containing commas.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parses raw text or CSV input into structured topic entries.
 * Supports:
 * - Plain line-by-line topics
 * - Comma-separated lines (topic, category)
 * - Standard CSV with header (topic/text, category)
 * - Quoted fields with commas
 * - Comments starting with # or //
 */
export function parseTopicImport(rawInput: string, defaultCategory?: string): ParsedTopicEntry[] {
  if (!rawInput || typeof rawInput !== 'string') {
    return [];
  }

  const lines = rawInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  if (lines.length === 0) {
    return [];
  }

  const results: ParsedTopicEntry[] = [];
  let textIndex = 0;
  let categoryIndex = 1;
  let hasHeader = false;

  // Check if first line is a CSV header
  const firstLineFields = parseCsvLine(lines[0]).map((f) => f.toLowerCase().replace(/['"]/g, ''));
  if (
    firstLineFields.includes('topic') ||
    firstLineFields.includes('text') ||
    firstLineFields.includes('title')
  ) {
    hasHeader = true;
    textIndex = firstLineFields.findIndex((f) => f === 'topic' || f === 'text' || f === 'title');
    categoryIndex = firstLineFields.indexOf('category');
  }

  const startIndex = hasHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const topicText = (fields[textIndex] || fields[0] || '').replace(/^["']|["']$/g, '').trim();

    if (!topicText) {
      continue;
    }

    let category: string | undefined = undefined;
    if (categoryIndex !== -1 && fields[categoryIndex]) {
      category = fields[categoryIndex].replace(/^["']|["']$/g, '').trim();
    } else if (!hasHeader && fields.length > 1) {
      category = fields[1].replace(/^["']|["']$/g, '').trim();
    }

    results.push({
      text: topicText,
      category: category || defaultCategory,
    });
  }

  return results;
}

/**
 * Converts parsed entries into full TopicQueueItem instances with UUIDs and sort orders.
 */
export function enqueueTopics(
  entries: ParsedTopicEntry[],
  options: EnqueueOptions = {}
): TopicQueueItem[] {
  const now = new Date().toISOString();
  let currentOrder = options.startingOrder ?? 0;

  return entries.map((entry) => ({
    id: crypto.randomUUID(),
    page_id: options.pageId || null,
    profile_id: options.profileId || null,
    text: entry.text,
    category: entry.category || null,
    status: 'pending',
    sort_order: currentOrder++,
    created_at: now,
    used_at: null,
  }));
}

/**
 * Retrieves the next available pending topic from the queue.
 * - Mode 'fifo': picks the lowest sort_order pending item.
 * - Mode 'random': picks randomly from all matching pending items.
 * - Optional category filter (case-insensitive).
 */
export function getNextTopic(
  queue: TopicQueueItem[],
  mode: 'fifo' | 'random' = 'fifo',
  categoryFilter?: string
): TopicQueueItem | null {
  const eligible = queue.filter((item) => {
    if (item.status !== 'pending') return false;
    if (categoryFilter && categoryFilter.trim()) {
      if (!item.category) return false;
      return item.category.trim().toLowerCase() === categoryFilter.trim().toLowerCase();
    }
    return true;
  });

  if (eligible.length === 0) {
    return null;
  }

  if (mode === 'random') {
    const randomIndex = Math.floor(Math.random() * eligible.length);
    return eligible[randomIndex];
  }

  // FIFO: sort by sort_order ascending
  eligible.sort((a, b) => a.sort_order - b.sort_order);
  return eligible[0];
}

/**
 * Updates a topic queue item's status to 'used' or 'skipped'.
 */
export function markTopicStatus(
  item: TopicQueueItem,
  status: 'used' | 'skipped'
): TopicQueueItem {
  item.status = status;
  item.used_at = new Date().toISOString();
  return item;
}

/**
 * Computes queue statistics and category distributions.
 */
export function getQueueStats(queue: TopicQueueItem[]): QueueStats {
  const stats: QueueStats = {
    total: queue.length,
    pending: 0,
    used: 0,
    skipped: 0,
    categories: {},
  };

  for (const item of queue) {
    if (item.status === 'pending') stats.pending++;
    else if (item.status === 'used') stats.used++;
    else if (item.status === 'skipped') stats.skipped++;

    const cat = item.category || 'Uncategorized';
    stats.categories[cat] = (stats.categories[cat] || 0) + 1;
  }

  return stats;
}
