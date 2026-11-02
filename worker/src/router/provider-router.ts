import {
  TextProviderAdapter,
  ImageProviderAdapter,
  TextGenerateOptions,
  TextGenerateResult,
  ImageGenerateOptions,
  ImageGenerateResult,
  ProviderError,
  ProviderAdapterKind,
  PipelineStage,
  ChainStrategy,
  OpenAIChatAdapter,
  GeminiNativeAdapter,
  CloudflareWorkersAIAdapter,
  PollinationsImageAdapter,
  CustomHttpAdapter,
  KeyPoolItem,
  getNextAvailableKey,
  recordKeySuccess,
  recordKeyFailure,
} from '@fb-auto/core';
import {
  ProviderCandidateMeta,
  orderCandidatesByStrategy,
} from './strategies.js';

export interface ProviderDefinition extends ProviderCandidateMeta {
  kind: ProviderAdapterKind;
  baseUrl?: string;
  config?: Record<string, unknown>;
  rpmLimit: number;
  rpdLimit: number;
  active: boolean;
  keys: KeyPoolItem[];
  defaultModel?: string;
}

export interface ChainDefinition {
  stage: PipelineStage;
  strategy: ChainStrategy;
  providerIds: string[];
}

export class ProviderRouterError extends Error {
  constructor(
    message: string,
    public readonly attempts: Array<{ provider: string; error: string; kind: string }>
  ) {
    super(message);
    this.name = 'ProviderRouterError';
  }
}

export class ProviderRouter {
  private providers = new Map<string, ProviderDefinition>();
  private chains = new Map<PipelineStage, ChainDefinition>();
  private defaultTextAdapter: TextProviderAdapter = new OpenAIChatAdapter();
  private geminiAdapter: TextProviderAdapter = new GeminiNativeAdapter();
  private cloudflareAdapter = new CloudflareWorkersAIAdapter();
  private pollinationsAdapter: ImageProviderAdapter = new PollinationsImageAdapter();

  registerProvider(provider: ProviderDefinition): void {
    this.providers.set(provider.providerId, provider);
  }

  getProvider(providerId: string): ProviderDefinition | undefined {
    return this.providers.get(providerId);
  }

  setChain(stage: PipelineStage, chain: ChainDefinition): void {
    this.chains.set(stage, chain);
  }

  getChain(stage: PipelineStage): ChainDefinition | undefined {
    return this.chains.get(stage);
  }

  /**
   * Resolves the appropriate adapter instance for a given provider kind.
   */
  private resolveTextAdapter(provider: ProviderDefinition): TextProviderAdapter {
    switch (provider.kind) {
      case 'gemini_native':
        return this.geminiAdapter;
      case 'cloudflare_workers_ai':
        return this.cloudflareAdapter;
      case 'custom_http':
        return new CustomHttpAdapter(provider.config as any);
      case 'openai_compatible_chat':
      case 'huggingface_inference':
      default:
        return this.defaultTextAdapter;
    }
  }

  private resolveImageAdapter(provider: ProviderDefinition): ImageProviderAdapter {
    switch (provider.kind) {
      case 'cloudflare_workers_ai':
        return this.cloudflareAdapter;
      case 'pollinations':
        return this.pollinationsAdapter;
      case 'custom_http':
        return new CustomHttpAdapter(provider.config as any);
      default:
        return this.pollinationsAdapter;
    }
  }

  /**
   * Executes a text generation stage across the configured provider chain with automatic failover.
   */
  async executeText(
    stage: PipelineStage,
    options: Omit<TextGenerateOptions, 'apiKey' | 'baseUrl' | 'model'> & {
      model?: string;
      encryptionKey?: string;
    }
  ): Promise<TextGenerateResult & { providerId: string; providerName: string; keyMasked: string }> {
    const chain = this.chains.get(stage);
    let candidateProviders: ProviderDefinition[] = [];

    if (chain && chain.providerIds.length > 0) {
      for (const id of chain.providerIds) {
        const prov = this.providers.get(id);
        if (prov && prov.active) {
          candidateProviders.push(prov);
        }
      }
    } else {
      // Fallback: all active text-capable providers
      candidateProviders = Array.from(this.providers.values()).filter(
        (p) => p.active && p.kind !== 'pollinations' && p.kind !== 'openai_compatible_images'
      );
    }

    const strategy = chain?.strategy || 'priority';
    const ordered = orderCandidatesByStrategy(candidateProviders, strategy);

    if (ordered.length === 0) {
      throw new ProviderRouterError(`No available or eligible providers in chain for stage '${stage}'.`, []);
    }

    const attempts: Array<{ provider: string; error: string; kind: string }> = [];

    for (const provider of ordered) {
      const keyInfo = getNextAvailableKey(provider.keys, new Date(), options.encryptionKey);
      if (!keyInfo) {
        attempts.push({
          provider: provider.name,
          error: 'No active or cooling-expired keys available in pool.',
          kind: 'auth',
        });
        continue;
      }

      const { item: keyItem, decryptedKey } = keyInfo;
      const adapter = this.resolveTextAdapter(provider);
      const model = options.model || provider.defaultModel || 'default-model';

      try {
        const result = await adapter.generateText({
          ...options,
          model,
          apiKey: decryptedKey,
          baseUrl: provider.baseUrl,
          customHeaders: (provider.config?.customHeaders as Record<string, string>) || undefined,
          extraBody: (provider.config?.extraBody as Record<string, unknown>) || undefined,
        });

        // Success: record usage
        recordKeySuccess(keyItem);
        provider.requestsToday += 1;

        return {
          ...result,
          providerId: provider.providerId,
          providerName: provider.name,
          keyMasked: keyItem.keyMasked,
        };
      } catch (err: unknown) {
        const errorKind = err instanceof ProviderError ? err.kind : 'network_error';
        const errorMsg = err instanceof Error ? err.message : String(err);
        const retryAfter = err instanceof ProviderError ? err.retryAfterSeconds : undefined;

        // Record key failure & backoff
        recordKeyFailure(keyItem, errorKind, retryAfter);

        attempts.push({
          provider: provider.name,
          error: errorMsg,
          kind: errorKind,
        });

        // Failover: loop proceeds to next candidate
      }
    }

    throw new ProviderRouterError(
      `All providers in chain for stage '${stage}' failed. Attempts: ${attempts.length}`,
      attempts
    );
  }

  /**
   * Executes an image generation stage across the configured provider chain with automatic failover.
   */
  async executeImage(
    stage: PipelineStage,
    options: Omit<ImageGenerateOptions, 'apiKey' | 'baseUrl'> & {
      encryptionKey?: string;
    }
  ): Promise<ImageGenerateResult & { providerId: string; providerName: string; keyMasked?: string }> {
    const chain = this.chains.get(stage);
    let candidateProviders: ProviderDefinition[] = [];

    if (chain && chain.providerIds.length > 0) {
      for (const id of chain.providerIds) {
        const prov = this.providers.get(id);
        if (prov && prov.active) {
          candidateProviders.push(prov);
        }
      }
    } else {
      // Fallback: image-capable providers
      candidateProviders = Array.from(this.providers.values()).filter(
        (p) =>
          p.active &&
          (p.kind === 'pollinations' ||
            p.kind === 'cloudflare_workers_ai' ||
            p.kind === 'custom_http' ||
            p.kind === 'openai_compatible_images')
      );
    }

    const strategy = chain?.strategy || 'priority';
    const ordered = orderCandidatesByStrategy(candidateProviders, strategy);

    if (ordered.length === 0) {
      throw new ProviderRouterError(`No available image providers in chain for stage '${stage}'.`, []);
    }

    const attempts: Array<{ provider: string; error: string; kind: string }> = [];

    for (const provider of ordered) {
      const keyInfo = getNextAvailableKey(provider.keys, new Date(), options.encryptionKey);
      const decryptedKey = keyInfo ? keyInfo.decryptedKey : undefined;
      const keyItem = keyInfo ? keyInfo.item : undefined;

      const adapter = this.resolveImageAdapter(provider);
      const model = options.model || provider.defaultModel || 'flux';

      try {
        const result = await adapter.generateImage({
          ...options,
          model,
          apiKey: decryptedKey,
          baseUrl: provider.baseUrl,
          customHeaders: (provider.config?.customHeaders as Record<string, string>) || undefined,
          ...(provider.config as any),
        });

        if (keyItem) {
          recordKeySuccess(keyItem);
        }
        provider.requestsToday += 1;

        return {
          ...result,
          providerId: provider.providerId,
          providerName: provider.name,
          keyMasked: keyItem?.keyMasked,
        };
      } catch (err: unknown) {
        const errorKind = err instanceof ProviderError ? err.kind : 'network_error';
        const errorMsg = err instanceof Error ? err.message : String(err);
        const retryAfter = err instanceof ProviderError ? err.retryAfterSeconds : undefined;

        if (keyItem) {
          recordKeyFailure(keyItem, errorKind, retryAfter);
        }

        attempts.push({
          provider: provider.name,
          error: errorMsg,
          kind: errorKind,
        });
      }
    }

    throw new ProviderRouterError(
      `All image providers in chain for stage '${stage}' failed. Attempts: ${attempts.length}`,
      attempts
    );
  }
}
