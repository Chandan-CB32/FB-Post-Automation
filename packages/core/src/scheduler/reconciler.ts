import {
  FacebookPublisher,
  FacebookGraphClient,
  FacebookGraphError,
  decryptPageToken,
} from '../index.js';

export interface ReconciliationPostItem {
  id: string;
  page_id: string;
  topic_key?: string | null;
  topic_title?: string | null;
  category?: string | null;
  fb_post_id?: string | null;
  status: string;
  scheduled_for: string;
  page_token?: string; // encrypted or raw
}

export interface ReconcileSinglePostResult {
  postId: string;
  fbPostId: string;
  action: 'published' | 'still_scheduled' | 'failed' | 'error';
  newStatus?: 'published' | 'failed' | 'scheduled_on_fb';
  publishedAt?: string;
  permalinkUrl?: string;
  error?: string;
  isOverdueWarning?: boolean;
}

export interface ReconciliationSummary {
  processedCount: number;
  publishedCount: number;
  stillScheduledCount: number;
  failedCount: number;
  errorCount: number;
  results: ReconcileSinglePostResult[];
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number; // default 60,000 (1 min)
  maxDelayMs?: number; // default 3,600,000 (1 hr)
  backoffFactor?: number; // default 2
}

/**
 * Calculates exponential backoff retry metadata for failed pipeline stages.
 */
export function calculateNextRetry(
  currentAttempts: number,
  options: RetryPolicyOptions = {}
): { nextAttempt: number; delayMs: number; nextRetryAt: string | null; isExhausted: boolean } {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 60000;
  const maxDelayMs = options.maxDelayMs ?? 3600000;
  const factor = options.backoffFactor ?? 2;

  const nextAttempt = currentAttempts + 1;
  if (nextAttempt > maxAttempts) {
    return {
      nextAttempt,
      delayMs: 0,
      nextRetryAt: null,
      isExhausted: true,
    };
  }

  const delayMs = Math.min(baseDelayMs * Math.pow(factor, currentAttempts), maxDelayMs);
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

  return {
    nextAttempt,
    delayMs,
    nextRetryAt,
    isExhausted: false,
  };
}

/**
 * Checks whether an error is retryable according to Facebook Graph API standards.
 */
export function isRetryablePublishError(error: unknown): boolean {
  if (error && typeof error === 'object' && ('code' in error || (error as any).name === 'FacebookGraphError')) {
    const graphErr = error as any;
    if (graphErr.isAuthError || graphErr.code === 190) return false;
    if (graphErr.isPermissionError || (graphErr.code >= 200 && graphErr.code <= 299) || graphErr.code === 10) return false;
    if (graphErr.code === 100) return false;
    return Boolean(graphErr.isRetryable);
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('token') && (msg.includes('expired') || msg.includes('revoked') || msg.includes('invalid'))) {
      return false;
    }
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnreset') || msg.includes('etimedout')) {
      return true;
    }
  }

  return true;
}

/**
 * Reconciles the status of a single scheduled Facebook post against the Graph API.
 */
export async function reconcileSinglePost(
  post: ReconciliationPostItem,
  publisher?: FacebookPublisher,
  nowMs = Date.now()
): Promise<ReconcileSinglePostResult> {
  if (!post.fb_post_id) {
    return {
      postId: post.id,
      fbPostId: '',
      action: 'failed',
      newStatus: 'failed',
      error: 'Post has no fb_post_id to reconcile.',
    };
  }

  if (!post.page_token) {
    return {
      postId: post.id,
      fbPostId: post.fb_post_id,
      action: 'error',
      error: 'Page access token is missing.',
    };
  }

  let token = post.page_token;
  if (token.includes(':') && token.split(':').length === 3) {
    try {
      token = decryptPageToken(token);
    } catch (err: unknown) {
      return {
        postId: post.id,
        fbPostId: post.fb_post_id,
        action: 'error',
        error: `Token decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const fbPub = publisher || new FacebookPublisher();

  try {
    const details = await fbPub.getPostDetails(post.fb_post_id, token);

    if (details.isPublished) {
      return {
        postId: post.id,
        fbPostId: post.fb_post_id,
        action: 'published',
        newStatus: 'published',
        publishedAt: new Date(nowMs).toISOString(),
        permalinkUrl: details.permalinkUrl,
      };
    }

    const scheduledTimeMs = new Date(post.scheduled_for).getTime();
    const overdueDurationMs = nowMs - scheduledTimeMs;
    const isOverdue = overdueDurationMs > 3 * 3600 * 1000;

    return {
      postId: post.id,
      fbPostId: post.fb_post_id,
      action: 'still_scheduled',
      newStatus: 'scheduled_on_fb',
      isOverdueWarning: isOverdue,
      error: isOverdue
        ? `Post is ${Math.round(overdueDurationMs / 3600000)} hours overdue on Facebook schedule.`
        : undefined,
    };
  } catch (err: unknown) {
    const errObj = err as any;
    const isGraphErr =
      err instanceof FacebookGraphError ||
      (err && typeof err === 'object' && ('code' in err || errObj.name === 'FacebookGraphError'));

    if (isGraphErr) {
      if (errObj.code === 100 || (errObj.message && errObj.message.toLowerCase().includes('does not exist'))) {
        return {
          postId: post.id,
          fbPostId: post.fb_post_id,
          action: 'failed',
          newStatus: 'failed',
          error: `Post was deleted or removed from Facebook: ${errObj.message}`,
        };
      }

      if (errObj.isAuthError || errObj.code === 190) {
        return {
          postId: post.id,
          fbPostId: post.fb_post_id,
          action: 'error',
          error: `Facebook Page token expired or revoked: ${errObj.message}`,
        };
      }
    }

    return {
      postId: post.id,
      fbPostId: post.fb_post_id,
      action: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reconciles all pending scheduled posts via database client, updates publication status,
 * and records completed posts in topic history.
 */
export async function reconcileScheduledPosts(
  supabase: any,
  options: {
    publisher?: FacebookPublisher;
    batchSize?: number;
    nowMs?: number;
  } = {}
): Promise<ReconciliationSummary> {
  const batchSize = options.batchSize ?? 50;
  const now = options.nowMs ? new Date(options.nowMs).toISOString() : new Date().toISOString();

  const { data: scheduledPosts, error: fetchErr } = await supabase
    .from('posts')
    .select(`
      id,
      page_id,
      topic_key,
      topic_title,
      category,
      fb_post_id,
      status,
      scheduled_for,
      pages (
        fb_page_token
      )
    `)
    .eq('status', 'scheduled_on_fb')
    .not('fb_post_id', 'is', null)
    .lte('scheduled_for', now)
    .limit(batchSize);

  if (fetchErr) {
    throw new Error(`Failed to fetch scheduled posts for reconciliation: ${fetchErr.message}`);
  }

  const postsList: ReconciliationPostItem[] = (scheduledPosts || []).map((p: any) => ({
    id: p.id,
    page_id: p.page_id,
    topic_key: p.topic_key,
    topic_title: p.topic_title,
    category: p.category,
    fb_post_id: p.fb_post_id,
    status: p.status,
    scheduled_for: p.scheduled_for,
    page_token: p.pages?.fb_page_token,
  }));

  const results: ReconcileSinglePostResult[] = [];
  let publishedCount = 0;
  let stillScheduledCount = 0;
  let failedCount = 0;
  let errorCount = 0;

  for (const postItem of postsList) {
    const res = await reconcileSinglePost(postItem, options.publisher, options.nowMs);
    results.push(res);

    if (res.action === 'published') {
      publishedCount++;
      await supabase
        .from('posts')
        .update({
          status: 'published',
          published_at: res.publishedAt,
          fb_permalink: res.permalinkUrl,
        })
        .eq('id', postItem.id);

      if (postItem.topic_key && postItem.topic_title) {
        try {
          await supabase.from('topic_history').insert({
            page_id: postItem.page_id,
            topic_key: postItem.topic_key,
            title: postItem.topic_title,
            category: postItem.category || '',
            used_at: res.publishedAt || now,
          });
        } catch (_) {}
      }
    } else if (res.action === 'failed') {
      failedCount++;
      await supabase
        .from('posts')
        .update({
          status: 'failed',
          error: res.error,
        })
        .eq('id', postItem.id);
    } else if (res.action === 'error') {
      errorCount++;
    } else {
      stillScheduledCount++;
    }
  }

  return {
    processedCount: postsList.length,
    publishedCount,
    stillScheduledCount,
    failedCount,
    errorCount,
    results,
  };
}
