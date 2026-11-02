import { describe, it, expect } from 'vitest';
import { extractJsonFromText } from '../packages/core/src/adapters/json-extractor.js';
import { ProviderError } from '../packages/core/src/adapters/types.js';

describe('JSON Extractor Helper', () => {
  it('parses raw clean JSON string', () => {
    const input = '{"title": "Mystery of the Void", "score": 95}';
    const result = extractJsonFromText(input) as { title: string; score: number };
    expect(result.title).toBe('Mystery of the Void');
    expect(result.score).toBe(95);
  });

  it('extracts JSON enclosed in markdown code fences', () => {
    const input = `
Here is your generated outline:
\`\`\`json
{
  "hook": "It was a dark stormy night",
  "sections": ["The Attic", "The Cellar"]
}
\`\`\`
Hope this helps!
`;
    const result = extractJsonFromText(input) as { hook: string; sections: string[] };
    expect(result.hook).toBe('It was a dark stormy night');
    expect(result.sections.length).toBe(2);
  });

  it('extracts JSON without json tag in fence', () => {
    const input = '```\n{"key": "value"}\n```';
    const result = extractJsonFromText(input) as { key: string };
    expect(result.key).toBe('value');
  });

  it('extracts JSON from surrounding text without fences using braces', () => {
    const input = 'Sure! { "status": "approved", "notes": "looks great" } That is all.';
    const result = extractJsonFromText(input) as { status: string };
    expect(result.status).toBe('approved');
  });

  it('extracts array JSON', () => {
    const input = 'Topics: ["Ghost Ship", "Cursed Island", "Haunted Manor"]';
    const result = extractJsonFromText(input) as string[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  it('throws ProviderError with invalid_output kind on completely malformed input', () => {
    expect(() => extractJsonFromText('Not a json at all')).toThrowError(ProviderError);
    try {
      extractJsonFromText('Malformed { not: valid json');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe('invalid_output');
    }
  });
});

