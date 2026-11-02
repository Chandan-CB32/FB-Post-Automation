/**
 * Safe, zero-eval JSONPath value extractor.
 * Supports dot notation and numeric array index access, e.g.:
 * - "choices[0].message.content"
 * - "data[0].url"
 * - "result.response"
 */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (!path || typeof path !== 'string' || !obj || typeof obj !== 'object') {
    return undefined;
  }

  // Normalize path tokens: e.g. "choices[0].message.content" -> ["choices", "0", "message", "content"]
  const normalizedPath = path
    .trim()
    .replace(/^(\$\.|\$)/, '') // Strip leading $ or $.
    .replace(/\[(\d+)\]/g, '.$1') // Replace [0] with .0
    .replace(/^\./, '');

  const tokens = normalizedPath.split('.');
  let current: any = obj;

  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Guard against prototype pollution keys
    if (token === '__proto__' || token === 'constructor' || token === 'prototype') {
      return undefined;
    }

    if (Array.isArray(current)) {
      const idx = parseInt(token, 10);
      if (isNaN(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current[idx];
    } else if (typeof current === 'object') {
      current = current[token];
    } else {
      return undefined;
    }
  }

  return current;
}
