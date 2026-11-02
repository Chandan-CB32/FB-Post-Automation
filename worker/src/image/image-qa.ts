import sharp, { Metadata } from 'sharp';

export interface ImageQaOptions {
  minWidth?: number;
  minHeight?: number;
  minStdDev?: number;
  recentHashes?: string[];
  maxHammingDistance?: number;
}

export interface ImageQaResult {
  valid: boolean;
  format: string;
  width: number;
  height: number;
  stdDev: number;
  phash: string;
  isBlank: boolean;
  isDuplicate: boolean;
  duplicateHashMatched?: string;
  hammingDistance?: number;
  violations: string[];
}

/**
 * Computes standard deviation of pixel intensities across an image buffer
 * to detect uniform blank / solid color images (e.g. solid black, grey, white).
 */
export async function computeImageStdDev(buffer: Buffer): Promise<number> {
  const { data } = await sharp(buffer)
    .resize(64, 64, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = data.length;
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i];
  }
  const mean = sum / n;

  let varianceSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = data[i] - mean;
    varianceSum += diff * diff;
  }

  return Math.sqrt(varianceSum / n);
}

/**
 * Computes a 64-bit difference perceptual hash (dHash) as a 16-hex character string.
 * Resizes image to 9x8 grayscale and computes horizontal gradient bits.
 */
export async function computeImagePhash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hashBits = '';
  // 8 rows of 9 pixels: 8 horizontal comparisons per row = 64 bits total
  for (let row = 0; row < 8; row++) {
    const rowOffset = row * 9;
    for (let col = 0; col < 8; col++) {
      const left = data[rowOffset + col];
      const right = data[rowOffset + col + 1];
      hashBits += left > right ? '1' : '0';
    }
  }

  // Convert 64 bits to 16 hex characters
  let hexString = '';
  for (let i = 0; i < 64; i += 4) {
    const nibble = hashBits.slice(i, i + 4);
    hexString += parseInt(nibble, 2).toString(16);
  }

  return hexString.padStart(16, '0');
}

/**
 * Computes Hamming distance between two 16-character hex perceptual hashes.
 * Returns number of bit differences (0 to 64).
 */
export function computeHammingDistance(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== 16 || hashB.length !== 16) {
    return 64;
  }

  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const valA = parseInt(hashA[i], 16);
    const valB = parseInt(hashB[i], 16);
    let xor = valA ^ valB;
    // Count set bits in xor
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }

  return distance;
}

/**
 * Validates generated image buffer against corruption, minimum dimensions,
 * blank / solid-color output, and visual duplication against recent post hashes.
 */
export async function validateImageBuffer(
  buffer: Buffer,
  options: ImageQaOptions = {}
): Promise<ImageQaResult> {
  const minWidth = options.minWidth ?? 512;
  const minHeight = options.minHeight ?? 512;
  const minStdDev = options.minStdDev ?? 5.0;
  const maxHammingDistance = options.maxHammingDistance ?? 10;
  const recentHashes = options.recentHashes || [];

  const violations: string[] = [];

  if (!buffer || buffer.length < 100) {
    return {
      valid: false,
      format: 'unknown',
      width: 0,
      height: 0,
      stdDev: 0,
      phash: '0000000000000000',
      isBlank: true,
      isDuplicate: false,
      violations: ['Buffer is empty or too small to be a valid image.'],
    };
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err: unknown) {
    return {
      valid: false,
      format: 'corrupt',
      width: 0,
      height: 0,
      stdDev: 0,
      phash: '0000000000000000',
      isBlank: true,
      isDuplicate: false,
      violations: [`Corrupted image buffer: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const format = metadata.format || 'unknown';
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  // 1. Dimension Checks
  if (width < minWidth || height < minHeight) {
    violations.push(`Image dimensions (${width}x${height}) are below required minimum (${minWidth}x${minHeight}).`);
  }

  // 2. Blank / Solid Color Check
  const stdDev = await computeImageStdDev(buffer);
  const isBlank = stdDev < minStdDev;
  if (isBlank) {
    violations.push(`Image is solid color or blank (standard deviation ${stdDev.toFixed(2)} is below minimum ${minStdDev}).`);
  }

  // 3. Perceptual Hashing & Duplicate Detection
  const phash = await computeImagePhash(buffer);
  let isDuplicate = false;
  let duplicateHashMatched: string | undefined;
  let minDistanceFound: number | undefined;

  for (const pastHash of recentHashes) {
    const dist = computeHammingDistance(phash, pastHash);
    if (dist <= maxHammingDistance) {
      isDuplicate = true;
      duplicateHashMatched = pastHash;
      minDistanceFound = dist;
      violations.push(`Image is a visual near-duplicate of recent post (Hamming distance ${dist} <= ${maxHammingDistance}).`);
      break;
    }
  }

  const valid = violations.length === 0;

  return {
    valid,
    format,
    width,
    height,
    stdDev: Math.round(stdDev * 100) / 100,
    phash,
    isBlank,
    isDuplicate,
    duplicateHashMatched,
    hammingDistance: minDistanceFound,
    violations,
  };
}
