/**
 * Facebook Graph API Constants & Version Configuration
 * FB Auto 247 - Made by Chandan Biswas
 */

/**
 * Standard supported Graph API version.
 * Overridable via FACEBOOK_GRAPH_API_VERSION environment variable.
 * Current stable version: v22.0
 */
export const DEFAULT_GRAPH_API_VERSION: string =
  (typeof process !== 'undefined' && process.env?.FACEBOOK_GRAPH_API_VERSION) || 'v22.0';

/**
 * Official valid Graph API fields for Facebook Page/accounts edge (GET /me/accounts).
 * Note: Legacy field 'perms' is completely deprecated and removed in modern Graph API.
 * The current official field is 'tasks'.
 */
export const PAGE_ACCOUNTS_FIELDS = 'id,name,category,access_token,tasks,picture,fan_count';

/**
 * Required permissions for full autonomous posting and engagement tracking.
 */
export const REQUIRED_FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const;

/**
 * Sanitizes an error message from Graph API or OAuth exchange to guarantee
 * that access tokens, secrets, or raw bearer credentials never leak to UI or logs.
 */
export function sanitizeFacebookErrorMessage(message?: string): string {
  if (!message) return 'Unknown Facebook error';
  return message
    // Mask any Graph API access tokens (EAAB..., EAA..., etc.)
    .replace(/\bEAA[a-zA-Z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]')
    // Mask Bearer tokens in headers or strings
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, 'Bearer [REDACTED_TOKEN]')
    // Mask client_secret or secret params
    .replace(/(client_secret|app_secret|secret)=([a-zA-Z0-9_-]+)/gi, '$1=[REDACTED_SECRET]')
    // Mask generic access_token query param
    .replace(/(access_token)=([a-zA-Z0-9_%-]+)/gi, '$1=[REDACTED_TOKEN]');
}
