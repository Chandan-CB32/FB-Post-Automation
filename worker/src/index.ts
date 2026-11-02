import { CORE_VERSION } from '@fb-auto/core';

export function getWorkerStatus() {
  return {
    status: 'idle',
    coreVersion: CORE_VERSION,
  };
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  console.log(`[Worker] Initialized with @fb-auto/core v${CORE_VERSION}`);
}
