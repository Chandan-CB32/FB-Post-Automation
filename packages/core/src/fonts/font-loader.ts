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

export type SupportedFontFamily = 'Roboto Condensed' | 'Oswald';

interface LoadedFont {
  family: SupportedFontFamily;
  buffer: Buffer;
  base64: string;
  font: OpenTypeFont;
  fileName: string;
}

const FONT_CACHE: Partial<Record<SupportedFontFamily, LoadedFont>> = {};

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
export function getBundledFont(family: SupportedFontFamily = 'Roboto Condensed'): LoadedFont {
  if (FONT_CACHE[family]) {
    return FONT_CACHE[family]!;
  }

  const fileName = family === 'Oswald' ? 'Oswald-Bold.ttf' : 'RobotoCondensed-Bold.ttf';
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
  family: SupportedFontFamily = 'Roboto Condensed'
): number {
  try {
    const loaded = getBundledFont(family);
    return loaded.font.getAdvanceWidth(text, fontSize);
  } catch (e) {
    // Fallback conservative estimation for condensed bold (averaging ~0.53 em per uppercase char)
    return text.length * fontSize * 0.53;
  }
}

export interface FontHealthReport {
  ok: boolean;
  fontsLoaded: string[];
  fonts: {
    robotoCondensed: boolean;
    oswald: boolean;
  };
  details: {
    robotoCondensedSize?: number;
    oswaldSize?: number;
    error?: string;
  };
}

/**
 * Startup health check for System Readiness.
 * Verifies both bundled fonts are loaded and readable.
 */
export function verifyFontLoading(): FontHealthReport {
  let robotoOk = false;
  let oswaldOk = false;
  let robotoSize: number | undefined;
  let oswaldSize: number | undefined;
  let errorMsg: string | undefined;

  try {
    const roboto = getBundledFont('Roboto Condensed');
    robotoOk = Boolean(roboto && roboto.buffer.length > 50000);
    robotoSize = roboto.buffer.length;
  } catch (err: any) {
    errorMsg = `Roboto Condensed load error: ${err.message}`;
  }

  try {
    const oswald = getBundledFont('Oswald');
    oswaldOk = Boolean(oswald && oswald.buffer.length > 50000);
    oswaldSize = oswald.buffer.length;
  } catch (err: any) {
    if (!errorMsg) errorMsg = `Oswald load error: ${err.message}`;
  }

  const fontsLoaded: string[] = [];
  if (robotoOk) fontsLoaded.push('Roboto Condensed Bold');
  if (oswaldOk) fontsLoaded.push('Oswald Bold');

  return {
    ok: robotoOk && oswaldOk,
    fontsLoaded,
    fonts: {
      robotoCondensed: robotoOk,
      oswald: oswaldOk,
    },
    details: {
      robotoCondensedSize: robotoSize,
      oswaldSize: oswaldSize,
      error: errorMsg,
    },
  };
}
