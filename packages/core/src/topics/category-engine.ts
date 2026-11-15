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
  weights?: Record<string, number>;
  maxDailySpace?: number;
  maxDailyPerCategory?: number;
}

export interface PostRecordForCategory {
  category?: string | null;
  title?: string | null;
  caption?: string | null;
  created_at?: string | Date;
  scheduled_for?: string | Date;
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
export function normalizeCategoryName(name: string): string {
  const lower = (name || '').toLowerCase().trim();
  for (const cat of DEFAULT_CATEGORIES) {
    if (cat.name.toLowerCase() === lower || cat.id.toLowerCase() === lower) {
      return cat.name;
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
  if (lower.includes('scientist') || lower.includes('idea') || lower.includes('theory') || lower.includes('history') || lower.includes('pioneer')) return 'Scientists & Big Ideas';

  return 'Space & Astronomy';
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

  // Resolve weights
  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const customWeight = config.weights?.[cat.name] ?? config.weights?.[cat.id] ?? cat.defaultWeight;
    weights[cat.name] = Math.max(0, customWeight);
    totalWeight += weights[cat.name];
  }
  if (totalWeight <= 0) totalWeight = 100;

  // Resolve daily limits
  const maxDailySpace = config.maxDailySpace ?? 1;
  const maxDailyPerCategory = config.maxDailyPerCategory ?? 2;

  // Filter today's posts
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  const endOfTodayUtc = startOfTodayUtc + 24 * 60 * 60 * 1000;

  const todayCounts: Record<string, number> = {};
  for (const cat of DEFAULT_CATEGORIES) {
    todayCounts[cat.name] = 0;
  }

  for (const p of recentPosts) {
    const postTime = new Date(p.scheduled_for || p.created_at || now).getTime();
    if (postTime >= startOfTodayUtc && postTime < endOfTodayUtc) {
      if (p.category) {
        const norm = normalizeCategoryName(p.category);
        todayCounts[norm] = (todayCounts[norm] || 0) + 1;
      }
    }
  }

  // Count window occurrences
  const windowCounts: Record<string, number> = {};
  for (const cat of DEFAULT_CATEGORIES) {
    windowCounts[cat.name] = 0;
  }
  for (const p of windowPosts) {
    if (p.category) {
      const norm = normalizeCategoryName(p.category);
      windowCounts[norm] = (windowCounts[norm] || 0) + 1;
    }
  }

  // Last post category (Hard rule #1: Never the same category twice in a row)
  const lastPostCategory = windowPosts.length > 0 && windowPosts[0].category
    ? normalizeCategoryName(windowPosts[0].category)
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

  for (const cat of DEFAULT_CATEGORIES) {
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
    if (lastPostCategory && cat.name === lastPostCategory && DEFAULT_CATEGORIES.length > 1) {
      continue;
    }

    // Hard Rule 3: At most 1 Space post per day
    if (cat.name === 'Space & Astronomy' && todayCount >= maxDailySpace) {
      continue;
    }

    // Hard Rule 2: At most 2 posts per category per day
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
 * Calculates current content mix shares, top repeated subjects, opening phrase frequency,
 * and checks for alerts (e.g. Space > 30% or daily cap exceeded) across last 50 posts and last 30 days.
 */
export function calculateContentMixReport(
  posts: PostRecordForCategory[],
  config: PageCategoryConfig = {},
  now: Date = new Date()
) {
  const windowPosts = posts.slice(0, 50);
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff30Days = now.getTime() - thirtyDaysMs;
  const thirtyDayPosts = posts.filter((p) => {
    const t = new Date(p.scheduled_for || p.created_at || now).getTime();
    return !isNaN(t) && t >= cutoff30Days;
  });

  const weights: Record<string, number> = {};
  let totalWeight = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const customWeight = config.weights?.[cat.name] ?? cat.defaultWeight;
    weights[cat.name] = customWeight;
    totalWeight += customWeight;
  }
  if (totalWeight <= 0) totalWeight = 100;

  const calculateBreakdown = (postSlice: PostRecordForCategory[]) => {
    const counts: Record<string, number> = {};
    for (const cat of DEFAULT_CATEGORIES) counts[cat.name] = 0;
    for (const p of postSlice) {
      if (p.category) {
        const norm = normalizeCategoryName(p.category);
        counts[norm] = (counts[norm] || 0) + 1;
      }
    }
    const total = postSlice.length;
    return DEFAULT_CATEGORIES.map((cat) => {
      const count = counts[cat.name] || 0;
      const actualShare = total > 0 ? (count / total) * 100 : 0;
      const targetShare = (weights[cat.name] / totalWeight) * 100;
      return {
        id: cat.id,
        name: cat.name,
        count,
        actualShare: Math.round(actualShare * 10) / 10,
        targetShare: Math.round(targetShare * 10) / 10,
        diff: Math.round((actualShare - targetShare) * 10) / 10,
        maxPerDay: cat.maxPerDay,
      };
    });
  };

  const last50Breakdown = calculateBreakdown(windowPosts);
  const last30DaysBreakdown = calculateBreakdown(thirtyDayPosts);

  // Top repeated subjects analysis
  const subjectCounts: Record<string, number> = {};
  for (const p of posts.slice(0, 50)) {
    const subject = (p.title || '').trim();
    if (subject) {
      subjectCounts[subject] = (subjectCounts[subject] || 0) + 1;
    }
  }
  const topRepeatedSubjects = Object.entries(subjectCounts)
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Opening phrase frequency analysis (first 6 words of caption)
  const openingCounts: Record<string, number> = {};
  for (const p of posts.slice(0, 50)) {
    const cap = (p.caption || '')
      .replace(/^#+\s+/g, '')
      .replace(/^\*+[^*]+\*+:?\s*/g, '')
      .trim();
    if (cap) {
      const words = cap.split(/\s+/).filter(Boolean).slice(0, 6).join(' ').toLowerCase();
      if (words.length > 5) {
        openingCounts[words] = (openingCounts[words] || 0) + 1;
      }
    }
  }
  const openingPhraseFrequency = Object.entries(openingCounts)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Alerts
  const spaceCategory = last50Breakdown.find((c) => c.name === 'Space & Astronomy');
  const spaceShare = spaceCategory ? spaceCategory.actualShare : 0;
  const hasSpaceAlert = spaceShare > 30;

  const alerts: string[] = [];
  if (hasSpaceAlert) {
    alerts.push(`Space & Astronomy is at ${spaceShare}% of the last 50 posts (exceeds 30% ceiling). Category engine will strictly divert to deficit categories.`);
  }

  // Check 30-day Space share
  const space30Days = last30DaysBreakdown.find((c) => c.name === 'Space & Astronomy');
  if (space30Days && space30Days.actualShare > 30 && !hasSpaceAlert) {
    alerts.push(`Space & Astronomy is at ${space30Days.actualShare}% over the last 30 days (exceeds 30% ceiling).`);
  }

  return {
    totalPosts: windowPosts.length,
    thirtyDayPostsCount: thirtyDayPosts.length,
    categories: last50Breakdown,
    last30DaysCategories: last30DaysBreakdown,
    topRepeatedSubjects,
    openingPhraseFrequency,
    hasSpaceAlert,
    alerts,
  };
}
