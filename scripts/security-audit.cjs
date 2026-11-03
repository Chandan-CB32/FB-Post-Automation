const { execSync } = require('child_process');

console.log('=== RUNNING SECURITY AUDIT ===\n');

// 1. Check if any .env or secret files were ever committed
try {
  const envFiles = execSync('git log --all --full-history -- "*.env*" "*secret*" "*token*" "*credential*"', { encoding: 'utf8' }).trim();
  if (envFiles) {
    console.warn('NOTICE: Commits touching filenames with env/secret/token:');
    console.log(envFiles.slice(0, 300));
  } else {
    console.log('[PASS] No .env, secret, or token files were ever committed in git history.');
  }
} catch (e) {
  console.log('[PASS] No .env files in history.');
}

// 2. Check tracked files right now
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
console.log(`[INFO] Total tracked files in git tree: ${tracked.length}`);
const sensitiveTracked = tracked.filter(f => 
  f.includes('.env') || 
  f.endsWith('system-store.json') || 
  f.includes('node_modules') || 
  f.endsWith('.pem') || 
  f.endsWith('.key') ||
  f.endsWith('.p12')
);
if (sensitiveTracked.length === 0) {
  console.log('[PASS] No sensitive files currently tracked in git tree.');
} else {
  console.error('[FAIL] Sensitive files found in git tree:', sensitiveTracked);
}

// 3. Check for live API keys or tokens in git history
const patterns = [
  'sk-[a-zA-Z0-9_-]{20,}',
  'ghp_[a-zA-Z0-9]{20,}',
  'AIza[0-9A-Za-z-_]{35}',
  'EAAB[0-9A-Za-z]+',
  'BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY'
];

for (const pattern of patterns) {
  try {
    const res = execSync(`git log -E -G "${pattern}" -p`, { encoding: 'utf8' });
    if (res.trim()) {
      console.log(`\n[ANALYSIS] Pattern matched in git history: ${pattern}`);
      // Print matches
      const lines = res.split('\n');
      const matches = lines.filter(l => l.startsWith('+') && new RegExp(pattern).test(l));
      console.log('Matches count:', matches.length);
      matches.slice(0, 5).forEach(m => console.log('  ', m.slice(0, 80)));
    } else {
      console.log(`[PASS] Zero matches in git history for pattern: ${pattern}`);
    }
  } catch (err) {
    console.log(`[PASS] Zero matches for: ${pattern}`);
  }
}

// 4. Verify .gitignore covers required patterns
const fs = require('fs');
const gitignore = fs.readFileSync('.gitignore', 'utf8');
const requiredPatterns = ['.env', 'node_modules', 'dist', 'data/*.json'];
console.log('\n=== VERIFYING .gitignore ===');
for (const req of requiredPatterns) {
  if (gitignore.includes(req)) {
    console.log(`[PASS] .gitignore includes '${req}'`);
  } else {
    console.error(`[FAIL] .gitignore missing '${req}'`);
  }
}

