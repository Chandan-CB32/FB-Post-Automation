export interface FacebookGraphApiErrorData {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export interface FacebookGraphErrorResponse {
  error: FacebookGraphApiErrorData;
}

export interface FacebookDebugTokenData {
  app_id: string;
  type: 'PAGE' | 'USER' | string;
  application: string;
  data_access_expires_at?: number;
  expires_at?: number; // 0 for never-expiring page token
  is_valid: boolean;
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  user_id?: string;
  error?: {
    code: number;
    message: string;
    subcode?: number;
  };
}

export interface FacebookDebugTokenResponse {
  data: FacebookDebugTokenData;
}

export interface FacebookPageAccount {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
  perms?: string[];
  fan_count?: number;
  picture?: {
    data?: {
      url?: string;
      height?: number;
      width?: number;
      is_silhouette?: boolean;
    };
  } | string;
}

export interface FacebookBusiness {
  id: string;
  name: string;
}

export interface FacebookBusinessesResponse {
  data: FacebookBusiness[];
  paging?: {
    cursors?: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

export interface DiscoveredPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks: string[];
  picture_url?: string;
  fan_count?: number;
  canPublish: boolean;
  token_status: 'valid' | 'cannot_publish';
  source: 'me/accounts' | 'business_owned' | 'business_client';
  business_id?: string;
  business_name?: string;
}

export interface PageDiscoveryResult {
  pages: DiscoveredPage[];
  totalFound: number;
  publishableCount: number;
  unpublishableCount: number;
  businessesSearched: number;
}

export interface FacebookAccountsResponse {
  data: FacebookPageAccount[];
  paging?: {
    cursors?: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

export type TokenHealthStatus =
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'insufficient_permissions'
  | 'invalid';

export interface TokenInspectionResult {
  valid: boolean;
  status: TokenHealthStatus;
  type: 'PAGE' | 'USER' | 'unknown';
  expiresAt: number | null;
  isNeverExpiring: boolean;
  scopes: string[];
  missingRequiredScopes: string[];
  error?: string;
}

export interface PagePermissionCheckResult {
  valid: boolean;
  canPost: boolean;
  canReadEngagement: boolean;
  hasPageManagePosts: boolean;
  tasks: string[];
  issues: string[];
}

