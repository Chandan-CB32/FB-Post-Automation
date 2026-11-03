import { spawn } from 'node:child_process';

console.log('[System] Starting FB Post Automation Monorepo (Web Dashboard + Autonomous Worker)...');

// Start Web Dashboard on PORT (default 3000)
const web = spawn('node', ['apps/web/dist/server.js'], {
  stdio: 'inherit',
  env: process.env,
});

// Start 24/7 Autonomous Scheduler & Publishing Worker
const worker = spawn('node', ['worker/dist/index.js'], {
  stdio: 'inherit',
  env: process.env,
});

web.on('exit', (code) => {
  console.log(`[Dashboard] Exited with code ${code}`);
  worker.kill();
  process.exit(code || 0);
});

worker.on('exit', (code) => {
  console.log(`[Worker] Exited with code ${code}`);
  web.kill();
  process.exit(code || 0);
});

const shutdown = () => {
  console.log('\n[System] Gracefully shutting down Dashboard and Worker...');
  web.kill('SIGTERM');
  worker.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

