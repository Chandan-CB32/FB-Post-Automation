import {
  FacebookGraphApiErrorData,
  FacebookGraphErrorResponse,
  FacebookDebugTokenData,
  FacebookDebugTokenResponse,
  TokenInspectionResult,
  PagePermissionCheckResult,
} from './types.js';

export interface FacebookClientOptions {
  apiVersion?: string;
  baseUrl?: string;
  appAccessToken?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: typeof fetch;
}

export class FacebookGraphError extends Error {
  public readonly code: number;
  public readonly subcode?: number;
  public readonly fbtraceId?: string;
  public readonly isAuthError: boolean;
  public readonly isRateLimit: boolean;
  public readonly isPermissionError: boolean;
  public readonly isRetryable: boolean;

  constructor(errorData: FacebookGraphApiErrorData, httpStatus?: number) {
    super(errorData.message || 'Facebook Graph API error');
    this.name = 'FacebookGraphError';
    this.code = errorData.code;
    this.subcode = errorData.error_subcode;
    this.fbtraceId = errorData.fbtrace_id;

    // Error Classification
    this.isAuthError = this.code === 190;
    this.isRateLimit = this.code === 4 || this.code === 17 || this.code === 32 || this.code === 368;
    this.isPermissionError =
      this.code === 10 || (this.code >= 200 && this.code <= 299);
    this.isRetryable =
      this.isRateLimit ||
      this.code === 1 ||
      this.code === 2 ||
      this.code === 500 ||
      (httpStatus !== undefined && httpStatus >= 500);
  }
}

export class FacebookGraphClient {
  public readonly apiVersion: string;
  public readonly baseUrl: string;
  private readonly appAccessToken?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: FacebookClientOptions = {}) {
    this.apiVersion = options.apiVersion || 'v21.0';
    this.baseUrl = (options.baseUrl || 'https://graph.facebook.com').replace(/\/+$/, '');
    this.appAccessToken = options.appAccessToken;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchFn = options.fetchFn || fetch;
  }

  /**
   * Performs an HTTP request against the Graph API with retry backoff for retryable errors.
   */
  public async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      token?: string;
      params?: Record<string, string | number | boolean | undefined>;
      body?: any;
      isMultipart?: boolean;
    } = {}
  ): Promise<T> {
    const method = options.method || 'GET';
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/${cleanEndpoint}`);

    // Append query parameters
    if (options.params) {
      for (const [key, val] of Object.entries(options.params)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const headers: Record<string, string> = {};
    const token = options.token || this.appAccessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let requestBody: any = undefined;

    if (options.body) {
      if (options.isMultipart || options.body instanceof FormData) {
        requestBody = options.body;
      } else if (typeof options.body === 'object') {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(options.body);
      } else {
        requestBody = options.body;
      }
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(url.toString(), {
          method,
          headers,
          body: requestBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check Rate Limit Usage Headers
        const appUsage = response.headers.get('x-app-usage');
        const pageUsage = response.headers.get('x-page-usage');
        if (appUsage || pageUsage) {
          try {
            const usageObj = JSON.parse(appUsage || pageUsage || '{}');
            if (usageObj.call_count && usageObj.call_count > 80) {
              console.warn(`[FacebookGraphClient] High rate limit warning: call_count is at ${usageObj.call_count}%`);
            }
          } catch {
            // Ignore parse errors on telemetry headers
          }
        }

        const data = (await response.json()) as any;

        if (!response.ok || (data && data.error)) {
          const errorData: FacebookGraphApiErrorData = data?.error || {
            message: `Facebook Graph API request failed with HTTP ${response.status}`,
            type: 'HttpError',
            code: response.status,
          };

          const graphError = new FacebookGraphError(errorData, response.status);

          // Retry if retryable and retries remain
          if (graphError.isRetryable && attempt <= this.maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000) + Math.random() * 200;
            await new Promise((res) => setTimeout(res, delay));
            continue;
          }

          throw graphError;
        }

        return data as T;
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        if (err instanceof FacebookGraphError) {
          throw err;
        }

        const isAbort = (err as any)?.name === 'AbortError';
        const isNetworkError = !isAbort && err instanceof Error;

        if ((isAbort || isNetworkError) && attempt <= this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        throw new FacebookGraphError(
          {
            message: err instanceof Error ? err.message : String(err),
            type: isAbort ? 'TimeoutError' : 'NetworkError',
            code: isAbort ? 408 : 0,
          },
          isAbort ? 408 : 0
        );
      }
    }

    throw new FacebookGraphError({
      message: `Failed after ${this.maxRetries} retries`,
      type: 'MaxRetriesExceeded',
      code: 0,
    });
  }

  /**
   * Shortcut for GET requests
   */
  public async get<T>(
    endpoint: string,
    token?: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', token, params });
  }

  /**
   * Shortcut for POST requests
   */
  public async post<T>(
    endpoint: string,
    token?: string,
    body?: any,
    params?: Record<string, string | number | boolean | undefined>,
    isMultipart = false
  ): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', token, body, params, isMultipart });
  }

  /**
   * Shortcut for DELETE requests
   */
  public async delete<T>(
    endpoint: string,
    token?: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', token, params });
  }

  /**
   * Inspects a token using Facebook's debug_token endpoint.
   */
  public async debugToken(inputToken: string, appOrUserToken?: string): Promise<FacebookDebugTokenData> {
    const token = appOrUserToken || this.appAccessToken;
    if (!token) {
      throw new Error(
        'debugToken requires an application access token (or app secret token). Provide one in options or as argument.'
      );
    }

    const response = await this.get<FacebookDebugTokenResponse>('debug_token', token, {
      input_token: inputToken,
    });

    return response.data;
  }

  /**
   * Evaluates the health and permissions of an access token.
   */
  public async inspectTokenHealth(
    inputToken: string,
    requiredScopes: string[] = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    appToken?: string
  ): Promise<TokenInspectionResult> {
    try {
      const debugData = await this.debugToken(inputToken, appToken);

      if (!debugData.is_valid) {
        return {
          valid: false,
          status: 'invalid',
          type: (debugData.type as any) || 'unknown',
          expiresAt: debugData.expires_at ?? null,
          isNeverExpiring: false,
          scopes: debugData.scopes || [],
          missingRequiredScopes: requiredScopes,
          error: debugData.error?.message || 'Token is marked invalid by Facebook',
        };
      }

      // Check Expiration (0 means never-expiring page token)
      const nowSeconds = Math.floor(Date.now() / 1000);
      const isNeverExpiring = debugData.expires_at === 0;
      const isExpired = !isNeverExpiring && debugData.expires_at !== undefined && debugData.expires_at < nowSeconds;

      if (isExpired) {
        return {
          valid: false,
          status: 'expired',
          type: (debugData.type as any) || 'unknown',
          expiresAt: debugData.expires_at ?? null,
          isNeverExpiring: false,
          scopes: debugData.scopes || [],
          missingRequiredScopes: [],
          error: 'Token has expired',
        };
      }

      // Check Scopes
      const grantedScopes = new Set(debugData.scopes || []);
      const missingRequiredScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));

      const hasRequiredScopes = missingRequiredScopes.length === 0;

      return {
        valid: hasRequiredScopes,
        status: hasRequiredScopes ? 'valid' : 'insufficient_permissions',
        type: (debugData.type as any) || 'unknown',
        expiresAt: debugData.expires_at ?? null,
        isNeverExpiring,
        scopes: debugData.scopes || [],
        missingRequiredScopes,
        error: hasRequiredScopes ? undefined : `Missing required scopes: ${missingRequiredScopes.join(', ')}`,
      };
    } catch (err: unknown) {
      const isAuthErr = err instanceof FacebookGraphError && err.isAuthError;
      return {
        valid: false,
        status: isAuthErr ? 'revoked' : 'invalid',
        type: 'unknown',
        expiresAt: null,
        isNeverExpiring: false,
        scopes: [],
        missingRequiredScopes: requiredScopes,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Verifies that a Page Access Token possesses administrative / publishing permissions
   * on the specified Page ID.
   */
  public async verifyPagePermissions(pageId: string, pageToken: string): Promise<PagePermissionCheckResult> {
    const issues: string[] = [];

    try {
      const pageInfo = await this.get<{ id: string; name: string; tasks?: string[]; perms?: string[] }>(
        pageId,
        pageToken,
        {
          fields: 'id,name,tasks',
        }
      );

      const tasks = pageInfo.tasks || [];
      const canManage = tasks.includes('MANAGE');
      const canCreateContent = tasks.includes('CREATE_CONTENT');
      const canPost = canManage || canCreateContent;

      if (!canPost) {
        issues.push(`Page token does not have CREATE_CONTENT or MANAGE task permission on Page ${pageId}.`);
      }

      return {
        valid: issues.length === 0,
        canPost,
        canReadEngagement: true,
        hasPageManagePosts: canPost,
        tasks,
        issues,
      };
    } catch (err: unknown) {
      issues.push(`Failed to verify permissions: ${err instanceof Error ? err.message : String(err)}`);
      return {
        valid: false,
        canPost: false,
        canReadEngagement: false,
        hasPageManagePosts: false,
        tasks: [],
        issues,
      };
    }
  }

  /**
   * Retrieves basic details for a managed Page.
   */
  public async getPageDetails(pageId: string, pageToken: string): Promise<{ id: string; name: string; tasks?: string[] }> {
    return this.get<{ id: string; name: string; tasks?: string[] }>(pageId, pageToken, {
      fields: 'id,name,tasks',
    });
  }
}
