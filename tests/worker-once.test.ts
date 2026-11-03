import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseTimeBudget,
  createTimeBudgetTracker,
} from '../worker/src/time-budget.js';
import {
  acquireWorkerLock,
  releaseWorkerLock,
} from '../worker/src/lock.js';
import {
  runOneShotWorker,
  extractTimeBudgetArg,
} from '../worker/src/index.js';

describe('Worker Time Budget & Distributed Lock (Step 1)', () => {
  const localLockFile = path.resolve(process.cwd(), 'data', '.worker.lock');

  beforeEach(() => {
    try {
      if (fs.existsSync(localLockFile)) {
        fs.unlinkSync(localLockFile);
      }
    } catch {}
  });

  afterEach(() => {
    try {
      if (fs.existsSync(localLockFile)) {
        fs.unlinkSync(localLockFile);
      }
    } catch {}
  });

  describe('Time Budget Parser', () => {
    it('parses minutes format correctly', () => {
      expect(parseTimeBudget('11m')).toBe(11 * 60 * 1000);
      expect(parseTimeBudget('15min')).toBe(15 * 60 * 1000);
      expect(parseTimeBudget('1.5m')).toBe(90 * 1000);
    });

    it('parses seconds format correctly', () => {
      expect(parseTimeBudget('300s')).toBe(300 * 1000);
      expect(parseTimeBudget('45sec')).toBe(45 * 1000);
    });

    it('parses hours format correctly', () => {
      expect(parseTimeBudget('1h')).toBe(3600 * 1000);
      expect(parseTimeBudget('2hrs')).toBe(7200 * 1000);
    });

    it('defaults to 11 minutes when omitted or empty', () => {
      expect(parseTimeBudget('')).toBe(11 * 60 * 1000);
      expect(parseTimeBudget(undefined)).toBe(11 * 60 * 1000);
    });

    it('extracts CLI flags properly', () => {
      expect(extractTimeBudgetArg(['--once', '--time-budget=11m'])).toBe('11m');
      expect(extractTimeBudgetArg(['--once', '--time-budget', '14m'])).toBe('14m');
      expect(extractTimeBudgetArg(['--once', '-b=5m'])).toBe('5m');
      expect(extractTimeBudgetArg(['--once'])).toBeUndefined();
    });

    it('tracker calculates elapsed and remaining time accurately', () => {
      const tracker = createTimeBudgetTracker('10m', 30000);
      expect(tracker.hasTimeRemaining()).toBe(true);
      expect(tracker.getRemainingMs()).toBeGreaterThan(500000);
      expect(tracker.getElapsedMs()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Distributed Worker Lock & Safe Overlapping', () => {
    it('acquires and releases worker lock cleanly', async () => {
      const workerA = 'worker-test-alpha';
      const acquireResult = await acquireWorkerLock(workerA, 60000);
      expect(acquireResult.acquired).toBe(true);

      const releaseResult = await releaseWorkerLock(workerA);
      expect(releaseResult).toBe(true);
    });

    it('prevents overlapping runs when lock is active', async () => {
      const workerA = 'worker-runner-primary';
      const workerB = 'worker-runner-overlapping';

      // Worker A takes the lock
      const lockA = await acquireWorkerLock(workerA, 60000);
      expect(lockA.acquired).toBe(true);

      // Worker B tries to take the lock concurrently -> rejected safely
      const lockB = await acquireWorkerLock(workerB, 60000);
      expect(lockB.acquired).toBe(false);
      expect(lockB.reason).toBeDefined();

      // Clean up
      await releaseWorkerLock(workerA);
    });

    it('runs one-shot execution and reports cycle count', async () => {
      const result = await runOneShotWorker({ timeBudget: '5m' });
      expect(result.executed).toBe(true);
      expect(result.ranCycles).toBeGreaterThanOrEqual(1);
      expect(result.message).toContain('Completed');
    });

    it('safely skips execution if another runner is already active', async () => {
      const lockHolder = 'existing-active-runner';
      await acquireWorkerLock(lockHolder, 120000);

      const result = await runOneShotWorker({ timeBudget: '5m', workerId: 'conflicting-runner' });
      expect(result.executed).toBe(false);
      expect(result.message).toContain('Skipping run');

      await releaseWorkerLock(lockHolder);
    });
  });
});

