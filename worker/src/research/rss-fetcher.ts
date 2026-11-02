import crypto from 'node:crypto';
import { ssrfSafeFetch, SSRFError } from '@fb-auto/core';

export { SSRFError };

export interface ParsedFeedItem {
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
  contentHash: string;
}

export interface FetchFeedResult {
  feedTitle?: string;
  feedDescription?: string;
  items: ParsedFeedItem[];
}

export interface FetchFeedOptions {
  allowHttpForTesting?: boolean;
  maxItems?: number;
  timeoutMs?: number;
}

/**
 * Strips HTML tags, script, style blocks, and decodes HTML entities into clean text.
 */
export function stripHtml(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let text = input;

  // 1. Remove script and style tags and their contents
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  // 2. Remove all other HTML/XML tags
  text = text.replace(/<\/?[^>]+(>|$)/g, ' ');

  // 3. Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // 4. Collapse whitespace
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Truncates text cleanly to around maxChars without cutting words in half.
 */
export function truncateExcerpt(text: string, maxChars = 2000): string {
  const cleaned = text.trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  // Find the last space before the limit
  const sub = cleaned.slice(0, maxChars - 3);
  const lastSpace = sub.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.7) {
    return `${sub.slice(0, lastSpace)}...`;
  }
  return `${sub}...`;
}

/**
 * Computes deterministic SHA-256 hash for deduplication.
 */
export function generateContentHash(title: string, urlOrExcerpt: string): string {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedKey = urlOrExcerpt.trim().toLowerCase();
  return crypto.createHash('sha256').update(`${normalizedTitle}|${normalizedKey}`).digest('hex');
}

/**
 * Extracts tag content from an XML snippet, handling CDATA blocks and standard text.
 */
function extractTagContent(xmlSnippet: string, tagName: string): string {
  const tagRegex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xmlSnippet.match(tagRegex);
  if (!match || match[1] === undefined) {
    return '';
  }
  let inner = match[1].trim();
  const cdataMatch = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdataMatch && cdataMatch[1] !== undefined) {
    return cdataMatch[1].trim();
  }
  return inner;
}

/**
 * Extracts URL from <link> tag which can be <link>https://...</link> or <link href="..." rel="alternate"/>
 */
function extractLink(xmlSnippet: string): string {
  // Atom-style: <link ... href="..." ... />
  const hrefMatch = xmlSnippet.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch && hrefMatch[1]) {
    return hrefMatch[1].trim();
  }

  // RSS-style: <link>...</link>
  const standardLink = extractTagContent(xmlSnippet, 'link');
  if (standardLink) {
    return standardLink;
  }

  // Fallback: <guid isPermaLink="true">...</guid>
  const guid = extractTagContent(xmlSnippet, 'guid');
  if (guid && (guid.startsWith('http://') || guid.startsWith('https://'))) {
    return guid;
  }

  return '';
}

/**
 * Parses published date string into ISO-8601 string or null.
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Parses raw RSS 2.0, RSS 1.0 (RDF), or Atom XML feed into structured items.
 */
export function parseFeedXml(xml: string, maxItems = 50): FetchFeedResult {
  if (!xml || typeof xml !== 'string') {
    return { items: [] };
  }

  const items: ParsedFeedItem[] = [];

  // Determine feed channel title & description from header section before the first item/entry
  const headerSection = xml.split(/<(?:item|entry)[\s>]/i)[0] || '';
  const feedTitle = stripHtml(extractTagContent(headerSection, 'title')) || stripHtml(extractTagContent(xml, 'title'));
  const feedDescription = stripHtml(extractTagContent(headerSection, 'description') || extractTagContent(headerSection, 'subtitle'));

  // 1. Check for Atom entries (<entry>...</entry>)
  const entryMatches = xml.match(/<entry[\s\S]*?<\/entry>/gi);
  if (entryMatches && entryMatches.length > 0) {
    for (const entryXml of entryMatches) {
      if (items.length >= maxItems) break;

      const rawTitle = extractTagContent(entryXml, 'title');
      const title = stripHtml(rawTitle);
      if (!title) continue;

      const url = extractLink(entryXml);
      const rawSummary = extractTagContent(entryXml, 'content') ||
        extractTagContent(entryXml, 'summary') ||
        extractTagContent(entryXml, 'description');
      const excerpt = truncateExcerpt(stripHtml(rawSummary), 2000);

      const pubDateStr = extractTagContent(entryXml, 'published') ||
        extractTagContent(entryXml, 'updated') ||
        extractTagContent(entryXml, 'dc:date');
      const publishedAt = parseDate(pubDateStr);

      const contentHash = generateContentHash(title, url || excerpt);

      items.push({
        title,
        url,
        excerpt,
        publishedAt,
        contentHash,
      });
    }

    return {
      feedTitle,
      feedDescription,
      items,
    };
  }

  // 2. Check for RSS items (<item>...</item>)
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi);
  if (itemMatches && itemMatches.length > 0) {
    for (const itemXml of itemMatches) {
      if (items.length >= maxItems) break;

      const rawTitle = extractTagContent(itemXml, 'title');
      const title = stripHtml(rawTitle);
      if (!title) continue;

      const url = extractLink(itemXml);
      const rawContent = extractTagContent(itemXml, 'content:encoded') ||
        extractTagContent(itemXml, 'description') ||
        extractTagContent(itemXml, 'summary');
      const excerpt = truncateExcerpt(stripHtml(rawContent), 2000);

      const pubDateStr = extractTagContent(itemXml, 'pubDate') ||
        extractTagContent(itemXml, 'dc:date') ||
        extractTagContent(itemXml, 'published');
      const publishedAt = parseDate(pubDateStr);

      const contentHash = generateContentHash(title, url || excerpt);

      items.push({
        title,
        url,
        excerpt,
        publishedAt,
        contentHash,
      });
    }

    return {
      feedTitle,
      feedDescription,
      items,
    };
  }

  return {
    feedTitle,
    feedDescription,
    items: [],
  };
}

/**
 * Fetches an RSS or Atom feed using the SSRF-safe fetcher,
 * parses and normalizes articles, and computes deduplication hashes.
 */
export async function fetchAndParseFeed(
  url: string,
  options: FetchFeedOptions = {}
): Promise<FetchFeedResult> {
  const response = await ssrfSafeFetch(
    url,
    {
      headers: {
        'User-Agent': 'FB-Content-Bot/1.0 (+https://github.com/autonomous-fb-bot)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    },
    3,
    options.allowHttpForTesting || false
  );

  if (!response.ok) {
    throw new Error(`Feed fetch failed with HTTP ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  return parseFeedXml(xml, options.maxItems || 25);
}
