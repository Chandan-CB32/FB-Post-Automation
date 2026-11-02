import sharp from 'sharp';

export interface HeadlinePanelOptions {
  enabled: boolean;
  headlineText?: string;
  heightPercent?: number; // 10 to 50, default 25
  backgroundColor?: string; // hex or rgba, default '#000000'
  textColor?: string; // hex or rgb, default '#FFFFFF'
  fontSize?: number; // optional, auto-scaled if omitted
  fontFamily?: string;
  fontWeight?: string;
  align?: 'center' | 'left';
  sourceText?: string; // e.g. "SOURCE: NASA / JPL"
  watermarkText?: string; // e.g. "SPACE & SCIENCE"
  paddingHorizontal?: number;
  paddingVertical?: number;
}

export interface CompositorOptions {
  targetWidth?: number;
  targetHeight?: number;
  aspectRatio?: '4:5' | '1:1' | '16:9';
  panel?: HeadlinePanelOptions;
  quality?: number; // 1 to 100, default 85
  fit?: 'cover' | 'contain' | 'fill';
}

export interface ComposedImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'jpeg';
  hasPanel: boolean;
  byteSize: number;
}

/**
 * Maps standard aspect ratios to pixel dimensions
 */
export function getAspectDimensions(aspectRatio: '4:5' | '1:1' | '16:9' = '4:5'): { width: number; height: number } {
  switch (aspectRatio) {
    case '1:1':
      return { width: 1080, height: 1080 };
    case '16:9':
      return { width: 1920, height: 1080 };
    case '4:5':
    default:
      return { width: 1080, height: 1350 };
  }
}

/**
 * Escapes XML / SVG special characters
 */
export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wraps text into multiple lines given a maximum character limit per line.
 */
export function wrapTextToLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return [];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Builds an SVG overlay with a lower headline panel, wrapped text,
 * and optional source note / watermark.
 */
export function buildHeadlinePanelSvg(
  canvasWidth: number,
  canvasHeight: number,
  options: HeadlinePanelOptions
): Buffer {
  const heightPercent = Math.min(Math.max(options.heightPercent ?? 25, 10), 50);
  const panelHeight = Math.round(canvasHeight * (heightPercent / 100));
  const panelTop = canvasHeight - panelHeight;
  const bgColor = options.backgroundColor || '#000000';
  const textColor = options.textColor || '#FFFFFF';
  const fontFamily = options.fontFamily || 'Arial, Helvetica, sans-serif';
  const fontWeight = options.fontWeight || 'bold';
  const align = options.align || 'center';
  const paddingH = options.paddingHorizontal ?? 60;
  const paddingV = options.paddingVertical ?? 30;

  const headlineRaw = (options.headlineText || '').trim();
  const availableWidth = canvasWidth - paddingH * 2;
  const availableHeight = panelHeight - paddingV * 2;

  // Compute optimal font size if not explicitly specified
  let fontSize = options.fontSize;
  if (!fontSize) {
    const wordCount = headlineRaw.split(/\s+/).length;
    if (wordCount <= 8) {
      fontSize = 54;
    } else if (wordCount <= 14) {
      fontSize = 46;
    } else if (wordCount <= 22) {
      fontSize = 40;
    } else {
      fontSize = 34;
    }
  }

  // Adjust font size down if availableHeight is tight
  const charsPerLine = Math.max(15, Math.floor(availableWidth / (fontSize * 0.58)));
  let lines = wrapTextToLines(headlineRaw, charsPerLine);

  let lineHeight = fontSize * 1.25;
  let textBlockHeight = lines.length * lineHeight;

  // Scale down if lines exceed available height
  while (textBlockHeight > availableHeight && fontSize > 20) {
    fontSize -= 4;
    lineHeight = fontSize * 1.25;
    const newCharsPerLine = Math.max(15, Math.floor(availableWidth / (fontSize * 0.58)));
    lines = wrapTextToLines(headlineRaw, newCharsPerLine);
    textBlockHeight = lines.length * lineHeight;
  }

  // Vertical centering in panel
  const startY = panelTop + (panelHeight - textBlockHeight) / 2 + fontSize * 0.85;

  const textAnchor = align === 'center' ? 'middle' : 'start';
  const textX = align === 'center' ? canvasWidth / 2 : paddingH;

  const textElements = lines
    .map((line, idx) => {
      const y = Math.round(startY + idx * lineHeight);
      return `<text x="${textX}" y="${y}" text-anchor="${textAnchor}" fill="${textColor}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" letter-spacing="-0.5px">${escapeXml(
        line
      )}</text>`;
    })
    .join('\n');

  // Optional source citation or watermark at bottom
  let sourceElement = '';
  if (options.sourceText) {
    const sourceY = canvasHeight - Math.max(12, Math.round(paddingV * 0.6));
    sourceElement = `<text x="${textX}" y="${sourceY}" text-anchor="${textAnchor}" fill="${textColor}" fill-opacity="0.65" font-family="${fontFamily}" font-size="16" font-weight="600" letter-spacing="1px">${escapeXml(
      options.sourceText.toUpperCase()
    )}</text>`;
  }

  // Optional watermark / page tag at top of panel
  let watermarkElement = '';
  if (options.watermarkText) {
    const watermarkY = panelTop + Math.max(18, Math.round(paddingV * 0.7));
    watermarkElement = `<text x="${textX}" y="${watermarkY}" text-anchor="${textAnchor}" fill="${textColor}" fill-opacity="0.5" font-family="${fontFamily}" font-size="14" font-weight="bold" letter-spacing="2px">${escapeXml(
      options.watermarkText.toUpperCase()
    )}</text>`;
  }

  const svg = `
<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <!-- Headline Panel Background -->
  <rect x="0" y="${panelTop}" width="${canvasWidth}" height="${panelHeight}" fill="${bgColor}" />
  <!-- Watermark Element -->
  ${watermarkElement}
  <!-- Headline Text -->
  ${textElements}
  <!-- Source Element -->
  ${sourceElement}
</svg>
`.trim();

  return Buffer.from(svg, 'utf-8');
}

/**
 * Composites an input image buffer into Facebook-optimized dimensions (e.g. 1080x1350 4:5)
 * with an optional crisp lower headline panel rendered via Sharp and SVG.
 */
export async function composePostImage(
  inputBuffer: Buffer,
  options: CompositorOptions = {}
): Promise<ComposedImageResult> {
  const aspect = options.aspectRatio || '4:5';
  const defaultDims = getAspectDimensions(aspect);
  const targetWidth = options.targetWidth || defaultDims.width;
  const targetHeight = options.targetHeight || defaultDims.height;
  const quality = Math.min(Math.max(options.quality ?? 85, 40), 100);
  const fit = options.fit || 'cover';

  const panelOptions = options.panel;
  const hasPanel = Boolean(panelOptions?.enabled && panelOptions.headlineText);

  let sharpInstance = sharp(inputBuffer).resize(targetWidth, targetHeight, {
    fit,
    position: 'center',
  });

  if (hasPanel && panelOptions) {
    const svgOverlay = buildHeadlinePanelSvg(targetWidth, targetHeight, panelOptions);
    sharpInstance = sharpInstance.composite([
      {
        input: svgOverlay,
        top: 0,
        left: 0,
      },
    ]);
  }

  const composedBuffer = await sharpInstance
    .jpeg({
      quality,
      progressive: true,
      mozjpeg: true,
    })
    .toBuffer();

  return {
    buffer: composedBuffer,
    width: targetWidth,
    height: targetHeight,
    format: 'jpeg',
    hasPanel,
    byteSize: composedBuffer.length,
  };
}
