import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createDashboardServer, generateLoginHtml } from '../apps/web/src/server.js';
import { DASHBOARD_CLIENT_SCRIPT } from '../apps/web/src/client/dashboard-script.js';

describe('Client Script Syntax & Parser Verification (Acorn Unit Tests)', () => {
  it('parses DASHBOARD_CLIENT_SCRIPT without syntax errors using acorn', () => {
    expect(DASHBOARD_CLIENT_SCRIPT).toBeDefined();
    expect(typeof DASHBOARD_CLIENT_SCRIPT).toBe('string');
    expect(DASHBOARD_CLIENT_SCRIPT.length).toBeGreaterThan(1000);

    let parsedAst: any = null;
    expect(() => {
      parsedAst = acorn.parse(DASHBOARD_CLIENT_SCRIPT, {
        ecmaVersion: 2022,
        sourceType: 'script',
      });
    }).not.toThrow();

    expect(parsedAst).toBeDefined();
    expect(parsedAst.type).toBe('Program');
  });

  it('parses public/dashboard.js directly from disk without syntax errors', () => {
    const filePath = path.join(process.cwd(), 'apps/web/public/dashboard.js');
    expect(fs.existsSync(filePath)).toBe(true);

    const fileContent = fs.readFileSync(filePath, 'utf8');
    let parsedAst: any = null;
    expect(() => {
      parsedAst = acorn.parse(fileContent, {
        ecmaVersion: 2022,
        sourceType: 'script',
      });
    }).not.toThrow();

    expect(parsedAst).toBeDefined();
  });

  it('serves /dashboard.js with valid JavaScript and 200 status code', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://localhost:${port}/dashboard.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/javascript');

      const body = await res.text();
      expect(body.length).toBeGreaterThan(1000);

      // Verify acorn parses served response body
      let parsedAst: any = null;
      expect(() => {
        parsedAst = acorn.parse(body, {
          ecmaVersion: 2022,
          sourceType: 'script',
        });
      }).not.toThrow();

      expect(parsedAst).toBeDefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('extracts and parses all <script> tags from served Dashboard HTML shell', async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();

      // Extract all script blocks
      const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let match: RegExpExecArray | null;
      let scriptCount = 0;

      while ((match = scriptRegex.exec(html)) !== null) {
        scriptCount++;
        const attrs = match[1] || '';
        const content = match[2] || '';

        if (attrs.includes('type="application/json"') || attrs.includes("type='application/json'")) {
          // Verify JSON script data parses validly
          expect(() => JSON.parse(content.trim())).not.toThrow();
        } else if (attrs.includes('src=')) {
          // Script has src attribute
          expect(attrs).toContain('/dashboard.js');
        } else if (content.trim().length > 0) {
          // Inline JavaScript
          expect(() => {
            acorn.parse(content, {
              ecmaVersion: 2022,
              sourceType: 'script',
            });
          }).not.toThrow();
        }
      }

      expect(scriptCount).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('verifies login page inline script parses cleanly with acorn', () => {
    const html = generateLoginHtml();
    expect(html).toBeDefined();

    const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let foundScript = false;

    while ((match = scriptRegex.exec(html)) !== null) {
      const attrs = match[1] || '';
      const content = match[2] || '';
      if (attrs.includes('type="application/json"')) continue;
      if (content.trim().length > 0) {
        foundScript = true;
        expect(() => {
          acorn.parse(content, {
            ecmaVersion: 2022,
            sourceType: 'script',
          });
        }).not.toThrow();
      }
    }

    expect(foundScript).toBe(true);
  });
});
