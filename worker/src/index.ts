import {
  getSupabaseClient,
  CORE_VERSION,
  decryptPageToken,
  encryptPageToken,
  discoverFacebookPages,
} from '@fb-auto/core';
import { workerState, startHealthServer, stopHealthServer } from './server.js';
import { createTimeBudgetTracker, type TimeBudgetTracker } from './time-budget.js';
import { acquireWorkerLock, releaseWorkerLock } from './lock.js';

export { workerState, startHealthServer, stopHealthServer } from './server.js';
export * from './time-budget.js';
export * from './lock.js';
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
export * from './stages/02-idea-generator.js';
export * from './stages/03-topic-select.js';
export * from './stages/04-fact-extractor.js';
export * from './stages/chunker.js';
export * from './stages/04-write.js';
export * from './stages/05-qa-safety.js';
export * from './stages/06-image-prompt.js';
export * from './image/image-qa.js';
export * from './image/compositor.js';
export * from './stages/07-post.js';
export * from './schedulers/reconciler.js';
export * from './schedulers/slot-planner.js';
export * from './schedulers/retention-cleaner.js';

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
  // Read kill_switch dynamically from Supabase settings on every cycle (Single Source of Truth)
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: killRow } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'kill_switch')
        .maybeSingle();
      if (killRow?.value?.paused !== undefined) {
        workerState.isPaused = Boolean(killRow.value.paused);
      }
    } catch (e: any) {
      console.warn('[Worker] Failed reading kill switch status from Supabase:', e?.message);
    }
  }

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

export interface OneShotOptions {
  timeBudget?: string | number;
  workerId?: string;
  forceUnlock?: boolean;
}

/**
 * Recovers stale jobs left in intermediate stages if a prior runner crashed or timed out.
 * Ensures the pipeline is 100% resumable across separate runs.
 */
export async function recoverStaleInFlightJobs(staleThresholdMinutes = 15): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;

  try {
    const staleTime = new Date(Date.now() - staleThresholdMinutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('posts')
      .update({ status: 'planned' })
      .in('status', ['writing', 'imaging', 'qa', 'researching'])
      .lt('created_at', staleTime)
      .select('id');

    if (!error && data && data.length > 0) {
      console.log(`[Worker] Resumability: Recovered ${data.length} stale in-flight post(s) back to 'planned'.`);
      return data.length;
    }
  } catch (err) {
    // Non-fatal recovery check
  }
  return 0;
}

/**
 * Automatically checks Facebook token health and synchronizes Pages once daily.
 * Runs inside the distributed lock and time budget.
 */
export async function runDailyFacebookTokenAndPageSync(
  tracker?: TimeBudgetTracker
): Promise<{ executed: boolean; message: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { executed: false, message: 'Supabase client not available' };
  }

  try {
    const { data: setting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'worker_last_daily_sync')
      .maybeSingle();

    const lastSyncTime = setting?.value?.timestamp ? new Date(setting.value.timestamp).getTime() : 0;
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - lastSyncTime < twentyFourHours) {
      return { executed: false, message: 'Daily Facebook sync already completed within past 24h.' };
    }

    console.log('[Worker] Running scheduled daily Facebook token verification and page sync...');

    const { data: accounts } = await supabase.from('facebook_accounts').select('*');
    if (!accounts || accounts.length === 0) {
      await supabase.from('settings').upsert({
        key: 'worker_last_daily_sync',
        value: { timestamp: new Date().toISOString(), syncedAccounts: 0 },
        updated_at: new Date().toISOString(),
      });
      return { executed: true, message: 'No accounts to sync.' };
    }

    let syncedAccounts = 0;
    for (const acc of accounts) {
      if (tracker && !tracker.hasTimeRemaining()) {
        console.log('[Worker] Time budget reached during daily Facebook sync. Will resume next run.');
        break;
      }

      if (!acc.user_access_token) continue;

      try {
        const decryptedToken = decryptPageToken(acc.user_access_token);
        const discovery = await discoverFacebookPages(decryptedToken);

        const discoveredPageIds = new Set<string>();
        for (const dp of discovery.pages) {
          discoveredPageIds.add(dp.id);
          const { data: existing } = await supabase
            .from('pages')
            .select('id,token_status')
            .eq('fb_page_id', dp.id)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('pages')
              .update({
                name: dp.name,
                category: dp.category,
                picture_url: dp.picture_url,
                tasks: dp.tasks,
                fan_count: dp.fan_count,
                token_status: dp.token_status,
                last_synced_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
          } else {
            await supabase.from('pages').insert({
              fb_account_id: acc.id,
              name: dp.name,
              fb_page_id: dp.id,
              fb_page_token: encryptPageToken(dp.access_token),
              category: dp.category,
              picture_url: dp.picture_url,
              tasks: dp.tasks,
              fan_count: dp.fan_count,
              token_status: dp.token_status,
              connected_at: new Date().toISOString(),
              last_synced_at: new Date().toISOString(),
            });
          }
        }

        // Mark missing pages as inaccessible without deleting history
        const { data: userPages } = await supabase
          .from('pages')
          .select('id,fb_page_id,token_status')
          .eq('fb_account_id', acc.id);

        if (userPages) {
          for (const up of userPages) {
            if (!discoveredPageIds.has(up.fb_page_id) && up.token_status !== 'inaccessible') {
              await supabase
                .from('pages')
                .update({
                  token_status: 'inaccessible',
                  last_synced_at: new Date().toISOString(),
                })
                .eq('id', up.id);
            }
          }
        }

        await supabase
          .from('facebook_accounts')
          .update({
            pages_count: discovery.pages.length,
            last_synced_at: new Date().toISOString(),
            token_status: 'valid',
          })
          .eq('id', acc.id);

        syncedAccounts++;
      } catch (accErr: any) {
        console.warn(`[Worker] Failed syncing account ${acc.account_name}:`, accErr?.message);
      }
    }

    await supabase.from('settings').upsert({
      key: 'worker_last_daily_sync',
      value: { timestamp: new Date().toISOString(), syncedAccounts },
      updated_at: new Date().toISOString(),
    });

    console.log(`[Worker] Completed daily Facebook sync across ${syncedAccounts} account(s).`);
    return { executed: true, message: `Synced ${syncedAccounts} accounts.` };
  } catch (err: any) {
    console.error('[Worker] Error during daily Facebook sync:', err?.message);
    return { executed: false, message: err?.message || 'Error' };
  }
}

/**
 * Executes a one-shot worker run with a time budget, distributed lock, and resumable state.
 * Safe to run overlapping in GitHub Actions or scheduled cron jobs.
 */
export async function runOneShotWorker(
  options: OneShotOptions = {}
): Promise<{ executed: boolean; message: string; ranCycles: number; elapsedMs: number }> {
  const tracker = createTimeBudgetTracker(options.timeBudget ?? process.env.WORKER_TIME_BUDGET ?? '11m');
  const workerId = options.workerId || `worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  console.log(`[Worker] Starting one-shot run with time budget: ${Math.round(tracker.budgetMs / 60000)}m (${tracker.budgetMs}ms)...`);

  // 1. Acquire distributed lock (lease expires after budget + 2 minutes)
  const lockResult = await acquireWorkerLock(workerId, tracker.budgetMs + 2 * 60 * 1000);
  if (!lockResult.acquired) {
    const msg = `Skipping run: Distributed lock currently held by another runner (${lockResult.reason}). Safe overlapping prevented.`;
    console.log(`[Worker] ${msg}`);
    return {
      executed: false,
      message: msg,
      ranCycles: 0,
      elapsedMs: tracker.getElapsedMs(),
    };
  }

  let cyclesRun = 0;
  try {
    console.log(`[Worker] Acquired distributed lock [${workerId}]. Beginning execution cycle...`);

    // 2. Recover stale in-flight jobs
    await recoverStaleInFlightJobs();

    // 2.5 Run scheduled daily Facebook token verification and page sync if due
    await runDailyFacebookTokenAndPageSync(tracker);

    // 3. Execution loop within time budget
    while (tracker.hasTimeRemaining()) {
      cyclesRun += 1;
      const cycleResult = await runWorkerCycle();
      console.log(`[Worker] Executed cycle #${cyclesRun} (${cycleResult.message}). Time remaining: ${Math.round(tracker.getRemainingMs() / 1000)}s.`);

      if (!tracker.hasTimeRemaining()) {
        console.log(`[Worker] Time budget deadline approaching (${Math.round(tracker.getRemainingMs() / 1000)}s remaining). Stopping gracefully. Next run will resume remaining work.`);
        break;
      }

      // In one-shot mode, complete the cycle and conclude
      break;
    }

    return {
      executed: true,
      message: `Completed ${cyclesRun} cycle(s) within ${Math.round(tracker.getElapsedMs() / 1000)}s`,
      ranCycles: cyclesRun,
      elapsedMs: tracker.getElapsedMs(),
    };
  } finally {
    // 4. Always release distributed lock
    await releaseWorkerLock(workerId);
    console.log(`[Worker] Released distributed lock [${workerId}]. Run finished in ${Math.round(tracker.getElapsedMs() / 1000)}s.`);
  }
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

export function extractTimeBudgetArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--time-budget=')) {
      return arg.split('=')[1];
    }
    if (arg === '--time-budget' && args[i + 1]) {
      return args[i + 1];
    }
    if (arg.startsWith('-b=')) {
      return arg.split('=')[1];
    }
    if (arg === '-b' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return process.env.WORKER_TIME_BUDGET;
}

// Self-executing CLI detection
const isDirectExecution =
  process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'));

if (isDirectExecution) {
  const isOnce = process.argv.includes('--once') || process.argv.includes('worker:once');
  const timeBudgetArg = extractTimeBudgetArg(process.argv);
  const port = parseInt(process.env.PORT || '8080', 10);
  const intervalSeconds = parseInt(process.env.WORKER_LOOP_SECONDS || '60', 10);

  if (isOnce) {
    console.log(`[Worker] Running in one-shot mode (--once) [Time budget: ${timeBudgetArg || '11m'}]...`);
    runOneShotWorker({ timeBudget: timeBudgetArg })
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
