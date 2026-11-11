import crypto from 'node:crypto';
import { FacebookGraphClient } from './client.js';

export interface PhotoInput {
  buffer?: Buffer;
  url?: string;
  filename?: string;
  fallbackUrl?: string;
  fallbackBuffer?: Buffer;
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

    let buffer = photo.buffer;

    // 1. Resolve buffer if photo.url is provided and no buffer yet
    if (!buffer && photo.url) {
      const trimmedUrl = photo.url.trim();

      // Case A: SVG data URI or raw SVG markup
      if (trimmedUrl.startsWith('data:image/svg+xml') || trimmedUrl.startsWith('<svg')) {
        try {
          let svgString = trimmedUrl;
          if (trimmedUrl.startsWith('data:image/svg+xml')) {
            const commaIndex = trimmedUrl.indexOf(',');
            const header = trimmedUrl.slice(0, commaIndex);
            const body = trimmedUrl.slice(commaIndex + 1);
            svgString = header.includes(';base64')
              ? Buffer.from(body, 'base64').toString('utf-8')
              : decodeURIComponent(body);
          }
          let sharpModule: any;
          try {
            sharpModule = (await import('sharp')).default;
          } catch {
            const { createRequire } = await import('node:module');
            sharpModule = createRequire(import.meta.url)('sharp');
          }
          buffer = await sharpModule(Buffer.from(svgString))
            .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
            .toBuffer();
        } catch (rasterErr) {
          console.warn('[FacebookPublisher] Sharp SVG-to-JPEG conversion error:', rasterErr);
        }
      }
      // Case B: Base64 raster image data URI (data:image/jpeg;base64,...)
      else if (trimmedUrl.startsWith('data:image/')) {
        try {
          const parts = trimmedUrl.split(',');
          const isBase64 = parts[0].includes(';base64');
          buffer = isBase64
            ? Buffer.from(parts[1], 'base64')
            : Buffer.from(decodeURIComponent(parts[1]), 'utf-8');
        } catch (dataUriErr) {
          console.warn('[FacebookPublisher] Base64 image decoding error:', dataUriErr);
        }
      }
      // Case C: Public HTTP/HTTPS URL -> Download buffer server-side to guarantee Facebook receives the buffer
      else if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
        try {
          if (typeof fetch === 'function') {
            const dlRes = await fetch(trimmedUrl, { signal: AbortSignal.timeout(15000) });
            if (dlRes.ok) {
              const ab = await dlRes.arrayBuffer();
              if (ab.byteLength > 500) {
                buffer = Buffer.from(ab);
              }
            }
          }
        } catch (dlErr: any) {
          console.warn(`[FacebookPublisher] Server-side photo download failed (${dlErr?.message}), falling back to direct URL.`);
        }
      }
    }

    // 2. Upload via multipart/form-data if buffer is available (primary & most reliable for Facebook)
    if (buffer && buffer.length > 0) {
      const formData = new FormData();
      formData.append('published', 'false');
      const blob = new Blob([buffer as any], { type: 'image/jpeg' });
      formData.append('source', blob, photo.filename || 'post.jpg');

      const response = await this.client.post<{ id: string }>(
        `${pageId}/photos`,
        pageToken,
        formData,
        undefined,
        true
      );

      return response.id;
    }

    // 3. If buffer couldn't be formed, pass URL directly to Facebook API if it is HTTP/HTTPS
    if (photo.url && (photo.url.startsWith('http://') || photo.url.startsWith('https://'))) {
      const response = await this.client.post<{ id: string }>(`${pageId}/photos`, pageToken, {
        url: photo.url,
        published: false,
      });

      return response.id;
    }

    throw new Error('Unable to upload photo: invalid image format or empty buffer.');
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

    // Step 1: Upload photo if provided (buffer, data URI, or URL with automatic fallback)
    if (options.photo && (options.photo.buffer || options.photo.url || options.photo.fallbackBuffer || options.photo.fallbackUrl)) {
      try {
        photoId = await this.uploadUnpublishedPhoto(pageId, pageToken, options.photo);
      } catch (photoErr: any) {
        console.warn(`[FacebookPublisher] Primary photo upload failed (${photoErr?.message}). Checking fallback options...`);

        // Attempt fallback buffer
        if (options.photo.fallbackBuffer) {
          try {
            photoId = await this.uploadUnpublishedPhoto(pageId, pageToken, {
              buffer: options.photo.fallbackBuffer,
              filename: 'fallback_image.jpg',
            });
            console.log(`[FacebookPublisher] Fallback buffer upload succeeded: ${photoId}`);
          } catch (fbErr: any) {
            console.warn(`[FacebookPublisher] Fallback buffer upload failed: ${fbErr?.message}`);
          }
        }

        // Attempt fallback URL
        if (!photoId && options.photo.fallbackUrl) {
          try {
            photoId = await this.uploadUnpublishedPhoto(pageId, pageToken, {
              url: options.photo.fallbackUrl,
              filename: 'fallback_url.jpg',
            });
            console.log(`[FacebookPublisher] Fallback URL upload succeeded: ${photoId}`);
          } catch (fuErr: any) {
            console.warn(`[FacebookPublisher] Fallback URL upload failed: ${fuErr?.message}`);
          }
        }

        if (!photoId) {
          // Never post a naked text status when an image was requested
          throw new Error(
            `Failed to upload photo for Facebook post: ${photoErr?.message || photoErr}. Post publication aborted to prevent naked text-only post without image.`
          );
        }
      }
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
        // If scheduled time is in the past or under 10 minutes away, publish immediately
        const schedMs =
          typeof options.scheduledPublishTime === 'number'
            ? (options.scheduledPublishTime > 1e11 ? options.scheduledPublishTime : options.scheduledPublishTime * 1000)
            : options.scheduledPublishTime.getTime();
        if (schedMs <= Date.now() + 600 * 1000) {
          payload.published = true;
          isScheduled = false;
        } else {
          throw new Error(`Scheduling window validation failed: ${windowValidation.error}`);
        }
      } else {
        scheduledSeconds = windowValidation.scheduledTimeSeconds;
        payload.published = false;
        payload.scheduled_publish_time = scheduledSeconds;
        isScheduled = true;
      }
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
