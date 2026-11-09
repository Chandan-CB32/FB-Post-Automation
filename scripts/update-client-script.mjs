import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const dashboardJsPath = path.join(root, 'apps', 'web', 'public', 'dashboard.js');
const dashboardScriptTsPath = path.join(root, 'apps', 'web', 'src', 'client', 'dashboard-script.ts');

const code = fs.readFileSync(dashboardJsPath, 'utf8');

const scriptTsContent = `// Auto-generated from apps/web/public/dashboard.js
// Do not edit directly; modify apps/web/public/dashboard.js and re-sync.

export const DASHBOARD_CLIENT_SCRIPT = ${JSON.stringify(code)};
`;

fs.writeFileSync(dashboardScriptTsPath, scriptTsContent, 'utf8');
console.log('Successfully synced dashboard-script.ts from dashboard.js');
