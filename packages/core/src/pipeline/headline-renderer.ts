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
  const fontFamily = (mergedOptions.fontFamily as SupportedFontFamily) || 'Roboto';
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

  // 3. Load font buffer and parsed OpenType font
  const bundledFont = getBundledFont(fontFamily);
  const fontBase64 = bundledFont.base64;
  const otFont = bundledFont.font;
  const spaceWidth = otFont.getAdvanceWidth(' ', layout.fontSize);

  // 4. Build pixel-perfect vector glyph paths for every line and word
  const vectorPaths: string[] = [];
  const accessibleTextParts: string[] = [];

  for (let idx = 0; idx < layout.lines.length; idx++) {
    const line = layout.lines[idx];
    const lineY = layout.startY + idx * layout.lineHeight;

    // Calculate exact advance width of the line from tokens and word spaces
    let totalLineWidth = 0;
    const tokenAdvances: number[] = [];
    for (let t = 0; t < line.tokens.length; t++) {
      const adv = otFont.getAdvanceWidth(line.tokens[t].word, layout.fontSize);
      tokenAdvances.push(adv);
      totalLineWidth += adv + (t > 0 ? spaceWidth : 0);
    }

    // Perfectly center the line within canvasWidth
    let currentX = Math.round((canvasWidth - totalLineWidth) / 2);

    for (let t = 0; t < line.tokens.length; t++) {
      const token = line.tokens[t];
      const tokenColor = token.isHighlighted ? token.color || options.primaryAccent || '#FFD21F' : defaultTextColor;

      if (t > 0) {
        currentX += spaceWidth;
      }

      try {
        const glyphPath = otFont.getPath(token.word, currentX, lineY, layout.fontSize);
        const pathData = glyphPath.toPathData(2);
        if (pathData) {
          vectorPaths.push(`<path d="${pathData}" fill="${tokenColor}"/>`);
        }
      } catch (err) {
        console.warn('[HeadlineRenderer] Vector glyph error:', token.word, err);
      }

      currentX += tokenAdvances[t];
    }

    accessibleTextParts.push(line.tokens.map((t) => t.word).join(' '));
  }

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

  <!-- Centered Bold High-Impact Headline with Vector Glyph Paths -->
  <g id="headline-text" font-family="'${fontFamily}', sans-serif" text-anchor="middle" aria-label="${escapeXml(parsed.plainHeadline)}">
    <!-- Accessible text for screen readers, SEO & test assertions -->
    <text display="none" text-anchor="middle">${escapeXml(accessibleTextParts.join(' / '))}</text>
    <!-- Pixel-Perfect Vector Paths Rendered Directly from Bundled Font -->
    ${vectorPaths.join('\n    ')}
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

async function getSharpInstance(): Promise<any> {
  try {
    const mod = await import('sharp');
    return mod.default || mod;
  } catch {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    return req('sharp');
  }
}

/**
 * Asynchronously rasterizes a rendered headline card SVG into a high-quality 1080x1350 JPEG buffer.
 * Compatible with Facebook Graph API /{page-id}/photos requirement (JPEG/PNG only).
 */
export async function rasterizeHeadlineCardToJpeg(
  svgXmlOrResult: string | RenderedHeadlineResult,
  quality = 95
): Promise<Buffer> {
  const sharp = await getSharpInstance();
  const svgString = typeof svgXmlOrResult === 'string' ? svgXmlOrResult : svgXmlOrResult.svgXml;
  return await sharp(Buffer.from(svgString))
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
