import {
  ImageProviderAdapter,
  ImageGenerateOptions,
  ImageGenerateResult,
  ProviderError,
} from './types.js';
import { validateAndNormalizeImage } from '../validation/image-validator.js';

export interface OpenAICompatibleImageConfig {
  baseUrl?: string;
  defaultModel?: string;
  endpointType?: 'standard_images' | 'openrouter_chat_modalities' | 'nvidia_nim' | 'alibaba_dashscope_async';
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Universal Image Adapter supporting:
 * 1. Standard OpenAI Image API (Vercel AI Gateway, ZenMux, DALL-E)
 * 2. OpenRouter Chat Multimodal Image Generation (sourceful/riverflow-v2.5-fast:free)
 * 3. NVIDIA NIM Generative AI Endpoints (SD 3.5 Large, Qwen-Image)
 * 4. Alibaba Cloud Model Studio DashScope Async Image Synthesis (Wanx, Qwen-Image)
 */
export class OpenAICompatibleImageAdapter implements ImageProviderAdapter {
  public readonly id = 'openai_compatible_images';

  constructor(private readonly defaultConfig?: OpenAICompatibleImageConfig) {}

  async generateImage(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
    const baseUrl = (options.baseUrl || this.defaultConfig?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiKey = options.apiKey || '';
    const model = options.model || this.defaultConfig?.defaultModel || 'bfl/flux-2-klein-4b';
    const timeoutMs = options.timeoutMs || this.defaultConfig?.timeoutMs || 60000;

    // Detect endpoint style from model or baseUrl
    const endpointType = this.detectEndpointType(baseUrl, model, this.defaultConfig?.endpointType);

    const startTime = Date.now();

    if (endpointType === 'alibaba_dashscope_async') {
      return this.executeAlibabaDashScopeAsync(baseUrl, apiKey, model, options, startTime);
    }

    if (endpointType === 'openrouter_chat_modalities') {
      return this.executeOpenRouterModalities(baseUrl, apiKey, model, options, startTime, timeoutMs);
    }

    if (endpointType === 'nvidia_nim') {
      return this.executeNvidiaNim(baseUrl, apiKey, model, options, startTime, timeoutMs);
    }

    // Default: Standard OpenAI-compatible image endpoint (POST /images/generations or /v1/images/generations)
    return this.executeStandardOpenAiImages(baseUrl, apiKey, model, options, startTime, timeoutMs);
  }

  private detectEndpointType(
    baseUrl: string,
    model: string,
    explicit?: string
  ): 'standard_images' | 'openrouter_chat_modalities' | 'nvidia_nim' | 'alibaba_dashscope_async' {
    if (explicit) return explicit;
    const lowerUrl = baseUrl.toLowerCase();
    const lowerModel = model.toLowerCase();

    if (lowerUrl.includes('dashscope') || lowerUrl.includes('aliyuncs') || lowerModel.includes('wanx') || lowerModel.includes('qwen-image')) {
      return 'alibaba_dashscope_async';
    }
    if (lowerUrl.includes('openrouter') || lowerModel.includes('riverflow') || lowerModel.includes(':free')) {
      return 'openrouter_chat_modalities';
    }
    if (lowerUrl.includes('nvidia') || lowerModel.includes('stabilityai') || lowerModel.includes('stable-diffusion')) {
      return 'nvidia_nim';
    }
    return 'standard_images';
  }

  /**
   * 1. Standard OpenAI Images API (Vercel AI Gateway, ZenMux, OpenAI)
   */
  private async executeStandardOpenAiImages(
    baseUrl: string,
    apiKey: string,
    model: string,
    options: ImageGenerateOptions,
    startTime: number,
    timeoutMs: number
  ): Promise<ImageGenerateResult> {
    const endpoint = baseUrl.endsWith('/images/generations')
      ? baseUrl
      : `${baseUrl}/images/generations`;

    const requestBody: Record<string, any> = {
      model,
      prompt: options.prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    };

    if (options.negativePrompt) {
      requestBody.negative_prompt = options.negativePrompt;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.defaultConfig?.customHeaders || {}),
      ...(options.customHeaders || {}),
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        throw new ProviderError(`OpenAI image provider timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(`Network error calling image API: ${err.message}`, 'network_error');
    }

    if (!response.ok) {
      await this.handleHttpError(response, 'OpenAI-Compatible');
    }

    const data: any = await response.json();
    let rawBuffer: Buffer | null = null;

    if (data.data && data.data[0]) {
      if (data.data[0].b64_json) {
        rawBuffer = Buffer.from(data.data[0].b64_json, 'base64');
      } else if (data.data[0].url) {
        rawBuffer = await this.downloadImageBuffer(data.data[0].url, timeoutMs);
      }
    }

    if (!rawBuffer) {
      throw new ProviderError('Provider returned no image data in expected format.', 'invalid_output');
    }

    const validated = await validateAndNormalizeImage(rawBuffer, {
      targetWidth: options.width || 1080,
      targetHeight: options.height || 1350,
      rejectWatermarks: true,
    });

    return {
      imageBuffer: validated.sanitizedBuffer,
      mimeType: validated.mimeType,
      width: validated.width,
      height: validated.height,
      latencyMs: Date.now() - startTime,
      modelUsed: model,
      rawResponse: data,
    };
  }

  /**
   * 2. OpenRouter Multimodal Chat Completions Image Output
   * Uses Chat API with `modalities: ["image", "text"]` to generate images from models like sourceful/riverflow-v2.5-fast:free.
   */
  private async executeOpenRouterModalities(
    baseUrl: string,
    apiKey: string,
    model: string,
    options: ImageGenerateOptions,
    startTime: number,
    timeoutMs: number
  ): Promise<ImageGenerateResult> {
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

    const requestBody = {
      model,
      messages: [{ role: 'user', content: options.prompt }],
      modalities: ['image', 'text'],
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'HTTP-Referer': 'https://fbauto247.vercel.app',
      'X-Title': 'FB Auto 247 Autonomous System',
      ...(this.defaultConfig?.customHeaders || {}),
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        throw new ProviderError(`OpenRouter request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(`Network error calling OpenRouter: ${err.message}`, 'network_error');
    }

    if (!response.ok) {
      await this.handleHttpError(response, 'OpenRouter');
    }

    const data: any = await response.json();
    const message = data.choices?.[0]?.message;
    let rawBuffer: Buffer | null = null;

    // Check for message.images array (OpenRouter multimodal standard)
    if (message?.images && Array.isArray(message.images) && message.images[0]) {
      const imgItem = message.images[0];
      if (typeof imgItem === 'string' && imgItem.startsWith('data:')) {
        const b64 = imgItem.split(',')[1];
        rawBuffer = Buffer.from(b64, 'base64');
      } else if (typeof imgItem === 'string' && imgItem.startsWith('http')) {
        rawBuffer = await this.downloadImageBuffer(imgItem, timeoutMs);
      } else if (imgItem.image_url?.url) {
        const u = imgItem.image_url.url;
        rawBuffer = u.startsWith('data:')
          ? Buffer.from(u.split(',')[1], 'base64')
          : await this.downloadImageBuffer(u, timeoutMs);
      }
    }

    // Fallback: Check if message text contains markdown image `![...](url)`
    if (!rawBuffer && message?.content) {
      const match = message.content.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
      if (match && match[1]) {
        rawBuffer = await this.downloadImageBuffer(match[1], timeoutMs);
      }
    }

    if (!rawBuffer) {
      throw new ProviderError(
        'OpenRouter did not return an image payload in the response.',
        'invalid_output'
      );
    }

    const validated = await validateAndNormalizeImage(rawBuffer, {
      targetWidth: options.width || 1080,
      targetHeight: options.height || 1350,
      rejectWatermarks: true,
    });

    return {
      imageBuffer: validated.sanitizedBuffer,
      mimeType: validated.mimeType,
      width: validated.width,
      height: validated.height,
      latencyMs: Date.now() - startTime,
      modelUsed: model,
      rawResponse: data,
    };
  }

  /**
   * 3. NVIDIA NIM Image Endpoint (SD 3.5 Large / Qwen-Image)
   */
  private async executeNvidiaNim(
    baseUrl: string,
    apiKey: string,
    model: string,
    options: ImageGenerateOptions,
    startTime: number,
    timeoutMs: number
  ): Promise<ImageGenerateResult> {
    // NVIDIA NIM hosted endpoint path
    const modelSegment = model.startsWith('stabilityai/')
      ? model
      : `stabilityai/${model}`;
    const endpoint = `${baseUrl}/genai/${modelSegment}`;

    const requestBody = {
      prompt: options.prompt,
      mode: 'base',
      width: 1024,
      height: 1024,
      steps: 30,
      seed: 0,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(this.defaultConfig?.customHeaders || {}),
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        throw new ProviderError(`NVIDIA NIM timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(`Network error calling NVIDIA NIM: ${err.message}`, 'network_error');
    }

    if (!response.ok) {
      await this.handleHttpError(response, 'NVIDIA NIM');
    }

    const data: any = await response.json();
    let rawBuffer: Buffer | null = null;

    if (data.artifacts && data.artifacts[0]?.base64) {
      rawBuffer = Buffer.from(data.artifacts[0].base64, 'base64');
    } else if (data.data && data.data[0]?.b64_json) {
      rawBuffer = Buffer.from(data.data[0].b64_json, 'base64');
    }

    if (!rawBuffer) {
      throw new ProviderError('NVIDIA NIM returned no valid image artifact.', 'invalid_output');
    }

    const validated = await validateAndNormalizeImage(rawBuffer, {
      targetWidth: options.width || 1080,
      targetHeight: options.height || 1350,
      rejectWatermarks: true,
    });

    return {
      imageBuffer: validated.sanitizedBuffer,
      mimeType: validated.mimeType,
      width: validated.width,
      height: validated.height,
      latencyMs: Date.now() - startTime,
      modelUsed: model,
      rawResponse: data,
    };
  }

  /**
   * 4. Alibaba Cloud Model Studio (DashScope) Async Task Flow
   * Submits async synthesis request and polls until completed.
   */
  private async executeAlibabaDashScopeAsync(
    baseUrl: string,
    apiKey: string,
    model: string,
    options: ImageGenerateOptions,
    startTime: number
  ): Promise<ImageGenerateResult> {
    const submitEndpoint = `${baseUrl}/services/aigc/text2image/image-synthesis`;
    const submitBody = {
      model: model || 'wanx2.1-t2i-turbo',
      input: { prompt: options.prompt },
      parameters: { size: '1024*1024', n: 1 },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(this.defaultConfig?.customHeaders || {}),
    };

    let submitRes: Response;
    try {
      submitRes = await fetch(submitEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(submitBody),
        signal: AbortSignal.timeout(30000),
      });
    } catch (err: any) {
      throw new ProviderError(`Alibaba Model Studio submit failed: ${err.message}`, 'network_error');
    }

    if (!submitRes.ok) {
      await this.handleHttpError(submitRes, 'Alibaba Model Studio');
    }

    const submitData: any = await submitRes.json();
    const taskId = submitData.output?.task_id;
    if (!taskId) {
      throw new ProviderError('Alibaba Model Studio did not return a valid task_id.', 'invalid_output');
    }

    // Poll for completion (up to 120s per requirement D2)
    const pollEndpoint = `${baseUrl}/tasks/${taskId}`;
    const pollMaxSeconds = 120;
    const pollIntervalMs = 2500;
    const deadline = Date.now() + pollMaxSeconds * 1000;

    let imageUrl: string | null = null;
    let pollData: any = null;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      try {
        const pollRes = await fetch(pollEndpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!pollRes.ok) {
          continue;
        }

        pollData = await pollRes.json();
        const status = pollData.output?.task_status;

        if (status === 'SUCCEEDED') {
          imageUrl = pollData.output?.results?.[0]?.url;
          break;
        } else if (status === 'FAILED') {
          throw new ProviderError(
            `Alibaba Model Studio synthesis task failed: ${pollData.output?.message || 'Task error'}`,
            'server_error'
          );
        }
      } catch (err: any) {
        if (err instanceof ProviderError) throw err;
        // Continue polling on transient polling error
      }
    }

    if (!imageUrl) {
      throw new ProviderError(
        `Alibaba Model Studio synthesis task timed out after ${pollMaxSeconds}s polling.`,
        'timeout',
        504
      );
    }

    const rawBuffer = await this.downloadImageBuffer(imageUrl, 30000);
    const validated = await validateAndNormalizeImage(rawBuffer, {
      targetWidth: options.width || 1080,
      targetHeight: options.height || 1350,
      rejectWatermarks: true,
    });

    return {
      imageBuffer: validated.sanitizedBuffer,
      mimeType: validated.mimeType,
      width: validated.width,
      height: validated.height,
      latencyMs: Date.now() - startTime,
      modelUsed: model,
      rawResponse: pollData,
    };
  }

  private async downloadImageBuffer(url: string, timeoutMs: number): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      throw new ProviderError(`Failed to download image from ${url} (HTTP ${res.status})`, 'network_error');
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  private async handleHttpError(response: Response, providerName: string): Promise<never> {
    const status = response.status;
    let errorText = '';
    let parsed: any = null;

    try {
      errorText = await response.text();
      parsed = JSON.parse(errorText);
    } catch {
      // Raw string
    }

    const msg = parsed?.error?.message || parsed?.message || errorText || `HTTP ${status}`;

    if (status === 401 || status === 403) {
      throw new ProviderError(`${providerName} authentication error: ${msg}`, 'auth', status);
    }
    if (status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitSec = retryAfter ? parseInt(retryAfter, 10) : undefined;
      throw new ProviderError(
        `${providerName} rate limit or quota exceeded: ${msg}`,
        'rate_limit',
        429,
        waitSec
      );
    }
    if (status >= 500) {
      throw new ProviderError(`${providerName} server error (${status}): ${msg}`, 'server_error', status);
    }
    if (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('content policy')) {
      throw new ProviderError(`${providerName} content policy refusal: ${msg}`, 'content_policy', 400);
    }

    throw new ProviderError(`${providerName} error (${status}): ${msg}`, 'invalid_output', status);
  }
}

