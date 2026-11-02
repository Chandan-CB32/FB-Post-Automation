import { getSupabaseClient, CORE_VERSION } from '@fb-auto/core';
import { workerState, startHealthServer, stopHealthServer } from './server.js';

export { workerState, startHealthServer, stopHealthServer } from './server.js';
export * from './router/strategies.js';
export * from './router/provider-router.js';
export * from './router/quota-tracker.js';
export * from './router/health-checker.js';
export * from './router/bench-runner.js';
export * from './schedulers/daily-planner.js';
export * from './stages/test-run-runner.js';
export * from './research/rss-fetcher.js';
export * from './research/collector.js';
export * from './stages/02-research-idea.js';

export function getWorkerStatus() {
  return {
    status: workerState.status,
    coreVersion: CORE_VERSION,
  };
}

let isShuttingDown = false;
let loopTimer: NodeJS.Timeout | null = null;

export async function runHeartbeat(): Promise<void> {
  const timestamp = new Date().toISOString();
  workerState.lastHeartbeat = timestamp;
  workerState.loopCount += 1;

  console.log(`[Worker] Heartbeat #${workerState.loopCount} at ${timestamp}`);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('settings').upsert({
        key: 'worker_heartbeat',
        value: {
          lastHeartbeat: timestamp,
          loopCount: workerState.loopCount,
          status: workerState.status,
          version: CORE_VERSION,
        },
        updated_at: timestamp,
      });
      if (error) {
        console.warn('[Worker] Failed to write heartbeat to Supabase:', error.message);
      }
    } catch (err: unknown) {
      console.warn('[Worker] Supabase heartbeat error:', err);
    }
  }
}

export async function runWorkerCycle(): Promise<{ executed: boolean; message: string }> {
  if (workerState.isPaused) {
    console.log('[Worker] System is paused via kill switch. Skipping cycle.');
    return { executed: false, message: 'Paused' };
  }

  workerState.status = 'running';
  await runHeartbeat();

  // In later milestones, pipeline stages (slot planning, research, write, post) run here.
  // Currently verifies skeleton heartbeat.

  workerState.status = 'idle';
  return { executed: true, message: `Completed cycle #${workerState.loopCount}` };
}

export async function startWorkerLoop(intervalSeconds = 60): Promise<void> {
  console.log(`[Worker] Starting 24x7 worker loop (interval: ${intervalSeconds}s)...`);

  // Run immediate first cycle
  await runWorkerCycle();

  // Schedule recurring loop
  loopTimer = setInterval(async () => {
    if (isShuttingDown) return;
    try {
      await runWorkerCycle();
    } catch (err) {
      console.error('[Worker] Error during worker cycle:', err);
    }
  }, intervalSeconds * 1000);
}

export async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  workerState.status = 'stopping';
  console.log('[Worker] Shutting down gracefully...');

  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }

  await stopHealthServer();
  console.log('[Worker] Cleanup complete. Exiting.');
}

// Process signal handlers
process.on('SIGINT', async () => {
  console.log('[Worker] Received SIGINT (Ctrl+C)');
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Received SIGTERM');
  await shutdown();
  process.exit(0);
});

// Self-executing CLI detection
const isDirectExecution =
  process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'));

if (isDirectExecution) {
  const isOnce = process.argv.includes('--once');
  const port = parseInt(process.env.PORT || '8080', 10);
  const intervalSeconds = parseInt(process.env.WORKER_LOOP_SECONDS || '60', 10);

  if (isOnce) {
    console.log('[Worker] Running in one-shot mode (--once)...');
    runWorkerCycle()
      .then((res) => {
        console.log(`[Worker] One-shot execution complete: ${res.message}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('[Worker] Fatal error in one-shot run:', err);
        process.exit(1);
      });
  } else {
    startHealthServer(port, runWorkerCycle).then(() => {
      startWorkerLoop(intervalSeconds).catch((err) => {
        console.error('[Worker] Fatal error in loop runner:', err);
        process.exit(1);
      });
    });
  }
}
