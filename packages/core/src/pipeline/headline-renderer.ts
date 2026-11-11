import { getBundledFont, SupportedFontFamily } from '../fonts/font-loader.js';
import { HeadlineSegment, parseHeadlineSegments, HighlightOptions } from './headline-highlighter.js';
import { layoutHeadline, HeadlineLayoutOptions, HeadlineLayoutResult } from './headline-layout.js';

export interface HeadlineRendererOptions extends HeadlineLayoutOptions, HighlightOptions {
  panelColor?: string; // default '#000000'
  textColor?: string; // default '#FFFFFF'
  imageUrl?: string;
  themeColor?: string;
}

export interface RenderedHeadlineResult {
  svg: string;
  svgDataUri: string;
  svgXml: string;
  plainHeadline: string;
  segments: HeadlineSegment[];
  layout: HeadlineLayoutResult;
  fontFamily: SupportedFontFamily;
}

function escapeXml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds the viral fact card composite SVG matching the reference image specification:
 * - Upper photo area: cover-cropped, main subject centered, hard clean edge.
 * - Lower black panel: #000000, 30%-42% height auto-fit to lines.
 * - Text: Condensed bold sans-serif (Roboto Condensed Bold), ALL CAPS, centered horizontally and vertically.
 * - Color emphasis: attention-grabbing words highlighted in contrasting accent colors (#FFD21F, #22D3EE, etc.).
 * - Embedded base64 font: renders with pixel-perfect fidelity across Vercel, Linux CI, and all browsers without fallback.
 */
export function renderHeadlineCard(
  headlineOrOptions: string | ({ headlineText?: string; headline?: string } & HeadlineRendererOptions),
  options: HeadlineRendererOptions = {}
): RenderedHeadlineResult {
  let headlineText = '';
  let mergedOptions: HeadlineRendererOptions = {};

  if (typeof headlineOrOptions === 'object' && headlineOrOptions !== null) {
    headlineText = headlineOrOptions.headlineText || (headlineOrOptions as any).headline || '';
    mergedOptions = { ...headlineOrOptions, ...options };
  } else {
    headlineText = String(headlineOrOptions || '');
    mergedOptions = { ...options };
  }

  const canvasWidth = mergedOptions.canvasWidth ?? 1080;
  const canvasHeight = mergedOptions.canvasHeight ?? 1350;
  const fontFamily = mergedOptions.fontFamily ?? 'Roboto Condensed';
  const panelColor = mergedOptions.panelColor && mergedOptions.panelColor.trim() ? mergedOptions.panelColor.trim() : '#000000';
  const defaultTextColor = mergedOptions.textColor ?? '#FFFFFF';

  // 1. Parse markers and segments (**WORD**)
  const parsed = parseHeadlineSegments(headlineText, mergedOptions);

  // 2. Perform layout and auto-fit font sizing
  const layout = layoutHeadline(parsed.segments, {
    canvasWidth,
    canvasHeight,
    fontFamily,
    panelHeightMode: mergedOptions.panelHeightMode,
    fixedPanelRatio: mergedOptions.fixedPanelRatio,
    minFontSize: mergedOptions.minFontSize,
    maxFontSize: mergedOptions.maxFontSize,
  });

  // 3. Load font buffer and generate base64 data URL for embedded @font-face
  const bundledFont = getBundledFont(fontFamily);
  const fontBase64 = bundledFont.base64;

  // 4. Build text markup with multi-colored <tspan> elements
  const textLinesMarkup = layout.lines
    .map((line, idx) => {
      const lineY = layout.startY + idx * layout.lineHeight;

      // Group consecutive tokens with the same color into tspans
      const spans: string[] = [];
      let currentSpanText = '';
      let currentColor = '';

      for (let i = 0; i < line.tokens.length; i++) {
        const token = line.tokens[i];
        const tokenColor = token.isHighlighted ? token.color || options.primaryAccent || '#FFD21F' : defaultTextColor;
        const separator = i > 0 ? ' ' : '';

        if (!currentColor) {
          currentColor = tokenColor;
          currentSpanText = token.word;
        } else if (currentColor === tokenColor) {
          currentSpanText += separator + token.word;
        } else {
          spans.push(`<tspan fill="${currentColor}">${escapeXml(currentSpanText)}</tspan>`);
          currentColor = tokenColor;
          currentSpanText = ' ' + token.word;
        }
      }

      if (currentSpanText) {
        spans.push(`<tspan fill="${currentColor}">${escapeXml(currentSpanText)}</tspan>`);
      }

      return `<text x="${canvasWidth / 2}" y="${lineY}" text-anchor="middle" font-family="'${fontFamily}', sans-serif" font-size="${layout.fontSize}" font-weight="700" letter-spacing="0.5px">
      ${spans.join('')}
    </text>`;
    })
    .join('\n    ');

  // 5. Visual top area: full-bleed AI image or clean fallback
  const topImageMarkup = options.imageUrl
    ? `<!-- Photorealistic Scene Cover-Cropped to Upper Area -->
  <image href="${options.imageUrl}" x="0" y="0" width="${canvasWidth}" height="${layout.panelTop}" preserveAspectRatio="xMidYMid slice" />`
    : `<!-- Rich Space Atmosphere Scene Fallback -->
  <defs>
    <radialGradient id="topGlow" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="60%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${canvasWidth}" height="${layout.panelTop}" fill="url(#topGlow)"/>`;

  // 6. Complete self-contained SVG
  const svgXml = `<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <style>
      @font-face {
        font-family: '${fontFamily}';
        font-weight: 700;
        font-style: normal;
        src: url('data:font/truetype;charset=utf-8;base64,${fontBase64}') format('truetype');
      }
    </style>
  </defs>
  
  <!-- Upper Photo Area -->
  ${topImageMarkup}

  <!-- Lower Pitch-Black Headline Panel (Hard Clean Edge) -->
  <rect x="0" y="${layout.panelTop}" width="${canvasWidth}" height="${layout.panelHeight}" fill="${panelColor}"/>

  <!-- Centered Bold High-Impact Headline with Word-Level Accents -->
  <g id="headline-text">
    ${textLinesMarkup}
  </g>
</svg>`.trim();

  const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgXml)}`;

  return {
    svg: svgXml,
    svgDataUri,
    svgXml,
    plainHeadline: parsed.plainHeadline,
    segments: parsed.segments,
    layout,
    fontFamily,
  };
}
