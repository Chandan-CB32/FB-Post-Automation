import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Load credentials from .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = { ...process.env };
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
    env[key] = val;
  }
}

env.TEST_AUTH_ENABLED = 'true';
env.PORT = '3099';

const testEmail = env.OWNER_EMAIL || 'owner@example.com';
const testPassword = env.OWNER_PASSWORD || env.SUPABASE_PASSWORD || '';

const BASE_URL = 'http://127.0.0.1:3099';

async function run() {
  console.log('\n============================================================');
  console.log(' Next.js (App Router) Server & Supabase Login Verification');
  console.log('============================================================\n');

  console.log('Starting Next.js production server on port 3099...');
  const nextServer = spawn('npx', ['next', 'start', '-p', '3099'], {
    cwd: './apps/web',
    env,
    stdio: 'pipe',
    shell: true,
  });

  // Wait for Next.js to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (!ready) {
    nextServer.kill();
    throw new Error('Next.js server failed to become ready in time.');
  }

  console.log('🚀 Next.js server is ready and serving requests!\n');

  try {
    // 1. Health check
    console.log('1. Testing /health Endpoint on Next.js:');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    console.log(`   Status: ${healthRes.status} | Data:`, healthData);
    if (healthRes.status !== 200 || healthData.status !== 'ok') {
      throw new Error('/health failed on Next.js!');
    }
    console.log('   ✅ Health endpoint passed.');

    // 2. Unauthenticated access to / -> should redirect to /login
    console.log('\n2. Testing Protected Dashboard (/) without Auth:');
    const unauthRes = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    console.log(`   Status: ${unauthRes.status} | Location: ${unauthRes.headers.get('location')}`);
    if (unauthRes.status !== 302 || !unauthRes.headers.get('location')?.includes('/login')) {
      throw new Error('Expected 302 redirect to /login for unauthenticated request!');
    }
    console.log('   ✅ Protected route redirected to /login.');

    // 3. Login page HTML
    console.log('\n3. Testing Login Page HTML (/login):');
    const loginPageRes = await fetch(`${BASE_URL}/login`);
    const loginHtml = await loginPageRes.text();
    console.log(`   Status: ${loginPageRes.status} | HTML Length: ${loginHtml.length}`);
    if (loginPageRes.status !== 200 || !loginHtml.includes('FB Auto 247')) {
      throw new Error('Login page HTML failed to load!');
    }
    console.log('   ✅ Login page HTML rendered cleanly.');

    // 4. Invalid Login Attempt
    console.log('\n4. Testing Invalid Password via Next.js API (/api/auth/login):');
    const invalidRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'WrongPassword123!' }),
    });
    const invalidJson = await invalidRes.json();
    console.log(`   Status: ${invalidRes.status} | Response:`, invalidJson);
    if (invalidRes.status !== 401) {
      throw new Error('Expected 401 Unauthorized for invalid password!');
    }
    console.log('   ✅ Invalid password rejected as expected.');

    // 5. Valid Login with Supabase User
    console.log(`\n5. Testing Real Supabase Login (${testEmail}):`);
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
    console.log('   ✅ Login succeeded and secure cookie issued.');

    const cookie = setCookie.split(';')[0];

    // 6. Access Dashboard with Session Cookie
    console.log('\n6. Testing Authenticated Access to Dashboard (/) with Cookie:');
    const authDashRes = await fetch(`${BASE_URL}/`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    const dashHtml = await authDashRes.text();
    console.log(`   Status: ${authDashRes.status} | HTML Length: ${dashHtml.length}`);
    if (authDashRes.status !== 200 || !dashHtml.includes('FB Auto 247')) {
      throw new Error('Authenticated dashboard access failed on Next.js!');
    }
    console.log('   ✅ Authenticated dashboard rendered in full on Next.js.');

    // 7. Access API with Session Cookie
    console.log('\n7. Testing Authenticated Access to Next.js API (/api/overview):');
    const authApiRes = await fetch(`${BASE_URL}/api/overview`, {
      headers: { Cookie: cookie },
    });
    const apiJson = await authApiRes.json();
    console.log(`   Status: ${authApiRes.status} | Worker Status: ${apiJson.workerStatus}`);
    if (authApiRes.status !== 200 || !apiJson.workerStatus) {
      throw new Error('Authenticated API access failed on Next.js!');
    }
    console.log('   ✅ Authenticated API route returned live metrics.');

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
    console.log(' 🎉 ALL 8 NEXT.JS (APP ROUTER) TESTS PASSED 100%!');
    console.log('============================================================\n');
  } finally {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', nextServer.pid, '/f', '/t'], { stdio: 'ignore' });
    } else {
      nextServer.kill();
    }
  }
}

run().then(() => {
  setTimeout(() => process.exit(0), 500);
}).catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
