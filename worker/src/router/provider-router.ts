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
  OpenAICompatibleImageAdapter,
  validateAndNormalizeImage,
  globalBudgetTracker,
  KNOWN_IMAGE_MODEL_LICENSES,
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
  priority?: number;
  health_status?: string;
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
  private geminiAdapter: GeminiNativeAdapter = new GeminiNativeAdapter();
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
      case 'gemini_native':
        return this.geminiAdapter;
      case 'cloudflare_workers_ai':
        return this.cloudflareAdapter;
      case 'pollinations':
        return this.pollinationsAdapter;
      case 'openai_compatible_images':
        return new OpenAICompatibleImageAdapter(provider.config as any);
      case 'custom_http':
        return new CustomHttpAdapter(provider.config as any);
      default:
        if (provider.name.toLowerCase().includes('gemini')) {
          return this.geminiAdapter;
        }
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
   * Executes an image generation stage across the configured provider chain with strict priority failover.
   */
  async executeImage(
    stage: PipelineStage,
    options: Omit<ImageGenerateOptions, 'apiKey' | 'baseUrl'> & {
      encryptionKey?: string;
      pageOverrides?: {
        image_chain_override?: string[];
        isMonetized?: boolean;
      };
    }
  ): Promise<
    ImageGenerateResult & {
      providerId: string;
      providerName: string;
      keyMasked?: string;
      auditTrail: Array<{
        provider: string;
        model: string;
        status: 'success' | 'skipped' | 'failed';
        error?: string;
        skippedReason?: string;
        latencyMs?: number;
      }>;
      estimatedCostUsd: number;
    }
  > {
    const chain = this.chains.get(stage);
    let candidateProviders: ProviderDefinition[] = [];

    // Support per-Page image chain override
    const pageOverrideIds = options.pageOverrides?.image_chain_override;
    if (pageOverrideIds && Array.isArray(pageOverrideIds) && pageOverrideIds.length > 0) {
      for (const id of pageOverrideIds) {
        const prov = this.providers.get(id);
        if (prov) candidateProviders.push(prov);
      }
    } else if (chain && chain.providerIds.length > 0) {
      for (const id of chain.providerIds) {
        const prov = this.providers.get(id);
        if (prov) candidateProviders.push(prov);
      }
    } else {
      // Fallback: image-capable providers ordered strictly by priority
      candidateProviders = Array.from(this.providers.values())
        .filter(
          (p) =>
            p.kind === 'pollinations' ||
            p.kind === 'cloudflare_workers_ai' ||
            p.kind === 'gemini_native' ||
            p.kind === 'custom_http' ||
            p.kind === 'openai_compatible_images'
        )
        .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
    }

    if (candidateProviders.length === 0) {
      throw new ProviderRouterError(`failed: no image - No image providers configured for stage '${stage}'.`, []);
    }

    const auditTrail: Array<{
      provider: string;
      model: string;
      status: 'success' | 'skipped' | 'failed';
      error?: string;
      skippedReason?: string;
      latencyMs?: number;
    }> = [];
    const attempts: Array<{ provider: string; error: string; kind: string }> = [];

    for (const provider of candidateProviders) {
      const model = options.model || provider.defaultModel || 'flux';

      // 1. Check if provider explicitly marked as needs_key or missing active key
      const isPollinations = provider.kind === 'pollinations';
      const hasKeysInPool = Array.isArray(provider.keys) && provider.keys.length > 0;
      const isNeedsKeyStatus = (provider as any).status === 'needs_key' || (provider as any).health_status === 'needs_key';

      if ((isNeedsKeyStatus || (!hasKeysInPool && !isPollinations)) && !isPollinations) {
        auditTrail.push({
          provider: provider.name,
          model,
          status: 'skipped',
          skippedReason: 'Needs API Key (Missing key, skipped silently)',
        });
        continue;
      }

      // 2. Check if provider is disabled
      if (!provider.active) {
        auditTrail.push({
          provider: provider.name,
          model,
          status: 'skipped',
          skippedReason: 'Provider is disabled',
        });
        continue;
      }

      // 3. License compliance check
      if (options.pageOverrides?.isMonetized) {
        const licenseCheck = globalBudgetTracker.checkLicenseCompliance(model, true);
        if (!licenseCheck.compliant) {
          auditTrail.push({
            provider: provider.name,
            model,
            status: 'skipped',
            skippedReason: `License non-compliant for monetized page: ${licenseCheck.warning}`,
          });
          continue;
        }
      }

      // 4. Budget & Quota checks
      const provLower = provider.name.toLowerCase();
      const kindLower = provider.kind.toLowerCase();

      if (kindLower === 'cloudflare_workers_ai' || provLower.includes('cloudflare')) {
        const cfCheck = globalBudgetTracker.canUseCloudflareModel(model);
        if (!cfCheck.allowed) {
          auditTrail.push({
            provider: provider.name,
            model,
            status: 'skipped',
            skippedReason: cfCheck.reason,
          });
          continue;
        }
      } else if (provLower.includes('vercel') || model.includes('flux-2-klein-4b')) {
        const vercelCheck = globalBudgetTracker.canUseVercel();
        if (!vercelCheck.allowed) {
          auditTrail.push({
            provider: provider.name,
            model,
            status: 'skipped',
            skippedReason: vercelCheck.reason,
          });
          continue;
        }
      } else if (provLower.includes('alibaba') || model.includes('wanx') || kindLower.includes('dashscope')) {
        const aliCheck = globalBudgetTracker.canUseAlibaba();
        if (!aliCheck.allowed) {
          auditTrail.push({
            provider: provider.name,
            model,
            status: 'skipped',
            skippedReason: aliCheck.reason,
          });
          continue;
        }
      } else if (provLower.includes('openrouter') || model.includes('riverflow')) {
        const orCheck = globalBudgetTracker.canUseOpenRouter();
        if (!orCheck.allowed) {
          auditTrail.push({
            provider: provider.name,
            model,
            status: 'skipped',
            skippedReason: orCheck.reason,
          });
          continue;
        }
      }

      // 5. Key retrieval & cooldown check
      const keyInfo = getNextAvailableKey(provider.keys, new Date(), options.encryptionKey);
      if (!keyInfo && !isPollinations) {
        auditTrail.push({
          provider: provider.name,
          model,
          status: 'skipped',
          skippedReason: 'All keys in cooldown or exhausted',
        });
        continue;
      }

      const decryptedKey = keyInfo ? keyInfo.decryptedKey : undefined;
      const keyItem = keyInfo ? keyInfo.item : undefined;
      const adapter = this.resolveImageAdapter(provider);

      // Determine timeout: Alibaba async tasks allow up to 120s; others 60s
      const isAlibabaAsync = provLower.includes('alibaba') || model.includes('wanx');
      const timeoutMs = options.timeoutMs || (isAlibabaAsync ? 120000 : 60000);

      // Generation attempt with transient network retry (at most 1) & policy rewrite (at most 1)
      let candidateSuccess = false;
      let lastCandidateError: any = null;
      let activePrompt = options.prompt;
      let hasRewrittenPolicy = false;
      let attemptsCount = 0;
      const startCandidateTime = Date.now();

      while (attemptsCount < 2 && !candidateSuccess) {
        attemptsCount++;
        try {
          const result = await adapter.generateImage({
            ...options,
            prompt: activePrompt,
            model,
            apiKey: decryptedKey,
            baseUrl: provider.baseUrl,
            timeoutMs,
            customHeaders: (provider.config?.customHeaders as Record<string, string>) || undefined,
            ...(provider.config as any),
          });

          // Validate buffer via Sharp
          const normalized = await validateAndNormalizeImage(result.imageBuffer, {
            targetWidth: options.width || 1080,
            targetHeight: options.height || 1350,
            rejectWatermarks: true,
          });

          // Success! Record usage
          if (keyItem) {
            recordKeySuccess(keyItem);
          }
          provider.requestsToday += 1;

          // Track usage in budget tracker
          if (provLower.includes('vercel') || model.includes('flux-2-klein-4b')) {
            globalBudgetTracker.recordVercelUsage(0.003);
          } else if (provLower.includes('alibaba') || model.includes('wanx')) {
            globalBudgetTracker.recordAlibabaUsage();
          } else if (provLower.includes('openrouter') || model.includes('riverflow')) {
            globalBudgetTracker.recordOpenRouterUsage();
          }

          const durationMs = Date.now() - startCandidateTime;
          auditTrail.push({
            provider: provider.name,
            model,
            status: 'success',
            latencyMs: durationMs,
          });

          candidateSuccess = true;
          return {
            ...result,
            imageBuffer: normalized.sanitizedBuffer,
            mimeType: normalized.mimeType,
            width: normalized.width,
            height: normalized.height,
            providerId: provider.providerId,
            providerName: provider.name,
            keyMasked: keyItem?.keyMasked,
            auditTrail,
            estimatedCostUsd: provLower.includes('vercel') ? 0.003 : 0.0,
          };
        } catch (err: unknown) {
          lastCandidateError = err;
          const errorKind = err instanceof ProviderError ? err.kind : 'network_error';
          const errorMsg = err instanceof Error ? err.message : String(err);
          const lowerMsg = errorMsg.toLowerCase();
          const retryAfter = err instanceof ProviderError ? err.retryAfterSeconds : undefined;

          // 401/403: Disable key immediately and alert
          if (errorKind === 'auth' || lowerMsg.includes('unauthorized') || lowerMsg.includes('forbidden') || lowerMsg.includes('api key')) {
            if (keyItem) {
              keyItem.status = 'disabled';
              (keyItem as any).active = false;
            }
            break; // No retry for auth errors
          }

          // 429: Rate limit or quota error -> record cooldown
          if (errorKind === 'rate_limit' || lowerMsg.includes('rate limit') || lowerMsg.includes('quota') || lowerMsg.includes('429')) {
            if (keyItem) {
              recordKeyFailure(keyItem, 'rate_limit', retryAfter || 300);
            }
            break; // No retry on rate limit
          }

          // Content policy refusal: Rewrite prompt more conservatively once
          if (!hasRewrittenPolicy && (errorKind === 'invalid_output' || lowerMsg.includes('policy') || lowerMsg.includes('safety') || lowerMsg.includes('moderation') || lowerMsg.includes('nsfw'))) {
            hasRewrittenPolicy = true;
            activePrompt = `Photorealistic educational scene depicting the scientific subject: ${options.prompt.slice(0, 160)}. Clean composition, natural lighting, documentary style, no text, no symbols.`;
            continue; // Retry with conservative prompt
          }

          // Transient network error: Retry the SAME entry at most ONCE
          if (errorKind === 'network_error' && attemptsCount === 1) {
            continue; // Retry once
          }

          // Otherwise, break and move to next candidate in chain
          break;
        }
      }

      if (!candidateSuccess) {
        const errorMsg = lastCandidateError instanceof Error ? lastCandidateError.message : String(lastCandidateError);
        const errorKind = lastCandidateError instanceof ProviderError ? lastCandidateError.kind : 'network_error';
        const durationMs = Date.now() - startCandidateTime;

        if (keyItem) {
          recordKeyFailure(keyItem, errorKind);
        }

        auditTrail.push({
          provider: provider.name,
          model,
          status: 'failed',
          error: errorMsg,
          latencyMs: durationMs,
        });

        attempts.push({
          provider: provider.name,
          error: errorMsg,
          kind: errorKind,
        });
      }
    }

    // Every entry in chain failed -> mark post "failed: no image" and NEVER publish text-only!
    throw new ProviderRouterError(
      `failed: no image - All ${candidateProviders.length} image provider(s) in priority chain failed. Refusing to publish text-only post.`,
      attempts
    );
  }
}
