import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CustomHttpAdapter } from '../packages/core/src/adapters/custom-http.js';
import { resolveJsonPath } from '../packages/core/src/adapters/jsonpath.js';
import { ProviderError } from '../packages/core/src/adapters/types.js';

describe('Custom HTTP Adapter & JSONPath Resolver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveJsonPath', () => {
    const sample = {
      choices: [
        {
          message: {
            content: 'Extracted content text',
          },
        },
      ],
      data: [
        { url: 'https://images.example.com/photo.png' },
        { b64_json: 'aW1hZ2UtYnl0ZXM=' },
      ],
      nested: {
        layer1: {
          layer2: {
            score: 98,
          },
        },
      },
    };

    it('extracts nested properties via dot notation', () => {
      expect(resolveJsonPath(sample, 'nested.layer1.layer2.score')).toBe(98);
    });

    it('extracts properties via array indexing notation', () => {
      expect(resolveJsonPath(sample, 'choices[0].message.content')).toBe('Extracted content text');
      expect(resolveJsonPath(sample, 'data[0].url')).toBe('https://images.example.com/photo.png');
      expect(resolveJsonPath(sample, 'data[1].b64_json')).toBe('aW1hZ2UtYnl0ZXM=');
    });

    it('returns undefined on invalid path or out of bounds index', () => {
      expect(resolveJsonPath(sample, 'choices[5].message')).toBeUndefined();
      expect(resolveJsonPath(sample, 'nonexistent.path')).toBeUndefined();
    });

    it('blocks prototype pollution attempts', () => {
      expect(resolveJsonPath(sample, '__proto__.polluted')).toBeUndefined();
      expect(resolveJsonPath(sample, 'constructor.name')).toBeUndefined();
    });
  });

  describe('CustomHttpAdapter Execution', () => {
    it('generates text using template substitution and textPath extraction', async () => {
      let sentBody: string = '';
      let sentHeaders: Headers | undefined;

      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
        sentBody = init?.body as string;
        sentHeaders = init?.headers as Headers;
        return new Response(
          JSON.stringify({
            output: {
              article: 'Custom generated text about quantum computing.',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const adapter = new CustomHttpAdapter({
        method: 'POST',
        url: 'https://one.one.one.one/api/v1/generate', // Public IP for SSRF check
        headers: {
          Authorization: 'Bearer {{key}}',
          'X-Custom-Model': '{{model}}',
        },
        bodyTemplate: '{"input": "{{prompt}}", "max": 1000}',
        textPath: 'output.article',
      });

      const result = await adapter.generateText({
        prompt: 'Explain quantum computing',
        model: 'custom-q-model',
        apiKey: 'my-custom-key-123',
      });

      expect(result.text).toBe('Custom generated text about quantum computing.');
      expect(sentBody).toBe('{"input": "Explain quantum computing", "max": 1000}');
    });

    it('generates image from base64Path in JSON response', async () => {
      const mockBase64 = Buffer.alloc(512, 123).toString('base64');

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifacts: [
              { base64: mockBase64 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const adapter = new CustomHttpAdapter({
        method: 'POST',
        url: 'https://one.one.one.one/api/image',
        bodyTemplate: '{"prompt": "{{prompt}}", "width": {{width}}, "height": {{height}}}',
        base64Path: 'artifacts[0].base64',
      });

      const result = await adapter.generateImage({
        prompt: 'Haunted abandoned lighthouse at sea',
        width: 1080,
        height: 1350,
      });

      expect(result.imageBuffer.length).toBe(512);
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1350);
    });

    it('blocks SSRF when custom HTTP URL targets private subnet', async () => {
      const adapter = new CustomHttpAdapter({
        method: 'POST',
        url: 'https://192.168.1.100/admin/api',
      });

      await expect(
        adapter.generateText({
          prompt: 'test',
          model: 'test',
          apiKey: 'key',
        })
      ).rejects.toMatchObject({
        kind: 'auth',
        statusCode: 403,
      });
    });
  });
});
