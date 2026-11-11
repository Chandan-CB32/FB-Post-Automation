import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import { handleRequest, generateLoginHtml, createFallbackAppSession } from '../apps/web/src/server.js';
import { DASHBOARD_CLIENT_SCRIPT } from '../apps/web/src/client/dashboard-script.js';

describe('Mobile Phone Optimization & Admin Sign In Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TEST_AUTH_ENABLED = 'true';
    process.env.OWNER_EMAIL = 'badboycb123@gmail.com';
  });

  describe('Mobile Login Experience (generateLoginHtml & /login)', () => {
    it('includes mobile-friendly viewport meta and theme-color', () => {
      const html = generateLoginHtml();
      expect(html).toContain('viewport-fit=cover');
      expect(html).toContain('name="theme-color"');
      expect(html).toContain('#030712');
    });

    it('optimizes form inputs for mobile touch keyboards and prevents iOS zoom', () => {
      const html = generateLoginHtml();
      // 16px prevents iOS Safari from automatically zooming into the form input
      expect(html).toContain('font-size: 16px');
      // Email input has mobile-specific attributes
      expect(html).toContain('inputmode="email"');
      expect(html).toContain('autocapitalize="none"');
      expect(html).toContain('autocorrect="off"');
      expect(html).toContain('spellcheck="false"');
      // Password toggle button exists for mobile convenience
      expect(html).toContain('togglePasswordVisibility');
      expect(html).toContain('pwd-toggle-btn');
    });

    it('authenticates admin with case-insensitive and trimmed mobile email input', async () => {
      let responseData = '';
      let responseCode = 0;
      let setCookieHeaders: string[] = [];

      const mockReq = {
        method: 'POST',
        url: '/api/auth/login',
        headers: { host: 'localhost:3000' },
        on: (event: string, cb: any) => {
          if (event === 'data') {
            // User typed on mobile with leading/trailing spaces and mixed casing
            cb(JSON.stringify({
              email: '   Badboycb123@GMAIL.com   ',
              password: 'AnyPasswordInTestMode',
            }));
          }
          if (event === 'end') cb();
        },
      } as any;

      const mockRes = {
        writeHead: (code: number, headers: any) => {
          responseCode = code;
          if (headers['Set-Cookie']) {
            setCookieHeaders = headers['Set-Cookie'];
          }
        },
        end: (data: string) => {
          responseData = data;
        },
      } as any;

      await handleRequest(mockReq, mockRes);

      expect(responseCode).toBe(200);
      const parsed = JSON.parse(responseData);
      expect(parsed.success).toBe(true);
      expect(parsed.user.email).toBe('badboycb123@gmail.com');
      // Cookie is valid for 30 days
      expect(setCookieHeaders.some((c) => c.includes('app_session='))).toBe(true);
      expect(setCookieHeaders.some((c) => c.includes('Path=/'))).toBe(true);
    });
  });

  describe('Mobile Responsive Dashboard & Navigation', () => {
    it('renders sticky mobile topbar, drawer backdrop, and mobile bottom nav bar', async () => {
      let htmlResponse = '';
      const server = http.createServer(async (req, res) => {
        await handleRequest(req, res);
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as any).port;

      const appSession = createFallbackAppSession('badboycb123@gmail.com', 'owner-123');
      const res = await fetch(`http://localhost:${port}/overview`, {
        headers: {
          cookie: `app_session=${appSession}`,
        },
      });
      htmlResponse = await res.text();
      server.close();

      // Mobile viewport and PWA status bar styles
      expect(htmlResponse).toContain('viewport-fit=cover');
      expect(htmlResponse).toContain('name="theme-color"');
      expect(htmlResponse).toContain('apple-mobile-web-app-status-bar-style');

      // Mobile Topbar with hamburger menu button
      expect(htmlResponse).toContain('mobile-topbar');
      expect(htmlResponse).toContain('mobile-menu-btn');
      expect(htmlResponse).toContain('toggleMobileSidebar()');
      expect(htmlResponse).toContain('mobileTabTitle');

      // Mobile Drawer Backdrop
      expect(htmlResponse).toContain('id="sidebarBackdrop"');
      expect(htmlResponse).toContain('closeMobileSidebar()');

      // Mobile Bottom Navigation Bar with quick access buttons
      expect(htmlResponse).toContain('mobile-bottom-nav');
      expect(htmlResponse).toContain('data-mobile-tab="overview"');
      expect(htmlResponse).toContain('data-mobile-tab="pages"');
      expect(htmlResponse).toContain('data-mobile-tab="calendar"');
      expect(htmlResponse).toContain('data-mobile-tab="review"');

      // Responsive CSS media queries for mobile phones
      expect(htmlResponse).toContain('@media (max-width: 900px)');
      expect(htmlResponse).toContain('sidebar.mobile-open');
    });

    it('client dashboard script exposes toggleMobileSidebar and closeMobileSidebar', () => {
      expect(DASHBOARD_CLIENT_SCRIPT).toContain('window.toggleMobileSidebar = toggleMobileSidebar');
      expect(DASHBOARD_CLIENT_SCRIPT).toContain('window.closeMobileSidebar = closeMobileSidebar');
      expect(DASHBOARD_CLIENT_SCRIPT).toContain('mobileTabTitle');
      expect(DASHBOARD_CLIENT_SCRIPT).toContain('.mobile-bottom-nav');
    });
  });
});
