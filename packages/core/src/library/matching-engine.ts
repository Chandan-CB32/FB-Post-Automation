import crypto from 'node:crypto';
import type {
  LibraryItem,
  LibraryAsset,
  MatchDecision,
  LibraryMatchMethod,
} from '../types/library.js';

export function calculateSha256(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function detectAspectRatio(width?: number | null, height?: number | null): '4:5' | '1:1' | '16:9' | 'other' {
  if (!width || !height || height <= 0) return 'other';
  const ratio = width / height;

  if (ratio >= 0.75 && ratio <= 0.85) return '4:5';
  if (ratio >= 0.95 && ratio <= 1.05) return '1:1';
  if (ratio >= 1.65 && ratio <= 1.85) return '16:9';
  return 'other';
}

export function normalizeDriveName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '') // strip extension
    .replace(/[\s_]+/g, '-') // spaces and underscores to hyphens
    .replace(/[^a-z0-9-]/g, ''); // strip remaining punctuation
}

function normalizeName(name: string): string {
  return normalizeDriveName(name);
}

function stripExt(name: string): string {
  return name.trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '');
}

/**
 * Detects duplicate assets inside a library by MD5 checksum or SHA-256.
 */
export function detectDuplicateAssets(assets: LibraryAsset[]): Record<string, LibraryAsset[]> {
  const groups: Record<string, LibraryAsset[]> = {};
  for (const asset of assets) {
    const key = asset.drive_md5 || asset.sha256;
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(asset);
  }

  const duplicates: Record<string, LibraryAsset[]> = {};
  for (const [key, list] of Object.entries(groups)) {
    if (list.length > 1) {
      duplicates[key] = list;
    }
  }
  return duplicates;
}

/**
 * Validates whether a library can become "ready" for scheduling and publishing.
 * In excel_library mode, ALL non-skipped rows MUST have a matched image.
 * Hybrid mode allows partial matches (falls back to Full-AI).
 */
export function checkLibraryReadiness(
  items: LibraryItem[],
  mode: 'full_ai' | 'excel_library' | 'hybrid'
): { ready: boolean; reason?: string; missingCount: number; activeCount: number } {
  if (mode === 'full_ai') {
    return { ready: true, missingCount: 0, activeCount: items.length };
  }

  const activeItems = items.filter((item) => item.status !== 'skipped');
  const missingItems = activeItems.filter((item) => !item.matched_asset_id);

  if (mode === 'excel_library' && missingItems.length > 0) {
    return {
      ready: false,
      reason: `Excel Library Mode requires an image for every row. ${missingItems.length} active row(s) lack an image.`,
      missingCount: missingItems.length,
      activeCount: activeItems.length,
    };
  }

  return {
    ready: true,
    missingCount: missingItems.length,
    activeCount: activeItems.length,
  };
}

export interface MatcherOptions {
  enableOrderMatching?: boolean;
}

export function runAutoMatching(
  items: LibraryItem[],
  assets: LibraryAsset[],
  options: MatcherOptions = {}
): {
  matches: MatchDecision[];
  unmatchedItems: LibraryItem[];
  unmatchedAssets: LibraryAsset[];
} {
  const matches: MatchDecision[] = [];
  const assignedAssetIds = new Set<string>();
  const assignedItemIds = new Set<string>();

  // Exclude already used/deleted assets
  const availableAssets = assets.filter(
    (a) => a.status === 'unmatched' || a.status === 'matched'
  );

  // Exclude already published or skipped items
  const pendingItems = items.filter(
    (item) => item.status === 'pending' || item.status === 'matched'
  );

  // Helper to commit match
  function recordMatch(item: LibraryItem, asset: LibraryAsset, method: LibraryMatchMethod, confidence: number) {
    matches.push({
      itemId: item.id,
      assetId: asset.id,
      method,
      confidence,
    });
    assignedAssetIds.add(asset.id);
    assignedItemIds.add(item.id);
  }

  // 1. Exact filename match
  for (const item of pendingItems) {
    if (assignedItemIds.has(item.id)) continue;
    const hint = item.image_filename_hint?.trim().toLowerCase();
    if (!hint) continue;

    const matchedAsset = availableAssets.find(
      (a) => !assignedAssetIds.has(a.id) && a.filename.trim().toLowerCase() === hint
    );
    if (matchedAsset) {
      recordMatch(item, matchedAsset, 'exact', 1.0);
    }
  }

  // 2. Ignore extension match
  for (const item of pendingItems) {
    if (assignedItemIds.has(item.id)) continue;
    const hint = item.image_filename_hint?.trim();
    if (!hint) continue;
    const hintBase = stripExt(hint);

    const matchedAsset = availableAssets.find((a) => {
      if (assignedAssetIds.has(a.id)) return false;
      return stripExt(a.filename) === hintBase;
    });

    if (matchedAsset) {
      recordMatch(item, matchedAsset, 'ignore_ext', 0.95);
    }
  }

  // 3. Normalized match
  for (const item of pendingItems) {
    if (assignedItemIds.has(item.id)) continue;
    const hint = item.image_filename_hint?.trim();
    if (!hint) continue;
    const hintNorm = normalizeName(hint);
    if (!hintNorm) continue;

    const matchedAsset = availableAssets.find((a) => {
      if (assignedAssetIds.has(a.id)) return false;
      return normalizeName(a.filename) === hintNorm;
    });

    if (matchedAsset) {
      recordMatch(item, matchedAsset, 'normalized', 0.9);
    }
  }

  // 4. Sequential / Order matching (STRICTLY OPT-IN, NEVER runs automatically)
  if (options.enableOrderMatching === true) {
    const unassignedItems = pendingItems.filter((i) => !assignedItemIds.has(i.id));
    const unassignedAssets = availableAssets.filter((a) => !assignedAssetIds.has(a.id));

    const minLen = Math.min(unassignedItems.length, unassignedAssets.length);
    for (let idx = 0; idx < minLen; idx++) {
      const item = unassignedItems[idx];
      const asset = unassignedAssets[idx];
      recordMatch(item, asset, 'order', 0.6);
    }
  }

  const unmatchedItems = items.filter((i) => !assignedItemIds.has(i.id));
  const unmatchedAssets = assets.filter((a) => !assignedAssetIds.has(a.id));

  return {
    matches,
    unmatchedItems,
    unmatchedAssets,
  };
}

export function suggestVisionMatches(
  items: LibraryItem[],
  assets: LibraryAsset[]
): MatchDecision[] {
  const suggestions: MatchDecision[] = [];

  for (const item of items) {
    if (item.matched_asset_id) continue;
    const textCorpus = `${item.content_idea} ${item.image_idea || ''} ${item.key_facts.join(' ')}`.toLowerCase();

    let bestScore = 0;
    let bestAsset: LibraryAsset | null = null;

    for (const asset of assets) {
      if (asset.matched_item_id || asset.status === 'used' || asset.status === 'image_deleted') continue;

      const labels = asset.vision_labels || [];
      if (labels.length === 0) continue;

      let matchCount = 0;
      for (const label of labels) {
        const clean = label.trim().toLowerCase();
        if (clean.length > 2 && textCorpus.includes(clean)) {
          matchCount++;
        }
      }

      const score = labels.length > 0 ? matchCount / labels.length : 0;
      if (score > bestScore && score >= 0.25) {
        bestScore = score;
        bestAsset = asset;
      }
    }

    if (bestAsset && bestScore > 0) {
      suggestions.push({
        itemId: item.id,
        assetId: bestAsset.id,
        method: 'vision',
        confidence: Math.min(0.85, Math.max(0.65, Number(bestScore.toFixed(2)))),
      });
    }
  }

  return suggestions;
}
