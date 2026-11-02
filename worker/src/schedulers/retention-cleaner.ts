import fs from 'node:fs/promises';
import path from 'node:path';

export interface RetentionPolicyConfig {
  publishedImageRetentionHours?: number; // default 24 hours
  failedImageRetentionDays?: number; // default 3 days
  researchRetentionDays?: number; // default 30 days
  jobLogsRetentionDays?: number; // default 90 days
  storageWarningThresholdPercent?: number; // default 70%
  storageSafeModeThresholdPercent?: number; // default 90%
}

export interface PruneResult {
  publishedImagesPruned: number;
  failedImagesPruned: number;
  researchItemsPruned: number;
  jobLogsPruned: number;
  filesDeleted: string[];
  errors: string[];
}

export interface StorageUsageReport {
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
  isWarning: boolean;
  isSafeMode: boolean;
}

/**
 * Calculates current disk storage usage and checks warning/safe-mode thresholds
 */
export function evaluateStorageCapacity(
  usedBytes: number,
  totalBytes: number,
  config: RetentionPolicyConfig = {}
): StorageUsageReport {
  const warningPercent = config.storageWarningThresholdPercent ?? 70;
  const safeModePercent = config.storageSafeModeThresholdPercent ?? 90;

  const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

  return {
    usedBytes,
    totalBytes,
    usedPercent,
    isWarning: usedPercent >= warningPercent,
    isSafeMode: usedPercent >= safeModePercent,
  };
}

/**
 * Identifies expired posts whose images are eligible for deletion per PRD Section 16.
 */
export function identifyImagesToPrune(
  posts: Array<{
    id: string;
    status: string;
    published_at?: string | null;
    created_at: string;
    composed_image_path?: string | null;
    raw_image_path?: string | null;
  }>,
  config: RetentionPolicyConfig = {},
  nowMs = Date.now()
): {
  publishedPostImagePaths: string[];
  failedPostImagePaths: string[];
} {
  const publishedRetentionMs = (config.publishedImageRetentionHours ?? 24) * 3600 * 1000;
  const failedRetentionMs = (config.failedImageRetentionDays ?? 3) * 86400 * 1000;

  const publishedPostImagePaths: string[] = [];
  const failedPostImagePaths: string[] = [];

  for (const post of posts) {
    // 1. Published posts older than 24 hours
    if (post.status === 'published' && post.published_at) {
      const pubMs = new Date(post.published_at).getTime();
      if (nowMs - pubMs >= publishedRetentionMs) {
        if (post.composed_image_path) publishedPostImagePaths.push(post.composed_image_path);
        if (post.raw_image_path) publishedPostImagePaths.push(post.raw_image_path);
      }
    }

    // 2. Failed / Skipped posts older than 3 days
    if (post.status === 'failed' || post.status === 'skipped') {
      const createdMs = new Date(post.created_at).getTime();
      if (nowMs - createdMs >= failedRetentionMs) {
        if (post.composed_image_path) failedPostImagePaths.push(post.composed_image_path);
        if (post.raw_image_path) failedPostImagePaths.push(post.raw_image_path);
      }
    }
  }

  return {
    publishedPostImagePaths: Array.from(new Set(publishedPostImagePaths)),
    failedPostImagePaths: Array.from(new Set(failedPostImagePaths)),
  };
}

/**
 * Executes cleanup of aged image files, research excerpts (>30d), and job logs (>90d).
 */
export async function executeRetentionPrune(
  supabase: any,
  config: RetentionPolicyConfig = {},
  nowMs = Date.now()
): Promise<PruneResult> {
  const result: PruneResult = {
    publishedImagesPruned: 0,
    failedImagesPruned: 0,
    researchItemsPruned: 0,
    jobLogsPruned: 0,
    filesDeleted: [],
    errors: [],
  };

  const researchDays = config.researchRetentionDays ?? 30;
  const logsDays = config.jobLogsRetentionDays ?? 90;

  const researchCutoff = new Date(nowMs - researchDays * 86400 * 1000).toISOString();
  const logsCutoff = new Date(nowMs - logsDays * 86400 * 1000).toISOString();

  // 1. Fetch eligible posts
  try {
    const { data: posts, error: postErr } = await supabase
      .from('posts')
      .select('id, status, published_at, created_at, composed_image_path, raw_image_path')
      .in('status', ['published', 'failed', 'skipped']);

    if (!postErr && posts) {
      const { publishedPostImagePaths, failedPostImagePaths } = identifyImagesToPrune(
        posts,
        config,
        nowMs
      );

      const allPaths = [...publishedPostImagePaths, ...failedPostImagePaths];

      for (const filePath of allPaths) {
        try {
          // If local file exists, remove it
          if (filePath.startsWith('/') || filePath.includes(':\\')) {
            await fs.unlink(filePath).catch(() => {});
          }
          result.filesDeleted.push(filePath);
        } catch (e: any) {
          result.errors.push(`Error unlinking ${filePath}: ${e.message}`);
        }
      }

      result.publishedImagesPruned = publishedPostImagePaths.length;
      result.failedImagesPruned = failedPostImagePaths.length;

      // Nullify image paths on pruned post records
      if (allPaths.length > 0) {
        await supabase
          .from('posts')
          .update({ composed_image_path: null, raw_image_path: null })
          .in('composed_image_path', allPaths);
      }
    }
  } catch (err: any) {
    result.errors.push(`Post image pruning error: ${err.message}`);
  }

  // 2. Prune old research items (>30 days)
  try {
    const { data: deletedResearch } = await supabase
      .from('research_items')
      .delete()
      .lte('created_at', researchCutoff)
      .select('id');

    result.researchItemsPruned = deletedResearch?.length || 0;
  } catch (err: any) {
    result.errors.push(`Research pruning error: ${err.message}`);
  }

  // 3. Prune old job logs (>90 days)
  try {
    const { data: deletedLogs } = await supabase
      .from('job_logs')
      .delete()
      .lte('created_at', logsCutoff)
      .select('id');

    result.jobLogsPruned = deletedLogs?.length || 0;
  } catch (err: any) {
    result.errors.push(`Logs pruning error: ${err.message}`);
  }

  return result;
}

