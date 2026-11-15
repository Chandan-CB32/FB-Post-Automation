import { getBundledFont, SupportedFontFamily } from '../fonts/font-loader.js';
import { HeadlineSegment, parseHeadlineSegments, HighlightOptions } from './headline-highlighter.js';
import { layoutHeadline, HeadlineLayoutOptions, HeadlineLayoutResult } from './headline-layout.js';

export interface HeadlineRendererOptions extends HeadlineLayoutOptions, HighlightOptions {
  panelColor?: string; // default '#000000'
  textColor?: string; // default '#FFFFFF'
  imageUrl?: string;
  imageBuffer?: Buffer;
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
  imageBuffer?: Buffer;
  imageUrl?: string;
  canvasWidth: number;
  canvasHeight: number;
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
  let resolvedImageUrl = mergedOptions.imageUrl;
  let resolvedImageBuffer = mergedOptions.imageBuffer;

  if (resolvedImageBuffer && !resolvedImageUrl) {
    resolvedImageUrl = `data:image/jpeg;base64,${resolvedImageBuffer.toString('base64')}`;
  } else if (resolvedImageUrl?.startsWith('data:') && !resolvedImageBuffer) {
    try {
      const b64Part = resolvedImageUrl.split(',')[1];
      if (b64Part) {
        resolvedImageBuffer = Buffer.from(b64Part, 'base64');
      }
    } catch (_) {}
  }

  const topImageMarkup = resolvedImageUrl
    ? `<!-- Photorealistic Scene Cover-Cropped to Upper Area -->
  <image href="${escapeXml(resolvedImageUrl)}" xlink:href="${escapeXml(resolvedImageUrl)}" x="0" y="0" width="${canvasWidth}" height="${layout.panelTop}" preserveAspectRatio="xMidYMid slice" />`
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
    imageBuffer: resolvedImageBuffer,
    imageUrl: resolvedImageUrl,
    canvasWidth,
    canvasHeight,
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

export interface RasterizeHeadlineOptions {
  imageBuffer?: Buffer;
  imageUrl?: string;
  quality?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  panelTop?: number;
}

/**
 * Asynchronously rasterizes a rendered headline card SVG into a high-quality 1080x1350 JPEG buffer.
 * Performs native Sharp compositing when a top photo buffer/URL is available, preventing
 * empty/black boxes caused by librsvg network sandboxing.
 */
export async function rasterizeHeadlineCardToJpeg(
  svgXmlOrResult: string | RenderedHeadlineResult,
  qualityOrOptions: number | RasterizeHeadlineOptions = 95,
  legacyOptions?: RasterizeHeadlineOptions
): Promise<Buffer> {
  const sharp = await getSharpInstance();

  const isResultObject = typeof svgXmlOrResult === 'object' && svgXmlOrResult !== null;
  const svgString = isResultObject ? svgXmlOrResult.svgXml : String(svgXmlOrResult);

  const opts: RasterizeHeadlineOptions =
    typeof qualityOrOptions === 'number'
      ? { quality: qualityOrOptions, ...legacyOptions }
      : { ...qualityOrOptions, ...legacyOptions };

  const quality = opts.quality ?? 95;
  const canvasWidth = opts.canvasWidth ?? (isResultObject ? svgXmlOrResult.canvasWidth : 1080) ?? 1080;
  const canvasHeight = opts.canvasHeight ?? (isResultObject ? svgXmlOrResult.canvasHeight : 1350) ?? 1350;
  const panelTop = opts.panelTop ?? (isResultObject ? svgXmlOrResult.layout?.panelTop : 837) ?? 837;

  let photoBuffer = opts.imageBuffer || (isResultObject ? svgXmlOrResult.imageBuffer : undefined);
  const photoUrl = opts.imageUrl || (isResultObject ? svgXmlOrResult.imageUrl : undefined);

  // If no buffer provided but data URI exists, decode synchronously
  if (!photoBuffer && photoUrl?.startsWith('data:')) {
    try {
      const b64 = photoUrl.split(',')[1];
      if (b64) photoBuffer = Buffer.from(b64, 'base64');
    } catch (_) {}
  }

  // If no buffer provided and SVG contains an embedded data URI, extract it
  if (!photoBuffer && svgString.includes('data:image/')) {
    try {
      const match = svgString.match(/data:image\/[^;]+;base64,([a-zA-Z0-9+/=]+)/);
      if (match && match[1]) {
        photoBuffer = Buffer.from(match[1], 'base64');
      }
    } catch (_) {}
  }

  // If still no buffer but an HTTP URL is given, pre-fetch it
  if (!photoBuffer && photoUrl?.startsWith('http')) {
    try {
      const res = await fetch(photoUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 500) {
          photoBuffer = Buffer.from(ab);
        }
      }
    } catch (fErr) {
      console.warn('[HeadlineRenderer] Could not fetch remote photo for compositing:', fErr);
    }
  }

  // If we have a valid photo buffer (>500 bytes), use native Sharp compositing!
  if (photoBuffer && photoBuffer.byteLength > 500) {
    try {
      // 1. Cover-crop photo to exact upper dimensions (canvasWidth x panelTop)
      const croppedPhoto = await sharp(photoBuffer)
        .resize(canvasWidth, panelTop, { fit: 'cover', position: 'center' })
        .toBuffer();

      // 2. Strip <image .../> from SVG so librsvg doesn't attempt to render it again
      const textOverlaySvg = svgString.replace(/<image\b[^>]*\/>/gi, '');

      // 3. Composite photo at top: 0, left: 0 and SVG text overlay on top
      const compositeBuffer = await sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .composite([
          { input: croppedPhoto, top: 0, left: 0 },
          { input: Buffer.from(textOverlaySvg), top: 0, left: 0 },
        ])
        .jpeg({ quality, chromaSubsampling: '4:4:4' })
        .toBuffer();

      return compositeBuffer;
    } catch (cErr) {
      console.warn('[HeadlineRenderer] Native Sharp compositing failed, falling back to direct SVG:', cErr);
    }
  }

  // Direct SVG fallback
  return await sharp(Buffer.from(svgString))
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
