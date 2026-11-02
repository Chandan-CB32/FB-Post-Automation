import crypto from 'node:crypto';
import { FacebookGraphClient } from './client.js';

export interface PhotoInput {
  buffer?: Buffer;
  url?: string;
  filename?: string;
}

export interface PublishPostOptions {
  message: string;
  photo?: PhotoInput;
  scheduledPublishTime?: Date | number; // timestamp in seconds or Date
  published?: boolean; // if explicitly true, publishes immediately
}

export interface PublishPostResult {
  postId: string;
  photoId?: string;
  scheduledPublishTime?: number;
  isScheduled: boolean;
  permalinkUrl?: string;
}

/**
 * Validates Facebook Graph API scheduling window (10 minutes to 30 days in the future).
 */
export function validateSchedulingWindow(
  scheduledTime: Date | number,
  nowMs = Date.now()
): { valid: boolean; scheduledTimeSeconds: number; error?: string } {
  const scheduledTimeSeconds =
    typeof scheduledTime === 'number'
      ? Math.floor(scheduledTime > 1e11 ? scheduledTime / 1000 : scheduledTime)
      : Math.floor(scheduledTime.getTime() / 1000);

  const nowSeconds = Math.floor(nowMs / 1000);
  const minSeconds = nowSeconds + 600; // +10 minutes
  const maxSeconds = nowSeconds + 2592000; // +30 days (30 * 24 * 3600)

  if (scheduledTimeSeconds < minSeconds) {
    return {
      valid: false,
      scheduledTimeSeconds,
      error: `Scheduled time (${new Date(
        scheduledTimeSeconds * 1000
      ).toISOString()}) must be at least 10 minutes in the future from now (${new Date(
        nowSeconds * 1000
      ).toISOString()}).`,
    };
  }

  if (scheduledTimeSeconds > maxSeconds) {
    return {
      valid: false,
      scheduledTimeSeconds,
      error: `Scheduled time (${new Date(
        scheduledTimeSeconds * 1000
      ).toISOString()}) cannot be more than 30 days in the future (Facebook API constraint).`,
    };
  }

  return {
    valid: true,
    scheduledTimeSeconds,
  };
}

/**
 * Computes deterministic SHA-256 content hash of caption text and image perceptual hash.
 */
export function computePostContentHash(caption: string, imagePhash?: string): string {
  const normalized = caption.trim().replace(/\r\n/g, '\n');
  return crypto
    .createHash('sha256')
    .update(`${normalized}::${imagePhash || ''}`)
    .digest('hex');
}

export class FacebookPublisher {
  private readonly client: FacebookGraphClient;

  constructor(client?: FacebookGraphClient) {
    this.client = client || new FacebookGraphClient();
  }

  /**
   * Uploads an unpublished photo to /{page-id}/photos with published=false.
   * Returns the uploaded photo's media_fbid.
   */
  public async uploadUnpublishedPhoto(
    pageId: string,
    pageToken: string,
    photo: PhotoInput
  ): Promise<string> {
    if (!photo.buffer && !photo.url) {
      throw new Error('uploadUnpublishedPhoto requires either an image buffer or an image url.');
    }

    if (photo.buffer) {
      const formData = new FormData();
      formData.append('published', 'false');
      const blob = new Blob([photo.buffer as any], { type: 'image/jpeg' });
      formData.append('source', blob, photo.filename || 'post.jpg');

      const response = await this.client.post<{ id: string }>(
        `${pageId}/photos`,
        pageToken,
        formData,
        undefined,
        true
      );

      return response.id;
    } else {
      const response = await this.client.post<{ id: string }>(`${pageId}/photos`, pageToken, {
        url: photo.url,
        published: false,
      });

      return response.id;
    }
  }

  /**
   * Publishes or schedules a Facebook Page feed post with the full caption and attached media.
   */
  public async publishFeedPost(
    pageId: string,
    pageToken: string,
    options: PublishPostOptions
  ): Promise<PublishPostResult> {
    let photoId: string | undefined;

    // Step 1: Upload photo if provided
    if (options.photo && (options.photo.buffer || options.photo.url)) {
      photoId = await this.uploadUnpublishedPhoto(pageId, pageToken, options.photo);
    }

    const payload: Record<string, any> = {
      message: options.message,
    };

    if (photoId) {
      payload.attached_media = [{ media_fbid: photoId }];
    }

    let isScheduled = false;
    let scheduledSeconds: number | undefined;

    // Step 2: Handle Scheduling vs Immediate Publishing
    if (options.scheduledPublishTime && options.published !== true) {
      const windowValidation = validateSchedulingWindow(options.scheduledPublishTime);
      if (!windowValidation.valid) {
        throw new Error(`Scheduling window validation failed: ${windowValidation.error}`);
      }
      scheduledSeconds = windowValidation.scheduledTimeSeconds;
      payload.published = false;
      payload.scheduled_publish_time = scheduledSeconds;
      isScheduled = true;
    } else {
      payload.published = true;
    }

    const postResponse = await this.client.post<{ id: string }>(
      `${pageId}/feed`,
      pageToken,
      payload
    );

    const postId = postResponse.id;
    const permalinkUrl = `https://www.facebook.com/${postId.replace('_', '/posts/')}`;

    return {
      postId,
      photoId,
      scheduledPublishTime: scheduledSeconds,
      isScheduled,
      permalinkUrl,
    };
  }

  /**
   * Reschedules an existing scheduled post on Facebook.
   */
  public async reschedulePost(
    postId: string,
    pageToken: string,
    newScheduledTime: Date | number
  ): Promise<boolean> {
    const windowValidation = validateSchedulingWindow(newScheduledTime);
    if (!windowValidation.valid) {
      throw new Error(`Scheduling window validation failed: ${windowValidation.error}`);
    }

    const response = await this.client.post<{ success: boolean }>(postId, pageToken, {
      scheduled_publish_time: windowValidation.scheduledTimeSeconds,
    });

    return response.success === true;
  }

  /**
   * Deletes a published or scheduled post from Facebook.
   */
  public async deletePost(postId: string, pageToken: string): Promise<boolean> {
    const response = await this.client.delete<{ success: boolean }>(postId, pageToken);
    return response.success === true;
  }

  /**
   * Queries Facebook Graph API for post status, publication flag, and permalink.
   */
  public async getPostDetails(
    postId: string,
    pageToken: string
  ): Promise<{
    id: string;
    isPublished: boolean;
    scheduledPublishTime?: number;
    permalinkUrl?: string;
  }> {
    const response = await this.client.get<{
      id: string;
      is_published: boolean;
      scheduled_publish_time?: number;
      permalink_url?: string;
    }>(postId, pageToken, {
      fields: 'id,is_published,scheduled_publish_time,permalink_url',
    });

    return {
      id: response.id,
      isPublished: response.is_published,
      scheduledPublishTime: response.scheduled_publish_time,
      permalinkUrl: response.permalink_url,
    };
  }
}
