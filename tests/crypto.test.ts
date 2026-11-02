import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  generateEncryptionKey,
  normalizeKey,
  maskSecret,
} from '../packages/core/src/crypto/encryption.js';

describe('AES-256-GCM Encryption Module', () => {
  const originalEnvKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (originalEnvKey) {
      process.env.ENCRYPTION_KEY = originalEnvKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it('generates a valid 32-byte base64 encryption key', () => {
    const key = generateEncryptionKey();
    expect(key).toBeTypeOf('string');
    const buf = Buffer.from(key, 'base64');
    expect(buf.length).toBe(32);
  });

  it('normalizes valid base64 and hex keys', () => {
    const rawKey = Buffer.alloc(32, 7);
    const b64 = rawKey.toString('base64');
    const hex = rawKey.toString('hex');

    expect(normalizeKey(b64).equals(rawKey)).toBe(true);
    expect(normalizeKey(hex).equals(rawKey)).toBe(true);
    expect(normalizeKey(rawKey).equals(rawKey)).toBe(true);
  });

  it('throws when key length is invalid', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => normalizeKey(shortKey)).toThrow('Invalid encryption key length');
  });

  it('throws when key is missing completely', () => {
    expect(() => normalizeKey()).toThrow('Encryption key not provided');
  });

  it('performs successful encryption and decryption round-trip', () => {
    const key = generateEncryptionKey();
    const secretMessage = 'EAAGNO4...FacebookPageTokenWithSpecialChars:!@#$%^&*()';

    const encrypted = encrypt(secretMessage, key);
    expect(encrypted).not.toBe(secretMessage);
    expect(encrypted.split(':').length).toBe(3);

    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(secretMessage);
  });

  it('uses process.env.ENCRYPTION_KEY as fallback when key argument is omitted', () => {
    const envKey = generateEncryptionKey();
    process.env.ENCRYPTION_KEY = envKey;

    const secret = 'sk-or-v1-my-secret-openrouter-key';
    const encrypted = encrypt(secret);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(secret);
  });

  it('produces non-deterministic ciphertexts for the same plaintext due to random IV', () => {
    const key = generateEncryptionKey();
    const text = 'Same input text';

    const enc1 = encrypt(text, key);
    const enc2 = encrypt(text, key);

    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1, key)).toBe(text);
    expect(decrypt(enc2, key)).toBe(text);
  });

  it('fails decryption with tampered ciphertext', () => {
    const key = generateEncryptionKey();
    const encrypted = encrypt('Hello World', key);
    const parts = encrypted.split(':');

    // Tamper with ciphertext
    const tamperedCipher = Buffer.from(parts[2], 'base64');
    tamperedCipher[0] ^= 0xff;
    parts[2] = tamperedCipher.toString('base64');

    expect(() => decrypt(parts.join(':'), key)).toThrow('Decryption failed');
  });

  it('fails decryption with wrong key', () => {
    const key1 = generateEncryptionKey();
    const key2 = generateEncryptionKey();

    const encrypted = encrypt('Top Secret Data', key1);
    expect(() => decrypt(encrypted, key2)).toThrow('Decryption failed');
  });

  it('correctly masks secrets for safe UI display and logging', () => {
    expect(maskSecret('sk-1234567890abcdef', 3, 4)).toBe('sk-...cdef');
    expect(maskSecret('short', 3, 4)).toBe('***');
    expect(maskSecret('')).toBe('');
  });
});

