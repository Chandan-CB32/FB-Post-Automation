import { CORE_VERSION } from '@fb-auto/core';

export * from './server/api-handlers.js';
export * from './server/storage.js';
export * from './components/dashboard-views.js';

export const WEB_APP_STATUS = {
  name: 'FB Post Automation Web App',
  version: '0.1.0',
  coreVersion: CORE_VERSION,
};
