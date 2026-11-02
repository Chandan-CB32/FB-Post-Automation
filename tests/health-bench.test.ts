import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderHealthChecker } from '../worker/src/router/health-checker.js';
import { QualityBenchRunner } from '../worker/src/router/bench-runner.js';
import { ProviderDefinition } from '../worker/src/router/provider-router.js';
import { createKeyPoolItem, generateEncryptionKey } from '../packages/core/src/index.js';

describe('ProviderHealthChecker & QualityBenchRunner', () => {
  let encKey: string;

  beforeEach(() => {
    encKey = generateEncryptionKey();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createTestProvider(
    id: string,
    name: string,
    kind: any = 'openai_compatible_chat',
    active = true
  ): ProviderDefinition {
    const key = createKeyPoolItem(id, 'test-api-key', 'Key 1', encKey);
    return {
      providerId: id,
      name,
      kind,
      baseUrl: 'https://api.mock.test/v1',
      defaultModel: 'test-model',
      rpmLimit: 60,
      rpdLimit: 1000,
      requestsToday: 0,
      dailyLimit: 1000,
      active,
      status: active ? 'active' : 'disabled',
      keys: [key],
    };
  }

  describe('ProviderHealthChecker', () => {
    it('returns unhealthy for inactive provider without making network call', async () => {
      const checker = new ProviderHealthChecker();
      const prov = createTestProvider('p-inactive', 'Inactive Provider', 'openai_compatible_chat', false);

      const res = await checker.checkProvider(prov, encKey);
      expect(res.healthy).toBe(false);
      expect(res.error).toContain('marked inactive');
    });

    it('returns unhealthy when provider has no active keys', async () => {
      const checker = new ProviderHealthChecker();
      const prov = createTestProvider('p-nokeys', 'No Keys Provider');
      prov.keys[0].status = 'disabled';

      const res = await checker.checkProvider(prov, encKey);
      expect(res.healthy).toBe(false);
      expect(res.error).toContain('No active keys');
    });

    it('runs health check on active provider', async () => {
      const checker = new ProviderHealthChecker();
      const prov = createTestProvider('p-active', 'Active Provider');

      const res = await checker.checkProvider(prov, encKey);
      expect(res.healthy).toBe(true);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(res.providerId).toBe('p-active');
    });
  });

  describe('QualityBenchRunner', () => {
    const runner = new QualityBenchRunner();

    it('benchmarks multiple text providers and suggests optimal chain order', async () => {
      const provFast = createTestProvider('prov-fast', 'Fast Groq');
      provFast.baseUrl = 'https://fast.mock.test/v1';

      const provSlow = createTestProvider('prov-slow', 'Slow Provider');
      provSlow.baseUrl = 'https://slow.mock.test/v1';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('fast')) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Fast response text' } }],
              usage: { total_tokens: 30 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Slow response text' } }],
            usage: { total_tokens: 45 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const bench = await runner.runTextBench('Explain quantum teleportation', [provFast, provSlow], {
        encryptionKey: encKey,
      });

      expect(bench.kind).toBe('text');
      expect(bench.results.length).toBe(2);

      const fastRes = bench.results.find((r) => r.providerId === 'prov-fast');
      const slowRes = bench.results.find((r) => r.providerId === 'prov-slow');

      expect(fastRes?.success).toBe(true);
      expect(fastRes?.textOutput).toBe('Fast response text');
      expect(slowRes?.success).toBe(true);

      // Suggested order places successful models first, sorted by latency
      expect(bench.suggestedOrder.length).toBe(2);
      expect(bench.suggestedOrder).toContain('prov-fast');
      expect(bench.suggestedOrder).toContain('prov-slow');
    });

    it('benchmarks image providers and records image buffer outputs', async () => {
      const imgProv = createTestProvider('img-prov', 'Pollinations Benchmark', 'pollinations');
      const mockImageBuffer = Buffer.alloc(1024, 99);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockImageBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      );

      const bench = await runner.runImageBench('Space telescope rendering deep star cluster', [imgProv], {
        width: 1080,
        height: 1350,
        encryptionKey: encKey,
      });

      expect(bench.kind).toBe('image');
      expect(bench.results.length).toBe(1);
      expect(bench.results[0].success).toBe(true);
      expect(bench.results[0].imageBuffer?.length).toBe(1024);
      expect(bench.suggestedOrder).toEqual(['img-prov']);
    });
  });
});
