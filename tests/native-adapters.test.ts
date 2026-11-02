import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiNativeAdapter } from '../packages/core/src/adapters/gemini.js';
import { CloudflareWorkersAIAdapter } from '../packages/core/src/adapters/cloudflare.js';
import { PollinationsImageAdapter } from '../packages/core/src/adapters/pollinations.js';
import { ProviderError } from '../packages/core/src/adapters/types.js';

describe('Native Provider Adapters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GeminiNativeAdapter', () => {
    const adapter = new GeminiNativeAdapter();

    it('generates text with systemInstruction and search grounding', async () => {
      let capturedBody: any;
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'NASA announced a new exoplanet discovery.' }],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 15,
              candidatesTokenCount: 25,
              totalTokenCount: 40,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const result = await adapter.generateText({
        prompt: 'What did NASA discover?',
        systemPrompt: 'You are a science communicator.',
        model: 'gemini-2.5-flash',
        apiKey: 'test-gemini-key',
        extraBody: { searchGrounding: true },
      });

      expect(result.text).toBe('NASA announced a new exoplanet discovery.');
      expect(result.tokens.totalTokens).toBe(40);
      expect(capturedBody.systemInstruction.parts[0].text).toBe('You are a science communicator.');
      expect(capturedBody.tools).toEqual([{ google_search: {} }]);
    });

    it('detects safety block from promptFeedback', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            promptFeedback: { blockReason: 'SAFETY' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        adapter.generateText({
          prompt: 'unsafe prompt',
          model: 'gemini-2.5-flash',
          apiKey: 'key',
        })
      ).rejects.toMatchObject({
        kind: 'content_policy',
      });
    });

    it('detects candidate finishReason SAFETY', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'SAFETY',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        adapter.generateText({
          prompt: 'test',
          model: 'gemini-2.5-flash',
          apiKey: 'key',
        })
      ).rejects.toMatchObject({
        kind: 'content_policy',
      });
    });

    it('throws ProviderError(rate_limit) on 429', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Quota exceeded for QuotaId: GenerateContent' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        adapter.generateText({
          prompt: 'test',
          model: 'gemini-2.5-flash',
          apiKey: 'key',
        })
      ).rejects.toMatchObject({
        kind: 'rate_limit',
        statusCode: 429,
      });
    });
  });

  describe('CloudflareWorkersAIAdapter', () => {
    const adapter = new CloudflareWorkersAIAdapter();

    it('generates text using Llama model', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { response: 'The telescope captured a stunning cosmic view.' },
            success: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const result = await adapter.generateText({
        prompt: 'Describe the galaxy',
        model: '@cf/meta/llama-3.1-8b-instruct',
        apiKey: 'cf-test-token',
        extraBody: { accountId: 'test-cf-account-id' },
      });

      expect(result.text).toBe('The telescope captured a stunning cosmic view.');
    });

    it('generates image returning binary arraybuffer for FLUX schnell', async () => {
      const mockImageBytes = Buffer.alloc(1024, 255);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockImageBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      );

      const result = await adapter.generateImage({
        prompt: 'Futuristic solar station in space',
        model: '@cf/black-forest-labs/flux-1-schnell',
        apiKey: 'cf-test-token',
        width: 1080,
        height: 1350,
        customHeaders: { accountId: 'test-cf-account-id' },
        ...({ accountId: 'test-cf-account-id' } as any),
      });

      expect(result.imageBuffer.length).toBe(1024);
      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1350);
    });

    it('throws auth error when accountId is missing', async () => {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      await expect(
        adapter.generateText({
          prompt: 'test',
          model: 'model',
          apiKey: 'key',
        })
      ).rejects.toMatchObject({
        kind: 'auth',
      });
    });
  });

  describe('PollinationsImageAdapter', () => {
    const adapter = new PollinationsImageAdapter();

    it('generates image with nologo and custom dimensions', async () => {
      let requestedUrl = '';
      const mockImageBytes = Buffer.alloc(2048, 128);

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
        requestedUrl = url.toString();
        return new Response(mockImageBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      });

      const result = await adapter.generateImage({
        prompt: 'Vintage 1957 Corvette red convertible',
        model: 'flux',
        width: 1080,
        height: 1350,
        seed: 42,
      });

      expect(result.imageBuffer.length).toBe(2048);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1350);

      const parsedUrl = new URL(requestedUrl);
      expect(parsedUrl.searchParams.get('nologo')).toBe('true');
      expect(parsedUrl.searchParams.get('width')).toBe('1080');
      expect(parsedUrl.searchParams.get('height')).toBe('1350');
      expect(parsedUrl.searchParams.get('seed')).toBe('42');
      expect(parsedUrl.searchParams.get('model')).toBe('flux');
    });

    it('throws ProviderError on rate limit 429', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Too Many Requests', { status: 429 })
      );

      await expect(
        adapter.generateImage({
          prompt: 'test',
        })
      ).rejects.toMatchObject({
        kind: 'rate_limit',
        statusCode: 429,
      });
    });
  });
});

