import { computePostContentHash } from '../facebook/publisher.js';
import { validateCaption } from '../validation/caption-validator.js';

export interface ReviewablePost {
  id: string;
  page_id: string;
  status: string;
  review_state: 'n/a' | 'pending' | 'approved' | 'rejected';
  review_note?: string | null;
  title?: string | null;
  headline?: string | null;
  caption?: string | null;
  caption_word_count?: number | null;
  hashtags?: string[] | null;
  scheduled_for: string;
  created_at: string;
  image_phash?: string | null;
  content_hash?: string | null;
}

export interface ApprovePostResult {
  post: ReviewablePost;
  action: 'approved';
  newStatus: 'ready' | 'scheduled_on_fb';
  scheduledFor: string;
  wasRescheduled: boolean;
}

export interface EditPostUpdates {
  caption?: string;
  headline?: string;
  title?: string;
  imagePhash?: string;
  scheduledFor?: Date | string;
  reviewerNote?: string;
}

/**
 * Approves a post in the Review Inbox. If the post's scheduled slot has already passed,
 * rolls it forward to the next future slot (default +2 hours from now).
 */
export function approveReviewPost(
  post: ReviewablePost,
  scheduledTimeOverride?: Date | string,
  reviewerNote?: string,
  nowMs = Date.now()
): ApprovePostResult {
  let scheduledDate = scheduledTimeOverride
    ? new Date(scheduledTimeOverride)
    : new Date(post.scheduled_for);

  let wasRescheduled = false;

  // Never allow publishing in the past. If the slot passed while pending review,
  // push to next valid future slot (now + 2 hours).
  if (scheduledDate.getTime() <= nowMs + 600 * 1000) {
    scheduledDate = new Date(nowMs + 7200 * 1000); // +2 hours
    wasRescheduled = true;
  }

  const updated: ReviewablePost = {
    ...post,
    review_state: 'approved',
    review_note: reviewerNote || post.review_note || 'Approved by user via Review Inbox',
    scheduled_for: scheduledDate.toISOString(),
    status: 'ready',
  };

  return {
    post: updated,
    action: 'approved',
    newStatus: 'ready',
    scheduledFor: scheduledDate.toISOString(),
    wasRescheduled,
  };
}

/**
 * Rejects a post in the Review Inbox with a recorded reason.
 */
export function rejectReviewPost(
  post: ReviewablePost,
  rejectionReason: string
): ReviewablePost {
  return {
    ...post,
    review_state: 'rejected',
    status: 'skipped',
    review_note: rejectionReason || 'Rejected by user',
  };
}

/**
 * Applies owner edits to a review-pending post and recalculates word count and content hash.
 */
export function editReviewPost(
  post: ReviewablePost,
  updates: EditPostUpdates
): ReviewablePost {
  const newCaption = updates.caption !== undefined ? updates.caption : post.caption || '';
  const newHeadline = updates.headline !== undefined ? updates.headline : post.headline;
  const newTitle = updates.title !== undefined ? updates.title : post.title;
  const newPhash = updates.imagePhash !== undefined ? updates.imagePhash : post.image_phash;

  const words = newCaption.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const contentHash = computePostContentHash(newCaption, newPhash || undefined);

  let newScheduledFor = post.scheduled_for;
  if (updates.scheduledFor) {
    newScheduledFor =
      updates.scheduledFor instanceof Date
        ? updates.scheduledFor.toISOString()
        : new Date(updates.scheduledFor).toISOString();
  }

  return {
    ...post,
    caption: newCaption,
    caption_word_count: wordCount,
    headline: newHeadline,
    title: newTitle,
    image_phash: newPhash,
    content_hash: contentHash,
    scheduled_for: newScheduledFor,
    review_note: updates.reviewerNote || post.review_note,
  };
}

/**
 * Checks for review-pending posts eligible for auto-approval after N hours.
 */
export function evaluateAutoApproveEligiblePosts(
  posts: ReviewablePost[],
  autoApproveHours: number,
  nowMs = Date.now()
): ReviewablePost[] {
  if (autoApproveHours <= 0) return [];

  const thresholdMs = autoApproveHours * 3600 * 1000;

  return posts.filter((post) => {
    if (post.review_state !== 'pending') return false;
    const createdAtMs = new Date(post.created_at).getTime();
    return nowMs - createdAtMs >= thresholdMs;
  });
}

