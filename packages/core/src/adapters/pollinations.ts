import {
  ImageProviderAdapter,
  ImageGenerateOptions,
  ImageGenerateResult,
  ProviderError,
} from './types.js';
import { validateAndNormalizeImage } from '../validation/image-validator.js';

export const POLLINATIONS_MODELS = [
  { id: 'flux', name: 'FLUX.1 Schnell (Default, Free)', cost: 0.0 },
  { id: 'turbo', name: 'SDXL Turbo (High-speed)', cost: 0.002 },
  { id: 'gptimage', name: 'GPT Image (Semantic prompt alignment)', cost: 0.003 },
  { id: 'seedream', name: 'Seedream (ByteDance SDXL)', cost: 0.003 },
  { id: 'nanobanana', name: 'Nano Banana (Gemini 2.5 Flash Image)', cost: 0.004 },
];

export class PollinationsImageAdapter implements ImageProviderAdapter {
  public readonly id = 'pollinations';

  async generateImage(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
    const prompt = encodeURIComponent(options.prompt);
    const width = options.width || 1080;
    const height = options.height || 1350;
    const model = options.model || 'flux';

    // If an API key is provided and starts with secret prefix 'sk_', use gen.pollinations.ai
    // Publishable keys ('pk_') or missing keys use image.pollinations.ai with no auth header
    const hasSecretKey = Boolean(options.apiKey && options.apiKey.trim().startsWith('sk_'));
    const isDirectService = !hasSecretKey;

    const baseDomain = isDirectService ? 'https://image.pollinations.ai' : (options.baseUrl || 'https://gen.pollinations.ai').replace(/\/+$/, '');
    const pathPrefix = isDirectService ? '/prompt' : '/image';

    const url = new URL(`${baseDomain}${pathPrefix}/${prompt}`);
    url.searchParams.set('model', model);
    url.searchParams.set('width', width.toString());
    url.searchParams.set('height', height.toString());
    url.searchParams.set('nologo', 'true');
    if (options.seed !== undefined) {
      url.searchParams.set('seed', options.seed.toString());
    }

    const headers: Record<string, string> = {
      ...options.customHeaders,
    };
    if (hasSecretKey) {
      headers['Authorization'] = `Bearer ${options.apiKey!.trim()}`;
    }

    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      // Fallback: If enterprise gen.pollinations.ai returns 401/403, retry via direct image.pollinations.ai
      if (!response.ok && (response.status === 401 || response.status === 403) && !isDirectService && model === 'flux') {
        const fallbackUrl = new URL(`https://image.pollinations.ai/prompt/${prompt}`);
        fallbackUrl.searchParams.set('model', model);
        fallbackUrl.searchParams.set('width', width.toString());
        fallbackUrl.searchParams.set('height', height.toString());
        fallbackUrl.searchParams.set('nologo', 'true');
        response = await fetch(fallbackUrl.toString(), {
          method: 'GET',
          signal: controller.signal,
        });
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError(`Pollinations request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(
        `Network error calling Pollinations: ${err instanceof Error ? err.message : String(err)}`,
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const status = response.status;
      const errorText = await response.text();
      if (status === 402 || (status === 403 && model !== 'flux')) {
        throw new ProviderError(
          `Pollinations model "${model}" requires an active Pollinations subscription/tier or credits. Use "flux" for the free unlimited tier.`,
          'auth',
          status
        );
      }
      if (status === 401 || status === 403) {
        throw new ProviderError(`Pollinations auth failure: ${errorText}`, 'auth', status);
      }
      if (status === 429) {
        throw new ProviderError(`Pollinations rate limit exceeded: ${errorText}`, 'rate_limit', 429);
      }
      if (status >= 500) {
        throw new ProviderError(`Pollinations server error: ${errorText}`, 'server_error', status);
      }
      throw new ProviderError(`Pollinations failed (${status}): ${errorText}`, 'invalid_output', status);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const rawBuffer = Buffer.from(arrayBuffer);

    if (rawBuffer.length < 500) {
      throw new ProviderError('Pollinations returned an empty or truncated image buffer.', 'invalid_output');
    }

    // Validate image integrity, check for blank renders / watermarks, cover-crop to 4:5 1080x1350
    const normalized = await validateAndNormalizeImage(rawBuffer, {
      targetWidth: width,
      targetHeight: height,
      rejectWatermarks: true,
    });

    return {
      imageBuffer: normalized.sanitizedBuffer,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      latencyMs,
      modelUsed: model,
      imageUrl: url.toString(),
    };
  }
}
