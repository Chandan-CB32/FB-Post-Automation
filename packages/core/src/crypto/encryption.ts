import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
const KEY_LENGTH = 32; // 256 bits

/**
 * Normalizes and validates a 32-byte key from a base64 string, hex string, or raw Buffer.
 */
export function normalizeKey(keyInput?: string | Buffer): Buffer {
  const key = keyInput ?? process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('Encryption key not provided and ENCRYPTION_KEY environment variable is not set.');
  }

  let buffer: Buffer;
  if (Buffer.isBuffer(key)) {
    buffer = key;
  } else if (typeof key === 'string') {
    const trimmed = key.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      buffer = Buffer.from(trimmed, 'hex');
    } else {
      buffer = Buffer.from(trimmed, 'base64');
    }
  } else {
    throw new Error('Invalid key type: expected string or Buffer.');
  }

  if (buffer.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid encryption key length: expected ${KEY_LENGTH} bytes (256-bit), got ${buffer.length} bytes.`
    );
  }

  return buffer;
}

/**
 * Generates a cryptographically secure random 32-byte key encoded as base64.
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: `<iv_b64>:<tag_b64>:<ciphertext_b64>`
 */
export function encrypt(plaintext: string, keyInput?: string | Buffer): string {
  if (typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a string.');
  }

  const key = normalizeKey(keyInput);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts an encrypted payload formatted as `<iv_b64>:<tag_b64>:<ciphertext_b64>` using AES-256-GCM.
 */
export function decrypt(payload: string, keyInput?: string | Buffer): string {
  if (!payload || typeof payload !== 'string') {
    throw new Error('Encrypted payload must be a non-empty string.');
  }

  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload: expected format <iv>:<tag>:<ciphertext>.');
  }

  const [ivB64, tagB64, cipherB64] = parts;
  if (!ivB64 || !tagB64 || !cipherB64) {
    throw new Error('Malformed encrypted payload: missing component.');
  }

  const key = normalizeKey(keyInput);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(cipherB64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}.`);
  }
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH} bytes, got ${tag.length}.`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err: unknown) {
    throw new Error('Decryption failed: integrity check failed or corrupted ciphertext/wrong key.');
  }
}

/**
 * Masks a sensitive string (e.g. API key or token), keeping prefix and suffix visible.
 * E.g., `sk-1234567890abcdef` -> `sk-...cdef`
 */
export function maskSecret(secret: string, visiblePrefix = 3, visibleSuffix = 4): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= visiblePrefix + visibleSuffix) {
    return '***';
  }
  const start = trimmed.slice(0, visiblePrefix);
  const end = trimmed.slice(-visibleSuffix);
  return `${start}...${end}`;
}

