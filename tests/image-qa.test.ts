import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  computeImageStdDev,
  computeImagePhash,
  computeHammingDistance,
  validateImageBuffer,
} from '../worker/src/image/image-qa.js';

describe('Image QA & Perceptual Hashing (Step 8.2)', () => {
  // Helper to create a solid color PNG buffer
  async function createSolidColorImage(width: number, height: number, r = 0, g = 0, b = 0): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r, g, b },
      },
    })
      .png()
      .toBuffer();
  }

  // Helper to create an image with high visual variation / gradients
  async function createPatternImage(width: number, height: number): Promise<Buffer> {
    const svg = `
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1" />
            <stop offset="50%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgb(0,0,255);stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#grad)" />
        <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="white" />
        <text x="10" y="50" font-size="30" fill="black">Detailed Scene</text>
      </svg>
    `;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  describe('Standard Deviation & Blank Detection (computeImageStdDev)', () => {
    it('calculates zero or near-zero standard deviation for solid black image', async () => {
      const buffer = await createSolidColorImage(100, 100, 0, 0, 0);
      const stdDev = await computeImageStdDev(buffer);
      expect(stdDev).toBeLessThan(1.0);
    });

    it('calculates near-zero standard deviation for solid white image', async () => {
      const buffer = await createSolidColorImage(100, 100, 255, 255, 255);
      const stdDev = await computeImageStdDev(buffer);
      expect(stdDev).toBeLessThan(1.0);
    });

    it('calculates high standard deviation for patterned / varied image', async () => {
      const buffer = await createPatternImage(512, 512);
      const stdDev = await computeImageStdDev(buffer);
      expect(stdDev).toBeGreaterThan(20.0);
    });
  });

  describe('Perceptual Hashing (dHash) & Hamming Distance', () => {
    it('computes 16-character hexadecimal dHash', async () => {
      const buffer = await createPatternImage(512, 512);
      const phash = await computeImagePhash(buffer);
      expect(phash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('returns distance 0 for identical hashes', () => {
      const hash = 'a1b2c3d4e5f60718';
      expect(computeHammingDistance(hash, hash)).toBe(0);
    });

    it('calculates bit differences accurately', () => {
      // '0' is 0000, '1' is 0001 -> 1 bit difference
      const hashA = '0000000000000000';
      const hashB = '1000000000000000';
      expect(computeHammingDistance(hashA, hashB)).toBe(1);

      // 'f' is 1111 -> 4 bit differences
      const hashC = 'f000000000000000';
      expect(computeHammingDistance(hashA, hashC)).toBe(4);
    });

    it('returns maximum distance 64 for invalid hash lengths', () => {
      expect(computeHammingDistance('short', '123')).toBe(64);
    });

    it('detects duplicate image with same hash', async () => {
      const buffer = await createPatternImage(512, 512);
      const hash1 = await computeImagePhash(buffer);
      const hash2 = await computeImagePhash(buffer);
      expect(computeHammingDistance(hash1, hash2)).toBe(0);
    });
  });

  describe('Comprehensive Image Buffer QA (validateImageBuffer)', () => {
    it('rejects empty or very small buffer', async () => {
      const emptyBuffer = Buffer.from('too short');
      const result = await validateImageBuffer(emptyBuffer);
      expect(result.valid).toBe(false);
      expect(result.isBlank).toBe(true);
      expect(result.violations[0]).toContain('Buffer is empty or too small');
    });

    it('rejects corrupted image buffer', async () => {
      const corruptBuffer = Buffer.alloc(500, 42); // 500 bytes of arbitrary junk
      const result = await validateImageBuffer(corruptBuffer);
      expect(result.valid).toBe(false);
      expect(result.format).toBe('corrupt');
      expect(result.violations[0]).toContain('Corrupted image buffer');
    });

    it('rejects image smaller than minimum required dimensions (512x512)', async () => {
      const smallBuffer = await createPatternImage(256, 256);
      const result = await validateImageBuffer(smallBuffer, { minWidth: 512, minHeight: 512 });
      expect(result.valid).toBe(false);
      expect(result.width).toBe(256);
      expect(result.height).toBe(256);
      expect(result.violations.some((v) => v.includes('below required minimum'))).toBe(true);
    });

    it('rejects blank / solid color images', async () => {
      const solidBuffer = await createSolidColorImage(512, 512, 128, 128, 128); // medium gray
      const result = await validateImageBuffer(solidBuffer);
      expect(result.valid).toBe(false);
      expect(result.isBlank).toBe(true);
      expect(result.violations.some((v) => v.includes('solid color or blank'))).toBe(true);
    });

    it('flags near-duplicate when hash matches past post within threshold', async () => {
      const buffer = await createPatternImage(512, 512);
      const hash = await computeImagePhash(buffer);

      const result = await validateImageBuffer(buffer, {
        recentHashes: [hash],
        maxHammingDistance: 10,
      });

      expect(result.valid).toBe(false);
      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateHashMatched).toBe(hash);
      expect(result.hammingDistance).toBe(0);
      expect(result.violations.some((v) => v.includes('visual near-duplicate'))).toBe(true);
    });

    it('accepts valid, varied, non-duplicate image meeting dimensions', async () => {
      const buffer = await createPatternImage(600, 600);
      const result = await validateImageBuffer(buffer, {
        minWidth: 512,
        minHeight: 512,
        recentHashes: ['0000000000000000', 'ffffffffffffffff'],
      });

      expect(result.valid).toBe(true);
      expect(result.width).toBe(600);
      expect(result.height).toBe(600);
      expect(result.isBlank).toBe(false);
      expect(result.isDuplicate).toBe(false);
      expect(result.violations).toHaveLength(0);
    });
  });
});
