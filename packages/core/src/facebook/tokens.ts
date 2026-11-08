import { encrypt, decrypt, maskSecret } from '../crypto/encryption.js';
import { FacebookGraphClient, FacebookGraphError } from './client.js';
import {
  FacebookAccountsResponse,
  FacebookBusinessesResponse,
  FacebookPageAccount,
  DiscoveredPage,
  PageDiscoveryResult,
  FacebookPermissionItem,
} from './types.js';
import {
  PAGE_ACCOUNTS_FIELDS,
  REQUIRED_FACEBOOK_SCOPES,
  sanitizeFacebookErrorMessage,
} from './constants.js';

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
 * Checks whether the granted tasks on a Page include publishing / content creation rights.
 * Requirement: Check that CREATE_CONTENT or MANAGE is present.
 */
export function canUserPublishToPage(tasks?: string[]): boolean {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return false;
  }
  return tasks.some((task) => {
    const upper = String(task).toUpperCase();
    return upper === 'CREATE_CONTENT' || upper === 'MANAGE';
  });
}

function extractPictureUrl(picture?: any): string | undefined {
  if (!picture) return undefined;
  if (typeof picture === 'string') return picture;
  if (typeof picture === 'object' && picture.data && typeof picture.data.url === 'string') {
    return picture.data.url;
  }
  return undefined;
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
    fields: PAGE_ACCOUNTS_FIELDS,
    limit: 100,
  });

  return response.data || [];
}

/**
 * Comprehensive automatic Page discovery:
 * 1. Fetches ALL Pages from `me/accounts` with full pagination using official Graph API fields (tasks, not legacy perms).
 * 2. Fetches Pages from Business Portfolios (`me/businesses` -> `owned_pages` and `client_pages`) with pagination.
 * 3. Merges duplicates by Page ID, preserving active tokens and publishing rights.
 * 4. Determines publishing rights based on tasks (`CREATE_CONTENT` or `MANAGE`).
 * 5. Queries granted user permissions to diagnose empty page discovery results.
 */
export async function discoverFacebookPages(
  userAccessToken: string,
  client?: FacebookGraphClient,
  options?: { maxPages?: number }
): Promise<PageDiscoveryResult> {
  if (!userAccessToken || !userAccessToken.trim()) {
    throw new Error('User access token is required to discover Facebook Pages.');
  }

  const fbClient = client || new FacebookGraphClient();
  const maxPages = options?.maxPages ?? 1000;
  const pagesMap = new Map<string, DiscoveredPage>();

  // 1. Fetch from me/accounts with pagination
  let nextUrl: string | undefined = undefined;
  let pageCount = 0;

  do {
    let response: FacebookAccountsResponse;
    if (nextUrl) {
      response = await fbClient.get<FacebookAccountsResponse>(nextUrl, userAccessToken);
    } else {
      response = await fbClient.get<FacebookAccountsResponse>('me/accounts', userAccessToken, {
        fields: PAGE_ACCOUNTS_FIELDS,
        limit: 100,
      });
    }

    if (response && Array.isArray(response.data)) {
      for (const p of response.data) {
        if (!p.id) continue;
        const tasks = Array.isArray(p.tasks) ? p.tasks : [];
        const canPublish = canUserPublishToPage(tasks);
        const picUrl = extractPictureUrl(p.picture);

        pagesMap.set(p.id, {
          id: p.id,
          name: p.name || `Facebook Page ${p.id}`,
          access_token: p.access_token,
          category: p.category,
          tasks,
          picture_url: picUrl,
          fan_count: typeof p.fan_count === 'number' ? p.fan_count : undefined,
          canPublish,
          token_status: canPublish ? 'valid' : 'cannot_publish',
          source: 'me/accounts',
        });
        pageCount++;
        if (pageCount >= maxPages) break;
      }
    }

    nextUrl = response?.paging?.next;
  } while (nextUrl && pageCount < maxPages);

  // 2. Discover through Business Portfolios (me/businesses -> owned_pages & client_pages)
  let businessesSearched = 0;
  try {
    const busResponse = await fbClient.get<FacebookBusinessesResponse>('me/businesses', userAccessToken, {
      fields: 'id,name',
      limit: 50,
    });

    if (busResponse && Array.isArray(busResponse.data)) {
      for (const bus of busResponse.data) {
        if (!bus.id) continue;
        businessesSearched++;

        // Helper to query business sub-endpoints
        const queryBusinessPages = async (endpoint: string, source: 'business_owned' | 'business_client') => {
          let bNextUrl: string | undefined = undefined;
          let bCount = 0;
          do {
            try {
              let resp: FacebookAccountsResponse;
              if (bNextUrl) {
                resp = await fbClient.get<FacebookAccountsResponse>(bNextUrl, userAccessToken);
              } else {
                resp = await fbClient.get<FacebookAccountsResponse>(
                  `${bus.id}/${endpoint}`,
                  userAccessToken,
                  {
                    fields: PAGE_ACCOUNTS_FIELDS,
                    limit: 100,
                  }
                );
              }

              if (resp && Array.isArray(resp.data)) {
                for (const p of resp.data) {
                  if (!p.id) continue;
                  const tasks = Array.isArray(p.tasks) ? p.tasks : [];
                  const canPublish = canUserPublishToPage(tasks);
                  const picUrl = extractPictureUrl(p.picture);

                  const existing = pagesMap.get(p.id);
                  if (existing) {
                    // Merge tasks and preserve/upgrade access_token and canPublish
                    const mergedTasks = Array.from(new Set([...existing.tasks, ...tasks]));
                    const mergedCanPublish = existing.canPublish || canPublish;
                    pagesMap.set(p.id, {
                      ...existing,
                      tasks: mergedTasks,
                      canPublish: mergedCanPublish,
                      token_status: mergedCanPublish ? 'valid' : 'cannot_publish',
                      access_token: p.access_token || existing.access_token,
                      picture_url: existing.picture_url || picUrl,
                      category: existing.category || p.category,
                      fan_count: existing.fan_count ?? (typeof p.fan_count === 'number' ? p.fan_count : undefined),
                      business_id: existing.business_id || bus.id,
                      business_name: existing.business_name || bus.name,
                    });
                  } else {
                    pagesMap.set(p.id, {
                      id: p.id,
                      name: p.name || `Facebook Page ${p.id}`,
                      access_token: p.access_token,
                      category: p.category,
                      tasks,
                      picture_url: picUrl,
                      fan_count: typeof p.fan_count === 'number' ? p.fan_count : undefined,
                      canPublish,
                      token_status: canPublish ? 'valid' : 'cannot_publish',
                      source,
                      business_id: bus.id,
                      business_name: bus.name,
                    });
                  }
                  bCount++;
                  if (bCount >= 200) break;
                }
              }
              bNextUrl = resp?.paging?.next;
            } catch (innerErr) {
              // Ignore sub-endpoint errors (e.g. not authorized for client_pages)
              bNextUrl = undefined;
            }
          } while (bNextUrl && bCount < 200);
        };

        await queryBusinessPages('owned_pages', 'business_owned');
        await queryBusinessPages('client_pages', 'business_client');
      }
    }
  } catch (err) {
    // If user has no business portfolios or lacks business permissions, continue smoothly
  }

  // 3. Inspect granted permissions via GET /me/permissions
  let permissions: FacebookPermissionItem[] = [];
  try {
    permissions = await fbClient.getPermissions(userAccessToken);
  } catch {
    // Non-fatal if permissions check fails
  }

  const grantedPermissions = permissions
    .filter((p) => p.status === 'granted')
    .map((p) => p.permission);
  const declinedPermissions = permissions
    .filter((p) => p.status === 'declined')
    .map((p) => p.permission);
  const missingRequiredPermissions = REQUIRED_FACEBOOK_SCOPES.filter(
    (scope) => !grantedPermissions.includes(scope)
  );

  const pages = Array.from(pagesMap.values());
  const publishableCount = pages.filter((p) => p.canPublish).length;

  let emptyReason: 'no_pages_selected' | 'no_pages_owned' | 'missing_permissions' | undefined = undefined;
  let emptyExplanation: string | undefined = undefined;

  if (pages.length === 0) {
    if (permissions.length > 0 && missingRequiredPermissions.includes('pages_show_list')) {
      emptyReason = 'missing_permissions';
      emptyExplanation =
        "The required 'pages_show_list' permission was not granted by Facebook. Please click 'Reconnect' and approve Page permissions.";
    } else {
      emptyReason = 'no_pages_selected';
      emptyExplanation =
        'No Facebook Pages were returned by Meta. Possible reasons: (a) In the Facebook Login dialog, no Pages were selected/checked; (b) this Facebook account does not have Admin or Editor role on any Facebook Page; or (c) your Page belongs to a Meta Business Portfolio requiring business management permissions.';
    }
  }

  return {
    pages,
    totalFound: pages.length,
    publishableCount,
    unpublishableCount: pages.length - publishableCount,
    businessesSearched,
    permissions,
    grantedPermissions,
    declinedPermissions,
    missingRequiredPermissions,
    emptyReason,
    emptyExplanation,
  };
}

