/**
 * CATEGORY ENGINE
 * Manages 10 scientific categories per Page with target distribution weights,
 * deficit-based assignment algorithm over the last 50 posts, and hard constraints
 * (never consecutive, max 2 per day per category, max 1 Space post per day).
 */

export interface CategoryDefinition {
  id: string;
  name: string;
  defaultWeight: number; // Percentage (summing to 100)
  maxPerDay: number;
  description: string;
}

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'space_astronomy',
    name: 'Space & Astronomy',
    defaultWeight: 20,
    maxPerDay: 1, // Hard rule: at most 1 Space post per day when posting 5 a day
    description: 'Astrophysics, exoplanets, stellar evolution, cosmological discoveries, telescopes, and celestial mechanics.',
  },
  {
    id: 'animals_ocean',
    name: 'Animals & Ocean Life',
    defaultWeight: 14,
    maxPerDay: 2,
    description: 'Marine biology, deep-sea organisms, zoology, animal adaptations, echolocation, and biomechanics.',
  },
  {
    id: 'earth_extreme',
    name: 'Earth & Extreme Phenomena',
    defaultWeight: 11,
    maxPerDay: 2,
    description: 'Geology, plate tectonics, extreme weather, volcanic systems, hydrothermal vents, and atmospheric events.',
  },
  {
    id: 'physics_chemistry',
    name: 'Physics & Chemistry',
    defaultWeight: 11,
    maxPerDay: 2,
    description: 'Quantum phenomena, thermodynamics, material science, fluid dynamics, electromagnetism, and chemical synthesis.',
  },
  {
    id: 'human_body_brain',
    name: 'Human Body & Brain',
    defaultWeight: 10,
    maxPerDay: 2,
    description: 'Neuroscience, cognitive architecture, sensory processing, immunology, cell biology, and organ physiology.',
  },
  {
    id: 'plants_fungi_nature',
    name: 'Plants/Fungi & Nature',
    defaultWeight: 8,
    maxPerDay: 2,
    description: 'Mycology, mycorrhizal networks, plant communication, extremophile flora, photosynthesis, and botanical defenses.',
  },
  {
    id: 'ancient_life_evolution',
    name: 'Ancient Life & Evolution',
    defaultWeight: 8,
    maxPerDay: 2,
    description: 'Paleontology, fossil evidence, evolutionary transitions, mass extinctions, and prehistoric morphology.',
  },
  {
    id: 'technology_ai',
    name: 'Technology & AI',
    defaultWeight: 7,
    maxPerDay: 2,
    description: 'Quantum computing, robotic autonomy, bio-interfaces, nanomaterials, neural networks, and energy capture.',
  },
  {
    id: 'microscopic_world',
    name: 'Microscopic World',
    defaultWeight: 6,
    maxPerDay: 2,
    description: 'Microbiology, tardigrades, bacteriophages, diatoms, cellular mechanics, and molecular machines.',
  },
  {
    id: 'scientists_big_ideas',
    name: 'Scientists & Big Ideas',
    defaultWeight: 5,
    maxPerDay: 2,
    description: 'Seminal experiments, paradigm shifts, historical pioneers, mathematical elegance, and revolutionary theories.',
  },
];

export interface PageCategoryConfig {
  niche?: string;
  categories?: CategoryDefinition[];
  weights?: Record<string, number>;
  maxDailySpace?: number;
  maxDailyDominant?: number;
  maxDailyPerCategory?: number;
}

export const NICHE_PRESETS: Record<
  string,
  {
    name: string;
    description: string;
    dominantCategory: string;
    categories: CategoryDefinition[];
  }
> = {
  science: {
    name: 'Science & Cosmos',
    description: 'Astrophysics, biology, earth phenomena, quantum physics, neuroscience, and groundbreaking scientific discoveries.',
    dominantCategory: 'Space & Astronomy',
    categories: DEFAULT_CATEGORIES,
  },
  history: {
    name: 'World History & Civilizations',
    description: 'Ancient empires, archaeological discoveries, pivotal military conflicts, and legendary historical figures.',
    dominantCategory: 'Ancient Civilizations & Empires',
    categories: [
      { id: 'ancient_civilizations', name: 'Ancient Civilizations & Empires', defaultWeight: 18, maxPerDay: 1, description: 'Mesopotamia, Rome, Egypt, Indus Valley, Maya, and dynastic politics.' },
      { id: 'military_battles', name: 'Military Tactics & Decisive Battles', defaultWeight: 14, maxPerDay: 2, description: 'Famous sieges, strategic doctrines, weapon evolution, and battlefield turning points.' },
      { id: 'archaeological_finds', name: 'Archaeological Finds & Artifacts', defaultWeight: 12, maxPerDay: 2, description: 'Excavations, deciphered tablets, tomb discoveries, and forgotten ruins.' },
      { id: 'medieval_kingdoms', name: 'Medieval Kingdoms & Feudal Eras', defaultWeight: 10, maxPerDay: 2, description: 'Castles, crusades, chivalric codes, feudal intrigue, and medieval scholarship.' },
      { id: 'historical_figures', name: 'Pioneers, Leaders & Conquerors', defaultWeight: 10, maxPerDay: 2, description: 'Alexander, Cleopatra, Genghis Khan, Leonardo da Vinci, and visionary reformers.' },
      { id: 'ancient_inventions', name: 'Inventions & Ancient Engineering', defaultWeight: 10, maxPerDay: 2, description: 'Aqueducts, the Antikythera mechanism, Greek fire, and architectural feats.' },
      { id: 'maritime_exploration', name: 'Maritime Exploration & Voyages', defaultWeight: 8, maxPerDay: 2, description: 'Silk roads, age of navigation, polar expeditions, and nautical cartography.' },
      { id: 'myths_mysteries', name: 'Mythologies & Ancient Mysteries', defaultWeight: 6, maxPerDay: 2, description: 'Folklore origins, sacred rites, pantheons, and unsolved historical enigmas.' },
      { id: 'social_revolutions', name: 'Cultural Pivots & Revolutions', defaultWeight: 6, maxPerDay: 2, description: 'The Renaissance, printing press revolution, Enlightenment, and trade transformations.' },
      { id: 'modern_crises', name: 'Modern Pivotal Moments', defaultWeight: 6, maxPerDay: 2, description: 'Industrial revolutions, 20th century geopolitics, and global treaty milestones.' },
    ],
  },
  technology: {
    name: 'Technology, AI & Future',
    description: 'Artificial intelligence, robotics, quantum computing, gadgets, and next-generation engineering.',
    dominantCategory: 'AI & Machine Learning',
    categories: [
      { id: 'ai_machine_learning', name: 'AI & Machine Learning', defaultWeight: 22, maxPerDay: 1, description: 'Neural architectures, autonomous agents, LLMs, computer vision, and cognitive systems.' },
      { id: 'robotics_automation', name: 'Robotics & Autonomous Systems', defaultWeight: 15, maxPerDay: 2, description: 'Humanoid robots, robotic actuators, self-driving platforms, and industrial automation.' },
      { id: 'quantum_future_tech', name: 'Quantum & Future Computing', defaultWeight: 12, maxPerDay: 2, description: 'Qubits, quantum supremacy, optical computing, and neuromorphic chips.' },
      { id: 'consumer_tech_gadgets', name: 'Consumer Tech & Gadgets', defaultWeight: 12, maxPerDay: 2, description: 'Flagship hardware, VR/AR spatial headsets, wearables, and microelectronics.' },
      { id: 'cybersecurity_privacy', name: 'Cybersecurity & Privacy', defaultWeight: 10, maxPerDay: 2, description: 'Zero-day exploits, cryptographic protocols, blockchain security, and network defenses.' },
      { id: 'biotech_augmentation', name: 'Biotech & Human Augmentation', defaultWeight: 10, maxPerDay: 2, description: 'Brain-computer interfaces, CRISPR genetic tools, synthetic biology, and bionics.' },
      { id: 'aerospace_satellites', name: 'Aerospace & Satellite Tech', defaultWeight: 10, maxPerDay: 2, description: 'Reusable orbital boosters, mega-constellations, ion thrusters, and space sensors.' },
      { id: 'clean_energy_tech', name: 'Clean Energy & Battery Tech', defaultWeight: 9, maxPerDay: 2, description: 'Solid-state batteries, fusion milestones, solar efficiency, and grid scale storage.' },
    ],
  },
  motivation_mindset: {
    name: 'Motivation, Mindset & Philosophy',
    description: 'Mental models, habit architecture, stoicism, deep work, and high-performance psychology.',
    dominantCategory: 'Mental Models & Decision Making',
    categories: [
      { id: 'mental_models', name: 'Mental Models & Decision Making', defaultWeight: 20, maxPerDay: 1, description: 'First principles, second-order thinking, probabilistic judgment, and inversion.' },
      { id: 'productivity_deep_work', name: 'Deep Work & Productivity Systems', defaultWeight: 16, maxPerDay: 2, description: 'Flow state triggers, cognitive load management, time boxing, and distraction defense.' },
      { id: 'stoic_philosophy', name: 'Stoic & Practical Philosophy', defaultWeight: 14, maxPerDay: 2, description: 'Marcus Aurelius, Seneca, Epictetus, amor fati, and voluntary discomfort.' },
      { id: 'habit_formation', name: 'Habit Formation & Behavioral Science', defaultWeight: 14, maxPerDay: 2, description: 'Cue-routine-reward loops, environment design, friction reduction, and identity shifts.' },
      { id: 'high_performance', name: 'High Performance & Discipline', defaultWeight: 12, maxPerDay: 2, description: 'Dopamine regulation, sleep architecture, recovery protocols, and relentless focus.' },
      { id: 'emotional_intelligence', name: 'Emotional Intelligence & Psychology', defaultWeight: 10, maxPerDay: 2, description: 'Self-regulation, cognitive reframing, active listening, and social acumen.' },
      { id: 'leadership_influence', name: 'Leadership & Strategic Influence', defaultWeight: 8, maxPerDay: 2, description: 'High-stakes negotiation, asymmetric leverage, team alignment, and executive poise.' },
      { id: 'resilience_stress', name: 'Resilience Under Pressure', defaultWeight: 6, maxPerDay: 2, description: 'Antifragility, stress inoculation, reframing adversity, and post-traumatic growth.' },
    ],
  },
  finance_crypto: {
    name: 'Finance, Investing & Wealth',
    description: 'Stock markets, macroeconomics, crypto, real estate, and long-term wealth compounding strategies.',
    dominantCategory: 'Global Macro & Market Cycles',
    categories: [
      { id: 'macro_markets', name: 'Global Macro & Market Cycles', defaultWeight: 18, maxPerDay: 1, description: 'Central bank policies, interest rate regimes, inflation trends, and debt supercycles.' },
      { id: 'value_investing', name: 'Value Investing & Stock Analysis', defaultWeight: 16, maxPerDay: 2, description: 'DCF models, moat evaluation, earnings quality, and margin of safety.' },
      { id: 'crypto_defi', name: 'Crypto, Bitcoin & DeFi', defaultWeight: 15, maxPerDay: 2, description: 'Bitcoin halving cycles, smart contracts, Layer 2 scaling, and token economics.' },
      { id: 'wealth_compounding', name: 'Wealth Building & Compounding', defaultWeight: 15, maxPerDay: 2, description: 'Index investing, dollar-cost averaging, asset allocation, and tax-advantaged compounding.' },
      { id: 'real_estate_assets', name: 'Real Estate & Tangible Assets', defaultWeight: 12, maxPerDay: 2, description: 'Cap rates, commercial real estate, commodity hedging, and precious metals.' },
      { id: 'startups_venture', name: 'Startup Ecosystem & Venture', defaultWeight: 10, maxPerDay: 2, description: 'Bootstrapping, product-market fit, angel rounds, and asymmetric venture bets.' },
      { id: 'market_crashes', name: 'Historic Crashes & Market Mania', defaultWeight: 8, maxPerDay: 2, description: '1929 crash, Dot-com bubble, 2008 GFC, tulip mania, and systemic liquidity crunches.' },
      { id: 'cashflow_systems', name: 'Cash Flow Systems & Tax Tactics', defaultWeight: 6, maxPerDay: 2, description: 'Corporate entity structuring, deductions, cash buffer reserves, and dividend streams.' },
    ],
  },
  nature_wildlife: {
    name: 'Nature & Wildlife Wonders',
    description: 'Ocean depths, apex predators, rainforest marvels, extreme climate survivors, and conservation.',
    dominantCategory: 'Ocean Giants & Deep Sea Life',
    categories: [
      { id: 'ocean_giants', name: 'Ocean Giants & Deep Sea Life', defaultWeight: 20, maxPerDay: 1, description: 'Cetaceans, bioluminescent abyssal creatures, giant squids, and hydrothermal ecology.' },
      { id: 'apex_predators', name: 'Apex Predators & Survival', defaultWeight: 16, maxPerDay: 2, description: 'Hunting mechanics, pack dynamics, territorial dominance, and predatory sensory adaptations.' },
      { id: 'polar_extreme', name: 'Polar & Extreme Cold Survivors', defaultWeight: 14, maxPerDay: 2, description: 'Antarctic krill, arctic tundra adaptations, antifreeze blood proteins, and glacial fauna.' },
      { id: 'rainforest_biodiversity', name: 'Rainforest & Jungle Marvels', defaultWeight: 14, maxPerDay: 2, description: 'Canopy species, symbiotic partnerships, toxic defenses, and mimicry.' },
      { id: 'birds_flight', name: 'Birds of Prey & Avian Flight', defaultWeight: 12, maxPerDay: 2, description: 'Thermal soaring, raptor vision, migratory navigation, and plumage aerodynamics.' },
      { id: 'insect_kingdoms', name: 'Insect Superorganisms & Wonders', defaultWeight: 10, maxPerDay: 2, description: 'Ant colony intelligence, hive architecture, metamorphosis, and micro-engineering.' },
      { id: 'ancient_flora', name: 'Ancient Flora & Forest Networks', defaultWeight: 8, maxPerDay: 2, description: 'Old-growth sequoias, underground mycelial webs, carnivorous plants, and living fossils.' },
      { id: 'conservation_endangered', name: 'Endangered Species & Conservation', defaultWeight: 6, maxPerDay: 2, description: 'Re-wilding projects, biodiversity corridors, de-extinction science, and habitat restoration.' },
    ],
  },
};

export function getCategoriesForPage(config: PageCategoryConfig = {}): {
  nicheKey: string;
  nicheName: string;
  dominantCategory: string;
  categories: CategoryDefinition[];
} {
  if (Array.isArray(config.categories) && config.categories.length > 0) {
    const dominant = config.categories[0]?.name || 'Dominant Category';
    return {
      nicheKey: config.niche || 'custom',
      nicheName: config.niche ? (NICHE_PRESETS[config.niche]?.name || config.niche) : 'Custom Niche',
      dominantCategory: dominant,
      categories: config.categories,
    };
  }

  const rawKey = (config.niche || 'science').toLowerCase().trim();
  const matchedKey = Object.keys(NICHE_PRESETS).find((k) => k === rawKey || rawKey.includes(k));
  if (matchedKey && NICHE_PRESETS[matchedKey]) {
    const preset = NICHE_PRESETS[matchedKey];
    return {
      nicheKey: matchedKey,
      nicheName: preset.name,
      dominantCategory: preset.dominantCategory,
      categories: preset.categories,
    };
  }

  return {
    nicheKey: 'science',
    nicheName: NICHE_PRESETS.science.name,
    dominantCategory: NICHE_PRESETS.science.dominantCategory,
    categories: NICHE_PRESETS.science.categories,
  };
}

export interface PostRecordForCategory {
  id?: string;
  category?: string | null;
  title?: string | null;
  caption?: string | null;
  topic?: string | null;
  created_at?: string | Date;
  scheduled_for?: string | Date;
  published_at?: string | Date;
  [key: string]: any;
}

export interface CategorySelectionResult {
  assignedCategory: string;
  categoryId: string;
  deficit: number;
  actualCount: number;
  targetCount: number;
  todayCount: number;
  reason: string;
}

/**
 * Normalizes category names for robust case-insensitive comparison.
 */
export function normalizeCategoryName(name: string, customCategories?: CategoryDefinition[]): string {
  const cats = customCategories && customCategories.length > 0 ? customCategories : DEFAULT_CATEGORIES;
  const lower = (name || '').toLowerCase().trim();
  for (const cat of cats) {
    if (cat.name.toLowerCase() === lower || cat.id.toLowerCase() === lower) {
      return cat.name;
    }
  }
  // Check against all presets to find any category match across all niches
  for (const preset of Object.values(NICHE_PRESETS)) {
    for (const cat of preset.categories) {
      if (cat.name.toLowerCase() === lower || cat.id.toLowerCase() === lower) {
        return cat.name;
      }
    }
  }

  // Keyword mapping fallbacks
  if (lower.includes('space') || lower.includes('astronom') || lower.includes('exoplanet') || lower.includes('telescope')) return 'Space & Astronomy';
  if (lower.includes('animal') || lower.includes('ocean') || lower.includes('marine') || lower.includes('whale') || lower.includes('fish')) return 'Animals & Ocean Life';
  if (lower.includes('earth') || lower.includes('geolog') || lower.includes('volcano') || lower.includes('extreme') || lower.includes('climate')) return 'Earth & Extreme Phenomena';
  if (lower.includes('physic') || lower.includes('chemistr') || lower.includes('quantum') || lower.includes('atom') || lower.includes('element')) return 'Physics & Chemistry';
  if (lower.includes('human') || lower.includes('brain') || lower.includes('neuro') || lower.includes('body') || lower.includes('medical')) return 'Human Body & Brain';
  if (lower.includes('plant') || lower.includes('fung') || lower.includes('mushroom') || lower.includes('tree') || lower.includes('forest')) return 'Plants/Fungi & Nature';
  if (lower.includes('ancient') || lower.includes('evolution') || lower.includes('fossil') || lower.includes('dinosaur') || lower.includes('prehistor')) return 'Ancient Life & Evolution';
  if (lower.includes('tech') || lower.includes('ai') || lower.includes('robot') || lower.includes('comput') || lower.includes('cyber')) return 'Technology & AI';
  if (lower.includes('micro') || lower.includes('cell') || lower.includes('bacteri') || lower.includes('virus') || lower.includes('tardigrade')) return 'Microscopic World';
  if (lower.includes('scientist') || lower.includes('idea') || lower.includes('theory') || lower.includes('pioneer')) return 'Scientists & Big Ideas';

  return cats[0]?.name || 'General';
}

/**
 * Assigns the next category in CODE according to target weights,
 * selecting the category with the largest deficit over the last 50 posts and today's posts.
 * Enforces hard rules:
 * 1. Never the same category twice in a row.
 * 2. At most 2 posts per category per day.
 * 3. At most 1 Space post per day when posting 5 a day.
 * 4. A post may not be generated until it has an assigned category.
 */
export function assignNextCategory(
  recentPosts: PostRecordForCategory[],
  config: PageCategoryConfig = {},
  now: Date = new Date()
): CategorySelectionResult {
  const windowPosts = recentPosts.slice(0, 50);
  const totalWindow = windowPosts.length;

  const pageCategoryInfo = getCategoriesForPage(config);
  const activeCategories = pageCategoryInfo.categories;
  const dominantCategoryName = pageCategoryInfo.dominantCategory;

  // Resolve weights
  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const cat of activeCategories) {
    const customWeight = config.weights?.[cat.name] ?? config.weights?.[cat.id] ?? cat.defaultWeight;
    weights[cat.name] = Math.max(0, customWeight);
    totalWeight += weights[cat.name];
  }
  if (totalWeight <= 0) totalWeight = 100;

  // Resolve daily limits
  const maxDailySpace = config.maxDailySpace ?? 1;
  const maxDailyDominant = config.maxDailyDominant ?? maxDailySpace;
  const maxDailyPerCategory = config.maxDailyPerCategory ?? 2;

  // Filter today's posts
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  const endOfTodayUtc = startOfTodayUtc + 24 * 60 * 60 * 1000;

  const todayCounts: Record<string, number> = {};
  for (const cat of activeCategories) {
    todayCounts[cat.name] = 0;
  }

  for (const p of recentPosts) {
    const postTime = new Date(p.scheduled_for || p.created_at || now).getTime();
    if (postTime >= startOfTodayUtc && postTime < endOfTodayUtc) {
      if (p.category) {
        const norm = normalizeCategoryName(p.category, activeCategories);
        todayCounts[norm] = (todayCounts[norm] || 0) + 1;
      }
    }
  }

  // Count window occurrences
  const windowCounts: Record<string, number> = {};
  for (const cat of activeCategories) {
    windowCounts[cat.name] = 0;
  }
  for (const p of windowPosts) {
    if (p.category) {
      const norm = normalizeCategoryName(p.category, activeCategories);
      windowCounts[norm] = (windowCounts[norm] || 0) + 1;
    }
  }

  // Last post category (Hard rule #1: Never the same category twice in a row)
  const lastPostCategory = windowPosts.length > 0 && windowPosts[0].category
    ? normalizeCategoryName(windowPosts[0].category, activeCategories)
    : null;

  // Evaluate candidate categories
  interface Candidate {
    name: string;
    id: string;
    deficit: number;
    actualCount: number;
    targetCount: number;
    todayCount: number;
  }

  const eligibleCandidates: Candidate[] = [];
  const allCandidates: Candidate[] = [];

  for (const cat of activeCategories) {
    const targetShare = weights[cat.name] / totalWeight;
    const targetCount = targetShare * Math.max(1, totalWindow);
    const actualCount = windowCounts[cat.name] || 0;
    const deficit = targetCount - actualCount;
    const todayCount = todayCounts[cat.name] || 0;

    const cand: Candidate = {
      name: cat.name,
      id: cat.id,
      deficit,
      actualCount,
      targetCount,
      todayCount,
    };
    allCandidates.push(cand);

    // Hard Rule 1: Never the same category twice in a row
    if (lastPostCategory && cat.name === lastPostCategory && activeCategories.length > 1) {
      continue;
    }

    // Hard Rule 3: Dominant category daily cap (e.g. max 1 Space post per day)
    const isDominant = cat.name === dominantCategoryName || (cat.name === 'Space & Astronomy' && pageCategoryInfo.nicheKey === 'science');
    if (isDominant && todayCount >= maxDailyDominant) {
      continue;
    }

    // Hard Rule 2: At most maxDailyPerCategory posts per category per day
    if (todayCount >= (cat.maxPerDay || maxDailyPerCategory)) {
      continue;
    }

    eligibleCandidates.push(cand);
  }

  // Choose the candidate with largest deficit
  let chosen: Candidate;
  let reason = '';

  if (eligibleCandidates.length > 0) {
    eligibleCandidates.sort((a, b) => b.deficit - a.deficit);
    chosen = eligibleCandidates[0];
    reason = `Selected '${chosen.name}' with highest weight deficit (+${chosen.deficit.toFixed(2)} vs target ${chosen.targetCount.toFixed(1)}).`;
  } else {
    // If all non-capped categories are exhausted, pick highest deficit non-consecutive candidate
    const nonConsecutive = allCandidates.filter((c) => c.name !== lastPostCategory);
    const pool = nonConsecutive.length > 0 ? nonConsecutive : allCandidates;
    pool.sort((a, b) => b.deficit - a.deficit);
    chosen = pool[0];
    reason = `Fallback: daily caps reached for preferred pools; picked non-consecutive '${chosen.name}' (deficit: ${chosen.deficit.toFixed(2)}).`;
  }

  return {
    assignedCategory: chosen.name,
    categoryId: chosen.id,
    deficit: chosen.deficit,
    actualCount: chosen.actualCount,
    targetCount: chosen.targetCount,
    todayCount: chosen.todayCount,
    reason,
  };
}

/**
 * Calculates current content mix shares and checks for alerts (e.g. Space > 30%).
 */
export function calculateContentMixReport(
  posts: PostRecordForCategory[],
  config: PageCategoryConfig = {},
  now: Date = new Date()
) {
  const windowPosts = posts.slice(0, 50);
  const total = windowPosts.length;

  const pageCategoryInfo = getCategoriesForPage(config);
  const activeCategories = pageCategoryInfo.categories;
  const dominantCategoryName = pageCategoryInfo.dominantCategory;

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff30Days = now.getTime() - thirtyDaysMs;
  const thirtyDayPosts = posts.filter((p) => {
    const t = new Date(p.scheduled_for || p.created_at || now).getTime();
    return !isNaN(t) && t >= cutoff30Days;
  });

  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const cat of activeCategories) {
    const customWeight = config.weights?.[cat.name] ?? cat.defaultWeight;
    weights[cat.name] = customWeight;
    totalWeight += customWeight;
  }
  if (totalWeight <= 0) totalWeight = 100;

  const calculateBreakdown = (postSlice: PostRecordForCategory[]) => {
    const counts: Record<string, number> = {};
    for (const cat of activeCategories) counts[cat.name] = 0;
    for (const p of postSlice) {
      if (p.category) {
        const norm = normalizeCategoryName(p.category, activeCategories);
        counts[norm] = (counts[norm] || 0) + 1;
      }
    }
    const sliceTotal = postSlice.length;
    return activeCategories.map((cat) => {
      const count = counts[cat.name] || 0;
      const actualShare = sliceTotal > 0 ? (count / sliceTotal) * 100 : 0;
      const targetShare = (weights[cat.name] / totalWeight) * 100;
      const diff = actualShare - targetShare;
      return {
        id: cat.id,
        name: cat.name,
        count,
        actualShare: Math.round(actualShare * 10) / 10,
        targetShare: Math.round(targetShare * 10) / 10,
        diff: Math.round(diff * 10) / 10,
        maxPerDay: cat.maxPerDay,
      };
    });
  };

  const categories = calculateBreakdown(windowPosts);
  const last30DaysCategories = calculateBreakdown(thirtyDayPosts);

  const dominantCatStat = categories.find((c) => c.name === dominantCategoryName) || categories[0];
  const dominantShare = dominantCatStat ? dominantCatStat.actualShare : 0;
  const hasSpaceAlert = dominantShare > 30;

  const alerts: string[] = [];
  if (hasSpaceAlert) {
    alerts.push(`${dominantCatStat.name} is at ${dominantShare}% of recent posts (exceeds 30% ceiling). Category engine will prioritize other categories.`);
  }

  const subjectCounts: Record<string, number> = {};
  const openingCounts: Record<string, number> = {};

  for (const p of windowPosts) {
    if (p.title) {
      const cleanTitle = p.title.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim();
      if (cleanTitle) {
        subjectCounts[cleanTitle] = (subjectCounts[cleanTitle] || 0) + 1;
      }
    }
    if (p.caption) {
      const firstWords = p.caption.trim().split(/\s+/).slice(0, 4).join(' ');
      if (firstWords) {
        openingCounts[firstWords] = (openingCounts[firstWords] || 0) + 1;
      }
    }
  }

  const topRepeatedSubjects = Object.entries(subjectCounts)
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const openingPhraseFrequency = Object.entries(openingCounts)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalPosts: total,
    thirtyDayPostsCount: thirtyDayPosts.length,
    nicheKey: pageCategoryInfo.nicheKey,
    nicheName: pageCategoryInfo.nicheName,
    dominantCategory: dominantCategoryName,
    categories,
    last30DaysCategories,
    hasSpaceAlert,
    alerts,
    topRepeatedSubjects,
    openingPhraseFrequency,
    openingPhraseFrequencies: openingPhraseFrequency,
  };
}

