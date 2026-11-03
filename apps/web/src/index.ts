import { CORE_VERSION } from '@fb-auto/core';

export * from './server/api-handlers';
export * from './server/storage';
export * from './components/dashboard-views';

export const WEB_APP_STATUS = {
  name: 'FB Post Automation Web App',
  version: '0.1.0',
  coreVersion: CORE_VERSION,
};
