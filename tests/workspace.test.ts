import { describe, it, expect } from 'vitest';
import { CORE_VERSION } from '../packages/core/src/index.js';
import { getWorkerStatus } from '../worker/src/index.js';
import { WEB_APP_STATUS } from '../apps/web/src/index.js';

describe('Monorepo Workspace Scaffold', () => {
  it('exports CORE_VERSION from @fb-auto/core', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });

  it('connects @fb-auto/worker with core', () => {
    const status = getWorkerStatus();
    expect(status.status).toBe('idle');
    expect(status.coreVersion).toBe(CORE_VERSION);
  });

  it('connects @fb-auto/web with core', () => {
    expect(WEB_APP_STATUS.coreVersion).toBe(CORE_VERSION);
    expect(WEB_APP_STATUS.name).toBe('FB Auto 247');
  });
});

