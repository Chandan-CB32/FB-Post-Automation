export interface HeadlineSegment {
  text: string;
  isHighlighted: boolean;
  color?: string;
}

export interface HighlightOptions {
  enabled?: boolean;
  primaryAccent?: string;
  secondaryAccent?: string;
  accentPalette?: string[];
  matchNiche?: boolean;
  niche?: string;
  maxHighlightedWords?: number;
}

export const ACCENT_PALETTE = {
  yellow: '#FFD21F', // Standard high-impact viral yellow
  cyan: '#22D3EE', // Science, astronomy, space
  orange: '#FF8A1F', // Breakthroughs, exciting news
  redPink: '#FF4D6D', // Danger, horror, mystery
  green: '#4ADE80', // Biology, nature, health
};

const FILLER_WORDS = new Set([
  'THE',
  'A',
  'AN',
  'OF',
  'AND',
  'OR',
  'BUT',
  'IN',
  'ON',
  'AT',
  'TO',
  'FOR',
  'WITH',
  'BY',
  'FROM',
  'IS',
  'ARE',
  'WAS',
  'WERE',
  'BE',
  'BEEN',
  'HAS',
  'HAVE',
  'HAD',
  'THAT',
  'THIS',
  'THESE',
  'THOSE',
]);

/**
 * Selects accent colors based on niche and options.
 */
export function resolveAccentColors(options: HighlightOptions = {}): { primary: string; secondary: string } {
  let primary = options.primaryAccent || ACCENT_PALETTE.yellow;
  let secondary = options.secondaryAccent || ACCENT_PALETTE.cyan;

  if (options.matchNiche && options.niche) {
    const n = options.niche.toLowerCase();
    if (n.includes('space') || n.includes('astronomy') || n.includes('science') || n.includes('physics')) {
      primary = ACCENT_PALETTE.cyan;
      secondary = ACCENT_PALETTE.yellow;
    } else if (n.includes('horror') || n.includes('danger') || n.includes('mystery') || n.includes('crime')) {
      primary = ACCENT_PALETTE.redPink;
      secondary = ACCENT_PALETTE.orange;
    } else if (n.includes('nature') || n.includes('animal') || n.includes('biology') || n.includes('health')) {
      primary = ACCENT_PALETTE.green;
      secondary = ACCENT_PALETTE.yellow;
    }
  }

  return { primary, secondary };
}

/**
 * Parses markdown style double asterisks **PHRASE** into plain headline and structured segments.
 */
export function parseHeadlineSegments(
  rawHeadline: string,
  options: HighlightOptions = {}
): {
  plainHeadline: string;
  segments: HeadlineSegment[];
  hasHighlight: boolean;
} {
  const cleanInput = (rawHeadline || '').trim();
  const { primary, secondary } = resolveAccentColors(options);

  if (!cleanInput.includes('**') || options.enabled === false) {
    // No markers or disabled
    const fallback = applyFallbackHighlighting(cleanInput.replace(/\*\*/g, ''), options);
    return fallback;
  }

  // Regex split on **...**
  const parts = cleanInput.split(/(\*\*[^*]+\*\*)/g);
  const segments: HeadlineSegment[] = [];
  let plainHeadline = '';
  let highlightCount = 0;
  let totalChars = 0;
  let highlightedChars = 0;

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const innerText = part.slice(2, -2).trim().toUpperCase();
      // Validate that it does not consist solely of filler words
      const words = innerText.split(/\s+/);
      const nonFiller = words.filter((w) => !FILLER_WORDS.has(w));

      if (nonFiller.length > 0 && highlightCount < 3) {
        highlightCount++;
        const color = highlightCount % 2 === 1 ? primary : secondary;
        segments.push({
          text: innerText,
          isHighlighted: true,
          color,
        });
        plainHeadline += (plainHeadline ? ' ' : '') + innerText;
        totalChars += innerText.length;
        highlightedChars += innerText.length;
      } else {
        // Demote to normal text
        segments.push({
          text: innerText,
          isHighlighted: false,
        });
        plainHeadline += (plainHeadline ? ' ' : '') + innerText;
        totalChars += innerText.length;
      }
    } else {
      const text = part.trim().toUpperCase();
      if (text) {
        segments.push({
          text,
          isHighlighted: false,
        });
        plainHeadline += (plainHeadline ? ' ' : '') + text;
        totalChars += text.length;
      }
    }
  }

  // Guard: if highlighted characters exceed 55% of total, remove least significant highlights
  if (highlightedChars > totalChars * 0.55 && segments.length > 1) {
    // Only keep first highlight
    let keptFirst = false;
    for (const seg of segments) {
      if (seg.isHighlighted) {
        if (!keptFirst) {
          keptFirst = true;
        } else {
          seg.isHighlighted = false;
          delete seg.color;
        }
      }
    }
  }

  return {
    plainHeadline: plainHeadline.toUpperCase().replace(/\s+/g, ' ').trim(),
    segments,
    hasHighlight: segments.some((s) => s.isHighlighted),
  };
}

/**
 * Fallback highlighting heuristic when the AI writer did not provide **...** markers.
 * Heuristic priority:
 * 1. Numbers, percentages, or measurements (e.g. "THREE", "124 LIGHT-YEARS", "99%")
 * 2. Key rare/surprising words or noun phrases
 * Maximum 3 words highlighted.
 */
export function applyFallbackHighlighting(
  plainHeadline: string,
  options: HighlightOptions = {}
): {
  plainHeadline: string;
  segments: HeadlineSegment[];
  hasHighlight: boolean;
} {
  const clean = plainHeadline.trim().toUpperCase().replace(/\s+/g, ' ');
  const { primary } = resolveAccentColors(options);

  if (options.enabled === false) {
    return {
      plainHeadline: clean,
      segments: [{ text: clean, isHighlighted: false }],
      hasHighlight: false,
    };
  }

  const words = clean.split(' ');
  if (words.length <= 2) {
    return {
      plainHeadline: clean,
      segments: [{ text: clean, isHighlighted: false }],
      hasHighlight: false,
    };
  }

  const maxWords = options.maxHighlightedWords ?? 3;
  let targetIdxStart = -1;
  let targetIdxEnd = -1;

  // 1. Look for numbers or measurements
  const numberRegex = /^(THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|FIRST|MILLION|BILLION|\d+(%|X|KM|LIGHT-YEARS)?)$/i;
  for (let i = 0; i < words.length; i++) {
    if (numberRegex.test(words[i])) {
      targetIdxStart = i;
      // Also grab next word if not filler
      targetIdxEnd = i + 1 < words.length && !FILLER_WORDS.has(words[i + 1]) ? i + 1 : i;
      break;
    }
  }

  // 2. Look for surprising noun phrase or longest content words
  if (targetIdxStart === -1) {
    let longestWordLen = 0;
    let longestIdx = -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!FILLER_WORDS.has(w) && w.length > longestWordLen) {
        longestWordLen = w.length;
        longestIdx = i;
      }
    }
    if (longestIdx !== -1) {
      targetIdxStart = longestIdx;
      targetIdxEnd = longestIdx;
    }
  }

  if (targetIdxStart === -1) {
    // No suitable word found
    return {
      plainHeadline: clean,
      segments: [{ text: clean, isHighlighted: false }],
      hasHighlight: false,
    };
  }

  // Build segments
  const before = words.slice(0, targetIdxStart).join(' ');
  const highlighted = words.slice(targetIdxStart, Math.min(targetIdxEnd + 1, targetIdxStart + maxWords)).join(' ');
  const after = words.slice(targetIdxStart + highlighted.split(' ').length).join(' ');

  const segments: HeadlineSegment[] = [];
  if (before) segments.push({ text: before, isHighlighted: false });
  if (highlighted) segments.push({ text: highlighted, isHighlighted: true, color: primary });
  if (after) segments.push({ text: after, isHighlighted: false });

  return {
    plainHeadline: clean,
    segments,
    hasHighlight: true,
  };
}

/**
 * Accuracy Guard for Headlines:
 * Replaces overstating certainty verbs with hedged verbs unless explicitly grounded in facts.
 */
export function sanitizeHeadlineAccuracy(
  headline: string,
  verifiedFacts: string[] = []
): {
  headline: string;
  modified: boolean;
  reason?: string;
} {
  let clean = headline.trim();
  let modified = false;
  let reason: string | undefined;

  // Check if any fact explicitly confirms 100% definitive proof
  const hasDefinitiveProof = verifiedFacts.some((f) => {
    const fl = f.toLowerCase();
    return fl.includes('definitively proven') || fl.includes('conclusive proof') || fl.includes('100% verified');
  });

  if (!hasDefinitiveProof) {
    const certaintyPatterns: Array<[RegExp, string, string]> = [
      [/\bIDENTIFIES\b/gi, 'FINDS CLUES TO', 'Replaced absolute "IDENTIFIES" with "FINDS CLUES TO"'],
      [/\bIDENTIFY\b/gi, 'FIND CLUES TO', 'Replaced absolute "IDENTIFY" with "FIND CLUES TO"'],
      [/\bPROVES\b/gi, 'SUGGESTS', 'Replaced "PROVES" with "SUGGESTS"'],
      [/\bPROVE\b/gi, 'SUGGEST', 'Replaced "PROVE" with "SUGGEST"'],
      [/\bCONFIRMS\b/gi, 'POINTS TO', 'Replaced "CONFIRMS" with "POINTS TO"'],
      [/\bCONFIRM\b/gi, 'POINT TO', 'Replaced "CONFIRM" with "POINT TO"'],
      [/\bDISCOVERS EVIDENCE OF\b/gi, 'DETECTS SIGNS OF', 'Replaced "DISCOVERS EVIDENCE OF" with "DETECTS SIGNS OF"'],
      [/\bDISCOVER EVIDENCE OF\b/gi, 'DETECT SIGNS OF', 'Replaced "DISCOVER EVIDENCE OF" with "DETECT SIGNS OF"'],
      [/\bDISCOVERS\b/gi, 'FINDS CLUES TO', 'Replaced "DISCOVERS" with "FINDS CLUES TO"'],
      [/\bDISCOVER\b/gi, 'FIND CLUES TO', 'Replaced "DISCOVER" with "FIND CLUES TO"'],
    ];

    for (const [regex, replacement, why] of certaintyPatterns) {
      if (regex.test(clean)) {
        clean = clean.replace(regex, replacement);
        modified = true;
        reason = why;
      }
    }
  }

  return { headline: clean, modified, reason };
}
