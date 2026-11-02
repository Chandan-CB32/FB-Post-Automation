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

