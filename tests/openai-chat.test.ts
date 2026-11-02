import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIChatAdapter } from '../packages/core/src/adapters/openai-chat.js';
import { ProviderError } from '../packages/core/src/adapters/types.js';

describe('OpenAIChatAdapter', () => {
  let adapter: OpenAIChatAdapter;

  beforeEach(() => {
    adapter = new OpenAIChatAdapter();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully generates text from prompt and systemPrompt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-123',
          model: 'gpt-4o-mini',
          choices: [
            {
              message: { role: 'assistant', content: 'In the shadows of the old clock tower...' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 25, completion_tokens: 50, total_tokens: 75 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await adapter.generateText({
      prompt: 'Write a horror opening',
      systemPrompt: 'You are a master horror storyteller',
      model: 'gpt-4o-mini',
      apiKey: 'test-sk-key',
    });

    expect(result.text).toBe('In the shadows of the old clock tower...');
    expect(result.tokens.totalTokens).toBe(75);
    expect(result.modelUsed).toBe('gpt-4o-mini');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('parses JSON mode with extractJsonFromText fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '```json\n{"score": 92, "verdict": "pass"}\n```',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await adapter.generateText({
      prompt: 'Score this caption',
      model: 'llama-3.3-70b-versatile',
      apiKey: 'test-key',
      jsonMode: true,
    });

    expect(result.parsedJson).toEqual({ score: 92, verdict: 'pass' });
  });

  it('retries without response_format when provider returns 400 for unsupported json_object', async () => {
    // 1st call fails with 400 saying response_format not supported
    // 2nd call succeeds without response_format
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "Unrecognized request argument 'response_format' for model" },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: 'assistant', content: '{"answer": "fallback worked"}' },
                finish_reason: 'stop',
              },
            ],
            usage: { total_tokens: 40 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const result = await adapter.generateText({
      prompt: 'Give json',
      model: 'together-custom-model',
      apiKey: 'test-key',
      jsonMode: true,
    });

    expect(result.parsedJson).toEqual({ answer: 'fallback worked' });
  });

  it('throws ProviderError(auth) on 401 or 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      adapter.generateText({
        prompt: 'test',
        model: 'model',
        apiKey: 'bad-key',
      })
    ).rejects.toMatchObject({
      kind: 'auth',
      statusCode: 401,
    });
  });

  it('throws ProviderError(rate_limit) on 429 with retry-after header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Rate limit reached' } }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'retry-after': '12',
          },
        }
      )
    );

    try {
      await adapter.generateText({
        prompt: 'test',
        model: 'model',
        apiKey: 'key',
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.kind).toBe('rate_limit');
      expect(provErr.statusCode).toBe(429);
      expect(provErr.retryAfterSeconds).toBe(12);
    }
  });

  it('throws ProviderError(content_policy) on content filter refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: '' },
              finish_reason: 'content_filter',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      adapter.generateText({
        prompt: 'test',
        model: 'model',
        apiKey: 'key',
      })
    ).rejects.toMatchObject({
      kind: 'content_policy',
    });
  });

  it('throws ProviderError(server_error) on 500 error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 })
    );

    await expect(
      adapter.generateText({
        prompt: 'test',
        model: 'model',
        apiKey: 'key',
      })
    ).rejects.toMatchObject({
      kind: 'server_error',
      statusCode: 500,
    });
  });
});

