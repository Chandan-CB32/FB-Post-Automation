import {
  TextProviderAdapter,
  TextGenerateOptions,
  TextGenerateResult,
  ProviderError,
} from './types.js';
import { extractJsonFromText } from './json-extractor.js';

export interface GeminiExtraOptions {
  searchGrounding?: boolean;
}

export class GeminiNativeAdapter implements TextProviderAdapter {
  public readonly id = 'gemini_native';

  async generateText(options: TextGenerateOptions): Promise<TextGenerateResult> {
    const model = options.model.startsWith('models/') ? options.model.replace('models/', '') : options.model;
    const baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/models/${model}:generateContent`;

    // Map messages into Gemini's contents format
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    if (options.messages && options.messages.length > 0) {
      for (const msg of options.messages) {
        if (msg.role === 'system') continue; // Handled in systemInstruction
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    } else if (options.prompt) {
      contents.push({
        role: 'user',
        parts: [{ text: options.prompt }],
      });
    }

    if (contents.length === 0) {
      throw new ProviderError('No user prompt or message provided to Gemini adapter.', 'invalid_output');
    }

    const requestBody: Record<string, unknown> = {
      contents,
    };

    // System instruction
    const systemText =
      options.systemPrompt ||
      options.messages?.find((m) => m.role === 'system')?.content;

    if (systemText) {
      requestBody.systemInstruction = {
        parts: [{ text: systemText }],
      };
    }

    // Generation config
    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }
    if (options.jsonMode) {
      generationConfig.responseMimeType = 'application/json';
    }
    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig;
    }

    // Search grounding tool
    const useSearch = (options.extraBody as GeminiExtraOptions)?.searchGrounding;
    if (useSearch) {
      requestBody.tools = [{ google_search: {} }];
    }

    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 45000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': options.apiKey,
          ...options.customHeaders,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError(`Gemini request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(
        `Network error calling Gemini: ${err instanceof Error ? err.message : String(err)}`,
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError('Failed to parse Gemini response as JSON.', 'invalid_output', response.status);
    }

    if (data.promptFeedback?.blockReason) {
      throw new ProviderError(
        `Gemini blocked prompt: ${data.promptFeedback.blockReason}`,
        'content_policy',
        400,
        undefined,
        data
      );
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new ProviderError('Gemini returned no candidates.', 'invalid_output', 200, undefined, data);
    }

    if (candidate.finishReason === 'SAFETY') {
      throw new ProviderError('Gemini output blocked by safety filter.', 'content_policy', 400, undefined, data);
    }

    const textContent = candidate.content?.parts?.[0]?.text || '';
    let parsedJson: unknown | undefined;
    if (options.jsonMode) {
      parsedJson = extractJsonFromText(textContent);
    }

    const tokens = {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0,
    };

    return {
      text: textContent,
      tokens,
      latencyMs,
      finishReason: candidate.finishReason || 'STOP',
      parsedJson,
      modelUsed: model,
      rawResponse: data,
    };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const status = response.status;
    let bodyText = '';
    let parsed: any;

    try {
      bodyText = await response.text();
      parsed = JSON.parse(bodyText);
    } catch {
      // Raw string
    }

    const message = parsed?.error?.message || bodyText || `HTTP ${status}`;

    if (status === 400 && message.toLowerCase().includes('api_key_invalid')) {
      throw new ProviderError(`Gemini invalid API key: ${message}`, 'auth', 401, undefined, parsed);
    }
    if (status === 401 || status === 403) {
      throw new ProviderError(`Gemini auth error: ${message}`, 'auth', status, undefined, parsed);
    }
    if (status === 429) {
      throw new ProviderError(`Gemini quota exceeded: ${message}`, 'rate_limit', 429, undefined, parsed);
    }
    if (status >= 500) {
      throw new ProviderError(`Gemini server error: ${message}`, 'server_error', status, undefined, parsed);
    }

    throw new ProviderError(`Gemini API error (${status}): ${message}`, 'invalid_output', status, undefined, parsed);
  }
}
