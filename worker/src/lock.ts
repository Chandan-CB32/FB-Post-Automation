import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSupabaseClient } from '@fb-auto/core';

export interface WorkerLockData {
  locked_by: string;
  acquired_at: string;
  expires_at: string;
  hostname: string;
  pid: number;
}

export interface LockAcquisitionResult {
  acquired: boolean;
  reason?: string;
  existingLock?: WorkerLockData;
}

const SETTINGS_LOCK_KEY = 'worker_distributed_lock';
const LOCAL_LOCK_DIR = path.resolve(process.cwd(), 'data');
const LOCAL_LOCK_FILE = path.join(LOCAL_LOCK_DIR, '.worker.lock');

/**
 * Attempts to acquire distributed lock via Supabase settings table.
 * If Supabase is not configured, gracefully falls back to local file lock.
 */
export async function acquireWorkerLock(
  workerId: string,
  ttlMs = 13 * 60 * 1000 // default 13 minutes lease
): Promise<LockAcquisitionResult> {
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const acquiredAt = new Date(now).toISOString();
  const lockData: WorkerLockData = {
    locked_by: workerId,
    acquired_at: acquiredAt,
    expires_at: expiresAt,
    hostname: os.hostname(),
    pid: process.pid,
  };

  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      // 1. Fetch current lock if present
      const { data, error } = await supabase
        .from('settings')
        .select('key, value, updated_at')
        .eq('key', SETTINGS_LOCK_KEY)
        .maybeSingle();

      if (!error && data?.value) {
        const currentLock = data.value as WorkerLockData;
        const currentExpires = new Date(currentLock.expires_at).getTime();

        // If lock is still valid and held by another runner
        if (currentExpires > now && currentLock.locked_by !== workerId) {
          return {
            acquired: false,
            reason: `Lock held by ${currentLock.locked_by} on ${currentLock.hostname} until ${currentLock.expires_at}`,
            existingLock: currentLock,
          };
        }
      }

      // 2. Upsert lock lease
      const { error: upsertErr } = await supabase.from('settings').upsert({
        key: SETTINGS_LOCK_KEY,
        value: lockData,
        updated_at: acquiredAt,
      });

      if (upsertErr) {
        console.warn('[WorkerLock] Failed to upsert Supabase lock, trying local fallback:', upsertErr.message);
      } else {
        return { acquired: true };
      }
    } catch (err: any) {
      console.warn('[WorkerLock] Supabase lock check error, falling back to local file lock:', err.message);
    }
  }

  // Fallback: Local file-based lock
  return acquireLocalFileLock(lockData, ttlMs);
}

/**
 * Releases distributed worker lock if held by this worker.
 */
export async function releaseWorkerLock(workerId: string): Promise<boolean> {
  let released = false;
  const supabase = getSupabaseClient();

  if (supabase) {
    try {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', SETTINGS_LOCK_KEY)
        .maybeSingle();

      if (data?.value && (data.value as WorkerLockData).locked_by === workerId) {
        await supabase.from('settings').delete().eq('key', SETTINGS_LOCK_KEY);
        released = true;
      }
    } catch (err) {
      // Ignore cleanup error
    }
  }

  // Also clean up local lock file
  try {
    if (fs.existsSync(LOCAL_LOCK_FILE)) {
      const content = JSON.parse(fs.readFileSync(LOCAL_LOCK_FILE, 'utf8'));
      if (content.locked_by === workerId) {
        fs.unlinkSync(LOCAL_LOCK_FILE);
        released = true;
      }
    }
  } catch {
    // Ignore cleanup error
  }

  return released;
}

/**
 * Local file-based lock helper for offline or non-Supabase execution.
 */
function acquireLocalFileLock(lockData: WorkerLockData, ttlMs: number): LockAcquisitionResult {
  try {
    if (!fs.existsSync(LOCAL_LOCK_DIR)) {
      fs.mkdirSync(LOCAL_LOCK_DIR, { recursive: true });
    }

    if (fs.existsSync(LOCAL_LOCK_FILE)) {
      try {
        const existing: WorkerLockData = JSON.parse(fs.readFileSync(LOCAL_LOCK_FILE, 'utf8'));
        const expiresTime = new Date(existing.expires_at).getTime();

        if (expiresTime > Date.now() && existing.locked_by !== lockData.locked_by) {
          return {
            acquired: false,
            reason: `Local lock held by PID ${existing.pid} (${existing.locked_by}) until ${existing.expires_at}`,
            existingLock: existing,
          };
        }
      } catch {
        // Corrupt lock file, overwrite
      }
    }

    fs.writeFileSync(LOCAL_LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf8');
    return { acquired: true };
  } catch (err: any) {
    console.warn('[WorkerLock] Failed to write local lock file:', err.message);
    // If filesystem write fails, allow execution
    return { acquired: true };
  }
}

