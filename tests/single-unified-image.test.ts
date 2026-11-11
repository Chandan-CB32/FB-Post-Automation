import { describe, it, expect } from 'vitest';
import { runGenerationPipeline } from '../packages/core/src/pipeline/generation-pipeline.js';
import { renderHeadlineCard, rasterizeHeadlineCardToJpeg } from '../packages/core/src/pipeline/headline-renderer.js';
import sharp from 'sharp';

describe('Single Unified JPEG Card & Topic-Relevant Image Prompt Tests', () => {
  it('guarantees visual prompt contains actual topic and strips template boilerplate instructions', async () => {
    const pageWithMasterInstructions: any = {
      id: 'test-page-1',
      name: 'Beyond the Known',
      custom_niche: 'Science & Space exploration',
      custom_image_prompt: `Create ONE photorealistic, highly detailed image that fits this post's topic and caption. Show a single clear subject and focal point.

COMPOSITION: Vertical 4:5 portrait. Fill the whole frame with the image and put NO text, letters, numbers, logos, watermarks, borders or interface elements anywhere in it.

STYLE: Photorealistic and cinematic but believable scientific lighting. Palette of deep blues, cosmic blacks, subtle glowing highlights and natural colors.`,
      custom_image_prompt_mode: 'replace',
      overrides: {
        'image.headlinePanel.enabled': true,
      },
    };

    const report = await runGenerationPipeline({
      page: pageWithMasterInstructions,
      profile: { name: 'Beyond the Known', masterPrompt: 'Space facts' } as any,
      activeProviders: [],
      userTopic: 'Webb Telescope Identifies Potential Hycean Atmosphere on K2-18b',
      isTestRun: true,
    });

    // 1. The scene prompt must be topic-relevant (exoplanet / K2-18b) and NOT start with "Create ONE photorealistic"
    expect(report.imagePrompt).not.toContain('Create ONE photorealistic');
    expect(report.imagePrompt).not.toContain('COMPOSITION: Vertical 4:5 portrait');
    expect(
      report.imagePrompt.toLowerCase().includes('k2-18b') ||
      report.imagePrompt.toLowerCase().includes('exoplanet') ||
      report.imagePrompt.toLowerCase().includes('webb') ||
      report.imagePrompt.toLowerCase().includes('atmosphere')
    ).toBe(true);

    // 2. The composed image must be a single raster JPEG (not an SVG data URI)
    expect(report.compositeImageUrl).toBeDefined();
    expect(report.compositeImageUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(report.compositeJpegBuffer).toBeDefined();
    expect(report.compositeJpegBuffer!.length).toBeGreaterThan(1000);

    // 3. Verify metadata of the single unified JPEG: 1080x1350
    const meta = await sharp(report.compositeJpegBuffer!).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('proves composed card is one unified image with top photo and bottom text panel baked into one bitmap', async () => {
    // Create distinct test image: upper photo bright red
    const topPhotoBuf = await sharp({
      create: { width: 1080, height: 800, channels: 3, background: { r: 220, g: 30, b: 30 } },
    }).jpeg().toBuffer();

    const topPhotoUri = `data:image/jpeg;base64,${topPhotoBuf.toString('base64')}`;

    const card = renderHeadlineCard('THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**', {
      canvasWidth: 1080,
      canvasHeight: 1350,
      imageUrl: topPhotoUri,
      panelColor: '#000000',
    });

    const singleJpeg = await rasterizeHeadlineCardToJpeg(card.svgXml);
    expect(singleJpeg.length).toBeGreaterThan(5000);

    // Read pixel colors to prove both upper photo and lower panel exist in this single file
    const meta = await sharp(singleJpeg).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);

    const rawPixels = await sharp(singleJpeg).raw().toBuffer();
    const channels = meta.channels || 3;

    // Sample top photo area (Y = 200, X = 540)
    const topIdx = (200 * 1080 + 540) * channels;
    const topR = rawPixels[topIdx];
    const topG = rawPixels[topIdx + 1];
    const topB = rawPixels[topIdx + 2];
    expect(topR).toBeGreaterThan(180); // Red
    expect(topG).toBeLessThan(60);

    // Sample bottom text panel area (Y = 1200, X = 100 - empty margin in black panel)
    const btmIdx = (1200 * 1080 + 100) * channels;
    const btmR = rawPixels[btmIdx];
    const btmG = rawPixels[btmIdx + 1];
    const btmB = rawPixels[btmIdx + 2];
    expect(btmR).toBeLessThan(15); // Pure black #000000
    expect(btmG).toBeLessThan(15);
    expect(btmB).toBeLessThan(15);
  });
});
