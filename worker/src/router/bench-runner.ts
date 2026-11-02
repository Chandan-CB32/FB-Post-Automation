import crypto from 'node:crypto';
import { ProviderDefinition } from './provider-router.js';
import {
  OpenAIChatAdapter,
  GeminiNativeAdapter,
  CloudflareWorkersAIAdapter,
  PollinationsImageAdapter,
  CustomHttpAdapter,
  getNextAvailableKey,
} from '@fb-auto/core';

export interface BenchItemResult {
  providerId: string;
  providerName: string;
  model: string;
  success: boolean;
  textOutput?: string;
  imageBuffer?: Buffer;
  latencyMs: number;
  tokensUsed: number;
  error?: string;
}

export interface BenchRunResult {
  id: string;
  prompt: string;
  kind: 'text' | 'image';
  results: BenchItemResult[];
  suggestedOrder: string[]; // Provider IDs ordered by success, then latency
  timestamp: string;
}

export class QualityBenchRunner {
  private openaiAdapter = new OpenAIChatAdapter();
  private geminiAdapter = new GeminiNativeAdapter();
  private cloudflareAdapter = new CloudflareWorkersAIAdapter();
  private pollinationsAdapter = new PollinationsImageAdapter();

  /**
   * Executes a text prompt across multiple providers simultaneously to benchmark quality and latency.
   */
  async runTextBench(
    prompt: string,
    providers: ProviderDefinition[],
    options?: { systemPrompt?: string; maxTokens?: number; encryptionKey?: string }
  ): Promise<BenchRunResult> {
    const benchId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const tasks = providers.map(async (provider): Promise<BenchItemResult> => {
      const keyInfo = getNextAvailableKey(provider.keys, new Date(), options?.encryptionKey);
      if (!keyInfo) {
        return {
          providerId: provider.providerId,
          providerName: provider.name,
          model: provider.defaultModel || 'unknown',
          success: false,
          latencyMs: 0,
          tokensUsed: 0,
          error: 'No active keys available for provider.',
        };
      }

      const { decryptedKey } = keyInfo;
      const model = provider.defaultModel || 'default-model';
      const startTime = Date.now();

      try {
        let textOutput = '';
        let tokensUsed = 0;

        if (provider.kind === 'gemini_native') {
          const res = await this.geminiAdapter.generateText({
            prompt,
            systemPrompt: options?.systemPrompt,
            model,
            apiKey: decryptedKey,
            maxTokens: options?.maxTokens || 300,
          });
          textOutput = res.text;
          tokensUsed = res.tokens.totalTokens;
        } else if (provider.kind === 'cloudflare_workers_ai') {
          const res = await this.cloudflareAdapter.generateText({
            prompt,
            model,
            apiKey: decryptedKey,
            maxTokens: options?.maxTokens || 300,
            extraBody: provider.config as any,
          });
          textOutput = res.text;
          tokensUsed = res.tokens.totalTokens;
        } else if (provider.kind === 'custom_http') {
          const custom = new CustomHttpAdapter(provider.config as any);
          const res = await custom.generateText({
            prompt,
            systemPrompt: options?.systemPrompt,
            model,
            apiKey: decryptedKey,
            maxTokens: options?.maxTokens || 300,
          });
          textOutput = res.text;
        } else {
          // OpenAI-compatible / Groq / OpenRouter / HuggingFace
          const res = await this.openaiAdapter.generateText({
            prompt,
            systemPrompt: options?.systemPrompt,
            model,
            apiKey: decryptedKey,
            baseUrl: provider.baseUrl,
            maxTokens: options?.maxTokens || 300,
          });
          textOutput = res.text;
          tokensUsed = res.tokens.totalTokens;
        }

        const latencyMs = Date.now() - startTime;
        return {
          providerId: provider.providerId,
          providerName: provider.name,
          model,
          success: true,
          textOutput,
          latencyMs,
          tokensUsed,
        };
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        return {
          providerId: provider.providerId,
          providerName: provider.name,
          model,
          success: false,
          latencyMs,
          tokensUsed: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const results = await Promise.all(tasks);
    const suggestedOrder = this.calculateSuggestedOrder(results);

    return {
      id: benchId,
      prompt,
      kind: 'text',
      results,
      suggestedOrder,
      timestamp,
    };
  }

  /**
   * Executes an image prompt across multiple image providers to benchmark visual outputs and latency.
   */
  async runImageBench(
    prompt: string,
    providers: ProviderDefinition[],
    options?: { width?: number; height?: number; encryptionKey?: string }
  ): Promise<BenchRunResult> {
    const benchId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const tasks = providers.map(async (provider): Promise<BenchItemResult> => {
      const keyInfo = getNextAvailableKey(provider.keys, new Date(), options?.encryptionKey);
      const decryptedKey = keyInfo ? keyInfo.decryptedKey : '';
      const model = provider.defaultModel || 'flux';
      const startTime = Date.now();

      try {
        let imageBuffer: Buffer | undefined;

        if (provider.kind === 'cloudflare_workers_ai') {
          const res = await this.cloudflareAdapter.generateImage({
            prompt,
            model,
            apiKey: decryptedKey,
            width: options?.width || 1080,
            height: options?.height || 1350,
            ...(provider.config as any),
          });
          imageBuffer = res.imageBuffer;
        } else if (provider.kind === 'custom_http') {
          const custom = new CustomHttpAdapter(provider.config as any);
          const res = await custom.generateImage({
            prompt,
            model,
            apiKey: decryptedKey,
            width: options?.width || 1080,
            height: options?.height || 1350,
          });
          imageBuffer = res.imageBuffer;
        } else {
          // Pollinations
          const res = await this.pollinationsAdapter.generateImage({
            prompt,
            model,
            apiKey: decryptedKey,
            width: options?.width || 1080,
            height: options?.height || 1350,
          });
          imageBuffer = res.imageBuffer;
        }

        const latencyMs = Date.now() - startTime;
        return {
          providerId: provider.providerId,
          providerName: provider.name,
          model,
          success: true,
          imageBuffer,
          latencyMs,
          tokensUsed: 0,
        };
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        return {
          providerId: provider.providerId,
          providerName: provider.name,
          model,
          success: false,
          latencyMs,
          tokensUsed: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const results = await Promise.all(tasks);
    const suggestedOrder = this.calculateSuggestedOrder(results);

    return {
      id: benchId,
      prompt,
      kind: 'image',
      results,
      suggestedOrder,
      timestamp,
    };
  }

  /**
   * Sorts benchmarked providers to suggest optimal chain order:
   * Successful runs first, then sorted by fastest latency ascending.
   */
  private calculateSuggestedOrder(results: BenchItemResult[]): string[] {
    return [...results]
      .sort((a, b) => {
        if (a.success !== b.success) {
          return a.success ? -1 : 1; // Successful first
        }
        return a.latencyMs - b.latencyMs; // Fastest first
      })
      .map((r) => r.providerId);
  }
}
