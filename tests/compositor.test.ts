import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  getAspectDimensions,
  escapeXml,
  wrapTextToLines,
  buildHeadlinePanelSvg,
  composePostImage,
} from '../worker/src/image/compositor.js';
import {
  generateCompositePreviewSvg,
  wrapHeadlineLines,
} from '../packages/core/src/pipeline/generation-pipeline.js';

describe('Sharp Headline Panel Renderer & Aspect Ratio Compositor (Step 8.3)', () => {
  // Helper to create a base test image buffer
  async function createTestImage(width = 800, height = 800, r = 20, g = 60, b = 120): Promise<Buffer> {
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

  describe('Aspect Ratio Dimension Mapping (getAspectDimensions)', () => {
    it('returns 1080x1350 for 4:5 aspect ratio', () => {
      expect(getAspectDimensions('4:5')).toEqual({ width: 1080, height: 1350 });
    });

    it('returns 1080x1080 for 1:1 aspect ratio', () => {
      expect(getAspectDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
    });

    it('returns 1920x1080 for 16:9 aspect ratio', () => {
      expect(getAspectDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
    });

    it('defaults to 4:5 when omitted or unknown', () => {
      expect(getAspectDimensions()).toEqual({ width: 1080, height: 1350 });
    });
  });

  describe('XML / SVG Escaping & Word Wrapping Helpers', () => {
    it('escapes &, <, >, ", and \' in XML text', () => {
      const unsafe = `Hubble's & Webb's "Deep Field" <Cosmic> Discovery`;
      const safe = escapeXml(unsafe);
      expect(safe).toBe(
        'Hubble&apos;s &amp; Webb&apos;s &quot;Deep Field&quot; &lt;Cosmic&gt; Discovery'
      );
    });

    it('wraps text cleanly into multiple lines without cutting words', () => {
      const text = 'The James Webb Space Telescope Has Found Water Vapor Around An Exoplanet';
      const lines = wrapTextToLines(text, 30);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      lines.forEach((line) => {
        expect(line.length).toBeLessThanOrEqual(35);
      });
      expect(lines.join(' ')).toBe(text);
    });

    it('handles empty text gracefully in word wrapper', () => {
      expect(wrapTextToLines('', 30)).toEqual([]);
      expect(wrapTextToLines('   ', 30)).toEqual([]);
    });
  });

  describe('Headline Panel SVG Generator (buildHeadlinePanelSvg)', () => {
    it('generates SVG with panel rect, text elements, and font styles', () => {
      const svgBuffer = buildHeadlinePanelSvg(1080, 1350, {
        enabled: true,
        headlineText: 'THE UNIVERSE MAY BE EXPANDING FASTER THAN PHYSICS PREDICTS',
        heightPercent: 25,
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
      });

      const svgString = svgBuffer.toString('utf-8');
      expect(svgString).toContain('<svg');
      expect(svgString).toContain('fill="#000000"');
      expect(svgString).toContain('fill="#FFFFFF"');
      expect(svgString).toContain('UNIVERSE');
      expect(svgString).toContain('EXPANDING');
    });

    it('includes source note and watermark when provided', () => {
      const svgBuffer = buildHeadlinePanelSvg(1080, 1350, {
        enabled: true,
        headlineText: 'MYSTERIOUS RADIO SIGNALS REPEATING EVERY 16 DAYS DETECTED',
        sourceText: 'Source: Nature Astronomy / CHIME',
        watermarkText: 'Cosmic Science Daily',
      });

      const svgString = svgBuffer.toString('utf-8');
      expect(svgString).toContain('SOURCE: NATURE ASTRONOMY / CHIME');
      expect(svgString).toContain('COSMIC SCIENCE DAILY');
    });
  });

  describe('Full Post Image Composition (composePostImage)', () => {
    it('scales and crops clean image without headline panel to 1080x1350 JPEG', async () => {
      const input = await createTestImage(800, 800);
      const result = await composePostImage(input, {
        aspectRatio: '4:5',
      });

      expect(result.width).toBe(1080);
      expect(result.height).toBe(1350);
      expect(result.format).toBe('jpeg');
      expect(result.hasPanel).toBe(false);
      expect(result.byteSize).toBeGreaterThan(1000);

      // Verify that Sharp can read back the metadata from the composed buffer
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.width).toBe(1080);
      expect(metadata.height).toBe(1350);
      expect(metadata.format).toBe('jpeg');
    });

    it('composites lower headline panel onto image buffer with high quality', async () => {
      const input = await createTestImage(1000, 1000);
      const headline = 'BLACK HOLE JET TRAVELING AT 99% THE SPEED OF LIGHT CAPTURED';

      const result = await composePostImage(input, {
        aspectRatio: '4:5',
        quality: 85,
        panel: {
          enabled: true,
          headlineText: headline,
          heightPercent: 28,
          backgroundColor: '#0a0a0f',
          textColor: '#ffffff',
          sourceText: 'NASA / Chandra X-ray Observatory',
        },
      });

      expect(result.width).toBe(1080);
      expect(result.height).toBe(1350);
      expect(result.hasPanel).toBe(true);

      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.width).toBe(1080);
      expect(metadata.height).toBe(1350);
      expect(metadata.format).toBe('jpeg');
    });

    it('supports 1:1 and 16:9 aspect ratios correctly', async () => {
      const input = await createTestImage(500, 500);

      const squareResult = await composePostImage(input, {
        aspectRatio: '1:1',
      });
      expect(squareResult.width).toBe(1080);
      expect(squareResult.height).toBe(1080);

      const landscapeResult = await composePostImage(input, {
        aspectRatio: '16:9',
      });
      expect(landscapeResult.width).toBe(1920);
      expect(landscapeResult.height).toBe(1080);
    });

    it('respects custom width and height overrides', async () => {
      const input = await createTestImage(400, 400);
      const customResult = await composePostImage(input, {
        targetWidth: 720,
        targetHeight: 900,
        quality: 80,
      });

      expect(customResult.width).toBe(720);
      expect(customResult.height).toBe(900);
      const metadata = await sharp(customResult.buffer).metadata();
      expect(metadata.width).toBe(720);
      expect(metadata.height).toBe(900);
    });
  });

  describe('Viral Fact Card Format (Octopus Layout Specification)', () => {
    it('wraps viral headlines into 2-4 clean uppercase lines', () => {
      const headline = 'The Octopus Has Three Hearts And Blue Blood';
      const lines = wrapHeadlineLines(headline, 18, 4);
      expect(lines).toEqual(['THE OCTOPUS HAS', 'THREE HEARTS AND', 'BLUE BLOOD']);
    });

    it('generates composite SVG with full-bleed top image, black bottom box, and zero watermarks', () => {
      const svgUri = generateCompositePreviewSvg({
        width: 1080,
        height: 1350,
        headline: 'THE OCTOPUS HAS THREE HEARTS AND BLUE BLOOD',
        imageUrl: 'https://example.com/octopus.jpg',
      });

      const decoded = decodeURIComponent(svgUri.replace('data:image/svg+xml;utf8,', ''));

      // 1. Dimensions: 1080x1350
      expect(decoded).toContain('viewBox="0 0 1080 1350"');

      // 2. Full-bleed image occupying the upper ~67% (height 910)
      expect(decoded).toContain('<image href="https://example.com/octopus.jpg" x="0" y="0" width="1080" height="910"');
      expect(decoded).toContain('preserveAspectRatio="xMidYMid slice"');

      // 3. Solid pitch black panel occupying the bottom ~33% (y=910 to 1350)
      expect(decoded).toContain('<rect x="0" y="910" width="1080" height="440" fill="#000000"');

      // 4. Centered, uppercase white text with high-impact font
      expect(decoded).toContain('fill="#FFFFFF"');
      expect(decoded).toContain('text-anchor="middle"');
      expect(decoded).toContain('font-family="\'Impact\', \'Bebas Neue\', \'Anton\'');
      expect(decoded).toContain('THE OCTOPUS HAS');
      expect(decoded).toContain('THREE HEARTS AND');
      expect(decoded).toContain('BLUE BLOOD');

      // 5. Zero watermarks, zero badges, zero source attribution lines
      expect(decoded).not.toContain('PORTRAIT');
      expect(decoded).not.toContain('1080 × 1350');
      expect(decoded).not.toContain('SOURCE:');
      expect(decoded).not.toContain('url(#bgGrad)');
    });
  });
});


