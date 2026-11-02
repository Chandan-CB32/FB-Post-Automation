import {
  resolveSettings,
  importMasterPrompt,
  createHorrorStoryProfile,
  createScienceStoryProfile,
  approveReviewPost,
  rejectReviewPost,
  editReviewPost,
  evaluateAutoApproveEligiblePosts,
  maskSecret,
  CORE_VERSION,
} from '@fb-auto/core';

export interface DashboardOverviewMetrics {
  workerHeartbeat: string | null;
  workerStatus: 'healthy' | 'stale' | 'paused' | 'offline';
  killSwitchActive: boolean;
  pagesCount: number;
  postCounts: {
    planned: number;
    ready: number;
    pendingReview: number;
    scheduled: number;
    published: number;
    failed: number;
  };
  providerQuotas: {
    providerId: string;
    usedToday: number;
    dailyLimit: number;
    percentUsed: number;
  }[];
  recentAlerts: {
    id: string;
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: string;
  }[];
}

/**
 * Computes live dashboard overview status metrics
 */
export function getDashboardOverviewMetrics(data: {
  lastHeartbeat?: string | null;
  killSwitchActive?: boolean;
  pages?: any[];
  posts?: any[];
  alerts?: any[];
  providerDailyUsage?: any[];
}): DashboardOverviewMetrics {
  const now = Date.now();
  let workerStatus: 'healthy' | 'stale' | 'paused' | 'offline' = 'offline';

  if (data.killSwitchActive) {
    workerStatus = 'paused';
  } else if (data.lastHeartbeat) {
    const elapsedMinutes = (now - new Date(data.lastHeartbeat).getTime()) / 60000;
    if (elapsedMinutes <= 5) {
      workerStatus = 'healthy';
    } else {
      workerStatus = 'stale';
    }
  }

  const posts = data.posts || [];
  const postCounts = {
    planned: posts.filter((p) => p.status === 'planned').length,
    ready: posts.filter((p) => p.status === 'ready').length,
    pendingReview: posts.filter((p) => p.status === 'pending_review' || p.review_state === 'pending').length,
    scheduled: posts.filter((p) => p.status === 'scheduled_on_fb').length,
    published: posts.filter((p) => p.status === 'published').length,
    failed: posts.filter((p) => p.status === 'failed').length,
  };

  const quotas = (data.providerDailyUsage || []).map((u) => {
    const limit = u.daily_limit || 1000;
    const used = u.requests_count || 0;
    return {
      providerId: u.provider_id,
      usedToday: used,
      dailyLimit: limit,
      percentUsed: Math.min(Math.round((used / limit) * 100), 100),
    };
  });

  return {
    workerHeartbeat: data.lastHeartbeat || null,
    workerStatus,
    killSwitchActive: Boolean(data.killSwitchActive),
    pagesCount: (data.pages || []).length,
    postCounts,
    providerQuotas: quotas,
    recentAlerts: data.alerts || [],
  };
}

/**
 * Handles Prompt Studio live effective prompt preview
 */
export function handlePromptStudioPreview(input: {
  globalDefaults?: any;
  profile?: any;
  page?: any;
  postOverrides?: any;
}) {
  const effective = resolveSettings({
    globalDefaults: input.globalDefaults,
    profile: input.profile,
    page: input.page,
    postOverrides: input.postOverrides,
  });

  return {
    effectiveSettings: effective,
    provenance: effective.provenance,
  };
}

/**
 * Handles Review Inbox batch approval action
 */
export function handleBatchApproveReviewPosts(posts: any[]) {
  const approvedResults = posts.map((post) => approveReviewPost(post));
  return {
    approvedCount: approvedResults.length,
    results: approvedResults,
  };
}

/**
 * Handles Review Inbox rejection action
 */
export function handleRejectReviewPost(post: any, reason: string) {
  return rejectReviewPost(post, reason);
}

/**
 * Handles Review Inbox edit action
 */
export function handleEditReviewPost(post: any, updates: any) {
  return editReviewPost(post, updates);
}
