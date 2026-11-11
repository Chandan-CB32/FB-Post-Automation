import {
  TextProviderAdapter,
  ImageProviderAdapter,
  TextGenerateOptions,
  TextGenerateResult,
  ImageGenerateOptions,
  ImageGenerateResult,
  ProviderError,
} from './types.js';
import { extractJsonFromText } from './json-extractor.js';

export interface CloudflareConfig {
  accountId?: string;
}

export class CloudflareWorkersAIAdapter implements TextProviderAdapter, ImageProviderAdapter {
  public readonly id = 'cloudflare_workers_ai';

  private resolveAccountId(options: TextGenerateOptions | ImageGenerateOptions): string {
    const fromExtra = (options as any)?.extraBody?.accountId || (options as any)?.accountId;
    if (fromExtra) return fromExtra;

    const fromConfig = (options as any)?.config?.account_id || (options as any)?.account_id;
    if (fromConfig) return fromConfig;

    if (process.env.CLOUDFLARE_ACCOUNT_ID) {
      return process.env.CLOUDFLARE_ACCOUNT_ID;
    }

    if (options.apiKey && options.apiKey.includes(':')) {
      const parts = options.apiKey.split(':');
      if (parts[0] && parts[0].length >= 10) {
        return parts[0].trim();
      }
    }

    // Attempt to extract from baseUrl if formatted like https://api.cloudflare.com/client/v4/accounts/{id}/ai/run
    if (options.baseUrl) {
      const match = options.baseUrl.match(/accounts\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
    }

    throw new ProviderError(
      'Cloudflare Account ID is required (set CLOUDFLARE_ACCOUNT_ID in environment, or use https://api.cloudflare.com/client/v4/accounts/{your-account-id} in Base URL).',
      'auth'
    );
  }

  async generateText(options: TextGenerateOptions): Promise<TextGenerateResult> {
    const accountId = this.resolveAccountId(options);
    const model = options.model || '@cf/meta/llama-3.1-8b-instruct';
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

    const promptText =
      options.prompt ||
      options.messages?.map((m) => `${m.role}: ${m.content}`).join('\n') ||
      '';

    const body: Record<string, unknown> = {
      prompt: promptText,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const startTime = Date.now();
    const response = await this.executeFetch(endpoint, options.apiKey, body, options.timeoutMs);
    const latencyMs = Date.now() - startTime;

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError('Failed to parse Cloudflare text response as JSON.', 'invalid_output', response.status);
    }

    const text = data?.result?.response || '';
    let parsedJson: unknown | undefined;
    if (options.jsonMode) {
      parsedJson = extractJsonFromText(text);
    }

    return {
      text,
      tokens: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0, // Cloudflare tracks neurons, not standard token counters
      },
      latencyMs,
      finishReason: 'stop',
      parsedJson,
      modelUsed: model,
      rawResponse: data,
    };
  }

  async generateImage(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
    const accountId = this.resolveAccountId(options);
    const model = options.model || '@cf/black-forest-labs/flux-1-schnell';
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

    const body: Record<string, unknown> = {
      prompt: options.prompt,
      steps: 4, // Recommended standard steps for schnell
    };

    const startTime = Date.now();
    const apiKey = options.apiKey || process.env.CLOUDFLARE_API_TOKEN || '';
    const response = await this.executeFetch(endpoint, apiKey, body, options.timeoutMs);
    const latencyMs = Date.now() - startTime;

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    if (imageBuffer.length < 100) {
      throw new ProviderError('Cloudflare returned an empty or truncated image buffer.', 'invalid_output');
    }

    return {
      imageBuffer,
      mimeType: contentType.includes('jpeg') ? 'image/jpeg' : 'image/png',
      width: options.width || 1080,
      height: options.height || 1350,
      latencyMs,
      modelUsed: model,
    };
  }

  private async executeFetch(
    endpoint: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs = 60000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const bearerToken = apiKey && apiKey.includes(':') && apiKey.split(':')[0].length >= 10
      ? apiKey.split(':')[1].trim()
      : apiKey;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError(`Cloudflare request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(
        `Network error calling Cloudflare Workers AI: ${err instanceof Error ? err.message : String(err)}`,
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const status = response.status;
      const errorText = await response.text();
      if (status === 401 || status === 403) {
        throw new ProviderError(`Cloudflare auth failure: ${errorText}`, 'auth', status);
      }
      if (status === 429) {
        throw new ProviderError(`Cloudflare neuron quota or rate limit exceeded: ${errorText}`, 'rate_limit', 429);
      }
      if (status >= 500) {
        throw new ProviderError(`Cloudflare server error: ${errorText}`, 'server_error', status);
      }
      throw new ProviderError(`Cloudflare error (${status}): ${errorText}`, 'invalid_output', status);
    }

    return response;
  }
}

