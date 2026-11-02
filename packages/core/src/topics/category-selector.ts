export interface CategoryWeightItem {
  name: string;
  weight: number;
}

export interface CategorySelectionOptions {
  preventConsecutive?: boolean;
}

/**
 * Selects a target category according to configured weights,
 * enforcing the "prevent consecutive repeated category" rule.
 */
export function selectTargetCategory(
  categories: CategoryWeightItem[],
  recentHistory: Array<{ category?: string | null }> = [],
  options: CategorySelectionOptions = { preventConsecutive: true }
): string {
  if (!categories || categories.length === 0) {
    return 'General';
  }

  if (categories.length === 1) {
    return categories[0].name;
  }

  // Filter out zero-weight categories
  let activePool = categories.filter((c) => c.weight > 0);
  if (activePool.length === 0) {
    activePool = categories;
  }

  // Enforce preventConsecutive rule
  const lastCategory = recentHistory[0]?.category?.trim().toLowerCase();
  if (options.preventConsecutive !== false && lastCategory && activePool.length > 1) {
    const nonConsecutivePool = activePool.filter(
      (c) => c.name.trim().toLowerCase() !== lastCategory
    );
    if (nonConsecutivePool.length > 0) {
      activePool = nonConsecutivePool;
    }
  }

  // Weighted random selection
  const totalWeight = activePool.reduce((sum, c) => sum + (c.weight > 0 ? c.weight : 1), 0);
  let randomVal = Math.random() * totalWeight;

  for (const cat of activePool) {
    const w = cat.weight > 0 ? cat.weight : 1;
    if (randomVal <= w) {
      return cat.name;
    }
    randomVal -= w;
  }

  return activePool[activePool.length - 1].name;
}
