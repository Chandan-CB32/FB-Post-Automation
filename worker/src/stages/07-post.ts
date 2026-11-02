import {
  FacebookPublisher,
  computePostContentHash,
  decryptPageToken,
  PublishPostResult,
} from '@fb-auto/core';

export interface ExecutePublishStageInput {
  pageId: string;
  pageToken: string; // raw or AES-256-GCM encrypted
  caption: string;
  imageBuffer?: Buffer;
  imageUrl?: string;
  imagePhash?: string;
  publishingMode: 'auto' | 'review' | 'hybrid';
  scheduledFor?: Date | string | number;
  qaScore?: number;
  hybridMinScore?: number;
  sensitiveFlags?: string[];
  mustHoldForReview?: boolean;
  publisher?: FacebookPublisher;
}

export interface ExecutePublishStageResult {
  action: 'scheduled' | 'published' | 'held_for_review';
  status: 'scheduled' | 'published' | 'pending_review';
  contentHash: string;
  fbPostId?: string;
  fbPhotoId?: string;
  fbPermalink?: string;
  scheduledPublishTime?: number;
  holdReason?: string;
}

/**
 * Worker stage 7: Publish & Scheduling Stage.
 * Evaluates publishing mode and safety hold rules, then schedules photo feed post via Facebook Graph API.
 */
export async function executePublishStage(
  input: ExecutePublishStageInput
): Promise<ExecutePublishStageResult> {
  const contentHash = computePostContentHash(input.caption, input.imagePhash);

  // 1. Mandatory safety hold check (sensitive content flag)
  if (input.mustHoldForReview) {
    return {
      action: 'held_for_review',
      status: 'pending_review',
      contentHash,
      holdReason: 'Mandatory hold: sensitive content flag detected by safety audit.',
    };
  }

  // 2. Sensitive flags check
  if (input.sensitiveFlags && input.sensitiveFlags.length > 0) {
    return {
      action: 'held_for_review',
      status: 'pending_review',
      contentHash,
      holdReason: `Mandatory hold: flagged for sensitive content: ${input.sensitiveFlags.join(', ')}.`,
    };
  }

  // 3. Publishing mode routing
  const mode = input.publishingMode;
  if (mode === 'review') {
    return {
      action: 'held_for_review',
      status: 'pending_review',
      contentHash,
      holdReason: 'Page publishing mode is set to manual review.',
    };
  }

  if (mode === 'hybrid') {
    const minScore = input.hybridMinScore ?? 80;
    const score = input.qaScore ?? 0;
    if (score < minScore) {
      return {
        action: 'held_for_review',
        status: 'pending_review',
        contentHash,
        holdReason: `Hybrid mode: QA score (${score}) is below required threshold (${minScore}).`,
      };
    }
  }

  // 4. Resolve raw token if encrypted
  let resolvedToken = input.pageToken;
  if (input.pageToken && input.pageToken.includes(':') && input.pageToken.split(':').length === 3) {
    try {
      resolvedToken = decryptPageToken(input.pageToken);
    } catch {
      // If decryption fails, attempt to use as-is (e.g. test mock)
      resolvedToken = input.pageToken;
    }
  }

  // 5. Publish / Schedule via FacebookPublisher
  const publisher = input.publisher || new FacebookPublisher();

  let scheduledDate: Date | undefined;
  if (input.scheduledFor) {
    scheduledDate =
      input.scheduledFor instanceof Date ? input.scheduledFor : new Date(input.scheduledFor);
  }

  const publishResult: PublishPostResult = await publisher.publishFeedPost(
    input.pageId,
    resolvedToken,
    {
      message: input.caption,
      photo: input.imageBuffer
        ? { buffer: input.imageBuffer, filename: 'post.jpg' }
        : input.imageUrl
        ? { url: input.imageUrl }
        : undefined,
      scheduledPublishTime: scheduledDate,
    }
  );

  return {
    action: publishResult.isScheduled ? 'scheduled' : 'published',
    status: publishResult.isScheduled ? 'scheduled' : 'published',
    contentHash,
    fbPostId: publishResult.postId,
    fbPhotoId: publishResult.photoId,
    fbPermalink: publishResult.permalinkUrl,
    scheduledPublishTime: publishResult.scheduledPublishTime,
  };
}
