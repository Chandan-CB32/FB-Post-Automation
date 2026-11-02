import {
  TextProviderAdapter,
  TextGenerateOptions,
  TextGenerateResult,
  ChatMessage,
  ProviderError,
} from './types.js';
import { extractJsonFromText } from './json-extractor.js';

export class OpenAIChatAdapter implements TextProviderAdapter {
  public readonly id = 'openai_compatible_chat';

  async generateText(options: TextGenerateOptions): Promise<TextGenerateResult> {
    const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/chat/completions`;

    // Construct messages array
    const messages: ChatMessage[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options.messages && options.messages.length > 0) {
      messages.push(...options.messages);
    } else if (options.prompt) {
      messages.push({ role: 'user', content: options.prompt });
    } else {
      throw new ProviderError('Neither messages nor prompt provided to OpenAIChatAdapter.', 'invalid_output');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
      ...options.customHeaders,
    };

    // If calling OpenRouter, inject default attribution headers if not already set
    if (baseUrl.includes('openrouter.ai')) {
      if (!headers['HTTP-Referer']) headers['HTTP-Referer'] = 'https://fb-post-automation.local';
      if (!headers['X-Title']) headers['X-Title'] = 'FB Post Automation';
    }

    const requestBody: Record<string, unknown> = {
      model: options.model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      ...options.extraBody,
    };

    if (options.jsonMode) {
      requestBody.response_format = { type: 'json_object' };
    }

    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 45000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ProviderError(`Request timed out after ${timeoutMs}ms`, 'timeout', 504);
      }
      throw new ProviderError(
        `Network error calling ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        'network_error'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    // Retry once without response_format if provider doesn't support json_object mode
    if (
      !response.ok &&
      response.status === 400 &&
      options.jsonMode &&
      requestBody.response_format
    ) {
      const errorText = await response.text();
      if (
        errorText.toLowerCase().includes('response_format') ||
        errorText.toLowerCase().includes('json_object')
      ) {
        delete requestBody.response_format;
        return this.generateText({
          ...options,
          jsonMode: true, // will parse in code
          extraBody: { ...requestBody, response_format: undefined },
        });
      }
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError('Failed to parse response body as JSON from provider.', 'invalid_output', response.status);
    }

    const choice = data?.choices?.[0];
    const textContent = choice?.message?.content || '';
    const finishReason = choice?.finish_reason || 'stop';

    if (finishReason === 'content_filter') {
      throw new ProviderError('Generation blocked by provider content policy filter.', 'content_policy', 400, undefined, data);
    }

    let parsedJson: unknown | undefined;
    if (options.jsonMode) {
      parsedJson = extractJsonFromText(textContent);
    }

    const tokens = {
      promptTokens: data?.usage?.prompt_tokens || 0,
      completionTokens: data?.usage?.completion_tokens || 0,
      totalTokens: data?.usage?.total_tokens || 0,
    };

    return {
      text: textContent,
      tokens,
      latencyMs,
      finishReason,
      parsedJson,
      modelUsed: data?.model || options.model,
      rawResponse: data,
    };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const status = response.status;
    let bodyText = '';
    let parsedBody: any;

    try {
      bodyText = await response.text();
      parsedBody = JSON.parse(bodyText);
    } catch {
      // Raw string
    }

    const errorMessage =
      parsedBody?.error?.message ||
      parsedBody?.message ||
      bodyText ||
      `HTTP Error ${status}`;

    if (status === 401 || status === 403) {
      throw new ProviderError(`Authentication failed: ${errorMessage}`, 'auth', status, undefined, parsedBody);
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      let retryAfterSeconds: number | undefined;
      if (retryAfterHeader) {
        const parsedSeconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsedSeconds)) {
          retryAfterSeconds = parsedSeconds;
        }
      }
      throw new ProviderError(`Rate limit exceeded: ${errorMessage}`, 'rate_limit', 429, retryAfterSeconds, parsedBody);
    }

    if (status === 400 && errorMessage.toLowerCase().includes('safety')) {
      throw new ProviderError(`Safety refusal: ${errorMessage}`, 'content_policy', 400, undefined, parsedBody);
    }

    if (status >= 500) {
      throw new ProviderError(`Provider server error: ${errorMessage}`, 'server_error', status, undefined, parsedBody);
    }

    throw new ProviderError(`Provider request failed (${status}): ${errorMessage}`, 'invalid_output', status, undefined, parsedBody);
  }
}
