import { measureTextWidth, SupportedFontFamily } from '../fonts/font-loader.js';
import { HeadlineSegment } from './headline-highlighter.js';

export interface HeadlineWordToken {
  word: string;
  isHighlighted: boolean;
  color?: string;
}

export interface FormattedLine {
  text: string;
  tokens: HeadlineWordToken[];
  width: number;
}

export interface HeadlineLayoutOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  sidePaddingRatio?: number; // default 0.07 (7%)
  topBottomPaddingRatio?: number; // default 0.06 (6%)
  panelHeightMode?: 'auto' | 'fixed_30' | 'fixed_36' | 'fixed_42';
  fixedPanelRatio?: number;
  fontFamily?: SupportedFontFamily;
  minFontSize?: number; // default 76
  maxFontSize?: number; // default 124
  targetFillRatio?: number; // default 0.78 (78% of available width)
  lineHeightRatio?: number; // default 1.10
}

export interface HeadlineLayoutResult {
  lines: FormattedLine[];
  fontSize: number;
  lineHeight: number;
  panelHeight: number;
  panelTop: number;
  longestLineWidth: number;
  longestLineFillPercent: number; // relative to available text width
  widthFillPercent: number; // alias for longestLineFillPercent
  canvasFillPercent: number; // relative to canvas width (1080)
  sideMargin: number;
  needsShortening: boolean;
  startY: number;
}

/**
 * Splits headline segments into individual word tokens while preserving highlight markers and colors.
 */
export function tokenizeSegments(segments: HeadlineSegment[]): HeadlineWordToken[] {
  const tokens: HeadlineWordToken[] = [];

  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    for (const w of words) {
      tokens.push({
        word: w,
        isHighlighted: seg.isHighlighted,
        color: seg.color,
      });
    }
  }

  return tokens;
}

/**
 * Calculates panel height according to mode and line count.
 * 2 lines -> 30% (~405px)
 * 3 lines -> 36% (~486px)
 * 4 lines -> 42% (~567px)
 */
export function calculatePanelHeight(
  canvasHeight: number,
  lineCount: number,
  mode: 'auto' | 'fixed_30' | 'fixed_36' | 'fixed_42' = 'auto',
  fixedRatio?: number
): { panelHeight: number; panelTop: number } {
  if (fixedRatio) {
    const ph = Math.round(canvasHeight * fixedRatio);
    return { panelHeight: ph, panelTop: canvasHeight - ph };
  }

  if (mode === 'fixed_30') {
    const ph = Math.round(canvasHeight * 0.3);
    return { panelHeight: ph, panelTop: canvasHeight - ph };
  }
  if (mode === 'fixed_36') {
    const ph = Math.round(canvasHeight * 0.36);
    return { panelHeight: ph, panelTop: canvasHeight - ph };
  }
  if (mode === 'fixed_42') {
    const ph = Math.round(canvasHeight * 0.42);
    return { panelHeight: ph, panelTop: canvasHeight - ph };
  }

  // Auto mode based on line count
  let ratio = 0.36;
  if (lineCount <= 2) ratio = 0.30;
  else if (lineCount === 3) ratio = 0.36;
  else ratio = 0.42;

  const panelHeight = Math.round(canvasHeight * ratio);
  return { panelHeight, panelTop: canvasHeight - panelHeight };
}

/**
 * Generates balanced line splits for a given list of word tokens.
 * Enforces:
 * - Natural phrase breaking
 * - Avoiding orphans (single short word alone on last line)
 * - Avoiding breaking inside highlighted phrases when possible
 * - Never splitting hyphenated words (handled naturally by tokenization)
 */
function partitionTokens(tokens: HeadlineWordToken[], targetLines: number): HeadlineWordToken[][] {
  const n = tokens.length;
  if (n === 0) return [];
  if (n <= targetLines) {
    return tokens.map((t) => [t]);
  }

  // Pre-calculate natural break points
  const candidatePartitions: HeadlineWordToken[][][] = [];

  // Recursive partition search to find balanced splits
  function search(idx: number, currentLines: HeadlineWordToken[][]) {
    if (currentLines.length === targetLines - 1) {
      // Last line gets all remaining tokens
      const remaining = tokens.slice(idx);
      if (remaining.length > 0) {
        candidatePartitions.push([...currentLines, remaining]);
      }
      return;
    }

    // Try taking i tokens for current line
    for (let count = 1; count <= n - idx - (targetLines - currentLines.length - 1); count++) {
      const lineTokens = tokens.slice(idx, idx + count);
      search(idx + count, [...currentLines, lineTokens]);
    }
  }

  search(0, []);

  if (candidatePartitions.length === 0) {
    // Fallback: divide evenly
    const lines: HeadlineWordToken[][] = [];
    const chunkSize = Math.ceil(n / targetLines);
    for (let i = 0; i < n; i += chunkSize) {
      lines.push(tokens.slice(i, i + chunkSize));
    }
    return lines;
  }

  // Score candidate partitions based on balance and rules
  let bestPartition = candidatePartitions[0];
  let bestScore = -Infinity;

  for (const part of candidatePartitions) {
    let score = 100;
    const lineWordCounts = part.map((l) => l.length);
    const lastLine = part[part.length - 1];

    // Penalty: single short word on last line (orphan)
    if (lastLine.length === 1 && lastLine[0].word.length <= 6) {
      score -= 80;
    }

    // Penalty: high variance in word counts across lines
    const maxWords = Math.max(...lineWordCounts);
    const minWords = Math.min(...lineWordCounts);
    score -= (maxWords - minWords) * 12;

    // Penalty: breaking inside a highlighted phrase
    for (let l = 0; l < part.length - 1; l++) {
      const lineEndToken = part[l][part[l].length - 1];
      const nextLineStartToken = part[l + 1][0];
      if (lineEndToken.isHighlighted && nextLineStartToken.isHighlighted && lineEndToken.color === nextLineStartToken.color) {
        score -= 25; // discourage breaking inside the same highlighted phrase
      }
    }

    // Natural phrase boundary scoring:
    // Bonus: First line ending with subject verb (HAS, IS, FINDS, HIDES)
    const firstLineEndWord = part[0][part[0].length - 1]?.word;
    if (['HAS', 'IS', 'FINDS', 'HIDES', 'SHOWS', 'REVEALS'].includes(firstLineEndWord)) {
      score += 35;
    }

    // Bonus: Middle line ending with coordinating conjunction (AND, OR, PLUS)
    for (let l = 0; l < part.length - 1; l++) {
      const endWord = part[l][part[l].length - 1]?.word;
      if (['AND', 'OR', 'PLUS', 'WITH'].includes(endWord)) {
        score += 30;
      }
      const startWord = part[l + 1][0]?.word;
      if (['AND', 'OR'].includes(startWord)) {
        score -= 20; // Disfavor starting lines with AND
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPartition = part;
    }
  }

  return bestPartition;
}

/**
 * Computes optimal font size, line-wrapping, and vertical positioning for a headline.
 */
export function layoutHeadline(
  segments: HeadlineSegment[],
  options: HeadlineLayoutOptions = {}
): HeadlineLayoutResult {
  const canvasWidth = options.canvasWidth ?? 1080;
  const canvasHeight = options.canvasHeight ?? 1350;
  const sideMarginRatio = options.sidePaddingRatio ?? 0.07; // 7%
  const topBottomPaddingRatio = options.topBottomPaddingRatio ?? 0.06; // 6%
  const availableWidth = canvasWidth * (1 - sideMarginRatio * 2); // ~928.8px
  const fontFamily = options.fontFamily ?? 'Roboto Condensed';
  const minFontSize = options.minFontSize ?? 76;
  const maxFontSize = options.maxFontSize ?? 124;
  const lineHeightRatio = options.lineHeightRatio ?? 1.10;
  const targetFillRatio = options.targetFillRatio ?? 0.78; // 78% of available width

  const tokens = tokenizeSegments(segments);

  if (tokens.length === 0) {
    return {
      lines: [],
      fontSize: minFontSize,
      lineHeight: minFontSize * lineHeightRatio,
      panelHeight: Math.round(canvasHeight * 0.36),
      panelTop: Math.round(canvasHeight * 0.64),
      longestLineWidth: 0,
      longestLineFillPercent: 0,
      widthFillPercent: 0,
      canvasFillPercent: 0,
      sideMargin: canvasWidth * sideMarginRatio,
      needsShortening: false,
      startY: 0,
    };
  }

  // Test candidate line counts: 2, 3, 4 lines
  type CandidateResult = {
    partition: HeadlineWordToken[][];
    lineStrings: string[];
    fontSize: number;
    longestWidth: number;
    totalHeight: number;
    panelHeight: number;
    panelTop: number;
    score: number;
  };

  const candidates: CandidateResult[] = [];
  const candidateLineCounts = tokens.length <= 4 ? [2] : tokens.length <= 8 ? [2, 3] : [3, 4];

  for (const lineCount of candidateLineCounts) {
    const partition = partitionTokens(tokens, lineCount);
    const lineStrings = partition.map((lineTokens) => lineTokens.map((t) => t.word).join(' '));
    const { panelHeight, panelTop } = calculatePanelHeight(
      canvasHeight,
      lineCount,
      options.panelHeightMode,
      options.fixedPanelRatio
    );
    const availableHeight = panelHeight * (1 - topBottomPaddingRatio * 2);

    // Find the largest font size (stepping down from maxFontSize)
    let bestFs = 0;
    let longestWidth = 0;
    let totalTextHeight = 0;

    for (let fs = maxFontSize; fs >= minFontSize; fs -= 2) {
      const lh = Math.round(fs * lineHeightRatio);
      const th = (lineCount - 1) * lh + fs;

      if (th > availableHeight) continue;

      let fitsWidth = true;
      let maxW = 0;

      for (const str of lineStrings) {
        const w = measureTextWidth(str, fs, fontFamily);
        if (w > availableWidth) {
          fitsWidth = false;
          break;
        }
        if (w > maxW) maxW = w;
      }

      if (fitsWidth) {
        bestFs = fs;
        longestWidth = maxW;
        totalTextHeight = th;
        break;
      }
    }

    if (bestFs >= minFontSize) {
      const fillRatio = longestWidth / availableWidth;
      // High score for large font, filling available width >= 78%
      let score = bestFs * 10;
      if (fillRatio >= targetFillRatio) {
        score += 200;
      }
      if (lineCount === 3 && tokens.length >= 6 && tokens.length <= 11) {
        score += 100; // 3 lines is the sweet spot for viral reference look
      }
      candidates.push({
        partition,
        lineStrings,
        fontSize: bestFs,
        longestWidth,
        totalHeight: totalTextHeight,
        panelHeight,
        panelTop,
        score,
      });
    }
  }

  // If no candidate fits within minFontSize (76px), headline needs shortening!
  if (candidates.length === 0) {
    // Generate fallback layout at minFontSize with 4 lines
    const partition = partitionTokens(tokens, 4);
    const lineStrings = partition.map((lineTokens) => lineTokens.map((t) => t.word).join(' '));
    const { panelHeight, panelTop } = calculatePanelHeight(canvasHeight, 4, options.panelHeightMode, options.fixedPanelRatio);
    const lh = Math.round(minFontSize * lineHeightRatio);
    const th = 3 * lh + minFontSize;
    const maxW = Math.max(...lineStrings.map((s) => measureTextWidth(s, minFontSize, fontFamily)));

    const formattedLines: FormattedLine[] = partition.map((pt, idx) => ({
      text: lineStrings[idx],
      tokens: pt,
      width: measureTextWidth(lineStrings[idx], minFontSize, fontFamily),
    }));

    const centerY = panelTop + panelHeight / 2;
    const startY = Math.round(centerY - ((formattedLines.length - 1) * lh) / 2 + minFontSize * 0.35);

    return {
      lines: formattedLines,
      fontSize: minFontSize,
      lineHeight: lh,
      panelHeight,
      panelTop,
      longestLineWidth: maxW,
      longestLineFillPercent: Number(((maxW / availableWidth) * 100).toFixed(1)),
      widthFillPercent: Number(((maxW / availableWidth) * 100).toFixed(1)),
      canvasFillPercent: Number(((maxW / canvasWidth) * 100).toFixed(1)),
      sideMargin: (canvasWidth - maxW) / 2,
      needsShortening: true, // Flagged for shortening!
      startY,
    };
  }

  // Pick candidate with highest score
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const lh = Math.round(best.fontSize * lineHeightRatio);
  const centerY = best.panelTop + best.panelHeight / 2;
  const startY = Math.round(centerY - ((best.partition.length - 1) * lh) / 2 + best.fontSize * 0.35);

  const formattedLines: FormattedLine[] = best.partition.map((pt, idx) => ({
    text: best.lineStrings[idx],
    tokens: pt,
    width: measureTextWidth(best.lineStrings[idx], best.fontSize, fontFamily),
  }));

  return {
    lines: formattedLines,
    fontSize: best.fontSize,
    lineHeight: lh,
    panelHeight: best.panelHeight,
    panelTop: best.panelTop,
    longestLineWidth: best.longestWidth,
    longestLineFillPercent: Number(((best.longestWidth / availableWidth) * 100).toFixed(1)),
    widthFillPercent: Number(((best.longestWidth / availableWidth) * 100).toFixed(1)),
    canvasFillPercent: Number(((best.longestWidth / canvasWidth) * 100).toFixed(1)),
    sideMargin: (canvasWidth - best.longestWidth) / 2,
    needsShortening: false,
    startY,
  };
}

export const computeHeadlineLayout = layoutHeadline;
