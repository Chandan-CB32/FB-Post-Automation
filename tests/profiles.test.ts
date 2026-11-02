import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  stripInteractiveRules,
  extractCategoriesFromPrompt,
  importMasterPrompt,
} from '../packages/core/src/profiles/importer.js';
import {
  getSeedProfiles,
  createHorrorStoryProfile,
  createCrimeStoryProfile,
  createScienceStoryProfile,
} from '../packages/core/src/profiles/seed-profiles.js';
import { ContentProfileSchema } from '../packages/core/src/validation/schemas.js';

describe('Profile Importer & Seed Profiles Catalog', () => {
  const promptsDir = path.resolve(__dirname, '../prompts');

  it('strips interactive-only rules and provenance headers from raw prompt', () => {
    const raw = `
# MASTER PROMPT - Historical Photos
> **PROVENANCE (2026-11-01):** owner-provided
---
# **MASTER PROMPT: 500+ HISTORICAL PHOTOS COLLECTION**
You are my professional historical photography content creator.

# **1\\. THE MOST IMPORTANT INTERACTION RULE**
When I enter any number, generate EXACTLY that number.

# **2\\. FIXED CONTENT CATEGORIES**
**CATEGORY A: WORK AND INDUSTRY**
- Child labor and coal mines.

# **9\\. LARGE BATCH HANDLING**
If requested quantity exceeds output capacity, work in numbered batches.

# **10\\. FINAL COMMAND RULE**
Wait for my number.
`;

    const cleaned = stripInteractiveRules(raw);

    expect(cleaned).toContain('You are my professional historical photography content creator.');
    expect(cleaned).toContain('CATEGORY A: WORK AND INDUSTRY');
    expect(cleaned).not.toContain('THE MOST IMPORTANT INTERACTION RULE');
    expect(cleaned).not.toContain('When I enter any number');
    expect(cleaned).not.toContain('LARGE BATCH HANDLING');
    expect(cleaned).not.toContain('FINAL COMMAND RULE');
    expect(cleaned).not.toContain('PROVENANCE');
  });

  it('extracts named categories with balanced weights summing to 100%', () => {
    const sample = `
**CATEGORY A: SPACE AND ASTRONOMY**
**CATEGORY B: EARTH AND NATURE**
**CATEGORY C: ANCIENT MYSTERIES**
**CATEGORY D: MODERN BREAKTHROUGHS**
`;
    const categories = extractCategoriesFromPrompt(sample);
    expect(categories.length).toBe(4);
    expect(categories[0].name).toBe('SPACE AND ASTRONOMY');
    expect(categories[1].name).toBe('EARTH AND NATURE');

    const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('imports Science & Space prompt enabling headline panel', () => {
    const sample = `
You are a science storyteller.
CATEGORY A: DEEP SPACE
`;
    const profile = importMasterPrompt(sample, {
      name: 'Science & Space',
      niche: 'science_space',
      headlinePanel: true,
      minWords: 120,
      maxWords: 250,
    });

    expect(profile.name).toBe('Science & Space');
    expect(profile.imageSettings.headlinePanel.enabled).toBe(true);
    expect(profile.captionSettings.min).toBe(120);
    expect(profile.captionSettings.max).toBe(250);
  });

  it('creates valid starter fiction profiles matching Appendix A', () => {
    const horror = createHorrorStoryProfile();
    expect(horror.type).toBe('fiction');
    expect(horror.captionSettings.min).toBe(500);
    expect(horror.captionSettings.max).toBe(900);
    expect(horror.captionSettings.disclaimerLine).toContain('Fictional story');
    expect(ContentProfileSchema.parse(horror)).toBeDefined();

    const crime = createCrimeStoryProfile();
    expect(crime.type).toBe('fiction');
    expect(crime.captionSettings.min).toBe(500);
    expect(crime.captionSettings.max).toBe(1000);
    expect(ContentProfileSchema.parse(crime)).toBeDefined();

    const science = createScienceStoryProfile();
    expect(science.type).toBe('factual');
    expect(science.captionSettings.formatSourceLine).toBe(true);
    expect(ContentProfileSchema.parse(science)).toBeDefined();
  });

  it('loads all 7 seed profiles from /prompts and Appendix A and validates schemas', () => {
    const allSeeds = getSeedProfiles(promptsDir);

    expect(allSeeds.length).toBe(7);

    const names = allSeeds.map((p) => p.name);
    expect(names).toContain('Historical Photos');
    expect(names).toContain('Real-Life Photography');
    expect(names).toContain('Science & Space');
    expect(names).toContain('Vintage Cars');
    expect(names).toContain('Horror Story');
    expect(names).toContain('Crime Story');
    expect(names).toContain('Science Story');

    // Every seed profile must strictly pass ContentProfileSchema validation
    for (const seed of allSeeds) {
      expect(() => ContentProfileSchema.parse(seed)).not.toThrow();
    }
  });
});
