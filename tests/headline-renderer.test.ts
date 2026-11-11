import { describe, it, expect } from 'vitest';
import {
  renderHeadlineCard,
  computeHeadlineLayout,
  parseHeadlineSegments,
  applyFallbackHighlighting,
  sanitizeHeadlineAccuracy,
  verifyFontLoading,
  getBundledFont,
  shortenHeadline,
  validateHeadline,
} from '../packages/core/src/index.js';

describe('Headline Typography and Layout Engine', () => {
  it('bundles and loads Roboto Condensed and Oswald TrueType fonts with valid bezier glyphs', () => {
    const health = verifyFontLoading();
    expect(health.ok).toBe(true);
    expect(health.fontsLoaded).toContain('Roboto Condensed Bold');
    expect(health.fontsLoaded).toContain('Oswald Bold');

    const roboto = getBundledFont('Roboto Condensed');
    expect(roboto).toBeDefined();
    expect(roboto.font.numGlyphs).toBeGreaterThan(100);

    const oswald = getBundledFont('Oswald');
    expect(oswald).toBeDefined();
    expect(oswald.font.numGlyphs).toBeGreaterThan(100);
  });

  it('renders reference octopus headline with >= 78% width fill, 3 lines, and font size >= 100px', () => {
    const headline = 'THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**';
    const result = renderHeadlineCard({
      headlineText: headline,
      fontFamily: 'Roboto Condensed',
      panelHeightMode: 'auto',
    });

    const { layout, svg } = result;
    expect(layout.lines.length).toBe(3);
    expect(layout.fontSize).toBeGreaterThanOrEqual(100);
    expect(layout.widthFillPercent).toBeGreaterThanOrEqual(78);
    expect(layout.panelHeight).toBe(486); // 3 lines -> 36% of 1350 = 486px
    expect(layout.needsShortening).toBe(false);

    // Verify SVG markup
    expect(svg).toContain('viewBox="0 0 1080 1350"');
    expect(svg).toContain('@font-face');
    expect(svg).toContain("'Roboto Condensed'");
    expect(svg).toContain('THE OCTOPUS HAS');
    expect(svg).toContain('THREE HEARTS');
    expect(svg).toContain('BLUE BLOOD');
    // Accents present
    expect(svg).toContain('#FFD21F'); // Yellow accent
    expect(svg).toContain('#22D3EE'); // Cyan accent
  });

  it('partitions 12-word K2-18B headline into 3 or 4 balanced lines without hyphen splits', () => {
    const headline = 'WEBB FINDS CLUES TO A **POSSIBLE OCEAN WORLD** ON **K2-18B**';
    const result = renderHeadlineCard({
      headlineText: headline,
      fontFamily: 'Roboto Condensed',
      panelHeightMode: 'auto',
    });

    const { layout, svg } = result;
    expect(layout.lines.length).toBeLessThanOrEqual(4);
    expect(layout.fontSize).toBeGreaterThanOrEqual(76);
    expect(layout.widthFillPercent).toBeGreaterThanOrEqual(78);

    // Ensure K2-18B is not split across lines
    const lineJoined = layout.lines.map((l) => l.text).join('\n');
    expect(lineJoined).toMatch(/K2-18B/);
    expect(svg).toContain('K2-18B');
  });

  it('handles short 4 to 5 word headlines using 30% panel height (2 lines)', () => {
    const headline = '**DEEP OCEAN** GLOWS IN DARK';
    const result = renderHeadlineCard({
      headlineText: headline,
      panelHeightMode: 'auto',
    });

    const { layout } = result;
    expect(layout.lines.length).toBe(2);
    expect(layout.panelHeight).toBe(405); // 30% of 1350 = 405px
    expect(layout.fontSize).toBeGreaterThanOrEqual(100);
    expect(layout.widthFillPercent).toBeGreaterThanOrEqual(78);
  });

  it('parses double asterisk markers into structured colored segments', () => {
    const result = parseHeadlineSegments(
      'THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**',
      {
        primaryAccent: '#FFD21F',
        secondaryAccent: '#22D3EE',
      }
    );

    const segments = result.segments;
    expect(segments.length).toBe(4);
    expect(segments[0].text).toBe('THE OCTOPUS HAS');
    expect(segments[0].isHighlighted).toBe(false);
    expect(segments[1].text).toBe('THREE HEARTS');
    expect(segments[1].isHighlighted).toBe(true);
    expect(segments[1].color).toBe('#FFD21F');
    expect(segments[2].text).toBe('AND');
    expect(segments[2].isHighlighted).toBe(false);
    expect(segments[3].text).toBe('BLUE BLOOD');
    expect(segments[3].isHighlighted).toBe(true);
    expect(segments[3].color).toBe('#22D3EE');
  });

  it('applies fallback highlighting when writer provides unadorned text', () => {
    const result = applyFallbackHighlighting('THE OCTOPUS HAS 3 HEARTS AND BLUE BLOOD', { niche: 'science' });
    const segments = result.segments;
    const highlighted = segments.filter((s) => s.isHighlighted);
    expect(highlighted.length).toBeGreaterThan(0);
    // Number "3" should be highlighted
    expect(highlighted.some((s) => s.text.includes('3'))).toBe(true);
  });

  it('sanitizes certainty verbs into honest hedged verbs', () => {
    expect(sanitizeHeadlineAccuracy('WEBB PROVES LIFE EXISTS ON EXOPLANET').headline).toBe(
      'WEBB SUGGESTS LIFE EXISTS ON EXOPLANET'
    );
    expect(sanitizeHeadlineAccuracy('SCIENTISTS DISCOVER EXACT EVIDENCE OF ALIEN SIGNAL').headline).toBe(
      'SCIENTISTS FIND CLUES TO EXACT EVIDENCE OF ALIEN SIGNAL'
    );
    expect(sanitizeHeadlineAccuracy('RESEARCH CONFIRMS THE HYDROGEN HYPOTHESIS').headline).toBe(
      'RESEARCH POINTS TO THE HYDROGEN HYPOTHESIS'
    );
  });

  it('validates and auto-shortens overly long headlines', () => {
    const longHeadline = 'ASTRONOMERS DISCOVER BREATHTAKING NEW EXTRAORDINARY GIANT GALAXY CLUSTER LOCATED BILLIONS OF LIGHT YEARS AWAY IN DEEP SPACE';
    const validation = validateHeadline(longHeadline);
    expect(validation.valid).toBe(false);

    const shortened = shortenHeadline(longHeadline);
    expect(shortened.split(/\s+/).length).toBeLessThanOrEqual(14);
  });
});
