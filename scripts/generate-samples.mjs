import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHeadlineCard } from '../packages/core/dist/pipeline/headline-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../docs/samples');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  // Sample 0: Before image (bad small squashed font with empty space)
  const beforeSvg = `
<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="beforeGlow" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="60%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="1080" height="972" fill="url(#beforeGlow)"/>
  <rect x="0" y="972" width="1080" height="378" fill="#000000"/>
  <text x="540" y="1060" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="44" font-weight="900">WEBB TELESCOPE</text>
  <text x="540" y="1115" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="44" font-weight="900">IDENTIFIES</text>
  <text x="540" y="1170" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="44" font-weight="900">POTENTIAL HYCEAN</text>
  <text x="540" y="1225" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="44" font-weight="900">ATMOSPHERE ON K2-18B</text>
</svg>
  `;
  const beforeBuf = await sharp(Buffer.from(beforeSvg)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'before-k2-18b-sample.png'), beforeBuf);
  console.log('Saved docs/samples/before-k2-18b-sample.png');

  // Sample 1: The Octopus Reference Headline
  const octopusHeadline = 'THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**';
  const octopusResult = renderHeadlineCard(octopusHeadline, {
    fontFamily: 'Roboto Condensed',
    primaryAccent: '#FFD21F', // Yellow
    secondaryAccent: '#22D3EE', // Cyan
  });

  console.log('Octopus Layout:', {
    fontSize: octopusResult.layout.fontSize,
    lines: octopusResult.layout.lines.map((l) => l.text),
    longestLineFillPercent: octopusResult.layout.longestLineFillPercent,
    canvasFillPercent: octopusResult.layout.canvasFillPercent,
    panelHeight: octopusResult.layout.panelHeight,
  });

  const octopusBuf = await sharp(Buffer.from(octopusResult.svgXml)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'after-octopus-sample.png'), octopusBuf);
  console.log('Saved docs/samples/after-octopus-sample.png');

  // Sample 2: K2-18b Headline with accuracy guard
  const k2Headline = 'WEBB FINDS CLUES TO A **POSSIBLE OCEAN WORLD** ON **K2-18B**';
  const k2Result = renderHeadlineCard(k2Headline, {
    fontFamily: 'Roboto Condensed',
    matchNiche: true,
    niche: 'Science & Space',
  });

  console.log('K2-18b Layout:', {
    fontSize: k2Result.layout.fontSize,
    lines: k2Result.layout.lines.map((l) => l.text),
    longestLineFillPercent: k2Result.layout.longestLineFillPercent,
    panelHeight: k2Result.layout.panelHeight,
  });

  const k2Buf = await sharp(Buffer.from(k2Result.svgXml)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'after-k2-18b-sample.png'), k2Buf);
  console.log('Saved docs/samples/after-k2-18b-sample.png');

  // Sample 3: 5-word headline
  const shortHeadline = 'VENUS CLOUDS HIDE **POSSIBLE PHOSPHINE**';
  const shortResult = renderHeadlineCard(shortHeadline, {
    fontFamily: 'Roboto Condensed',
  });
  const shortBuf = await sharp(Buffer.from(shortResult.svgXml)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'after-short-5word-sample.png'), shortBuf);

  // Sample 4: 12-word headline
  const twelveHeadline = 'SCIENTISTS CONFIRM **MASSIVE SUBTERRANEAN OCEAN** HIDDEN DEEP INSIDE EARTH MANTLE';
  const twelveResult = renderHeadlineCard(twelveHeadline, {
    fontFamily: 'Roboto Condensed',
  });
  const twelveBuf = await sharp(Buffer.from(twelveResult.svgXml)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, 'after-12word-sample.png'), twelveBuf);

  console.log('All samples successfully generated!');
}

main().catch(console.error);
