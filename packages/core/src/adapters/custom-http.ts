import {
  TextProviderAdapter,
  ImageProviderAdapter,
  TextGenerateOptions,
  TextGenerateResult,
  ImageGenerateOptions,
  ImageGenerateResult,
  ProviderError,
} from './types.js';
import { resolveJsonPath } from './jsonpath.js';
import { extractJsonFromText } from './json-extractor.js';
import { ssrfSafeFetch, SSRFError } from '../security/ssrf.js';

export interface CustomHttpConfig {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  textPath?: string;
  imageUrlPath?: string;
  base64Path?: string;
  rawBinary?: boolean;
  allowHttpForTesting?: boolean;
}

export class CustomHttpAdapter implements TextProviderAdapter, ImageProviderAdapter {
  public readonly id = 'custom_http';

  constructor(public readonly config: CustomHttpConfig) {}

  /**
   * Safely interpolates template variables into string without eval.
   * Handles JSON string escaping so newlines and quotes do not break JSON templates.
   */
  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
      const val = vars[key];
      if (val === undefined || val === null) return '';
      // Escape for JSON context if inside quotes, otherwise direct replacement
      return val
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    });
  }

  async generateText(options: TextGenerateOptions): Promise<TextGenerateResult> {
    const vars: Record<string, string> = {
      prompt: options.prompt || '',
      system: options.systemPrompt || '',
      model: options.model || '',
      key: options.apiKey || '',
      messages: JSON.stringify(options.messages || []),
    };

    const url = this.interpolate(this.config.url, vars);
    const headers: Record<string, string> = {};

    if (this.config.headers) {
      for (const [k, v] of Object.entries(this.config.headers)) {
        headers[k] = this.interpolate(v, vars);
      }
    }
    if (options.customHeaders) {
      Object.assign(headers, options.customHeaders);
    }

    const method = this.config.method || 'POST';
    let body: string | undefined;

    if (method !== 'GET' && this.config.bodyTemplate) {
      body = this.interpolate(this.config.bodyTemplate, vars);
    }

    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 45000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await ssrfSafeFetch(
        url,
        {
          method,
          headers,
          body,
          signal: controller.signal,
        },
        3,
        this.config.allowHttpForTesting
      );
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof SSRFError) {
        throw new ProviderError(`SSRF Violation: ${err.message}`, 'auth', 403);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError(`Custom HTTP request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(
        `Network error in Custom HTTP provider: ${err instanceof Error ? err.message : String(err)}`,
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new ProviderError(`Custom HTTP auth failure: ${errorText}`, 'auth', status);
      }
      if (status === 429) {
        throw new ProviderError(`Custom HTTP rate limit: ${errorText}`, 'rate_limit', 429);
      }
      if (status >= 500) {
        throw new ProviderError(`Custom HTTP server error: ${errorText}`, 'server_error', status);
      }
      throw new ProviderError(`Custom HTTP error (${status}): ${errorText}`, 'invalid_output', status);
    }

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch {
      throw new ProviderError('Failed to parse Custom HTTP response as JSON.', 'invalid_output', response.status);
    }

    const path = this.config.textPath || 'choices[0].message.content';
    const extractedText = resolveJsonPath(responseData, path);

    if (typeof extractedText !== 'string') {
      throw new ProviderError(
        `Custom HTTP response did not contain text at path '${path}'.`,
        'invalid_output',
        200,
        undefined,
        responseData
      );
    }

    let parsedJson: unknown | undefined;
    if (options.jsonMode) {
      parsedJson = extractJsonFromText(extractedText);
    }

    return {
      text: extractedText,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs,
      finishReason: 'stop',
      parsedJson,
      modelUsed: options.model,
      rawResponse: responseData,
    };
  }

  async generateImage(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
    const width = options.width || 1080;
    const height = options.height || 1350;
    const vars: Record<string, string> = {
      prompt: options.prompt || '',
      negativePrompt: options.negativePrompt || '',
      width: width.toString(),
      height: height.toString(),
      seed: options.seed !== undefined ? options.seed.toString() : '42',
      model: options.model || '',
      key: options.apiKey || '',
    };

    const url = this.interpolate(this.config.url, vars);
    const headers: Record<string, string> = {};

    if (this.config.headers) {
      for (const [k, v] of Object.entries(this.config.headers)) {
        headers[k] = this.interpolate(v, vars);
      }
    }

    const method = this.config.method || 'POST';
    let body: string | undefined;

    if (method !== 'GET' && this.config.bodyTemplate) {
      body = this.interpolate(this.config.bodyTemplate, vars);
    }

    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await ssrfSafeFetch(
        url,
        {
          method,
          headers,
          body,
          signal: controller.signal,
        },
        3,
        this.config.allowHttpForTesting
      );
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof SSRFError) {
        throw new ProviderError(`SSRF Violation: ${err.message}`, 'auth', 403);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError(`Custom HTTP image request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(
        `Network error in Custom HTTP provider: ${err instanceof Error ? err.message : String(err)}`,
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(`Custom HTTP image generation failed (${response.status}): ${errorText}`, 'invalid_output');
    }

    // 1. Raw binary image
    if (this.config.rawBinary) {
      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      return {
        imageBuffer,
        mimeType: 'image/png',
        width,
        height,
        latencyMs,
        modelUsed: options.model || 'custom_http_image',
      };
    }

    // 2. JSON response containing base64 or URL
    const json = (await response.json()) as any;

    if (this.config.base64Path) {
      const b64 = resolveJsonPath(json, this.config.base64Path);
      if (typeof b64 === 'string' && b64.length > 50) {
        return {
          imageBuffer: Buffer.from(b64, 'base64'),
          mimeType: 'image/png',
          width,
          height,
          latencyMs,
          modelUsed: options.model || 'custom_http_image',
        };
      }
    }

    if (this.config.imageUrlPath) {
      const imgUrl = resolveJsonPath(json, this.config.imageUrlPath);
      if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
        // Fetch image bytes safely through SSRF protection
        const imgRes = await ssrfSafeFetch(imgUrl, undefined, 3, this.config.allowHttpForTesting);
        if (!imgRes.ok) {
          throw new ProviderError(`Failed to download image from extracted URL (${imgRes.status})`, 'invalid_output');
        }
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        return {
          imageBuffer: imgBuffer,
          mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
          width,
          height,
          latencyMs,
          modelUsed: options.model || 'custom_http_image',
          imageUrl: imgUrl,
        };
      }
    }

    throw new ProviderError('Custom HTTP image response did not yield valid image data.', 'invalid_output');
  }
}

