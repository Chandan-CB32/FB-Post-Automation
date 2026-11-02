import { encrypt, decrypt, maskSecret } from '../crypto/encryption.js';
import { FacebookGraphClient } from './client.js';
import { FacebookAccountsResponse, FacebookPageAccount } from './types.js';

/**
 * Encrypts a raw Facebook Page or User Access Token using AES-256-GCM.
 */
export function encryptPageToken(token: string, key?: Buffer | string): string {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string.');
  }
  return encrypt(token, key);
}

/**
 * Decrypts an AES-256-GCM encrypted Facebook Page Access Token.
 */
export function decryptPageToken(encryptedToken: string, key?: Buffer | string): string {
  if (!encryptedToken || typeof encryptedToken !== 'string') {
    throw new Error('Encrypted token must be a non-empty string.');
  }
  return decrypt(encryptedToken, key);
}

/**
 * Safely masks a Facebook Access Token for logs or UI display (e.g. `EAABcd...1234`).
 */
export function maskFacebookToken(token: string): string {
  return maskSecret(token, 6, 4);
}

/**
 * Exchanges a short-lived Facebook User Access Token for a long-lived User Access Token (~60 days).
 */
export async function exchangeForLongLivedUserToken(
  shortLivedToken: string,
  appId: string,
  appSecret: string,
  client?: FacebookGraphClient
): Promise<{ accessToken: string; expiresIn: number; tokenType: string }> {
  if (!shortLivedToken || !appId || !appSecret) {
    throw new Error('Missing required arguments: shortLivedToken, appId, and appSecret are required.');
  }

  const fbClient = client || new FacebookGraphClient();

  const response = await fbClient.get<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>('oauth/access_token', undefined, {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  return {
    accessToken: response.access_token,
    tokenType: response.token_type || 'bearer',
    expiresIn: response.expires_in || 5184000, // ~60 days default
  };
}

/**
 * Retrieves the list of Pages managed by the user using a user access token,
 * including each Page's permanent Page Access Token.
 */
export async function fetchManagedPages(
  userAccessToken: string,
  client?: FacebookGraphClient
): Promise<FacebookPageAccount[]> {
  if (!userAccessToken) {
    throw new Error('User access token is required to fetch managed pages.');
  }

  const fbClient = client || new FacebookGraphClient();

  const response = await fbClient.get<FacebookAccountsResponse>('me/accounts', userAccessToken, {
    fields: 'id,name,access_token,category,tasks,perms',
    limit: 100,
  });

  return response.data || [];
}

