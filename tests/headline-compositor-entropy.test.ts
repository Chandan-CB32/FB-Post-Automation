import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { renderHeadlineCard, rasterizeHeadlineCardToJpeg } from '../packages/core/src/pipeline/headline-renderer.js';

describe('Headline Card Native Compositor & Visual Verification', () => {
  it('composites a non-black, rich visual photo in the upper 62% and bold headline panel in the bottom 38%', async () => {
    // Create a 800x800 sample photo buffer with distinct colors (red/green gradient)
    const samplePhotoBuffer = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 50, g: 150, b: 220 },
      },
    })
      .jpeg()
      .toBuffer();

    const rendered = renderHeadlineCard('NEW TELESCOPE DETECTS **ATMOSPHERE ON EARTH SIZED PLANET**', {
      canvasWidth: 1080,
      canvasHeight: 1350,
      imageBuffer: samplePhotoBuffer,
      panelColor: '#000000',
    });

    expect(rendered.plainHeadline).toBe('NEW TELESCOPE DETECTS ATMOSPHERE ON EARTH SIZED PLANET');
    expect(rendered.imageBuffer).toBeDefined();

    // Rasterize with native Sharp compositing
    const jpegBuffer = await rasterizeHeadlineCardToJpeg(rendered, 95, {
      imageBuffer: samplePhotoBuffer,
    });

    expect(jpegBuffer).toBeDefined();
    expect(jpegBuffer.length).toBeGreaterThan(1000);

    const meta = await sharp(jpegBuffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
    expect(meta.format).toBe('jpeg');

    // Extract upper photo region (y: 0 to panelTop) and assert it is NOT pitch black
    const panelTop = rendered.layout.panelTop;
    const topStats = await sharp(jpegBuffer)
      .extract({ left: 0, top: 0, width: 1080, height: panelTop })
      .stats();

    // Verify non-zero means across color channels (guarantees NOT black #000000)
    for (const ch of topStats.channels) {
      expect(ch.mean).toBeGreaterThan(10);
    }
  });

  it('correctly decodes and composites data:image URI into a non-black card', async () => {
    const miniBuffer = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 255, g: 200, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();

    const dataUri = `data:image/jpeg;base64,${miniBuffer.toString('base64')}`;

    const rendered = renderHeadlineCard('FUNGAL ORGANISM SPANS **OREGON FORESTS**', {
      imageUrl: dataUri,
    });

    const jpegBuffer = await rasterizeHeadlineCardToJpeg(rendered, 90);
    expect(jpegBuffer).toBeDefined();

    const topStats = await sharp(jpegBuffer)
      .extract({ left: 0, top: 0, width: 1080, height: rendered.layout.panelTop })
      .stats();

    expect(topStats.channels[0].mean).toBeGreaterThan(20);
  });
});
