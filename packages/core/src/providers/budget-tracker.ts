/**
 * Provider Budget & Quota Tracker
 * Manages shared neuron pools, credits, rate limits, and model license compliance.
 */

export interface CloudflareBudgetState {
  dailyNeuronAllowance: number; // default: 10,000
  neuronReserve: number; // default: 1,500 (reserved for FLUX schnell and text)
  neuronsUsedToday: number;
  lucidPhoenixDailyCap: number; // default: 3 images/day
  lucidPhoenixUsedToday: number;
  lastResetUtc: string; // YYYY-MM-DD
}

export interface VercelBudgetState {
  monthlyCreditAllowanceUsd: number; // default: $5.00
  monthlyReserveUsd: number; // default: $0.50
  creditsUsedUsd: number;
  cycleStartIso: string;
}

export interface AlibabaQuotaState {
  totalFreeQuotaImages: number; // default: 500
  quotaUsedImages: number;
  expiresAtIso: string; // 90 days from activation
}

export interface OpenRouterLimitState {
  rpdLimit: number; // 200 requests per day for free models
  rpmLimit: number; // 20 requests per minute
  requestsToday: number;
  requestsThisMinute: number;
  lastMinuteTimestamp: number;
  lastResetUtc: string;
}

export interface ModelLicenseInfo {
  modelId: string;
  name: string;
  license: string;
  commercialUseAllowed: boolean;
  notes?: string;
}

export const KNOWN_IMAGE_MODEL_LICENSES: Record<string, ModelLicenseInfo> = {
  'google/gemini-2.5-flash-image-free': {
    modelId: 'google/gemini-2.5-flash-image-free',
    name: 'Gemini 2.5 Flash Image Free (ZenMux)',
    license: 'Google Terms of Service',
    commercialUseAllowed: true,
  },
  'bfl/flux-2-klein-4b': {
    modelId: 'bfl/flux-2-klein-4b',
    name: 'FLUX.2 klein 4B (Vercel AI Gateway)',
    license: 'Apache 2.0',
    commercialUseAllowed: true,
    notes: 'Apache 2.0 allows full commercial production use.',
  },
  'bfl/flux-2-klein-9b': {
    modelId: 'bfl/flux-2-klein-9b',
    name: 'FLUX.2 klein 9B',
    license: 'Non-Commercial (BFL)',
    commercialUseAllowed: false,
    notes: 'Non-commercial research only.',
  },
  'stabilityai/stable-diffusion-3.5-large': {
    modelId: 'stabilityai/stable-diffusion-3.5-large',
    name: 'Stable Diffusion 3.5 Large (NVIDIA NIM)',
    license: 'Stability AI Community License',
    commercialUseAllowed: true,
    notes: 'Free commercial use for entities under $1M/yr revenue.',
  },
  'qwen/qwen-image': {
    modelId: 'qwen/qwen-image',
    name: 'Qwen-Image (NVIDIA NIM)',
    license: 'Apache 2.0',
    commercialUseAllowed: true,
  },
  '@cf/leonardo/lucid-origin': {
    modelId: '@cf/leonardo/lucid-origin',
    name: 'Leonardo Lucid Origin (Cloudflare Workers AI)',
    license: 'Cloudflare / Leonardo Terms',
    commercialUseAllowed: true,
    notes: 'High neuron consumption (~2500 neurons/image).',
  },
  '@cf/leonardo/phoenix-1.0': {
    modelId: '@cf/leonardo/phoenix-1.0',
    name: 'Leonardo Phoenix 1.0 (Cloudflare Workers AI)',
    license: 'Cloudflare / Leonardo Terms',
    commercialUseAllowed: true,
  },
  'sourceful/riverflow-v2.5-fast:free': {
    modelId: 'sourceful/riverflow-v2.5-fast:free',
    name: 'Riverflow v2.5 Fast Free (OpenRouter)',
    license: 'OpenRouter Free Terms',
    commercialUseAllowed: true,
  },
  'wanx2.1-t2i-turbo': {
    modelId: 'wanx2.1-t2i-turbo',
    name: 'Wanx 2.1 T2I Turbo (Alibaba DashScope)',
    license: 'Alibaba Cloud Model Studio Terms',
    commercialUseAllowed: true,
    notes: 'One-time 90-day trial quota.',
  },
  'flux': {
    modelId: 'flux',
    name: 'FLUX.1 Schnell (Pollinations)',
    license: 'Apache 2.0',
    commercialUseAllowed: true,
  },
  '@cf/black-forest-labs/flux-1-schnell': {
    modelId: '@cf/black-forest-labs/flux-1-schnell',
    name: 'FLUX.1 Schnell (Cloudflare Workers AI)',
    license: 'Apache 2.0',
    commercialUseAllowed: true,
    notes: 'Low neuron consumption (~600 neurons/image).',
  },
};

export class ProviderBudgetTracker {
  private cfBudget: CloudflareBudgetState = {
    dailyNeuronAllowance: 10000,
    neuronReserve: 1500,
    neuronsUsedToday: 0,
    lucidPhoenixDailyCap: 3,
    lucidPhoenixUsedToday: 0,
    lastResetUtc: new Date().toISOString().slice(0, 10),
  };

  private vercelBudget: VercelBudgetState = {
    monthlyCreditAllowanceUsd: 5.0,
    monthlyReserveUsd: 0.5,
    creditsUsedUsd: 0.0,
    cycleStartIso: new Date().toISOString(),
  };

  private alibabaQuota: AlibabaQuotaState = {
    totalFreeQuotaImages: 500,
    quotaUsedImages: 0,
    expiresAtIso: new Date(Date.now() + 90 * 86400000).toISOString(),
  };

  private openRouterLimits: OpenRouterLimitState = {
    rpdLimit: 200,
    rpmLimit: 20,
    requestsToday: 0,
    requestsThisMinute: 0,
    lastMinuteTimestamp: Date.now(),
    lastResetUtc: new Date().toISOString().slice(0, 10),
  };

  constructor(initialState?: {
    cloudflare?: Partial<CloudflareBudgetState>;
    vercel?: Partial<VercelBudgetState>;
    alibaba?: Partial<AlibabaQuotaState>;
    openRouter?: Partial<OpenRouterLimitState>;
  }) {
    if (initialState?.cloudflare) {
      this.cfBudget = { ...this.cfBudget, ...initialState.cloudflare };
    }
    if (initialState?.vercel) {
      this.vercelBudget = { ...this.vercelBudget, ...initialState.vercel };
    }
    if (initialState?.alibaba) {
      this.alibabaQuota = { ...this.alibabaQuota, ...initialState.alibaba };
    }
    if (initialState?.openRouter) {
      this.openRouterLimits = { ...this.openRouterLimits, ...initialState.openRouter };
    }
  }

  // --- Reset check ---
  private checkDailyReset(): void {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (this.cfBudget.lastResetUtc !== todayUtc) {
      this.cfBudget.neuronsUsedToday = 0;
      this.cfBudget.lucidPhoenixUsedToday = 0;
      this.cfBudget.lastResetUtc = todayUtc;
    }
    if (this.openRouterLimits.lastResetUtc !== todayUtc) {
      this.openRouterLimits.requestsToday = 0;
      this.openRouterLimits.lastResetUtc = todayUtc;
    }
  }

  // --- Cloudflare Neuron Budget Checks ---
  canUseCloudflareModel(modelId: string, isText = false): { allowed: boolean; reason?: string } {
    this.checkDailyReset();
    const remainingNeurons = this.cfBudget.dailyNeuronAllowance - this.cfBudget.neuronsUsedToday;
    const isLucidOrPhoenix = modelId.includes('lucid') || modelId.includes('phoenix') || modelId.includes('leonardo');
    const isSchnell = modelId.includes('schnell');

    if (isLucidOrPhoenix) {
      if (this.cfBudget.lucidPhoenixUsedToday >= this.cfBudget.lucidPhoenixDailyCap) {
        return {
          allowed: false,
          reason: `Daily cap of ${this.cfBudget.lucidPhoenixDailyCap} images for Leonardo Lucid/Phoenix reached.`,
        };
      }
      // Lucid/Phoenix requires ~2500 neurons. We must not breach the 1,500 reserve!
      if (remainingNeurons - 2500 < this.cfBudget.neuronReserve) {
        return {
          allowed: false,
          reason: `Insufficient neurons (${remainingNeurons} remaining). Must protect ${this.cfBudget.neuronReserve} reserve for text and FLUX schnell fallback.`,
        };
      }
    }

    if (isSchnell || isText) {
      // Schnell and Text are permitted to run down to 0 neurons
      if (remainingNeurons < (isText ? 50 : 500)) {
        return {
          allowed: false,
          reason: `Cloudflare 10,000 daily neuron allowance fully exhausted (${remainingNeurons} remaining).`,
        };
      }
    }

    return { allowed: true };
  }

  recordCloudflareUsage(modelId: string, neuronsConsumed?: number): void {
    this.checkDailyReset();
    const isLucidOrPhoenix = modelId.includes('lucid') || modelId.includes('phoenix') || modelId.includes('leonardo');
    const consumed = neuronsConsumed ?? (isLucidOrPhoenix ? 2500 : 600);
    this.cfBudget.neuronsUsedToday += consumed;
    if (isLucidOrPhoenix) {
      this.cfBudget.lucidPhoenixUsedToday += 1;
    }
  }

  // --- Vercel Credit Budget Checks ---
  canUseVercel(): { allowed: boolean; reason?: string } {
    const remainingUsd = this.vercelBudget.monthlyCreditAllowanceUsd - this.vercelBudget.creditsUsedUsd;
    if (remainingUsd <= this.vercelBudget.monthlyReserveUsd) {
      return {
        allowed: false,
        reason: `Vercel AI Gateway monthly credit near exhaustion ($${remainingUsd.toFixed(2)} remaining, $${this.vercelBudget.monthlyReserveUsd.toFixed(2)} reserve held).`,
      };
    }
    return { allowed: true };
  }

  recordVercelUsage(costUsd = 0.003): void {
    this.vercelBudget.creditsUsedUsd += costUsd;
  }

  // --- Alibaba Quota Checks ---
  canUseAlibaba(): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const expiry = new Date(this.alibabaQuota.expiresAtIso).getTime();
    if (now > expiry) {
      return {
        allowed: false,
        reason: `Alibaba 90-day free trial quota expired on ${this.alibabaQuota.expiresAtIso.slice(0, 10)}.`,
      };
    }
    if (this.alibabaQuota.quotaUsedImages >= this.alibabaQuota.totalFreeQuotaImages) {
      return {
        allowed: false,
        reason: `Alibaba free quota fully exhausted (${this.alibabaQuota.quotaUsedImages}/${this.alibabaQuota.totalFreeQuotaImages} used).`,
      };
    }
    return { allowed: true };
  }

  recordAlibabaUsage(): void {
    this.alibabaQuota.quotaUsedImages += 1;
  }

  // --- OpenRouter Limit Checks ---
  canUseOpenRouter(): { allowed: boolean; reason?: string } {
    this.checkDailyReset();
    if (this.openRouterLimits.requestsToday >= this.openRouterLimits.rpdLimit) {
      return {
        allowed: false,
        reason: `OpenRouter daily limit reached (${this.openRouterLimits.rpdLimit} requests/day).`,
      };
    }
    const now = Date.now();
    if (now - this.openRouterLimits.lastMinuteTimestamp > 60000) {
      this.openRouterLimits.requestsThisMinute = 0;
      this.openRouterLimits.lastMinuteTimestamp = now;
    }
    if (this.openRouterLimits.requestsThisMinute >= this.openRouterLimits.rpmLimit) {
      return {
        allowed: false,
        reason: `OpenRouter rate limit reached (${this.openRouterLimits.rpmLimit} RPM). In cooldown.`,
      };
    }
    return { allowed: true };
  }

  recordOpenRouterUsage(): void {
    this.checkDailyReset();
    this.openRouterLimits.requestsToday += 1;
    this.openRouterLimits.requestsThisMinute += 1;
  }

  // --- Combined Image Capacity Calculation ---
  getEstimatedImagesRemainingToday(): number {
    this.checkDailyReset();
    let total = 0;

    // 1. ZenMux (typically high/unlimited free pool if key active)
    total += 100;

    // 2. Vercel AI Gateway ($5/mo at ~$0.003/img = ~1,600 imgs total)
    const vercelRemainingUsd = Math.max(0, this.vercelBudget.monthlyCreditAllowanceUsd - this.vercelBudget.creditsUsedUsd - this.vercelBudget.monthlyReserveUsd);
    total += Math.floor(vercelRemainingUsd / 0.003);

    // 3. NVIDIA NIM (~1,000 free requests)
    total += 50;

    // 4. Cloudflare (Lucid/Phoenix capped at 3, Schnell up to neuron reserve)
    const cfRemainingNeurons = Math.max(0, this.cfBudget.dailyNeuronAllowance - this.cfBudget.neuronsUsedToday);
    const cfImages = Math.floor(cfRemainingNeurons / 600);
    total += cfImages;

    // 5. OpenRouter free
    const orRemaining = Math.max(0, this.openRouterLimits.rpdLimit - this.openRouterLimits.requestsToday);
    total += orRemaining;

    // 6. Alibaba
    const aliRemaining = Math.max(0, this.alibabaQuota.totalFreeQuotaImages - this.alibabaQuota.quotaUsedImages);
    total += Math.min(aliRemaining, 50);

    // 7. Pollinations (free/keyed)
    total += 200;

    return total;
  }

  // --- License & Monetization Compliance ---
  checkLicenseCompliance(modelId: string, isPageMonetized: boolean): { compliant: boolean; warning?: string } {
    const info = KNOWN_IMAGE_MODEL_LICENSES[modelId];
    if (!info) {
      return { compliant: true };
    }
    if (isPageMonetized && !info.commercialUseAllowed) {
      return {
        compliant: false,
        warning: `Model "${info.name}" has license "${info.license}" which prohibits commercial use. This page is marked monetized!`,
      };
    }
    return { compliant: true };
  }

  getDashboardSummary() {
    this.checkDailyReset();
    const cfRemainingNeurons = Math.max(0, this.cfBudget.dailyNeuronAllowance - this.cfBudget.neuronsUsedToday);
    const cfPercent = (this.cfBudget.neuronsUsedToday / this.cfBudget.dailyNeuronAllowance) * 100;

    const vercelRemainingUsd = Math.max(0, this.vercelBudget.monthlyCreditAllowanceUsd - this.vercelBudget.creditsUsedUsd);
    const vercelPercent = (this.vercelBudget.creditsUsedUsd / this.vercelBudget.monthlyCreditAllowanceUsd) * 100;

    const aliRemaining = Math.max(0, this.alibabaQuota.totalFreeQuotaImages - this.alibabaQuota.quotaUsedImages);
    const aliPercent = (this.alibabaQuota.quotaUsedImages / this.alibabaQuota.totalFreeQuotaImages) * 100;

    const orRemaining = Math.max(0, this.openRouterLimits.rpdLimit - this.openRouterLimits.requestsToday);
    const orPercent = (this.openRouterLimits.requestsToday / this.openRouterLimits.rpdLimit) * 100;

    const warnings: string[] = [];
    if (cfPercent >= 80) warnings.push(`Cloudflare neurons at ${cfPercent.toFixed(0)}% of daily allowance.`);
    if (vercelPercent >= 80) warnings.push(`Vercel credit at ${vercelPercent.toFixed(0)}% of monthly allowance.`);
    if (aliPercent >= 80) warnings.push(`Alibaba trial quota at ${aliPercent.toFixed(0)}% used.`);
    if (orPercent >= 80) warnings.push(`OpenRouter daily requests at ${orPercent.toFixed(0)}% of daily limit.`);

    return {
      imagesRemainingToday: this.getEstimatedImagesRemainingToday(),
      warnings,
      cloudflare: {
        total: this.cfBudget.dailyNeuronAllowance,
        used: this.cfBudget.neuronsUsedToday,
        remaining: cfRemainingNeurons,
        percent: Number(cfPercent.toFixed(1)),
        reserve: this.cfBudget.neuronReserve,
        lucidUsedToday: this.cfBudget.lucidPhoenixUsedToday,
        lucidCap: this.cfBudget.lucidPhoenixDailyCap,
      },
      vercel: {
        totalUsd: this.vercelBudget.monthlyCreditAllowanceUsd,
        usedUsd: Number(this.vercelBudget.creditsUsedUsd.toFixed(3)),
        remainingUsd: Number(vercelRemainingUsd.toFixed(3)),
        percent: Number(vercelPercent.toFixed(1)),
      },
      alibaba: {
        total: this.alibabaQuota.totalFreeQuotaImages,
        used: this.alibabaQuota.quotaUsedImages,
        remaining: aliRemaining,
        percent: Number(aliPercent.toFixed(1)),
        expiresAt: this.alibabaQuota.expiresAtIso.slice(0, 10),
      },
      openRouter: {
        limit: this.openRouterLimits.rpdLimit,
        used: this.openRouterLimits.requestsToday,
        remaining: orRemaining,
        percent: Number(orPercent.toFixed(1)),
      },
    };
  }
}

export const globalBudgetTracker = new ProviderBudgetTracker();
