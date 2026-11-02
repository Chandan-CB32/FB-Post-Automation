import crypto from 'node:crypto';
import { getSupabaseClient } from '../db/client.js';

export interface TopicHistoryEntry {
  title: string;
  category?: string | null;
  created_at: string;
}

export interface DedupCheckOptions {
  windowDays?: number;
  maxPosts?: number;
  similarityThreshold?: number;
  now?: Date;
}

export interface DedupCheckResult {
  isDuplicate: boolean;
  matchedTitle?: string;
  similarity?: number;
  reason?: string;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'about', 'into', 'over', 'after', 'beneath', 'under'
]);

/**
 * Normalizes a topic string for indexing and similarity comparison.
 */
export function normalizeTopic(title: string): string {
  if (!title || typeof title !== 'string') {
    return '';
  }

  const cleaned = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^\w\s]/g, ' ') // Strip punctuation
    .replace(/\s+/g, ' ')
    .trim();

  // Strip stop words
  const tokens = cleaned.split(' ').filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return tokens.join(' ');
}

/**
 * Computes deterministic topic key hash for exact/fast database lookups.
 */
export function generateTopicKey(title: string): string {
  const norm = normalizeTopic(title);
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/**
 * Computes Dice's coefficient on character bigrams combined with word token overlap (0.0 to 1.0).
 */
export function computeTopicSimilarity(topicA: string, topicB: string): number {
  const normA = normalizeTopic(topicA);
  const normB = normalizeTopic(topicB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // 1. Check substring inclusion
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    if (minLen / maxLen >= 0.7) {
      return 0.85;
    }
  }

  // 2. Word token Jaccard similarity
  const tokensA = new Set(normA.split(' '));
  const tokensB = new Set(normB.split(' '));
  let intersectionTokens = 0;

  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersectionTokens++;
    }
  }

  const unionTokens = new Set([...tokensA, ...tokensB]).size;
  const tokenJaccard = unionTokens > 0 ? intersectionTokens / unionTokens : 0;

  // 3. Character Bigram Dice Coefficient
  const getBigrams = (str: string): string[] => {
    const s = str.replace(/\s/g, '');
    const bg: string[] = [];
    for (let i = 0; i < s.length - 1; i++) {
      bg.push(s.slice(i, i + 2));
    }
    return bg;
  };

  const bgA = getBigrams(normA);
  const bgB = getBigrams(normB);

  if (bgA.length === 0 || bgB.length === 0) {
    return tokenJaccard;
  }

  const mapB = new Map<string, number>();
  for (const bg of bgB) {
    mapB.set(bg, (mapB.get(bg) || 0) + 1);
  }

  let matches = 0;
  for (const bg of bgA) {
    const count = mapB.get(bg) || 0;
    if (count > 0) {
      matches++;
      mapB.set(bg, count - 1);
    }
  }

  const dice = (2 * matches) / (bgA.length + bgB.length);

  // Return the higher of token overlap or bigram dice score
  return Math.max(tokenJaccard, dice);
}

/**
 * Checks whether a candidate topic is a duplicate of any recent post in history.
 * Enforces the PRD 90-day / 200-post dedup window with near-duplicate detection.
 */
export function isTopicDuplicate(
  candidateTopic: string,
  history: TopicHistoryEntry[],
  options: DedupCheckOptions = {}
): DedupCheckResult {
  const windowDays = options.windowDays ?? 90;
  const maxPosts = options.maxPosts ?? 200;
  const threshold = options.similarityThreshold ?? 0.65;
  const now = options.now ?? new Date();

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoffTime = now.getTime() - windowMs;

  // Filter history by window days and take up to maxPosts
  const eligibleHistory = history
    .filter((entry) => {
      const entryTime = new Date(entry.created_at).getTime();
      return !isNaN(entryTime) && entryTime >= cutoffTime;
    })
    .slice(0, maxPosts);

  const candidateNorm = normalizeTopic(candidateTopic);

  for (const entry of eligibleHistory) {
    const entryNorm = normalizeTopic(entry.title);

    // Exact match
    if (candidateNorm === entryNorm) {
      return {
        isDuplicate: true,
        matchedTitle: entry.title,
        similarity: 1.0,
        reason: `Exact match with past post from ${entry.created_at}`,
      };
    }

    // Near-duplicate similarity check
    const similarity = computeTopicSimilarity(candidateTopic, entry.title);
    if (similarity >= threshold) {
      return {
        isDuplicate: true,
        matchedTitle: entry.title,
        similarity: Math.round(similarity * 100) / 100,
        reason: `Near-duplicate (${Math.round(similarity * 100)}% match) of '${entry.title}' from ${entry.created_at}`,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Records a chosen topic into the database `topic_history` table.
 */
export async function recordTopicHistory(
  pageId: string,
  title: string,
  category?: string,
  postId?: string,
  dbClient?: any
): Promise<void> {
  const db = dbClient || getSupabaseClient();
  if (!db) return;

  const topicKey = generateTopicKey(title);
  try {
    await db.from('topic_history').insert({
      page_id: pageId,
      topic_key: topicKey,
      title: title.trim(),
      category: category || null,
      post_id: postId || null,
      created_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.warn('[TopicDedup] Failed to record topic history:', err);
  }
}
