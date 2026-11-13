export type ProviderErrorKind =
  | 'auth'           // 401 / 403
  | 'rate_limit'     // 429 / quota
  | 'timeout'        // Network timeout / 504
  | 'content_policy' // Refusal / moderation filter
  | 'server_error'   // 5xx
  | 'invalid_output' // Unparseable JSON / empty output
  | 'network_error'; // Fetch failure / DNS

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    public readonly statusCode?: number,
    public readonly retryAfterSeconds?: number,
    public readonly rawBody?: unknown
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TextGenerateOptions {
  prompt?: string;
  messages?: ChatMessage[];
  systemPrompt?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  apiKey: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TextGenerateResult {
  text: string;
  tokens: TokenUsage;
  latencyMs: number;
  finishReason?: string;
  parsedJson?: unknown;
  modelUsed: string;
  rawResponse?: unknown;
}

export interface ImageGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: '4:5' | '1:1' | '16:9';
  model?: string;
  seed?: number;
  timeoutMs?: number;
  apiKey?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface ImageGenerateResult {
  imageBuffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  latencyMs: number;
  modelUsed: string;
  imageUrl?: string;
  rawResponse?: unknown;
}

export interface TextProviderAdapter {
  readonly id: string;
  generateText(options: TextGenerateOptions): Promise<TextGenerateResult>;
}

export interface ImageProviderAdapter {
  readonly id: string;
  generateImage(options: ImageGenerateOptions): Promise<ImageGenerateResult>;
}

