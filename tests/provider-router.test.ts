import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProviderRouter,
  ProviderRouterError,
  ProviderDefinition,
} from '../worker/src/router/provider-router.js';
import {
  createKeyPoolItem,
  generateEncryptionKey,
} from '../packages/core/src/index.js';

describe('ProviderRouter & Automatic Failover Engine', () => {
  let router: ProviderRouter;
  let encKey: string;

  beforeEach(() => {
    router = new ProviderRouter();
    encKey = generateEncryptionKey();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockProvider(
    id: string,
    name: string,
    kind: any = 'openai_compatible_chat',
    rawKey = 'test-key'
  ): ProviderDefinition {
    const keyItem = createKeyPoolItem(id, rawKey, 'Default Key', encKey);
    return {
      providerId: id,
      name,
      kind,
      baseUrl: 'https://mock.api/v1',
      rpmLimit: 60,
      rpdLimit: 1000,
      requestsToday: 0,
      dailyLimit: 1000,
      active: true,
      status: 'active',
      keys: [keyItem],
    };
  }

  it('successfully executes text via primary provider in chain', async () => {
    const prov1 = createMockProvider('p1', 'Primary Provider');
    router.registerProvider(prov1);
    router.setChain('write', {
      stage: 'write',
      strategy: 'priority',
      providerIds: ['p1'],
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Generated story content' } }],
          usage: { total_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await router.executeText('write', {
      prompt: 'Write a story',
      encryptionKey: encKey,
    });

    expect(result.text).toBe('Generated story content');
    expect(result.providerId).toBe('p1');
    expect(result.providerName).toBe('Primary Provider');
    expect(prov1.requestsToday).toBe(1);
  });

  it('fails over to secondary provider when primary encounters 429 rate limit', async () => {
    const p1 = createMockProvider('p1', 'Provider 1');
    const p2 = createMockProvider('p2', 'Provider 2');

    router.registerProvider(p1);
    router.registerProvider(p2);
    router.setChain('write', {
      stage: 'write',
      strategy: 'priority',
      providerIds: ['p1', 'p2'],
    });

    // 1st fetch (p1) returns 429
    // 2nd fetch (p2) returns 200
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Rate limit reached' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'retry-after': '60' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Backup story content' } }],
            usage: { total_tokens: 35 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const result = await router.executeText('write', {
      prompt: 'Write content',
      encryptionKey: encKey,
    });

    expect(result.text).toBe('Backup story content');
    expect(result.providerId).toBe('p2');
    expect(result.providerName).toBe('Provider 2');

    // p1 key should now be in cooling state
    expect(p1.keys[0].status).toBe('cooling');
    expect(p2.requestsToday).toBe(1);
  });

  it('fails over and disables key when primary encounters 401 auth error', async () => {
    const p1 = createMockProvider('p1', 'Bad Key Provider');
    const p2 = createMockProvider('p2', 'Good Key Provider');

    router.registerProvider(p1);
    router.registerProvider(p2);
    router.setChain('topic', {
      stage: 'topic',
      strategy: 'priority',
      providerIds: ['p1', 'p2'],
    });

    // p1 returns 401
    // p2 returns 200
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Selected topic' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const result = await router.executeText('topic', {
      prompt: 'Pick a topic',
      encryptionKey: encKey,
    });

    expect(result.text).toBe('Selected topic');
    expect(result.providerId).toBe('p2');
    expect(p1.keys[0].status).toBe('disabled');
  });

  it('throws ProviderRouterError with all attempt details when all candidates fail', async () => {
    const p1 = createMockProvider('p1', 'Prov 1');
    const p2 = createMockProvider('p2', 'Prov 2');

    router.registerProvider(p1);
    router.registerProvider(p2);
    router.setChain('qa', {
      stage: 'qa',
      strategy: 'priority',
      providerIds: ['p1', 'p2'],
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response('Server Error', { status: 502 }));

    await expect(
      router.executeText('qa', {
        prompt: 'Evaluate',
        encryptionKey: encKey,
      })
    ).rejects.toThrowError(ProviderRouterError);

    try {
      await router.executeText('qa', { prompt: 'Eval', encryptionKey: encKey });
    } catch (err) {
      const routerErr = err as ProviderRouterError;
      expect(routerErr.attempts.length).toBe(2);
      expect(routerErr.attempts[0].provider).toBe('Prov 1');
      expect(routerErr.attempts[1].provider).toBe('Prov 2');
    }
  }, 15000);

  it('fails over during image generation stage', async () => {
    const img1 = createMockProvider('img1', 'Pollinations Primary', 'pollinations');
    const img2 = createMockProvider('img2', 'Cloudflare Backup', 'cloudflare_workers_ai');
    img2.config = { accountId: 'mock-account-id' };

    router.registerProvider(img1);
    router.registerProvider(img2);
    router.setChain('image', {
      stage: 'image',
      strategy: 'priority',
      providerIds: ['img1', 'img2'],
    });

    const mockImageBytes = Buffer.alloc(1024, 255);

    // img1 fails with 503, img2 succeeds returning binary png
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(mockImageBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      );

    const result = await router.executeImage('image', {
      prompt: 'Cosmic nebula photograph',
      width: 1080,
      height: 1350,
      encryptionKey: encKey,
    });

    expect(result.imageBuffer.length).toBe(1024);
    expect(result.providerId).toBe('img2');
    expect(result.providerName).toBe('Cloudflare Backup');
  });
});
