import http from 'node:http';
import fs from 'node:fs';

// Load credentials from .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    env[key] = val;
  }
}

// Enable test auth checking
process.env.TEST_AUTH_ENABLED = 'true';

const testEmail = process.env.OWNER_EMAIL || 'owner@example.com';
const testPassword = process.env.OWNER_PASSWORD || process.env.SUPABASE_PASSWORD || 'TestOwnerPass123!';

const { createDashboardServer } = await import('../apps/web/dist/server.js');

const TEST_PORT = 3088;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function run() {
  console.log('\n============================================================');
  console.log(' Local Login & Authentication Verification');
  console.log('============================================================\n');

  const server = createDashboardServer();
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`🚀 Test server started at ${BASE_URL}`);

  try {
    // 1. Health check
    console.log('\n1. Testing Public Health Endpoint (/health):');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthJson = await healthRes.json();
    console.log(`   Status: ${healthRes.status} | Data:`, healthJson);
    if (healthRes.status !== 200 || healthJson.status !== 'ok') {
      throw new Error('Health check failed!');
    }
    console.log('   ✅ Health check passed.');

    // 2. Unauthenticated access to / -> should redirect to /login
    console.log('\n2. Testing Protected Dashboard (/):');
    const unauthRes = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    console.log(`   Status: ${unauthRes.status} | Location: ${unauthRes.headers.get('location')}`);
    if (unauthRes.status !== 302 || !unauthRes.headers.get('location')?.includes('/login')) {
      throw new Error('Expected 302 redirect to /login for unauthenticated request!');
    }
    console.log('   ✅ Unauthenticated redirect to /login passed.');

    // 3. Login page HTML
    console.log('\n3. Testing Login Page HTML (/login):');
    const loginPageRes = await fetch(`${BASE_URL}/login`);
    const loginHtml = await loginPageRes.text();
    console.log(`   Status: ${loginPageRes.status} | HTML Length: ${loginHtml.length}`);
    if (loginPageRes.status !== 200 || !loginHtml.includes('Admin Sign In')) {
      throw new Error('Login page HTML failed to load!');
    }
    console.log('   ✅ Login page HTML rendered correctly.');

    // 4. Invalid Login Attempt
    console.log('\n4. Testing Invalid Password Attempt:');
    const invalidRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'DefinitelyWrongPassword999!' }),
    });
    const invalidJson = await invalidRes.json();
    console.log(`   Status: ${invalidRes.status} | Response:`, invalidJson);
    if (invalidRes.status !== 401) {
      throw new Error('Expected 401 Unauthorized for invalid password!');
    }
    console.log('   ✅ Invalid password rejected as expected.');

    // 5. Valid Login with Supabase User
    console.log(`\n5. Testing Valid Login with Supabase Account (${testEmail}):`);
    const validRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const validJson = await validRes.json();
    const setCookie = validRes.headers.get('set-cookie');
    console.log(`   Status: ${validRes.status} | Success: ${validJson.success}`);
    console.log(`   Set-Cookie received: ${setCookie ? 'YES (contains sb_access_token)' : 'NO'}`);
    if (validRes.status !== 200 || !validJson.success || !setCookie) {
      throw new Error('Valid login failed!');
    }
    console.log('   ✅ Valid Supabase authentication passed and session cookie issued.');

    // Extract cookie
    const cookie = setCookie.split(';')[0];

    // 6. Access Dashboard with Session Cookie
    console.log('\n6. Testing Authenticated Access to Dashboard (/) with Cookie:');
    const authDashRes = await fetch(`${BASE_URL}/`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    const dashHtml = await authDashRes.text();
    console.log(`   Status: ${authDashRes.status} | HTML Length: ${dashHtml.length}`);
    if (authDashRes.status !== 200 || !dashHtml.includes('Autonomous Facebook Content Automation System')) {
      throw new Error('Authenticated dashboard access failed!');
    }
    console.log('   ✅ Authenticated dashboard loaded successfully.');

    // 7. Access API with Session Cookie
    console.log('\n7. Testing Authenticated Access to API (/api/overview):');
    const authApiRes = await fetch(`${BASE_URL}/api/overview`, {
      headers: { Cookie: cookie },
    });
    const apiJson = await authApiRes.json();
    console.log(`   Status: ${authApiRes.status} | Worker Status: ${apiJson.workerStatus}`);
    if (authApiRes.status !== 200 || !apiJson.workerStatus) {
      throw new Error('Authenticated API access failed!');
    }
    console.log('   ✅ Authenticated API access verified.');

    // 8. Test Logout
    console.log('\n8. Testing Logout (/api/auth/logout):');
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    console.log(`   Status: ${logoutRes.status} | Location: ${logoutRes.headers.get('location')}`);
    const logoutCookie = logoutRes.headers.get('set-cookie');
    console.log(`   Set-Cookie on logout: ${logoutCookie}`);
    if (logoutRes.status !== 302 || !logoutCookie?.includes('Max-Age=0')) {
      throw new Error('Logout failed to clear cookie or redirect!');
    }
    console.log('   ✅ Logout verified (cookie cleared and redirected to /login).');

    console.log('\n============================================================');
    console.log(' 🎉 ALL 8 LOCAL LOGIN & AUTHENTICATION TESTS PASSED!');
    console.log('============================================================\n');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
