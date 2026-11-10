import {
  runGenerationPipeline,
  GenerationPipelineOptions,
  GenerationPipelineResult,
} from '@fb-auto/core';
import { executePublishStage, ExecutePublishStageResult } from './stages/07-post.js';

export interface WorkerPostGenerationOptions extends GenerationPipelineOptions {
  pageToken?: string;
  fbPageId?: string;
  scheduledFor?: Date | string | number;
}

export interface WorkerPostGenerationResult {
  pipeline: GenerationPipelineResult;
  publishResult?: ExecutePublishStageResult;
}

/**
 * Executes a full worker post generation cycle.
 * Directly calls the unified generation pipeline shared with Test Run,
 * and enforces human-review gates before publishing.
 */
export async function executeWorkerPipelinePost(
  options: WorkerPostGenerationOptions
): Promise<WorkerPostGenerationResult> {
  // 1. Run the unified generation pipeline (SAME function as Test Run)
  const pipelineResult = await runGenerationPipeline(options);

  if (!pipelineResult.success) {
    return { pipeline: pipelineResult };
  }

  // 2. If test run, strict zero side-effects: never publish or schedule
  if (options.isTestRun) {
    return { pipeline: pipelineResult };
  }

  // 3. Worker Publishing / Holding via Stage 7
  const publishResult = await executePublishStage({
    pageId: options.fbPageId || options.page.id || 'unknown_page',
    pageToken: options.pageToken || '',
    caption: pipelineResult.caption,
    imageUrl: pipelineResult.thumbnailUrl || undefined,
    publishingMode: (options.page.publishing_mode as any) || 'review',
    scheduledFor: options.scheduledFor,
    qaScore: pipelineResult.qaScore,
    hybridMinScore: options.page.hybrid_min_score || 80,
    emergencyReformatApplied: pipelineResult.requires_human_review,
    requiresHumanReview: pipelineResult.requires_human_review,
    reviewReason: pipelineResult.review_reason,
  });

  return {
    pipeline: pipelineResult,
    publishResult,
  };
}
