import { ProviderError } from './types.js';

/**
 * Robust JSON parser and extractor for LLM text responses.
 * Handles markdown fences, preambles, trailing text, and relaxed formatting.
 */
export function extractJsonFromText(rawText: string): unknown {
  if (!rawText || typeof rawText !== 'string') {
    throw new ProviderError('LLM response text is empty or invalid.', 'invalid_output');
  }

  const trimmed = rawText.trim();

  // 1. Direct parse attempt
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to pattern extraction
  }

  // 2. Markdown fence extraction (```json ... ``` or ``` ... ```)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue to bracket extraction
    }
  }

  // 3. Bracket / brace substring extraction
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue to array check
    }
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Failed
    }
  }

  throw new ProviderError(
    `Failed to parse valid JSON from LLM response: ${rawText.slice(0, 150)}...`,
    'invalid_output',
    undefined,
    undefined,
    rawText
  );
}

