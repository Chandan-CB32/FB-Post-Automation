import http from 'node:http';
import { CORE_VERSION } from '@fb-auto/core';

export interface WorkerState {
  status: 'idle' | 'running' | 'stopping' | 'error';
  lastHeartbeat: string | null;
  loopCount: number;
  isPaused: boolean;
  startTime: number;
}

export const workerState: WorkerState = {
  status: 'idle',
  lastHeartbeat: null,
  loopCount: 0,
  isPaused: false,
  startTime: Date.now(),
};

export type TriggerHandler = () => Promise<{ executed: boolean; message: string }>;

let serverInstance: http.Server | null = null;

export function createHealthServer(onTrigger?: TriggerHandler): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      const payload = {
        status: workerState.status === 'error' ? 'unhealthy' : 'healthy',
        workerStatus: workerState.status,
        uptimeSeconds: Math.floor((Date.now() - workerState.startTime) / 1000),
        lastHeartbeat: workerState.lastHeartbeat,
        loopCount: workerState.loopCount,
        isPaused: workerState.isPaused,
        version: CORE_VERSION,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/trigger') {
      const expectedSecret = process.env.WORKER_SECRET;
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

      if (expectedSecret && token !== expectedSecret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing worker secret' }));
        return;
      }

      if (onTrigger) {
        try {
          const result = await onTrigger();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...result }));
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: errorMsg }));
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Trigger received (no active pipeline handler)' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return server;
}

export function startHealthServer(port = 8080, onTrigger?: TriggerHandler): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = createHealthServer(onTrigger);
    serverInstance = server;
    server.listen(port, () => {
      console.log(`[Worker] Health server listening on port ${port}`);
      resolve(server);
    });
  });
}

export function stopHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverInstance) {
      resolve();
      return;
    }
    serverInstance.close(() => {
      serverInstance = null;
      resolve();
    });
  });
}

