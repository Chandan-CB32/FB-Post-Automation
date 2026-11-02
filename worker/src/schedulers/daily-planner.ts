export type CaptionLengthPreset = 'short' | 'standard' | 'long' | 'story' | 'epic';

export interface PageDemandInput {
  pageId: string;
  pageName: string;
  postsPerDay: number;
  captionLengthPreset: CaptionLengthPreset;
}

export interface ProviderCapacityInput {
  providerId: string;
  name: string;
  kind: 'text' | 'image' | 'both';
  remainingRequests: number;
  remainingTokens?: number;
}

export interface DemandPlanResult {
  estimatedPostsToday: number;
  estimatedImagesToday: number;
  estimatedTokensToday: number;
  availableTextRequests: number;
  availableImageRequests: number;
  status: 'healthy' | 'tight' | 'throttled';
  shouldThrottle: boolean;
  warnings: string[];
  suggestedSlotGapMinutes: number;
}

// Token usage estimation by length preset (including outline, chunks, QA passes)
export const TOKEN_ESTIMATION_TABLE: Record<CaptionLengthPreset, number> = {
  short: 500,       // 80–150 words
  standard: 800,    // 120–220 words
  long: 1500,       // 250–500 words
  story: 3500,      // 500–1,200 words
  epic: 7500,       // 1,200–2,500 words
};

export class DailyDemandPlanner {
  /**
   * Evaluates expected post generation demand against remaining daily provider quotas.
   */
  evaluateDailyDemand(
    pages: PageDemandInput[],
    providerCapacities: ProviderCapacityInput[]
  ): DemandPlanResult {
    let totalPosts = 0;
    let totalTokens = 0;

    for (const page of pages) {
      const posts = Math.max(0, page.postsPerDay);
      totalPosts += posts;
      const tokensPerPost = TOKEN_ESTIMATION_TABLE[page.captionLengthPreset] || 800;
      totalTokens += posts * tokensPerPost;
    }

    // Allocate 1 image per post + 20% retry buffer (1.2x) as specified in PRD Section 2
    const totalImages = Math.ceil(totalPosts * 1.2);

    // Sum available capacity
    let availableTextRequests = 0;
    let availableImageRequests = 0;

    for (const cap of providerCapacities) {
      if (cap.kind === 'text' || cap.kind === 'both') {
        availableTextRequests += Math.max(0, cap.remainingRequests);
      }
      if (cap.kind === 'image' || cap.kind === 'both') {
        availableImageRequests += Math.max(0, cap.remainingRequests);
      }
    }

    const warnings: string[] = [];
    let shouldThrottle = false;
    let status: 'healthy' | 'tight' | 'throttled' = 'healthy';
    let suggestedSlotGapMinutes = 120; // Default 2 hours

    // 1. Check text demand vs supply
    // Each post takes ~2-4 text requests (topic select, write sections, QA)
    const requiredTextRequests = totalPosts * 3;
    if (availableTextRequests < requiredTextRequests) {
      warnings.push(
        `Insufficient text provider capacity: need ~${requiredTextRequests} requests, but only ${availableTextRequests} remaining.`
      );
      shouldThrottle = true;
      status = 'throttled';
    } else if (availableTextRequests < requiredTextRequests * 1.25) {
      warnings.push(
        `Tight text provider capacity: remaining budget (${availableTextRequests}) is close to daily demand (${requiredTextRequests}).`
      );
      status = 'tight';
    }

    // 2. Check image demand vs supply
    if (availableImageRequests < totalImages) {
      warnings.push(
        `Insufficient image provider capacity: need ${totalImages} images (including retries), but only ${availableImageRequests} remaining.`
      );
      shouldThrottle = true;
      status = 'throttled';
    } else if (availableImageRequests < totalImages * 1.2) {
      warnings.push(
        `Tight image provider capacity: remaining budget (${availableImageRequests}) is near demand (${totalImages}).`
      );
      if (status !== 'throttled') status = 'tight';
    }

    // 3. Spacing adjustments
    if (shouldThrottle) {
      suggestedSlotGapMinutes = 240; // Expand gap to 4 hours when throttled
    } else if (status === 'tight') {
      suggestedSlotGapMinutes = 180; // Expand gap to 3 hours
    }

    return {
      estimatedPostsToday: totalPosts,
      estimatedImagesToday: totalImages,
      estimatedTokensToday: totalTokens,
      availableTextRequests,
      availableImageRequests,
      status,
      shouldThrottle,
      warnings,
      suggestedSlotGapMinutes,
    };
  }
}
