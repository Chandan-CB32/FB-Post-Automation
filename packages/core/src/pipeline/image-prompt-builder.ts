/**
 * Concrete Image Prompt Builder & Visual Variety Guard
 * Replaces generic abstract glows with concrete physical subjects, realistic settings,
 * anti-repetition variety, and negative prompts.
 */

export interface BuildImagePromptInput {
  headline: string;
  caption: string;
  facts: string[];
  topic: string;
  category?: string;
  visualConcept?: string;
  recentPrompts?: string[];
}

export interface ConcreteImagePromptResult {
  prompt: string;
  negativePrompt: string;
  concreteSubject: string;
  setting: string;
  palette: string;
  style: string;
  aspectRatio: '4:5';
}

const MANDATORY_NEGATIVE_PROMPT =
  'text, letters, words, numbers, watermark, signature, logo, banner, blurry, deformed anatomy, extra limbs, bad proportions, generic blue glow, glowing orb, central glowing circle, abstract light vortex, digital lines, CGI swirl, neon bloom, childish, cartoon, 3d render, oversaturated bloom, low resolution, dark glowing ball, electric heart, energy portal, generic fantasy energy';

// Palette options for visual variety across posts - vivid, real documentary lighting
const VARIETY_PALETTES = [
  'sun-drenched crystal turquoise and azure ocean water with brilliant light rays',
  'warm amber and golden directional sunlight with deep authentic shadow contrast',
  'crisp scientific cleanroom daylight with brushed titanium and optic glass highlights',
  'polar glacial ice with crystalline white, pale turquoise, and dark volcanic rock',
  'terracotta and oxidized iron red-browns with harsh atmospheric sunlight',
  'vibrant planetary clouds, deep violet and ochre hues with brilliant distant starlight',
  'emerald rainforest canopy with filtered dappled natural daylight',
];

/**
 * Extracts the central concrete physical subject from the post content.
 */
export function extractConcreteSubject(
  headline: string,
  caption: string,
  facts: string[],
  topic: string
): string {
  const combined = `${headline} ${caption} ${facts.join(' ')} ${topic}`.toLowerCase();

  // 1. Biological / Animal subjects
  if (combined.includes('blue whale') || combined.includes('whale heart')) {
    return 'an enormous blue whale swimming majestically near the surface of clear sunlit ocean waters, authentic textured whale skin with barnacles and water ripples, National Geographic marine wildlife photography';
  }
  if (combined.includes('octopus') || combined.includes('three hearts')) {
    return 'a realistic living octopus perched on vibrant ocean coral reef, detailed suction cups and skin camouflage textures in natural sunlit seawater';
  }
  if (combined.includes('frog') || combined.includes('glass frog')) {
    return 'a glass frog resting on a lush tropical rainforest leaf, transparent belly revealing beating heart and organs in sharp macro photography';
  }

  // 2. Neuroscience & BCI subjects (strictly real laboratory hardware, no abstract energy)
  if (
    combined.includes('ecog') ||
    combined.includes('electrocorticography') ||
    combined.includes('brain-computer') ||
    combined.includes('speech cortex') ||
    combined.includes('neural interface')
  ) {
    return 'macro photograph of a precision micro-electrode clinical sensor grid resting in a biomedical research laboratory with titanium tools and microchips, clean scientific documentary photo';
  }

  // 3. Geology, Microbes & Extremophiles (rocks vs microbes)
  if (
    combined.includes('extremophile') ||
    combined.includes('peridotite') ||
    combined.includes('antarctic') ||
    combined.includes('microbe')
  ) {
    return 'a rough cross-section of deep green peridotite rock from Antarctica, macro view showing microscopic crystalline fissures where endolithic organisms survive';
  }

  // 4. Quantum & Photon experiments (avoid generic electric swirls)
  if (
    combined.includes('planck') ||
    combined.includes('photon') ||
    combined.includes('laser') ||
    combined.includes('quantum')
  ) {
    return 'an optical research breadboard table inside a cleanroom, showing a precision laser beam entering a polarizing beam splitter cube with single-photon fiber detectors';
  }

  // 5. Space, Astronomy & Exoplanets
  if (combined.includes('k2-18b') || combined.includes('hycean')) {
    return 'exoplanet K2-18b with a deep turbulent liquid ocean under atmospheric clouds, seen with its massive reddish dwarf star on the horizon, realistic space science visualization';
  }
  if (combined.includes('white dwarf') || combined.includes('planet survives')) {
    return 'an astronomical visualization of an intact gas giant planet closely orbiting a brilliant white dwarf stellar core, reflective cloud bands and stark cosmic illumination';
  }
  if (combined.includes('jupiter') || combined.includes('juno')) {
    return 'realistic scientific visualization of Jupiter as seen by the Juno spacecraft, showing swirling polar cyclones and deep atmospheric bands with accurate NASA telemetry';
  }

  // Fallback: extract specific scientific noun phrases
  const cleanedHeadline = headline
    .replace(/\*\*/g, '')
    .replace(/\b(PUMPS|REVEALED|CONFIRMS|DISCOVERS|DECODES|HARBOR|WITH|EVERY|REAL|TIME|MODERN|NEW)\b/gi, '')
    .trim();

  return `a scientifically accurate, photorealistic representation of ${cleanedHeadline || topic}`;
}

/**
 * Calculates Jaccard token similarity between two prompt strings.
 */
export function computePromptSimilarity(promptA: string, promptB: string): number {
  if (!promptA || !promptB) return 0;
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );
  const setA = tokenize(promptA);
  const setB = tokenize(promptB);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Checks whether a new prompt is too visually repetitive compared to recent prompts.
 */
export function checkPromptVariety(
  newPrompt: string,
  recentPrompts: string[] = []
): { ok: boolean; maxSimilarity: number; reason?: string } {
  if (!recentPrompts || recentPrompts.length === 0) {
    return { ok: true, maxSimilarity: 0 };
  }

  const newLower = newPrompt.toLowerCase();
  const hasBlueGlow =
    newLower.includes('blue glow') ||
    newLower.includes('blue light') ||
    newLower.includes('cyan vortex') ||
    newLower.includes('blue energy');

  let consecutiveBlueCount = 0;
  for (const prev of recentPrompts.slice(0, 3)) {
    const pl = prev.toLowerCase();
    if (pl.includes('blue') || pl.includes('cyan') || pl.includes('glow')) {
      consecutiveBlueCount++;
    }
  }

  if (hasBlueGlow && consecutiveBlueCount >= 2) {
    return {
      ok: false,
      maxSimilarity: 0.8,
      reason: 'Repeated blue-glow visual look: last 2 posts already used blue tones. Switch visual palette.',
    };
  }

  let maxSim = 0;
  for (const prev of recentPrompts.slice(0, 10)) {
    const sim = computePromptSimilarity(newPrompt, prev);
    if (sim > maxSim) maxSim = sim;
    if (sim >= 0.55) {
      return {
        ok: false,
        maxSimilarity: sim,
        reason: `Image prompt is too similar (${Math.round(sim * 100)}% overlap) to a recent post visual.`,
      };
    }
  }

  return { ok: true, maxSimilarity: maxSim };
}

/**
 * Builds a concrete, high-relevance image prompt that strictly names physical subjects
 * and keeps the bottom 35% calm for headline card overlays.
 */
export function buildConcreteImagePrompt(input: BuildImagePromptInput): ConcreteImagePromptResult {
  const { headline, caption, facts, topic, category = '', recentPrompts = [] } = input;

  // 1. Concrete subject
  let concreteSubject = input.visualConcept?.trim() || '';
  if (!concreteSubject || concreteSubject.length < 20 || concreteSubject.toLowerCase().includes('glowing blue')) {
    concreteSubject = extractConcreteSubject(headline, caption, facts, topic);
  }

  // 2. Select visual palette based on recent history to guarantee variety
  const recentCount = recentPrompts.length;
  let paletteIndex = recentCount % VARIETY_PALETTES.length;

  // If recent prompts used blue/cyan, avoid index 0 (blue ocean)
  const lastPrompt = (recentPrompts[0] || '').toLowerCase();
  if (lastPrompt.includes('blue') || lastPrompt.includes('ocean') || lastPrompt.includes('cyan')) {
    paletteIndex = (paletteIndex + 1) % VARIETY_PALETTES.length;
    if (paletteIndex === 0) paletteIndex = 1;
  }
  const selectedPalette = VARIETY_PALETTES[paletteIndex];

  // 3. Setting & environment
  let setting = 'realistic scientific documentary setting';
  const combined = (headline + ' ' + caption).toLowerCase();
  if (combined.includes('ocean') || combined.includes('marine') || combined.includes('whale')) {
    setting = 'deep ocean twilight zone, natural underwater lighting with suspended particulate';
  } else if (combined.includes('antarctic') || combined.includes('peridotite') || combined.includes('rock')) {
    setting = 'harsh McMurdo dry valley polar environment, raw geological terrain';
  } else if (combined.includes('ecog') || combined.includes('speech') || combined.includes('brain')) {
    setting = 'high-tech clinical neurophysiology laboratory, clean directional lighting';
  } else if (combined.includes('photon') || combined.includes('planck') || combined.includes('laser')) {
    setting = 'darkened quantum optics cleanroom with precision scientific instrumentation';
  }

  // 4. Style & Camera specification
  const style = 'High-detail National Geographic editorial documentary photography, tack-sharp focal point, 8k resolution, authentic material textures, zero digital bloom';

  // 5. Construct the full positive prompt with Calm Bottom rule
  const promptParts = [
    `Authentic, high-detail documentary photograph of ${concreteSubject}.`,
    `Environment: ${setting}.`,
    `Visual palette: ${selectedPalette}.`,
    `Shot on telephoto lens with natural cinematic depth of field and tack-sharp textures.`,
    `Composition Rule: Place the main focal subject in the upper 65% of the frame. Keep the bottom 35% calm, uncluttered, dark, and clear of high-contrast details for text typography overlay.`,
    `NO generic glowing blue energy, NO abstract light vortex, NO fantasy CGI, NO text, NO watermarks.`,
    `Editorial photography style, realistic, 8k resolution, authentic lighting, zero artificial glowing energy, zero text.`,
  ];

  const fullPrompt = promptParts.join(' ');

  return {
    prompt: fullPrompt,
    negativePrompt: MANDATORY_NEGATIVE_PROMPT,
    concreteSubject,
    setting,
    palette: selectedPalette,
    style,
    aspectRatio: '4:5',
  };
}

