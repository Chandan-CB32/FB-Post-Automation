import crypto from 'node:crypto';
import { encrypt, decrypt, maskSecret } from '../crypto/encryption.js';
import { ProviderErrorKind } from '../adapters/types.js';

export type KeyStatus = 'active' | 'cooling' | 'disabled';

export interface KeyPoolItem {
  id: string;
  providerId: string;
  keyEncrypted: string;
  keyMasked: string;
  label?: string;
  status: KeyStatus;
  cooldownUntil: Date | null;
  usageToday: number;
  errorCount: number;
}

/**
 * Creates an encrypted, masked KeyPoolItem from a raw API key.
 */
export function createKeyPoolItem(
  providerId: string,
  rawKey: string,
  label?: string,
  encryptionKey?: string
): KeyPoolItem {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    throw new Error('API key cannot be empty.');
  }

  const keyEncrypted = encrypt(trimmed, encryptionKey);
  const keyMasked = maskSecret(trimmed);

  return {
    id: crypto.randomUUID(),
    providerId,
    keyEncrypted,
    keyMasked,
    label: label || undefined,
    status: 'active',
    cooldownUntil: null,
    usageToday: 0,
    errorCount: 0,
  };
}

/**
 * Parses a multiline string of keys (one per line) and generates KeyPoolItems.
 * Empty lines and lines starting with '#' are ignored.
 */
export function parseBulkKeys(
  providerId: string,
  rawInput: string,
  encryptionKey?: string
): KeyPoolItem[] {
  if (!rawInput || typeof rawInput !== 'string') return [];

  const lines = rawInput.split('\n');
  const items: KeyPoolItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    items.push(createKeyPoolItem(providerId, line, `Key #${items.length + 1}`, encryptionKey));
  }

  return items;
}

/**
 * Selects the next available key for a provider.
 * Prioritizes active keys with least usage today, skipping cooling or disabled keys.
 */
export function getNextAvailableKey(
  keys: KeyPoolItem[],
  now = new Date(),
  encryptionKey?: string
): { item: KeyPoolItem; decryptedKey: string } | null {
  const eligible = keys.filter((k) => {
    if (k.status === 'disabled') return false;
    if (k.status === 'cooling') {
      if (k.cooldownUntil && k.cooldownUntil <= now) {
        // Cooldown has expired, automatically return to active
        k.status = 'active';
        k.cooldownUntil = null;
        return true;
      }
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    return null;
  }

  // Pick least used today to balance load across account keys
  eligible.sort((a, b) => a.usageToday - b.usageToday);
  const chosen = eligible[0];

  const decryptedKey = decrypt(chosen.keyEncrypted, encryptionKey);
  return { item: chosen, decryptedKey };
}

/**
 * Records successful usage of a key.
 */
export function recordKeySuccess(key: KeyPoolItem): void {
  key.usageToday += 1;
  key.errorCount = 0;
  key.status = 'active';
  key.cooldownUntil = null;
}

/**
 * Updates a key's health status following an execution failure.
 */
export function recordKeyFailure(
  key: KeyPoolItem,
  errorKind: ProviderErrorKind,
  retryAfterSeconds?: number,
  now = new Date()
): void {
  key.errorCount += 1;

  if (errorKind === 'auth') {
    // Immediate disable on invalid credentials (401/403)
    key.status = 'disabled';
    key.cooldownUntil = null;
    return;
  }

  if (errorKind === 'rate_limit') {
    // Cooldown on 429 quota exhaustion
    key.status = 'cooling';
    const cooldownMs = (retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : 60) * 1000;
    key.cooldownUntil = new Date(now.getTime() + cooldownMs);
    return;
  }

  if (errorKind === 'timeout' || errorKind === 'server_error') {
    // Backoff if repeated consecutive errors
    if (key.errorCount >= 3) {
      key.status = 'cooling';
      key.cooldownUntil = new Date(now.getTime() + 5 * 60 * 1000); // 5 min cooldown
    }
  }
}

