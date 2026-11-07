/**
 * Environment & Database Access Security Guard
 * Prevents test runs and seed scripts from accessing production database instances.
 */

export type AppEnv = 'production' | 'development' | 'test';

export const KNOWN_PRODUCTION_SUPABASE_HOSTS = [
  'qoicjeilaqcgldcwyzqs.supabase.co',
  'aws-0-ap-southeast-1.pooler.supabase.com',
];

/**
 * Returns current application environment.
 * Evaluates APP_ENV, NODE_ENV, VERCEL, and VITEST variables.
 */
export function getAppEnv(): AppEnv {
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'test' || process.env.APP_ENV === 'development') {
    return process.env.APP_ENV;
  }
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return 'test';
  }
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    return 'production';
  }
  return 'development';
}

export function isProductionEnv(): boolean {
  return getAppEnv() === 'production';
}

export function isTestEnv(): boolean {
  return getAppEnv() === 'test';
}

export function isDevelopmentEnv(): boolean {
  return getAppEnv() === 'development';
}

/**
 * Validates that the provided database URL is safe for the active environment.
 * Strictly throws if a test environment attempts to communicate with any known
 * production Supabase host or project.
 */
export function assertSafeDatabaseUrl(url?: string): void {
  if (!url) return;
  const normalized = url.toLowerCase().trim();
  const isProdHost = KNOWN_PRODUCTION_SUPABASE_HOSTS.some((host) => normalized.includes(host.toLowerCase()));

  if (isTestEnv()) {
    if (isProdHost) {
      throw new Error(
        `[CRITICAL SECURITY VIOLATION] Test runner execution blocked! Tests must NEVER touch the production Supabase database (${url}). APP_ENV is "${getAppEnv()}". Configure tests with mocks, isolated test DB, or .env.test.`
      );
    }
  }

  if (isProductionEnv()) {
    // Prevent accidental localhost fallbacks in production
    if (normalized.includes('127.0.0.1') || normalized.includes('localhost')) {
      console.warn(`[SECURITY WARNING] Production environment is using local database address: ${url}`);
    }
  }
}

/**
 * Validates that token / account credentials in production are not synthetic or test artifacts.
 */
export function assertSafeProductionToken(token?: string, accountOrPageId?: string): void {
  if (!isProductionEnv()) return;
  if (!token) return;

  const lower = token.toLowerCase();
  const idLower = (accountOrPageId || '').toLowerCase();

  const isTestToken =
    lower.startsWith('eaab_test') ||
    lower.startsWith('eaab_old') ||
    lower.startsWith('eaab_fresh') ||
    lower.includes('mock') ||
    lower === 'test';

  const isTestId =
    idLower.startsWith('user-') ||
    idLower.startsWith('fb-user-') ||
    idLower.startsWith('fb-page-') ||
    idLower.startsWith('fb-discovered-') ||
    idLower.startsWith('fb-disappearing-');

  if (isTestToken || isTestId) {
    throw new Error(
      `[SECURITY REJECTION] Synthetic test token or mock ID ("${accountOrPageId}") rejected in production environment. Real Facebook OAuth credentials required.`
    );
  }
}

