/**
 * Global Test Setup
 * Enforces APP_ENV=test and ensures tests NEVER load or communicate with production Supabase.
 */
import { assertSafeDatabaseUrl } from '../packages/core/src/security/env-guard.js';

// Strictly set test environment variables
process.env.APP_ENV = 'test';
process.env.NODE_ENV = 'test';
process.env.VITEST = 'true';

// Remove any production Supabase URL or keys from process.env if present
const currentUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (currentUrl && currentUrl.includes('supabase.co')) {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

// Set deterministic encryption key for cryptographic unit tests
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}

// Verify safety assertion
assertSafeDatabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

