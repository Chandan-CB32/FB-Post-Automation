import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { Font as OpenTypeFont } from 'opentype.js';

let currentDir = '';
try {
  currentDir = path.dirname(fileURLToPath(import.meta.url));
} catch (_) {
  currentDir = process.cwd();
}

let opentypeModule: any = null;
function getOpentype(): any {
  if (!opentypeModule) {
    try {
      const req = createRequire(import.meta.url);
      opentypeModule = req('opentype.js');
    } catch (_) {
      // fallback
    }
  }
  return opentypeModule;
}

function parseOpenTypeFont(buffer: ArrayBuffer): OpenTypeFont {
  const ot = getOpentype();
  const parseFn = ot?.parse || ot?.default?.parse;
  if (typeof parseFn === 'function') {
    return parseFn(buffer);
  }
  throw new Error('opentype.parse is not available');
}

export type SupportedFontFamily = 'Roboto' | 'Open Sans' | 'Roboto Condensed' | 'Oswald';

interface LoadedFont {
  family: SupportedFontFamily;
  buffer: Buffer;
  base64: string;
  font: OpenTypeFont;
  fileName: string;
}

const FONT_CACHE: Partial<Record<SupportedFontFamily, LoadedFont>> = {};

function getFontFileName(family: SupportedFontFamily): string {
  switch (family) {
    case 'Roboto':
      return 'Roboto-Bold.ttf';
    case 'Open Sans':
      return 'OpenSans-Bold.ttf';
    case 'Oswald':
      return 'Oswald-Bold.ttf';
    case 'Roboto Condensed':
    default:
      return 'RobotoCondensed-Bold.ttf';
  }
}

/**
 * Candidate directories to locate the bundled TrueType fonts across environments:
 * local development, Vitest, Node CLI, and Vercel serverless functions.
 */
function getFontSearchPaths(fileName: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, 'packages/core/assets/fonts', fileName),
    path.join(cwd, 'apps/web/public/fonts', fileName),
    path.join(cwd, 'public/fonts', fileName),
    path.resolve(currentDir, '../../assets/fonts', fileName),
    path.resolve(currentDir, '../../../packages/core/assets/fonts', fileName),
    path.resolve(currentDir, '../../../../packages/core/assets/fonts', fileName),
  ];
}

/**
 * Loads a bundled TrueType font file, caches it in memory, and parses with opentype.js.
 */
export function getBundledFont(family: SupportedFontFamily = 'Roboto'): LoadedFont {
  if (FONT_CACHE[family]) {
    return FONT_CACHE[family]!;
  }

  const fileName = getFontFileName(family);
  const searchPaths = getFontSearchPaths(fileName);

  let fontBuffer: Buffer | null = null;
  let resolvedPath: string | null = null;

  for (const p of searchPaths) {
    try {
      if (fs.existsSync(p)) {
        fontBuffer = fs.readFileSync(p);
        resolvedPath = p;
        break;
      }
    } catch (_) {
      // Continue to next candidate path
    }
  }

  if (!fontBuffer) {
    throw new Error(
      `[FontLoader] CRITICAL: Bundled font file '${fileName}' for '${family}' could not be found in any candidate path:\n${searchPaths.join(
        '\n'
      )}`
    );
  }

  try {
    const ab = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);
    const parsedFont = parseOpenTypeFont(ab as ArrayBuffer);
    const base64 = fontBuffer.toString('base64');

    const loaded: LoadedFont = {
      family,
      buffer: fontBuffer,
      base64,
      font: parsedFont,
      fileName,
    };

    FONT_CACHE[family] = loaded;
    return loaded;
  } catch (err: any) {
    throw new Error(`[FontLoader] Failed to parse TrueType font '${resolvedPath}': ${err?.message || err}`);
  }
}

/**
 * Measures the exact pixel width of a string at a specified font size using the parsed TrueType font.
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  family: SupportedFontFamily = 'Roboto'
): number {
  try {
    const loaded = getBundledFont(family);
    return loaded.font.getAdvanceWidth(text, fontSize);
  } catch (e) {
    // Fallback estimation
    const emRatio = family === 'Roboto Condensed' ? 0.53 : 0.62;
    return text.length * fontSize * emRatio;
  }
}

export interface FontHealthReport {
  ok: boolean;
  fontsLoaded: string[];
  fonts: {
    roboto?: boolean;
    openSans?: boolean;
    robotoCondensed: boolean;
    oswald: boolean;
  };
  details: {
    robotoSize?: number;
    openSansSize?: number;
    robotoCondensedSize?: number;
    oswaldSize?: number;
    error?: string;
  };
}

/**
 * Startup health check for System Readiness.
 * Verifies all bundled fonts are loaded and readable.
 */
export function verifyFontLoading(): FontHealthReport {
  let robotoBoldOk = false;
  let openSansOk = false;
  let robotoCondensedOk = false;
  let oswaldOk = false;

  let robotoSize: number | undefined;
  let openSansSize: number | undefined;
  let robotoCondensedSize: number | undefined;
  let oswaldSize: number | undefined;
  let errorMsg: string | undefined;

  try {
    const roboto = getBundledFont('Roboto');
    robotoBoldOk = Boolean(roboto && roboto.buffer.length > 50000);
    robotoSize = roboto.buffer.length;
  } catch (err: any) {
    errorMsg = `Roboto load error: ${err.message}`;
  }

  try {
    const openSans = getBundledFont('Open Sans');
    openSansOk = Boolean(openSans && openSans.buffer.length > 50000);
    openSansSize = openSans.buffer.length;
  } catch (err: any) {
    if (!errorMsg) errorMsg = `Open Sans load error: ${err.message}`;
  }

  try {
    const robotoCond = getBundledFont('Roboto Condensed');
    robotoCondensedOk = Boolean(robotoCond && robotoCond.buffer.length > 50000);
    robotoCondensedSize = robotoCond.buffer.length;
  } catch (err: any) {
    if (!errorMsg) errorMsg = `Roboto Condensed load error: ${err.message}`;
  }

  try {
    const oswald = getBundledFont('Oswald');
    oswaldOk = Boolean(oswald && oswald.buffer.length > 50000);
    oswaldSize = oswald.buffer.length;
  } catch (err: any) {
    if (!errorMsg) errorMsg = `Oswald load error: ${err.message}`;
  }

  const fontsLoaded: string[] = [];
  if (robotoBoldOk) fontsLoaded.push('Roboto Bold');
  if (openSansOk) fontsLoaded.push('Open Sans Bold');
  if (robotoCondensedOk) fontsLoaded.push('Roboto Condensed Bold');
  if (oswaldOk) fontsLoaded.push('Oswald Bold');

  return {
    ok: robotoBoldOk && openSansOk && robotoCondensedOk && oswaldOk,
    fontsLoaded,
    fonts: {
      roboto: robotoBoldOk,
      openSans: openSansOk,
      robotoCondensed: robotoCondensedOk,
      oswald: oswaldOk,
    },
    details: {
      robotoSize,
      openSansSize,
      robotoCondensedSize,
      oswaldSize,
      error: errorMsg,
    },
  };
}
