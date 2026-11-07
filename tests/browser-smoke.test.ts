import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import http from 'node:http';
import { createDashboardServer } from '../apps/web/src/server.js';

describe('Headless Browser Smoke Tests (Playwright)', () => {
  let server: http.Server;
  let port: number;
  let browser: Browser;
  let page: Page;

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  beforeAll(async () => {
    // Enable test mode bypass so verifyAuth permits direct dashboard access
    delete process.env.TEST_AUTH_ENABLED;

    server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as any).port;

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
  }, 20000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('loads the dashboard shell with 0 uncaught errors', async () => {
    // Warm up / navigate
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

    // Measure HTML document fetch speed directly
    const fetchStart = Date.now();
    const fetchRes = await fetch(`http://localhost:${port}/`);
    const docDuration = Date.now() - fetchStart;
    expect(fetchRes.status).toBe(200);
    expect(docDuration).toBeLessThan(2000); // Server renders shell in under 2 seconds

    // Verify main brand heading is visible
    const brandTitle = await page.textContent('.brand-title');
    expect(brandTitle).toContain('FB Auto 247');

    // Verify showTab function is defined on window
    const hasShowTab = await page.evaluate(() => typeof (window as any).showTab === 'function');
    expect(hasShowTab).toBe(true);

    expect(pageErrors).toEqual([]);
  }, 25000);

  it('clicks every tab in the navigation sidebar and asserts no ReferenceError or blank tabs', async () => {
    const tabsToClick = [
      'overview',
      'accounts',
      'pages',
      'page-prompts',
      'review',
      'calendar',
      'analytics',
      'simulator',
      'providers',
      'audit',
      'settings',
    ];

    for (const tabId of tabsToClick) {
      // Find navigation button with data-tab attribute
      const btn = page.locator(`.nav-list .nav-item button[data-tab="${tabId}"]`);
      expect(await btn.isVisible()).toBe(true);
      await btn.click();

      // Wait brief moment for DOM update
      await page.waitForTimeout(50);

      // Verify button became active
      const btnClass = await btn.getAttribute('class');
      expect(btnClass).toContain('active');

      // Verify corresponding tab content section became active
      const content = page.locator(`#tab-${tabId}`);
      expect(await content.isVisible()).toBe(true);
      const contentClass = await content.getAttribute('class');
      expect(contentClass).toContain('active');

      // Verify no uncaught ReferenceError occurred (e.g. showTab is not defined)
      const uncaughtErrors = pageErrors.filter((e) =>
        e.includes('showTab') || e.includes('ReferenceError') || e.includes('SyntaxError')
      );
      expect(uncaughtErrors).toEqual([]);
    }
  });

  it('verifies modals open and close without errors', async () => {
    // 1. Add Account Modal
    await page.evaluate(() => (window as any).openAddAccountModal());
    expect(await page.locator('#addAccountModal').getAttribute('class')).toContain('active');
    await page.evaluate(() => (window as any).closeAddAccountModal());
    expect(await page.locator('#addAccountModal').getAttribute('class')).not.toContain('active');

    // 2. Add Page Modal
    await page.evaluate(() => (window as any).openAddPageModal());
    expect(await page.locator('#addPageModal').getAttribute('class')).toContain('active');
    await page.evaluate(() => (window as any).closeAddPageModal());
    expect(await page.locator('#addPageModal').getAttribute('class')).not.toContain('active');

    // 3. Add Provider Modal
    await page.evaluate(() => (window as any).openAddProviderModal());
    expect(await page.locator('#addProviderModal').getAttribute('class')).toContain('active');
    await page.evaluate(() => (window as any).closeAddProviderModal());
    expect(await page.locator('#addProviderModal').getAttribute('class')).not.toContain('active');

    expect(pageErrors).toEqual([]);
  });
});
