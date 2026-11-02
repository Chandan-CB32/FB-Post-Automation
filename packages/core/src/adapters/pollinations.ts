import {
  ImageProviderAdapter,
  ImageGenerateOptions,
  ImageGenerateResult,
  ProviderError,
} from './types.js';

export class PollinationsImageAdapter implements ImageProviderAdapter {
  public readonly id = 'pollinations';

  async generateImage(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
    const prompt = encodeURIComponent(options.prompt);
    const baseUrl = (options.baseUrl || 'https://gen.pollinations.ai').replace(/\/+$/, '');

    const width = options.width || 1080;
    const height = options.height || 1350;
    const model = options.model || 'flux';

    const url = new URL(`${baseUrl}/image/${prompt}`);
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
    if (options.apiKey) {
      headers['Authorization'] = `Bearer ${options.apiKey}`;
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
    const imageBuffer = Buffer.from(arrayBuffer);

    if (imageBuffer.length < 500) {
      throw new ProviderError('Pollinations returned an empty or truncated image buffer.', 'invalid_output');
    }

    return {
      imageBuffer,
      mimeType: contentType.includes('png') ? 'image/png' : 'image/jpeg',
      width,
      height,
      latencyMs,
      modelUsed: model,
      imageUrl: url.toString(),
    };
  }
}

