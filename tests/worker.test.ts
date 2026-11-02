import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import {
  createHealthServer,
  workerState,
  startHealthServer,
  stopHealthServer,
} from '../worker/src/server.js';
import { runWorkerCycle } from '../worker/src/index.js';

describe('Worker Skeleton & Health Server', () => {
  const originalSecret = process.env.WORKER_SECRET;

  beforeEach(() => {
    workerState.loopCount = 0;
    workerState.lastHeartbeat = null;
    workerState.isPaused = false;
    workerState.status = 'idle';
  });

  afterEach(() => {
    process.env.WORKER_SECRET = originalSecret;
  });

  it('runs worker cycle and records heartbeat', async () => {
    const result = await runWorkerCycle();
    expect(result.executed).toBe(true);
    expect(workerState.loopCount).toBe(1);
    expect(workerState.lastHeartbeat).not.toBeNull();
    expect(workerState.status).toBe('idle');
  });

  it('respects pause flag and skips execution', async () => {
    workerState.isPaused = true;
    const result = await runWorkerCycle();
    expect(result.executed).toBe(false);
    expect(result.message).toBe('Paused');
    expect(workerState.loopCount).toBe(0);
  });

  it('serves GET /health with correct metrics', async () => {
    const server = createHealthServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };

    const res = await fetch(`http://localhost:${address.port}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; version: string; loopCount: number };
    expect(body.status).toBe('healthy');
    expect(body.version).toBe('0.1.0');
    expect(body.loopCount).toBe(workerState.loopCount);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('protects POST /trigger with WORKER_SECRET', async () => {
    process.env.WORKER_SECRET = 'secret-test-token-123';
    let triggered = false;

    const server = createHealthServer(async () => {
      triggered = true;
      return { executed: true, message: 'Triggered successfully' };
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };

    // Request without auth
    const unauthorizedRes = await fetch(`http://localhost:${address.port}/trigger`, {
      method: 'POST',
    });
    expect(unauthorizedRes.status).toBe(401);
    expect(triggered).toBe(false);

    // Request with valid auth
    const authorizedRes = await fetch(`http://localhost:${address.port}/trigger`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-test-token-123',
      },
    });
    expect(authorizedRes.status).toBe(200);
    const body = (await authorizedRes.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(triggered).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
