import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createKeyPoolItem,
  parseBulkKeys,
  getNextAvailableKey,
  recordKeySuccess,
  recordKeyFailure,
  KeyPoolItem,
} from '../packages/core/src/providers/key-pool.js';
import {
  PROVIDER_PRESETS,
  findPresetById,
  findPresetByName,
} from '../packages/core/src/providers/presets.js';
import { generateEncryptionKey } from '../packages/core/src/crypto/encryption.js';

describe('Provider Key Pool & Presets Registry', () => {
  let encKey: string;

  beforeEach(() => {
    encKey = generateEncryptionKey();
  });

  describe('KeyPoolItem Management', () => {
    it('creates an encrypted and masked key item', () => {
      const rawKey = 'sk-or-v1-abc123def456ghi789';
      const item = createKeyPoolItem('provider-1', rawKey, 'Primary Key', encKey);

      expect(item.providerId).toBe('provider-1');
      expect(item.label).toBe('Primary Key');
      expect(item.status).toBe('active');
      expect(item.keyMasked).toBe('sk-...i789');
      expect(item.keyEncrypted).not.toBe(rawKey);
      expect(item.usageToday).toBe(0);
      expect(item.errorCount).toBe(0);
    });

    it('rejects empty raw keys', () => {
      expect(() => createKeyPoolItem('provider-1', '   ', 'Label', encKey)).toThrow('API key cannot be empty');
    });

    it('parses bulk keys string ignoring empty lines and comments', () => {
      const bulkInput = `
# First production key
sk-key-111111111111

# Backup keys
sk-key-222222222222

sk-key-333333333333
`;
      const items = parseBulkKeys('provider-1', bulkInput, encKey);
      expect(items.length).toBe(3);
      expect(items[0].keyMasked).toBe('sk-...1111');
      expect(items[1].keyMasked).toBe('sk-...2222');
      expect(items[2].keyMasked).toBe('sk-...3333');
    });

    it('selects the least used active key and decrypts it', () => {
      const k1 = createKeyPoolItem('prov-1', 'key-alpha-1234567890', 'Alpha', encKey);
      k1.usageToday = 15;
      const k2 = createKeyPoolItem('prov-1', 'key-beta-1234567890', 'Beta', encKey);
      k2.usageToday = 3; // Least used

      const selected = getNextAvailableKey([k1, k2], new Date(), encKey);
      expect(selected).not.toBeNull();
      expect(selected?.item.id).toBe(k2.id);
      expect(selected?.decryptedKey).toBe('key-beta-1234567890');
    });

    it('skips disabled keys', () => {
      const k1 = createKeyPoolItem('prov-1', 'key-one-1234567890', 'K1', encKey);
      k1.status = 'disabled';

      const selected = getNextAvailableKey([k1], new Date(), encKey);
      expect(selected).toBeNull();
    });

    it('skips cooling keys until cooldown period has passed', () => {
      const now = new Date();
      const k1 = createKeyPoolItem('prov-1', 'key-one-1234567890', 'K1', encKey);
      k1.status = 'cooling';
      k1.cooldownUntil = new Date(now.getTime() + 60000); // Cooling for next 60s

      // While cooling
      expect(getNextAvailableKey([k1], now, encKey)).toBeNull();

      // After cooldown timestamp passed
      const future = new Date(now.getTime() + 61000);
      const selected = getNextAvailableKey([k1], future, encKey);
      expect(selected).not.toBeNull();
      expect(selected?.item.status).toBe('active');
    });

    it('records success and resets error count', () => {
      const k1 = createKeyPoolItem('prov-1', 'key-one-1234567890', 'K1', encKey);
      k1.errorCount = 2;

      recordKeySuccess(k1);
      expect(k1.usageToday).toBe(1);
      expect(k1.errorCount).toBe(0);
      expect(k1.status).toBe('active');
    });

    it('disables key immediately on auth failure (401/403)', () => {
      const k1 = createKeyPoolItem('prov-1', 'key-one-1234567890', 'K1', encKey);
      recordKeyFailure(k1, 'auth');

      expect(k1.status).toBe('disabled');
      expect(k1.errorCount).toBe(1);
    });

    it('puts key into cooling state on rate limit (429)', () => {
      const now = new Date();
      const k1 = createKeyPoolItem('prov-1', 'key-one-1234567890', 'K1', encKey);
      recordKeyFailure(k1, 'rate_limit', 30, now);

      expect(k1.status).toBe('cooling');
      expect(k1.cooldownUntil?.getTime()).toBe(now.getTime() + 30000);
    });
  });

  describe('Provider Presets Registry', () => {
    it('contains all required PRD starter presets', () => {
      expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(7);

      const names = PROVIDER_PRESETS.map((p) => p.name);
      expect(names).toContain('Google Gemini');
      expect(names).toContain('OpenRouter');
      expect(names).toContain('Groq');
      expect(names).toContain('Cloudflare Workers AI');
      expect(names).toContain('Pollinations AI');
      expect(names).toContain('Hugging Face Inference');
      expect(names).toContain('NVIDIA NIM');
    });

    it('finds preset by ID and by name', () => {
      const gemini = findPresetById('preset-gemini');
      expect(gemini).toBeDefined();
      expect(gemini?.kind).toBe('gemini_native');

      const groq = findPresetByName('groq');
      expect(groq).toBeDefined();
      expect(groq?.baseUrl).toBe('https://api.groq.com/openai/v1');
    });
  });
});

