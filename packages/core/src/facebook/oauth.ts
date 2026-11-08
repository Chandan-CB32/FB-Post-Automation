import crypto from 'node:crypto';
import { FacebookGraphClient, FacebookGraphError } from './client.js';
import { DEFAULT_GRAPH_API_VERSION } from './constants.js';

export interface GenerateFacebookAuthUrlOptions {
  appId: string;
  redirectUri: string;
  state: string;
  configId?: string;
  permissions?: string[];
  reconnect?: boolean;
}

/**
 * Generates the Facebook OAuth authorization URL.
 * Supports both Facebook Login for Business (using config_id) and classic Facebook Login (scope).
 */
export function generateFacebookAuthUrl(options: GenerateFacebookAuthUrlOptions): string {
  if (!options.appId || !options.appId.trim()) {
    throw new Error('Facebook App ID is required.');
  }
  if (!options.redirectUri || !options.redirectUri.trim()) {
    throw new Error('Redirect URI is required.');
  }
  if (!options.state || !options.state.trim()) {
    throw new Error('OAuth state is required for CSRF protection.');
  }

  const url = new URL(`https://www.facebook.com/${DEFAULT_GRAPH_API_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', options.appId.trim());
  url.searchParams.set('redirect_uri', options.redirectUri.trim());
  url.searchParams.set('state', options.state.trim());
  url.searchParams.set('response_type', 'code');

  if (options.configId && options.configId.trim()) {
    // Facebook Login for Business configuration ID
    url.searchParams.set('config_id', options.configId.trim());
  } else {
    // Classic Facebook Login permissions fallback
    const scopes =
      options.permissions && options.permissions.length > 0
        ? options.permissions
        : ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
    url.searchParams.set('scope', scopes.join(','));
  }

  if (options.reconnect) {
    url.searchParams.set('auth_type', 'rerequest');
  }

  return url.toString();
}

/**
 * Exchanges an authorization code returned from Facebook redirect for a short-lived user access token.
 */
export async function exchangeCodeForUserToken(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
  client?: FacebookGraphClient
): Promise<{ accessToken: string; expiresIn: number; tokenType: string }> {
  if (!code || !code.trim()) {
    throw new Error('Authorization code is required.');
  }
  if (!appId || !appId.trim()) {
    throw new Error('Facebook App ID is required.');
  }
  if (!appSecret || !appSecret.trim()) {
    throw new Error('Facebook App Secret is required.');
  }
  if (!redirectUri || !redirectUri.trim()) {
    throw new Error('Facebook Redirect URI is required.');
  }

  const fbClient = client || new FacebookGraphClient();

  const response = await fbClient.get<{
    access_token: string;
    token_type: string;
    expires_in?: number;
  }>('oauth/access_token', undefined, {
    client_id: appId.trim(),
    redirect_uri: redirectUri.trim(),
    client_secret: appSecret.trim(),
    code: code.trim(),
  });

  if (!response || !response.access_token) {
    throw new Error('Failed to obtain access token from Facebook code exchange.');
  }

  return {
    accessToken: response.access_token,
    tokenType: response.token_type || 'bearer',
    expiresIn: response.expires_in || 5184000,
  };
}

/**
 * Retrieves the basic profile of the authenticated Facebook user (id, name, email).
 */
export async function fetchFacebookUserProfile(
  accessToken: string,
  client?: FacebookGraphClient
): Promise<{ id: string; name: string; email?: string }> {
  if (!accessToken || !accessToken.trim()) {
    throw new Error('User access token is required.');
  }

  const fbClient = client || new FacebookGraphClient();
  const profile = await fbClient.get<{ id: string; name: string; email?: string }>('me', accessToken, {
    fields: 'id,name,email',
  });

  return profile;
}

/**
 * Validates and decodes a signed request sent by Facebook for User Data Deletion callbacks.
 */
export function parseFacebookDeletionSignedRequest(
  signedRequest: string,
  appSecret: string
): { userId?: string; isValid: boolean; payload?: any } {
  try {
    if (!signedRequest || !signedRequest.includes('.')) {
      return { isValid: false };
    }

    const [encodedSig, payloadStr] = signedRequest.split('.');
    if (!encodedSig || !payloadStr) {
      return { isValid: false };
    }

    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const expectedSig = crypto.createHmac('sha256', appSecret).update(payloadStr).digest();

    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
      return { isValid: false };
    }

    const payload = JSON.parse(
      Buffer.from(payloadStr.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );

    return {
      isValid: true,
      userId: payload.user_id,
      payload,
    };
  } catch {
    return { isValid: false };
  }
}

export interface FacebookConnectionDiagnostics {
  success: boolean;
  appIdPresent: boolean;
  appSecretPresent: boolean;
  configIdPresent: boolean;
  redirectUriPresent: boolean;
  appUrlPresent: boolean;
  expectedRedirectUri: string;
  configuredRedirectUri?: string;
  appTokenValid?: boolean;
  metaAppName?: string;
  metaAppId?: string;
  configIdValid?: boolean;
  issues: string[];
  recommendations: string[];
}

/**
 * Validates Facebook credentials and configuration against the Meta Graph API.
 * Never leaks raw secrets.
 */
export async function testFacebookCredentials(
  options: {
    appId?: string;
    appSecret?: string;
    configId?: string;
    configuredRedirectUri?: string;
    appUrl?: string;
  },
  client?: FacebookGraphClient
): Promise<FacebookConnectionDiagnostics> {
  const appId = options.appId?.trim() || '';
  const appSecret = options.appSecret?.trim() || '';
  const configId = options.configId?.trim() || '';
  const appUrl = options.appUrl?.trim() || '';
  const configuredRedirectUri = options.configuredRedirectUri?.trim() || '';

  const expectedRedirectUri = `${(appUrl || 'https://fbauto247.vercel.app').replace(/\/+$/, '')}/api/auth/facebook/callback`;

  const issues: string[] = [];
  const recommendations: string[] = [];

  const appIdPresent = Boolean(appId);
  const appSecretPresent = Boolean(appSecret);
  const configIdPresent = Boolean(configId);
  const redirectUriPresent = Boolean(configuredRedirectUri);
  const appUrlPresent = Boolean(appUrl);

  if (!appIdPresent) {
    issues.push('FACEBOOK_APP_ID is missing.');
    recommendations.push('Set FACEBOOK_APP_ID in your environment variables / Vercel secrets.');
  }

  if (!appSecretPresent) {
    issues.push('FACEBOOK_APP_SECRET is missing.');
    recommendations.push('Set FACEBOOK_APP_SECRET in your environment variables / Vercel secrets.');
  }

  if (!configIdPresent) {
    issues.push('FACEBOOK_LOGIN_CONFIG_ID is not configured.');
    recommendations.push('Create a Facebook Login for Business configuration in Meta Developer Portal and set FACEBOOK_LOGIN_CONFIG_ID.');
  }

  if (redirectUriPresent && configuredRedirectUri !== expectedRedirectUri) {
    issues.push(`FACEBOOK_REDIRECT_URI (${configuredRedirectUri}) does not match expected URL (${expectedRedirectUri}).`);
    recommendations.push(`Update FACEBOOK_REDIRECT_URI to: ${expectedRedirectUri}`);
  }

  recommendations.push(`Ensure "${expectedRedirectUri}" is listed under Meta App -> Facebook Login -> Settings -> Valid OAuth Redirect URIs.`);

  let appTokenValid = false;
  let metaAppName: string | undefined = undefined;
  let metaAppId: string | undefined = undefined;
  let configIdValid: boolean | undefined = undefined;

  if (appIdPresent && appSecretPresent) {
    const fbClient = client || new FacebookGraphClient();
    try {
      const tokenResp = await fbClient.get<{ access_token: string }>('oauth/access_token', undefined, {
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appSecret,
      });

      if (tokenResp && tokenResp.access_token) {
        appTokenValid = true;
        const appAccessToken = tokenResp.access_token;

        // Fetch App details
        try {
          const appDetails = await fbClient.get<{ id: string; name: string }>('app', appAccessToken);
          if (appDetails) {
            metaAppName = appDetails.name;
            metaAppId = appDetails.id;
          }
        } catch {
          // Non-fatal if app node query fails
        }

        // Test config ID if present
        if (configIdPresent) {
          try {
            await fbClient.get(configId, appAccessToken);
            configIdValid = true;
          } catch (cfgErr: any) {
            configIdValid = false;
            issues.push(`Facebook Login Configuration ID "${configId}" could not be verified by Meta Graph API: ${cfgErr?.message || 'Invalid config ID'}`);
            recommendations.push('Verify the Configuration ID in Meta Developer Portal -> Facebook Login for Business -> Configurations.');
          }
        }
      }
    } catch (err: any) {
      appTokenValid = false;
      issues.push(`Meta Graph API rejected App credentials: ${err?.message || 'Invalid App ID or App Secret'}`);
      recommendations.push('Double check that FACEBOOK_APP_ID and FACEBOOK_APP_SECRET match your Meta App Dashboard precisely.');
    }
  }

  const success = appIdPresent && appSecretPresent && appTokenValid && (configIdPresent ? configIdValid !== false : true);

  return {
    success,
    appIdPresent,
    appSecretPresent,
    configIdPresent,
    redirectUriPresent,
    appUrlPresent,
    expectedRedirectUri,
    configuredRedirectUri: configuredRedirectUri || undefined,
    appTokenValid,
    metaAppName,
    metaAppId,
    configIdValid,
    issues,
    recommendations,
  };
}


