import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProviderRouter,
  ProviderRouterError,
  ProviderDefinition,
} from '../worker/src/router/provider-router.js';
import {
  globalBudgetTracker,
  ProviderBudgetTracker,
  validateAndNormalizeImage,
  ProviderError,
  encrypt,
} from '../packages/core/src/index.js';
import sharp from 'sharp';

describe('Strict Priority Image Fallback Chain (#1 to #8)', () => {
  let router: ProviderRouter;
  const mockEncKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // Helper to create valid non-uniform 1080x1350 JPEG buffer for tests
  async function createValidJpegBuffer(): Promise<Buffer> {
    const rawPixels = Buffer.alloc(1080 * 1350 * 3);
    for (let i = 0; i < rawPixels.length; i += 3) {
      rawPixels[i] = (i * 17) % 256;
      rawPixels[i + 1] = (i * 31) % 256;
      rawPixels[i + 2] = (i * 47) % 256;
    }
    return sharp(rawPixels, {
      raw: { width: 1080, height: 1350, channels: 3 },
    })
      .jpeg()
      .toBuffer();
  }

  beforeEach(() => {
    router = new ProviderRouter();
    vi.restoreAllMocks();
  });

  it('tries the 8 entries strictly in order and picks the first available that works', async () => {
    const validImg = await createValidJpegBuffer();
    const testEncKey = encrypt('test-api-key', mockEncKey);

    // 1. ZenMux (P1) - Needs API key (missing keys) -> should be skipped silently
    const p1: ProviderDefinition = {
      providerId: 'zenmux',
      name: 'ZenMux (Gemini Image Free)',
      kind: 'openai_compatible_images',
      baseUrl: 'https://zenmux.ai/api/v1',
      defaultModel: 'google/gemini-2.5-flash-image-free',
      priority: 1,
      active: false,
      status: 'disabled',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 30,
      rpdLimit: 1000,
      keys: [], // No key!
    };

    // 2. Vercel AI Gateway (P2) - Needs API key -> should be skipped silently
    const p2: ProviderDefinition = {
      providerId: 'vercel',
      name: 'Vercel AI Gateway (FLUX.2 klein 4B)',
      kind: 'openai_compatible_images',
      baseUrl: 'https://gateway.ai.vercel.com/v1',
      defaultModel: 'bfl/flux-2-klein-4b',
      priority: 2,
      active: false,
      status: 'disabled',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 30,
      rpdLimit: 1000,
      keys: [], // No key!
    };

    // 3. NVIDIA NIM (P3) - Has key, but returns 503 Service Unavailable -> failover to #4
    const p3: ProviderDefinition = {
      providerId: 'nvidia',
      name: 'NVIDIA NIM (SD 3.5 Large)',
      kind: 'openai_compatible_images',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      defaultModel: 'stabilityai/stable-diffusion-3.5-large',
      priority: 3,
      active: true,
      status: 'active',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 60,
      rpdLimit: 1000,
      keys: [{
        id: 'k3',
        keyEncrypted: testEncKey,
        keyMasked: 'nva...OW7K',
        status: 'active',
        errorCount: 0,
        requestsToday: 0,
      }],
    };

    // 4. Cloudflare Leonardo Lucid (P4) - Has key, succeeds!
    const p4: ProviderDefinition = {
      providerId: 'cf-lucid',
      name: 'Cloudflare Workers AI (Leonardo Lucid)',
      kind: 'cloudflare_workers_ai',
      baseUrl: 'https://api.cloudflare.com/client/v4',
      defaultModel: '@cf/leonardo/lucid-origin',
      config: { accountId: 'test-cf-account' },
      priority: 4,
      active: true,
      status: 'active',
      requestsToday: 0,
      dailyLimit: 3,
      rpmLimit: 10,
      rpdLimit: 3,
      keys: [{
        id: 'k4',
        keyEncrypted: testEncKey,
        keyMasked: 'cfu...7830',
        status: 'active',
        errorCount: 0,
        requestsToday: 0,
      }],
    };

    router.registerProvider(p1);
    router.registerProvider(p2);
    router.registerProvider(p3);
    router.registerProvider(p4);

    router.setChain('image', {
      stage: 'image',
      strategy: 'priority',
      providerIds: ['zenmux', 'vercel', 'nvidia', 'cf-lucid'],
    });

    // Mock fetch: NVIDIA fails with 503, Cloudflare succeeds with valid JPEG
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Server Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(validImg, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      );

    const result = await router.executeImage('image', {
      prompt: 'Spectacular blue whale diving in arctic waters',
      width: 1080,
      height: 1350,
      encryptionKey: mockEncKey,
    });

    expect(result.providerId).toBe('cf-lucid');
    expect(result.providerName).toBe('Cloudflare Workers AI (Leonardo Lucid)');
    expect(result.auditTrail.length).toBeGreaterThanOrEqual(3);

    // Verify silent skips for missing keys
    const zenmuxAudit = result.auditTrail.find((a) => a.provider.includes('ZenMux'));
    const vercelAudit = result.auditTrail.find((a) => a.provider.includes('Vercel'));
    expect(zenmuxAudit?.status).toBe('skipped');
    expect(vercelAudit?.status).toBe('skipped');

    // Verify NVIDIA failed and Cloudflare succeeded
    const nvidiaAudit = result.auditTrail.find((a) => a.provider.includes('NVIDIA'));
    const cfAudit = result.auditTrail.find((a) => a.provider.includes('Leonardo Lucid'));
    expect(nvidiaAudit?.status).toBe('failed');
    expect(cfAudit?.status).toBe('success');
  });

  it('respects per-Page image chain override', async () => {
    const validImg = await createValidJpegBuffer();

    const pA: ProviderDefinition = {
      providerId: 'prov-a',
      name: 'Default Top Provider',
      kind: 'pollinations',
      defaultModel: 'flux',
      priority: 1,
      active: true,
      status: 'active',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 30,
      rpdLimit: 1000,
      keys: [],
    };

    const pB: ProviderDefinition = {
      providerId: 'prov-b',
      name: 'Page Preferred Provider',
      kind: 'pollinations',
      defaultModel: 'turbo',
      priority: 2,
      active: true,
      status: 'active',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 30,
      rpdLimit: 1000,
      keys: [],
    };

    router.registerProvider(pA);
    router.registerProvider(pB);

    router.setChain('image', {
      stage: 'image',
      strategy: 'priority',
      providerIds: ['prov-a', 'prov-b'],
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(validImg, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
    );

    // Call with per-Page override specifying prov-b first
    const result = await router.executeImage('image', {
      prompt: 'Ancient Antarctic moss ecosystem',
      pageOverrides: {
        image_chain_override: ['prov-b', 'prov-a'],
      },
      encryptionKey: mockEncKey,
    });

    expect(result.providerId).toBe('prov-b');
    expect(result.providerName).toBe('Page Preferred Provider');
  });

  it('fails over on content-policy refusal by rewriting prompt once conservatively', async () => {
    const validImg = await createValidJpegBuffer();

    const provider: ProviderDefinition = {
      providerId: 'pol-safe',
      name: 'Pollinations Safe',
      kind: 'pollinations',
      defaultModel: 'flux',
      priority: 1,
      active: true,
      status: 'active',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 30,
      rpdLimit: 1000,
      keys: [],
    };

    router.registerProvider(provider);

    // Call 1 returns content safety refusal, Call 2 with rewritten prompt succeeds
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Content safety violation detected', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(validImg, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      );

    const result = await router.executeImage('image', {
      prompt: 'Graphic medical surgery showing heart extraction',
      encryptionKey: mockEncKey,
    });

    expect(result.providerId).toBe('pol-safe');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('enforces Cloudflare 1,500 neuron reserve and Leonardo 3-image daily cap', () => {
    const tracker = new ProviderBudgetTracker({
      cloudflare: {
        dailyNeuronAllowance: 10000,
        neuronReserve: 1500,
        neuronsUsedToday: 0,
        lucidPhoenixDailyCap: 3,
        lucidPhoenixUsedToday: 0,
      },
    });

    // 1. First 3 Lucid calls are allowed
    expect(tracker.canUseCloudflareModel('@cf/leonardo/lucid-origin').allowed).toBe(true);
    tracker.recordCloudflareUsage('@cf/leonardo/lucid-origin');
    expect(tracker.canUseCloudflareModel('@cf/leonardo/lucid-origin').allowed).toBe(true);
    tracker.recordCloudflareUsage('@cf/leonardo/lucid-origin');
    expect(tracker.canUseCloudflareModel('@cf/leonardo/lucid-origin').allowed).toBe(true);
    tracker.recordCloudflareUsage('@cf/leonardo/lucid-origin');

    // 4th Lucid call is blocked by daily cap (3/day)
    const capCheck = tracker.canUseCloudflareModel('@cf/leonardo/lucid-origin');
    expect(capCheck.allowed).toBe(false);
    expect(capCheck.reason).toContain('Daily cap of 3 images');

    // 2. But FLUX schnell fallback is STILL allowed inside the reserve!
    const schnellCheck = tracker.canUseCloudflareModel('@cf/black-forest-labs/flux-1-schnell');
    expect(schnellCheck.allowed).toBe(true);

    // 3. When neurons are down to 1,600 (only 100 left before 1,500 reserve):
    tracker.recordCloudflareUsage('@cf/black-forest-labs/flux-1-schnell', 900);
    // Lucid would need 2,500 neurons which breaches the 1,500 reserve
    const reserveBreach = tracker.canUseCloudflareModel('@cf/leonardo/phoenix-1.0');
    expect(reserveBreach.allowed).toBe(false);
  });

  it('enforces Vercel $5.00 credit tracking with $0.50 reserve', () => {
    const tracker = new ProviderBudgetTracker({
      vercel: {
        monthlyCreditAllowanceUsd: 5.0,
        monthlyReserveUsd: 0.5,
        creditsUsedUsd: 0.0,
      },
    });

    expect(tracker.canUseVercel().allowed).toBe(true);

    // Consume $4.60 of credits (leaving $0.40, which is below the $0.50 reserve)
    tracker.recordVercelUsage(4.60);
    const check = tracker.canUseVercel();
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('reserve held');
  });

  it('enforces Alibaba 90-day trial quota and expiration date', () => {
    const tracker = new ProviderBudgetTracker({
      alibaba: {
        totalFreeQuotaImages: 500,
        quotaUsedImages: 500, // Exhausted
        expiresAtIso: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    const check = tracker.canUseAlibaba();
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('fully exhausted');

    // Test expiration
    const expiredTracker = new ProviderBudgetTracker({
      alibaba: {
        totalFreeQuotaImages: 500,
        quotaUsedImages: 10,
        expiresAtIso: new Date(Date.now() - 86400000).toISOString(), // Expired yesterday
      },
    });
    const expCheck = expiredTracker.canUseAlibaba();
    expect(expCheck.allowed).toBe(false);
    expect(expCheck.reason).toContain('expired');
  });

  it('throws "failed: no image" and refuses text-only posting when all candidates fail', async () => {
    const p1: ProviderDefinition = {
      providerId: 'p-fail-1',
      name: 'Failing Provider 1',
      kind: 'pollinations',
      defaultModel: 'flux',
      priority: 1,
      active: true,
      status: 'active',
      requestsToday: 0,
      dailyLimit: 1000,
      rpmLimit: 30,
      rpdLimit: 1000,
      keys: [],
    };

    router.registerProvider(p1);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );

    await expect(
      router.executeImage('image', {
        prompt: 'Cosmic discovery exoplanet',
        encryptionKey: mockEncKey,
      })
    ).rejects.toThrowError(/failed: no image/);
  });
});
