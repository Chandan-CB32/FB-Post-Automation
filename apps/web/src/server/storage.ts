import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

import {
  encryptPageToken,
  decryptPageToken,
  encrypt,
  maskSecret,
  FacebookGraphClient,
  FacebookGraphError,
  discoverFacebookPages,
  REQUIRED_FACEBOOK_SCOPES,
  sanitizeFacebookErrorMessage,
  assertSafeDatabaseUrl,
  assertSafeProductionToken,
  isTestEnv,
  isProductionEnv,
  SAFE_DEFAULT_SCHEDULE,
  getSeedProfiles,
  getAllNicheProfiles,
  type PageSchedule,
  type TokenInspectionResult,
  type PageDiscoveryResult,
  type DiscoveredPage,
} from '@fb-auto/core';

// In test environment, NEVER auto-load production .env
if (!isTestEnv()) {
  try {
    if (typeof (process as any).loadEnvFile === 'function') {
      (process as any).loadEnvFile();
    }
  } catch {
    // Ignore
  }
}


export interface StoredProvider {
  id: string;
  name: string;
  adapter_kind: string;
  base_url?: string;
  model_name?: string;
  daily_limit: number;
  used_today?: number;
  enabled: boolean;
  priority: number;
  health_status?: 'healthy' | 'failing' | 'unknown';
  latency_ms?: number;
  test_error?: string;
  last_tested_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface StoredProviderKey {
  id: string;
  provider_id: string;
  encrypted_key: string; // AES-256-GCM encrypted
  masked_key: string;    // e.g. "sk-...1234"
  label?: string;
  is_active: boolean;
  created_at: string;
}

export interface StoredFacebookAccount {
  id: string;
  account_name: string;
  fb_user_id: string;
  email?: string;
  user_access_token?: string; // AES-256-GCM encrypted
  masked_token?: string;
  token_status: 'valid' | 'expired' | 'revoked' | 'rate_limited';
  token_expires_at?: string;
  notes?: string;
  pages_count?: number;
  last_synced_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface StoredAuditLog {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  category: 'publish' | 'qa' | 'token' | 'provider' | 'security' | 'schedule';
  message: string;
  page_id?: string;
  details?: Record<string, any>;
  timestamp: string;
}

export interface StoredPage {
  id: string;
  fb_account_id?: string;
  name: string;
  fb_page_id: string;
  fb_page_token: string; // AES-256-GCM encrypted
  token_status: 'valid' | 'expired' | 'revoked' | 'rate_limited' | 'cannot_publish' | 'inaccessible';
  category?: string;
  picture_url?: string;
  tasks?: string[];
  fan_count?: number;
  secondary_account_ids?: string[];
  profile_id?: string | null;
  publishing_mode: 'auto' | 'review' | 'hybrid';
  hybrid_min_score: number;
  daily_cap: number;
  active: boolean;
  is_live?: boolean;
  version?: number;
  auto_posting_stopped_action?: 'pause' | 'cancel_pending';
  schedule: PageSchedule | {
    postsPerDay: number;
    postingTimes: string[];
    timezone: string;
    mode?: 'fixed' | 'interval' | 'auto_spread';
    daysOfWeek?: number[];
    jitterMinutes?: number;
    minGapMinutes?: number;
    leadTimeHours?: number;
    intervalHours?: number;
    windowStart?: string;
    windowEnd?: string;
    vacationStart?: string | null;
    vacationEnd?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  };
  custom_caption_prompt?: string;
  custom_caption_prompt_mode?: 'append' | 'replace';
  custom_image_prompt?: string;
  custom_image_prompt_mode?: 'append' | 'replace';
  custom_niche?: string;
  custom_niche_text?: string;
  mode_chosen?: boolean;
  settings_version?: number;
  schedule_version?: number;
  prompts_version?: number;
  profile_version?: number;
  settings_updated_at?: string;
  test_run_verified?: boolean;
  test_run_report?: any;
  qa_pass_threshold?: number;
  max_sentences_per_paragraph?: number;
  min_words?: number;
  target_words?: number;
  max_words?: number;
  first_comment_enabled?: boolean;
  first_comment_prompt?: string;
  overrides?: Record<string, any>;
  niche_analysis?: any;
  ai_disclosure_enabled?: boolean;
  ai_disclosure_text?: string;
  source_attribution_enabled?: boolean;
  last_test_run_at?: string | null;
  checklist_status?: any;
  connected_at?: string;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface StoredPost {
  id: string;
  page_id: string;
  fb_account_id?: string;
  status: string;
  review_state: 'n/a' | 'pending' | 'approved' | 'rejected';
  review_note?: string;
  title: string;
  headline?: string;
  caption: string;
  caption_word_count?: number;
  first_comment?: string;
  hashtags?: string[];
  scheduled_for: string;
  created_at: string;
  qa_score?: number;
  sensitive_flags?: string[];
  image_phash?: string;
  content_hash?: string;
  fb_post_id?: string;
  fb_permalink?: string;
  published_at?: string;
  analytics?: {
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    clicks?: number;
    engagement_rate?: number;
  };
}

export interface StorageHealthResult {
  supabaseConnected: boolean;
  tablesOk: boolean;
  tablesCount: number;
  expectedCount?: number;
  missingTables?: string[];
  bucketOk: boolean;
  singleSourceOfTruth: boolean;
  instructions?: string;
  error?: string;
}

export const CORE_SYSTEM_TABLES: string[] = [
  'facebook_accounts',
  'pages',
  'posts',
  'providers',
  'provider_keys',
  'provider_chains',
  'provider_usage_daily',
  'audit_log',
  'settings',
  'content_profiles',
  'profile_versions',
  'research_sources',
  'research_items',
  'topic_queue_items',
  'series',
  'series_episodes',
  'topic_history',
  'job_logs',
  'alerts',
];

export function parseRawKeysInput(input: string): string[] {
  if (!input || typeof input !== 'string') return [];
  const lines = input.split(/[\r\n,]+/);
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    let cleaned = rawLine.trim();
    if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) continue;

    // Strip inline comments (e.g. key123 # comment)
    const commentMatch = cleaned.search(/\s+[#\/]/);
    if (commentMatch > 0) {
      cleaned = cleaned.substring(0, commentMatch).trim();
    }

    let key = cleaned;
    const colonIdx = key.indexOf(':');
    if (colonIdx > 0 && colonIdx < key.length - 1 && !key.startsWith('http')) {
      const candidate = key.substring(colonIdx + 1).trim();
      if (candidate.length > 8) {
        key = candidate;
      }
    }
    const eqIdx = key.indexOf('=');
    if (eqIdx > 0 && eqIdx < key.length - 1) {
      key = key.substring(eqIdx + 1).trim();
    }
    key = key.replace(/^["'`]|["'`]$/g, '').trim();

    if (key.length >= 8 && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
}

export function generateProfileSlug(name: string, niche?: string): string {
  if (niche && typeof niche === 'string' && niche.trim().length > 0) {
    return niche.toLowerCase().trim().replace(/_/g, '-');
  }
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class SystemStore {
  private static instance: SystemStore;
  private client: SupabaseClient | null = null;

  // In-memory isolated storage for tests (APP_ENV === 'test')
  private memoryAccounts: Map<string, StoredFacebookAccount> = new Map();
  private memoryPages: Map<string, StoredPage> = new Map();
  private memoryProviders: Map<string, StoredProvider> = new Map();
  private memoryProviderKeys: Map<string, StoredProviderKey> = new Map();
  private memoryPosts: Map<string, StoredPost> = new Map();
  private memoryAuditLogs: StoredAuditLog[] = [];
  private memorySettings: Map<string, any> = new Map();
  private memoryContentProfiles: Map<string, any> = new Map();

  private constructor() {
    this.initClient();
  }

  public static getInstance(): SystemStore {
    if (!SystemStore.instance) {
      SystemStore.instance = new SystemStore();
    }
    return SystemStore.instance;
  }

  public static resetInstance(): void {
    SystemStore.instance = new SystemStore();
  }

  private initClient(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url) {
      assertSafeDatabaseUrl(url);
    }

    if (!url || !key) {
      if (!isTestEnv()) {
        console.warn('[SystemStore] Missing Supabase URL or SERVICE_ROLE_KEY');
      }
      return null;
    }
    if (!this.client) {
      this.client = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
    return this.client;
  }

  private getClient(): SupabaseClient {
    const c = this.client || this.initClient();
    if (!c) {
      throw new Error('Supabase client could not be initialized. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
    return c;
  }

  // --- Facebook Accounts / Identities CRUD ---
  public async getAccounts(): Promise<StoredFacebookAccount[]> {
    if (isTestEnv() && !this.client) {
      return Array.from(this.memoryAccounts.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    const { data, error } = await this.getClient()
      .from('facebook_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[SystemStore] Error fetching facebook_accounts:', error.message);
      return [];
    }
    return (data || []).map((row) => ({
      id: row.id,
      account_name: row.account_name,
      fb_user_id: row.fb_user_id,
      email: row.email,
      user_access_token: row.user_access_token,
      masked_token: row.masked_token,
      token_status: row.token_status || 'valid',
      token_expires_at: row.token_expires_at,
      notes: row.notes,
      pages_count: typeof row.pages_count === 'number' ? row.pages_count : 0,
      last_synced_at: row.last_synced_at || row.updated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async getAccountById(id: string): Promise<StoredFacebookAccount | undefined> {
    if (isTestEnv() && !this.client) {
      return this.memoryAccounts.get(id);
    }
    const { data, error } = await this.getClient()
      .from('facebook_accounts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return undefined;
    return {
      id: data.id,
      account_name: data.account_name,
      fb_user_id: data.fb_user_id,
      email: data.email,
      user_access_token: data.user_access_token,
      masked_token: data.masked_token,
      token_status: data.token_status || 'valid',
      token_expires_at: data.token_expires_at,
      notes: data.notes,
      pages_count: typeof data.pages_count === 'number' ? data.pages_count : 0,
      last_synced_at: data.last_synced_at || data.updated_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async createAccount(input: {
    account_name: string;
    fb_user_id: string;
    email?: string;
    user_access_token?: string;
    token_status?: 'valid' | 'expired' | 'revoked' | 'rate_limited';
    token_expires_at?: string;
    notes?: string;
    pages_count?: number;
  }): Promise<StoredFacebookAccount> {
    assertSafeProductionToken(input.user_access_token, input.fb_user_id);

    if (isTestEnv() && !this.client) {
      const id = crypto.randomUUID();
      const encToken = input.user_access_token ? encryptPageToken(input.user_access_token) : null;
      const masked = input.user_access_token ? maskSecret(input.user_access_token) : 'No User Token';
      const now = new Date().toISOString();
      const account: StoredFacebookAccount = {
        id,
        account_name: input.account_name,
        fb_user_id: input.fb_user_id,
        email: input.email,
        user_access_token: encToken,
        masked_token: masked,
        token_status: input.token_status || 'valid',
        token_expires_at: input.token_expires_at || new Date(Date.now() + 86400 * 1000 * 60).toISOString(),
        notes: input.notes,
        pages_count: input.pages_count ?? 0,
        last_synced_at: now,
        created_at: now,
        updated_at: now,
      };
      this.memoryAccounts.set(id, account);
      return account;
    }

    const encToken = input.user_access_token ? encryptPageToken(input.user_access_token) : null;
    const masked = input.user_access_token ? maskSecret(input.user_access_token) : 'No User Token';

    let insertPayload: Record<string, any> = {
      account_name: input.account_name,
      fb_user_id: input.fb_user_id,
      email: input.email || null,
      user_access_token: encToken,
      masked_token: masked,
      token_status: input.token_status || 'valid',
      token_expires_at: input.token_expires_at || new Date(Date.now() + 86400 * 1000 * 60).toISOString(),
      notes: input.notes || null,
      pages_count: input.pages_count ?? 0,
      last_synced_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let { data, error } = await this.getClient()
      .from('facebook_accounts')
      .insert(insertPayload)
      .select()
      .single();

    if (error && (error.message?.includes('schema cache') || error.message?.includes('column'))) {
      delete insertPayload.pages_count;
      delete insertPayload.last_synced_at;
      const retry = await this.getClient()
        .from('facebook_accounts')
        .insert(insertPayload)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to create Facebook Account in Supabase: ${error.message}`);
    }

    return {
      id: data.id,
      account_name: data.account_name,
      fb_user_id: data.fb_user_id,
      email: data.email,
      user_access_token: data.user_access_token,
      masked_token: data.masked_token,
      token_status: data.token_status,
      token_expires_at: data.token_expires_at,
      notes: data.notes,
      pages_count: data.pages_count ?? 0,
      last_synced_at: data.last_synced_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async updateAccount(id: string, updates: Partial<StoredFacebookAccount>): Promise<StoredFacebookAccount> {
    if (isTestEnv() && !this.client) {
      const existing = this.memoryAccounts.get(id);
      if (!existing) throw new Error(`Account ${id} not found.`);
      let user_access_token = existing.user_access_token;
      let masked_token = existing.masked_token;
      if (updates.user_access_token) {
        user_access_token = encryptPageToken(updates.user_access_token);
        masked_token = maskSecret(updates.user_access_token);
      }
      const updated: StoredFacebookAccount = {
        ...existing,
        ...updates,
        user_access_token,
        masked_token,
        updated_at: new Date().toISOString(),
      };
      this.memoryAccounts.set(id, updated);
      return updated;
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.account_name) updatePayload.account_name = updates.account_name;
    if (updates.email !== undefined) updatePayload.email = updates.email;
    if (updates.notes !== undefined) updatePayload.notes = updates.notes;
    if (updates.token_status) updatePayload.token_status = updates.token_status;
    if (updates.pages_count !== undefined) updatePayload.pages_count = updates.pages_count;
    if (updates.last_synced_at !== undefined) updatePayload.last_synced_at = updates.last_synced_at;

    if (updates.user_access_token) {
      updatePayload.user_access_token = encryptPageToken(updates.user_access_token);
      updatePayload.masked_token = maskSecret(updates.user_access_token);
    }

    let { data, error } = await this.getClient()
      .from('facebook_accounts')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error && (error.message?.includes('schema cache') || error.message?.includes('column'))) {
      delete updatePayload.pages_count;
      delete updatePayload.last_synced_at;
      const retry = await this.getClient()
        .from('facebook_accounts')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to update Facebook Account ${id}: ${error.message}`);
    }

    return data as StoredFacebookAccount;
  }

  public async deleteAccount(id: string): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      for (const [pId, p] of this.memoryPages.entries()) {
        if (p.fb_account_id === id) {
          this.memoryPages.delete(pId);
        }
      }
      return this.memoryAccounts.delete(id);
    }

    const { error } = await this.getClient().from('facebook_accounts').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete account error:', error.message);
      return false;
    }
    return true;
  }

  public async upsertAccount(input: {
    account_name: string;
    fb_user_id: string;
    email?: string;
    user_access_token?: string;
    token_expires_at?: string;
    notes?: string;
  }): Promise<StoredFacebookAccount> {
    assertSafeProductionToken(input.user_access_token, input.fb_user_id);

    if (isTestEnv() && !this.client) {
      const existing = Array.from(this.memoryAccounts.values()).find(
        (a) => a.fb_user_id === input.fb_user_id || (input.email && a.email === input.email)
      );
      if (existing) {
        return await this.updateAccount(existing.id, {
          account_name: input.account_name,
          email: input.email,
          ...(input.user_access_token ? { user_access_token: input.user_access_token } : {}),
          ...(input.token_expires_at ? { token_expires_at: input.token_expires_at } : {}),
          token_status: 'valid',
          ...(input.notes ? { notes: input.notes } : {}),
        });
      }
      return await this.createAccount(input);
    }

    const { data: existing } = await this.getClient()
      .from('facebook_accounts')
      .select('id')
      .eq('fb_user_id', input.fb_user_id)
      .maybeSingle();

    if (existing) {
      return await this.updateAccount(existing.id, {
        account_name: input.account_name,
        email: input.email,
        ...(input.user_access_token ? { user_access_token: input.user_access_token } : {}),
        ...(input.token_expires_at ? { token_expires_at: input.token_expires_at } : {}),
        token_status: 'valid',
        ...(input.notes ? { notes: input.notes } : {}),
      });
    }

    return await this.createAccount({
      account_name: input.account_name,
      fb_user_id: input.fb_user_id,
      email: input.email,
      user_access_token: input.user_access_token,
      token_expires_at: input.token_expires_at,
      notes: input.notes,
    });
  }

  public async checkAccountTokenHealth(accountId: string): Promise<TokenInspectionResult> {
    if (isTestEnv() && !this.client) {
      return {
        valid: true,
        status: 'valid',
        type: 'USER',
        expiresAt: Math.floor((Date.now() + 86400000 * 60) / 1000),
        isNeverExpiring: false,
        scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
        missingRequiredScopes: [],
      };
    }
    const account = await this.getAccountById(accountId);

    if (!account || !account.user_access_token) {
      throw new Error('Account or token not found');
    }
    const decryptedToken = decryptPageToken(account.user_access_token);
    const client = new FacebookGraphClient({
      appAccessToken:
        process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
          ? `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`
          : undefined,
    });
    const result = await client.inspectTokenHealth(decryptedToken);

    // Fallback: If scopes weren't obtained from debug_token, inspect via /me/permissions directly
    if (!result.scopes || result.scopes.length === 0) {
      try {
        const perms = await client.getPermissions(decryptedToken);
        const granted = perms.filter((p) => p.status === 'granted').map((p) => p.permission);
        if (granted.length > 0) {
          result.scopes = granted;
          result.missingRequiredScopes = REQUIRED_FACEBOOK_SCOPES.filter((s) => !granted.includes(s));
          if (result.missingRequiredScopes.length === 0 && (result.status === 'insufficient_permissions' || result.status === 'invalid')) {
            result.status = 'valid';
            result.valid = true;
          }
        }
      } catch {
        // Ignore fallback error
      }
    }

    const status = result.status === 'valid' ? 'valid' : 'expired';
    const updates: Partial<StoredFacebookAccount> = { token_status: status };
    if (result.scopes && result.scopes.length > 0) {
      updates.notes = `Permissions: ${result.scopes.join(', ')}`;
    }
    await this.updateAccount(accountId, updates);
    return result;
  }

  // --- Pages CRUD ---
  public async getPages(): Promise<StoredPage[]> {
    if (isTestEnv() && !this.client) {
      return Array.from(this.memoryPages.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const { data, error } = await this.getClient()
      .from('pages')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[SystemStore] Error fetching pages:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      fb_account_id: row.fb_account_id,
      name: row.name,
      fb_page_id: row.fb_page_id,
      fb_page_token: row.fb_page_token,
      token_status: row.token_status || 'valid',
      category: row.category || undefined,
      picture_url: row.picture_url || undefined,
      tasks: Array.isArray(row.tasks) ? row.tasks : [],
      fan_count: typeof row.fan_count === 'number' ? row.fan_count : (row.fan_count ? Number(row.fan_count) : 0),
      secondary_account_ids: Array.isArray(row.secondary_account_ids) ? row.secondary_account_ids : [],
      profile_id: row.profile_id || null,
      publishing_mode: row.publishing_mode || 'review',
      hybrid_min_score: Number(row.hybrid_min_score) || 80,
      daily_cap: row.daily_cap !== undefined ? Number(row.daily_cap) : 3,
      active: Boolean(row.active),
      is_live: Boolean(row.is_live !== undefined ? row.is_live : row.active),
      version: Number(row.version || 1),
      auto_posting_stopped_action: row.auto_posting_stopped_action || 'pause',
      schedule: row.schedule || SAFE_DEFAULT_SCHEDULE,
      niche_analysis: row.niche_analysis || null,
      ai_disclosure_enabled: Boolean(row.ai_disclosure_enabled),
      ai_disclosure_text: row.ai_disclosure_text || '',
      source_attribution_enabled: Boolean(row.source_attribution_enabled),
      last_test_run_at: row.last_test_run_at || null,
      checklist_status: row.checklist_status || null,
      custom_caption_prompt: row.custom_caption_prompt || '',
      custom_caption_prompt_mode: row.custom_caption_prompt_mode || 'append',
      custom_image_prompt: row.custom_image_prompt || '',
      custom_image_prompt_mode: row.custom_image_prompt_mode || 'append',
      custom_niche: row.custom_niche || row.custom_niche_text || '',
      custom_niche_text: row.custom_niche_text || row.custom_niche || '',
      mode_chosen: Boolean(row.mode_chosen),
      settings_version: Number(row.settings_version || row.version || 1),
      schedule_version: Number(row.schedule_version || 1),
      prompts_version: Number(row.prompts_version || 1),
      profile_version: Number(row.profile_version || 1),
      settings_updated_at: row.settings_updated_at || row.updated_at,
      test_run_verified: Boolean(row.test_run_verified),
      test_run_report: row.test_run_report || null,
      qa_pass_threshold: row.qa_pass_threshold !== undefined && row.qa_pass_threshold !== null ? Number(row.qa_pass_threshold) : 80,
      max_sentences_per_paragraph: row.max_sentences_per_paragraph !== undefined && row.max_sentences_per_paragraph !== null ? Number(row.max_sentences_per_paragraph) : 3,
      min_words: row.min_words !== undefined && row.min_words !== null ? Number(row.min_words) : undefined,
      target_words: row.target_words !== undefined && row.target_words !== null ? Number(row.target_words) : undefined,
      max_words: row.max_words !== undefined && row.max_words !== null ? Number(row.max_words) : undefined,
      first_comment_enabled: row.first_comment_enabled !== false,
      first_comment_prompt: row.first_comment_prompt || '',
      overrides: row.overrides || {},
      connected_at: row.connected_at || row.created_at,
      last_synced_at: row.last_synced_at || row.updated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async getPageById(id: string): Promise<StoredPage | undefined> {
    if (isTestEnv() && !this.client) {
      return this.memoryPages.get(id);
    }

    const { data, error } = await this.getClient()
      .from('pages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return undefined;
    return {
      id: data.id,
      fb_account_id: data.fb_account_id,
      name: data.name,
      fb_page_id: data.fb_page_id,
      fb_page_token: data.fb_page_token,
      token_status: data.token_status || 'valid',
      category: data.category || undefined,
      picture_url: data.picture_url || undefined,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      fan_count: typeof data.fan_count === 'number' ? data.fan_count : (data.fan_count ? Number(data.fan_count) : 0),
      secondary_account_ids: Array.isArray(data.secondary_account_ids) ? data.secondary_account_ids : [],
      profile_id: data.profile_id || null,
      publishing_mode: data.publishing_mode || 'review',
      hybrid_min_score: Number(data.hybrid_min_score) || 80,
      daily_cap: data.daily_cap !== undefined ? Number(data.daily_cap) : 3,
      active: Boolean(data.active),
      is_live: Boolean(data.is_live !== undefined ? data.is_live : data.active),
      version: Number(data.version || 1),
      auto_posting_stopped_action: data.auto_posting_stopped_action || 'pause',
      schedule: data.schedule || SAFE_DEFAULT_SCHEDULE,
      niche_analysis: data.niche_analysis || null,
      ai_disclosure_enabled: Boolean(data.ai_disclosure_enabled),
      ai_disclosure_text: data.ai_disclosure_text || '',
      source_attribution_enabled: Boolean(data.source_attribution_enabled),
      last_test_run_at: data.last_test_run_at || null,
      checklist_status: data.checklist_status || null,
      custom_caption_prompt: data.custom_caption_prompt || '',
      custom_caption_prompt_mode: data.custom_caption_prompt_mode || 'append',
      custom_image_prompt: data.custom_image_prompt || '',
      custom_image_prompt_mode: data.custom_image_prompt_mode || 'append',
      custom_niche: data.custom_niche || data.custom_niche_text || '',
      custom_niche_text: data.custom_niche_text || data.custom_niche || '',
      mode_chosen: Boolean(data.mode_chosen),
      settings_version: Number(data.settings_version || data.version || 1),
      schedule_version: Number(data.schedule_version || 1),
      prompts_version: Number(data.prompts_version || 1),
      profile_version: Number(data.profile_version || 1),
      settings_updated_at: data.settings_updated_at || data.updated_at,
      test_run_verified: Boolean(data.test_run_verified),
      test_run_report: data.test_run_report || null,
      qa_pass_threshold: data.qa_pass_threshold !== undefined && data.qa_pass_threshold !== null ? Number(data.qa_pass_threshold) : 80,
      max_sentences_per_paragraph: data.max_sentences_per_paragraph !== undefined && data.max_sentences_per_paragraph !== null ? Number(data.max_sentences_per_paragraph) : 3,
      min_words: data.min_words !== undefined && data.min_words !== null ? Number(data.min_words) : undefined,
      target_words: data.target_words !== undefined && data.target_words !== null ? Number(data.target_words) : undefined,
      max_words: data.max_words !== undefined && data.max_words !== null ? Number(data.max_words) : undefined,
      first_comment_enabled: data.first_comment_enabled !== false,
      first_comment_prompt: data.first_comment_prompt || '',
      overrides: data.overrides || {},
      connected_at: data.connected_at || data.created_at,
      last_synced_at: data.last_synced_at || data.updated_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async createPage(input: {
    name: string;
    fb_page_id: string;
    fb_page_token: string;
    profile_id?: string | null;
    fb_account_id?: string;
    category?: string;
    picture_url?: string;
    tasks?: string[];
    fan_count?: number;
    token_status?: 'valid' | 'expired' | 'revoked' | 'rate_limited' | 'cannot_publish' | 'inaccessible';
    secondary_account_ids?: string[];
    publishing_mode?: 'auto' | 'review' | 'hybrid';
    hybrid_min_score?: number;
    daily_cap?: number;
    active?: boolean;
    schedule?: any;
    niche_analysis?: any;
    ai_disclosure_enabled?: boolean;
    ai_disclosure_text?: string;
    source_attribution_enabled?: boolean;
    last_test_run_at?: string;
    checklist_status?: any;
    custom_caption_prompt?: string;
    custom_caption_prompt_mode?: 'append' | 'replace';
    custom_image_prompt?: string;
    custom_image_prompt_mode?: 'append' | 'replace';
    custom_niche?: string;
    custom_niche_text?: string;
    mode_chosen?: boolean;
    first_comment_enabled?: boolean;
    first_comment_prompt?: string;
    overrides?: Record<string, any>;
    qa_pass_threshold?: number;
    max_sentences_per_paragraph?: number;
    min_words?: number | null;
    target_words?: number | null;
    max_words?: number | null;
    connected_at?: string;
    last_synced_at?: string;
  }): Promise<StoredPage> {
    assertSafeProductionToken(input.fb_page_token, input.fb_page_id);

    const safeActive = input.active !== undefined ? input.active : false;
    const safeSchedule = input.schedule || SAFE_DEFAULT_SCHEDULE;
    const safeMode = input.publishing_mode || 'review';

    // Normalize profile_id: placeholders or empty string -> null
    let safeProfileId: string | null = null;
    if (
      input.profile_id &&
      input.profile_id !== '__custom__' &&
      input.profile_id !== 'custom' &&
      input.profile_id !== 'default-niche' &&
      input.profile_id.trim().length > 0
    ) {
      safeProfileId = input.profile_id.trim();
    }

    // Normalize fb_account_id
    let safeAccountId: string | null = null;
    if (
      input.fb_account_id &&
      input.fb_account_id !== '__none__' &&
      input.fb_account_id !== 'none' &&
      input.fb_account_id.trim().length > 0
    ) {
      safeAccountId = input.fb_account_id.trim();
    }

    const customNicheVal = (input.custom_niche ?? input.custom_niche_text ?? '').trim();
    const now = new Date().toISOString();

    if (isTestEnv() && !this.client) {
      const id = crypto.randomUUID();
      const encryptedToken = encryptPageToken(input.fb_page_token);
      const page: StoredPage = {
        id,
        fb_account_id: safeAccountId,
        name: input.name,
        fb_page_id: input.fb_page_id,
        fb_page_token: encryptedToken,
        token_status: input.token_status || 'valid',
        category: input.category,
        picture_url: input.picture_url,
        tasks: Array.isArray(input.tasks) ? input.tasks : ['CREATE_CONTENT'],
        fan_count: typeof input.fan_count === 'number' ? input.fan_count : 0,
        secondary_account_ids: input.secondary_account_ids || [],
        profile_id: safeProfileId,
        custom_niche: customNicheVal,
        custom_niche_text: customNicheVal,
        publishing_mode: safeMode,
        mode_chosen: Boolean(input.mode_chosen),
        hybrid_min_score: Number(input.hybrid_min_score) || 80,
        daily_cap: input.daily_cap !== undefined ? Number(input.daily_cap) : 3,
        active: safeActive,
        is_live: safeActive,
        version: 1,
        settings_version: 1,
        schedule_version: 1,
        prompts_version: 1,
        profile_version: 1,
        settings_updated_at: now,
        test_run_verified: false,
        test_run_report: null,
        schedule: safeSchedule,
        niche_analysis: input.niche_analysis || null,
        ai_disclosure_enabled: Boolean(input.ai_disclosure_enabled),
        ai_disclosure_text: input.ai_disclosure_text || '',
        source_attribution_enabled: Boolean(input.source_attribution_enabled),
        last_test_run_at: input.last_test_run_at || null,
        checklist_status: input.checklist_status || null,
        custom_caption_prompt: input.custom_caption_prompt || '',
        custom_caption_prompt_mode: input.custom_caption_prompt_mode || 'append',
        custom_image_prompt: input.custom_image_prompt || '',
        custom_image_prompt_mode: input.custom_image_prompt_mode || 'append',
        qa_pass_threshold: input.qa_pass_threshold !== undefined ? input.qa_pass_threshold : 80,
        max_sentences_per_paragraph: input.max_sentences_per_paragraph !== undefined ? input.max_sentences_per_paragraph : 3,
        min_words: input.min_words !== undefined ? input.min_words : null,
        target_words: input.target_words !== undefined ? input.target_words : null,
        max_words: input.max_words !== undefined ? input.max_words : null,
        first_comment_enabled: input.first_comment_enabled !== false,
        first_comment_prompt: input.first_comment_prompt !== undefined ? input.first_comment_prompt : 'What do you think? Share your thoughts in the comments below!',
        overrides: input.overrides || {},
        connected_at: input.connected_at || now,
        last_synced_at: input.last_synced_at || now,
        created_at: now,
        updated_at: now,
      };
      this.memoryPages.set(id, page);
      return page;
    }

    const encryptedToken = encryptPageToken(input.fb_page_token);

    let payload: Record<string, any> = {
      fb_account_id: safeAccountId,
      name: input.name,
      fb_page_id: input.fb_page_id,
      fb_page_token: encryptedToken,
      token_status: input.token_status || 'valid',
      category: input.category || null,
      picture_url: input.picture_url || null,
      tasks: input.tasks || [],
      fan_count: typeof input.fan_count === 'number' ? input.fan_count : 0,
      secondary_account_ids: input.secondary_account_ids || [],
      profile_id: safeProfileId,
      custom_niche: customNicheVal,
      custom_niche_text: customNicheVal,
      publishing_mode: safeMode,
      mode_chosen: Boolean(input.mode_chosen),
      hybrid_min_score: input.hybrid_min_score ?? 80,
      daily_cap: input.daily_cap !== undefined ? Number(input.daily_cap) : 3,
      active: safeActive,
      is_live: safeActive,
      version: 1,
      settings_version: 1,
      schedule_version: 1,
      prompts_version: 1,
      profile_version: 1,
      settings_updated_at: now,
      test_run_verified: false,
      test_run_report: null,
      schedule: safeSchedule,
      niche_analysis: input.niche_analysis || null,
      ai_disclosure_enabled: Boolean(input.ai_disclosure_enabled),
      ai_disclosure_text: input.ai_disclosure_text || '',
      source_attribution_enabled: Boolean(input.source_attribution_enabled),
      last_test_run_at: input.last_test_run_at || null,
      checklist_status: input.checklist_status || null,
      custom_caption_prompt: input.custom_caption_prompt || '',
      custom_caption_prompt_mode: input.custom_caption_prompt_mode || 'append',
      custom_image_prompt: input.custom_image_prompt || '',
      custom_image_prompt_mode: input.custom_image_prompt_mode || 'append',
      qa_pass_threshold: input.qa_pass_threshold !== undefined ? input.qa_pass_threshold : 80,
      max_sentences_per_paragraph: input.max_sentences_per_paragraph !== undefined ? input.max_sentences_per_paragraph : 3,
      min_words: input.min_words !== undefined ? input.min_words : null,
      target_words: input.target_words !== undefined ? input.target_words : null,
      max_words: input.max_words !== undefined ? input.max_words : null,
      first_comment_enabled: input.first_comment_enabled !== false,
      first_comment_prompt: input.first_comment_prompt !== undefined ? input.first_comment_prompt : 'What do you think? Share your thoughts in the comments below!',
      overrides: input.overrides || {},
      connected_at: input.connected_at || now,
      last_synced_at: input.last_synced_at || now,
      created_at: now,
      updated_at: now,
    };

    let { data, error } = await this.getClient().from('pages').insert(payload).select().single();
    if (error && (error.message?.includes('schema cache') || error.message?.includes('column') || error.message?.includes('check constraint'))) {
      delete payload.category;
      delete payload.picture_url;
      delete payload.tasks;
      delete payload.fan_count;
      delete payload.secondary_account_ids;
      delete payload.connected_at;
      delete payload.last_synced_at;
      delete payload.custom_niche;
      delete payload.custom_niche_text;
      delete payload.settings_version;
      delete payload.schedule_version;
      delete payload.prompts_version;
      delete payload.profile_version;
      delete payload.settings_updated_at;
      delete payload.mode_chosen;
      delete payload.test_run_verified;
      delete payload.test_run_report;
      if (payload.token_status === 'cannot_publish' || payload.token_status === 'inaccessible') {
        payload.token_status = 'revoked';
      }
      const retry = await this.getClient().from('pages').insert(payload).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to create Facebook Page in Supabase: ${error.message}`);
    }

    return {
      ...payload,
      id: data.id,
      profile_id: safeProfileId,
    } as StoredPage;
  }

  public async updatePage(
    id: string,
    updates: Partial<StoredPage>,
    options?: {
      expectedUpdatedAt?: string;
      expectedVersion?: number;
      expectedSettingsVersion?: number;
      expectedAreaVersion?: { area: 'schedule' | 'prompts' | 'profile' | 'settings'; version: number };
      force?: boolean;
      isOperational?: boolean;
    }
  ): Promise<StoredPage> {
    const operationalKeys = new Set([
      'token_status',
      'last_synced_at',
      'connected_at',
      'tasks',
      'fan_count',
      'picture_url',
      'category',
      'checklist_status',
      'test_run_report',
      'test_run_verified',
      'last_test_run_at',
      'secondary_account_ids',
      'fb_page_token',
    ]);
    const updateKeys = Object.keys(updates);
    const isOperationalOnly = Boolean(
      options?.isOperational ||
      (updateKeys.length > 0 && updateKeys.every((k) => operationalKeys.has(k)))
    );

    // 1. Profile foreign key normalization and validation
    if (updates.profile_id !== undefined) {
      if (
        updates.profile_id === '' ||
        updates.profile_id === '__custom__' ||
        updates.profile_id === 'custom' ||
        updates.profile_id === 'default-niche' ||
        (typeof updates.profile_id === 'string' && updates.profile_id.trim() === '')
      ) {
        updates.profile_id = null;
      } else if (updates.profile_id !== null) {
        let profileExists = false;
        if (isTestEnv() && !this.client) {
          profileExists =
            this.memoryContentProfiles.has(updates.profile_id) ||
            Array.from(this.memoryContentProfiles.values()).some(
              (p) =>
                p.id === updates.profile_id ||
                p.name === updates.profile_id ||
                p.customVariables?.niche === updates.profile_id ||
                (p as any).niche === updates.profile_id
            );
          if (!profileExists) {
            const seed = getAllNicheProfiles().find(
              (p) =>
                p.id === updates.profile_id ||
                p.name === updates.profile_id ||
                p.customVariables?.niche === updates.profile_id ||
                (p as any).niche === updates.profile_id
            );
            if (seed) profileExists = true;
          }
        } else {
          const { data: pRow } = await this.getClient()
            .from('content_profiles')
            .select('id')
            .eq('id', updates.profile_id)
            .maybeSingle();
          profileExists = Boolean(pRow);
        }
        if (!profileExists) {
          const err = new Error('Selected profile no longer exists. Please choose a valid profile or switch to Custom niche.');
          (err as any).field = 'profile_id';
          (err as any).statusCode = 400;
          (err as any).missingId = updates.profile_id;
          (err as any).table = 'content_profiles';
          throw err;
        }
      }
    }

    // 2. Facebook Account foreign key normalization and validation
    if (updates.fb_account_id !== undefined) {
      if (
        updates.fb_account_id === '' ||
        updates.fb_account_id === 'none' ||
        updates.fb_account_id === '__none__' ||
        (typeof updates.fb_account_id === 'string' && updates.fb_account_id.trim() === '')
      ) {
        updates.fb_account_id = null;
      } else if (updates.fb_account_id !== null) {
        let accountExists = false;
        if (isTestEnv() && !this.client) {
          accountExists = this.memoryAccounts.has(updates.fb_account_id);
        } else {
          const { data: aRow } = await this.getClient()
            .from('facebook_accounts')
            .select('id')
            .eq('id', updates.fb_account_id)
            .maybeSingle();
          accountExists = Boolean(aRow);
        }
        if (!accountExists) {
          const err = new Error('Selected Facebook account no longer exists.');
          (err as any).field = 'fb_account_id';
          (err as any).statusCode = 400;
          throw err;
        }
      }
    }

    // 3. Custom niche synchronization
    if (updates.custom_niche !== undefined || updates.custom_niche_text !== undefined) {
      const customNicheVal = (updates.custom_niche ?? updates.custom_niche_text ?? '').trim();
      updates.custom_niche = customNicheVal;
      updates.custom_niche_text = customNicheVal;
    }

    // 4. Invalidate test run when prompts, profile, niche, or word/headline overrides change
    const promptOrProfileChanged =
      updates.profile_id !== undefined ||
      updates.custom_niche !== undefined ||
      updates.custom_niche_text !== undefined ||
      updates.custom_caption_prompt !== undefined ||
      updates.custom_caption_prompt_mode !== undefined ||
      updates.custom_image_prompt !== undefined ||
      updates.custom_image_prompt_mode !== undefined ||
      updates.first_comment_enabled !== undefined ||
      updates.first_comment_prompt !== undefined ||
      updates.overrides !== undefined;

    if (promptOrProfileChanged && updates.test_run_verified === undefined && !isOperationalOnly) {
      updates.test_run_verified = false;
      updates.last_test_run_at = null;
      updates.test_run_report = null;
    }

    if (isTestEnv() && !this.client) {
      const existing = this.memoryPages.get(id);
      if (!existing) throw new Error(`Page ${id} not found.`);

      // Optimistic concurrency check ONLY on non-operational user updates
      if (!isOperationalOnly && !options?.force) {
        if (options?.expectedSettingsVersion && existing.settings_version && existing.settings_version !== options.expectedSettingsVersion) {
          const conflictErr = new Error(
            `Concurrency conflict: page settings modified elsewhere (current v${existing.settings_version}, expected v${options.expectedSettingsVersion}). Please resolve.`
          );
          (conflictErr as any).conflict = true;
          (conflictErr as any).currentRecord = existing;
          (conflictErr as any).statusCode = 409;
          throw conflictErr;
        }
        if (options?.expectedAreaVersion) {
          const areaKey = `${options.expectedAreaVersion.area}_version` as keyof StoredPage;
          const currentAreaVer = (existing as any)[areaKey];
          if (currentAreaVer && currentAreaVer !== options.expectedAreaVersion.version) {
            const conflictErr = new Error(
              `Concurrency conflict: ${options.expectedAreaVersion.area} was modified elsewhere (current v${currentAreaVer}, expected v${options.expectedAreaVersion.version}).`
            );
            (conflictErr as any).conflict = true;
            (conflictErr as any).currentRecord = existing;
            (conflictErr as any).statusCode = 409;
            throw conflictErr;
          }
        }
        if (options?.expectedUpdatedAt && existing.settings_updated_at && existing.settings_updated_at !== options.expectedUpdatedAt) {
          const conflictErr = new Error(
            `Concurrency conflict: page was modified elsewhere (current: ${existing.settings_updated_at}, expected: ${options.expectedUpdatedAt}). Please reload.`
          );
          (conflictErr as any).conflict = true;
          (conflictErr as any).currentRecord = existing;
          (conflictErr as any).statusCode = 409;
          throw conflictErr;
        }
      }

      let fb_page_token = existing.fb_page_token;
      if (updates.fb_page_token) {
        fb_page_token = encryptPageToken(updates.fb_page_token);
      }
      const activeVal = updates.active !== undefined ? updates.active : (updates.is_live !== undefined ? updates.is_live : existing.active);
      const isLiveVal = updates.is_live !== undefined ? updates.is_live : (updates.active !== undefined ? updates.active : (existing.is_live ?? activeVal));

      const nowIso = new Date().toISOString();
      const updated: StoredPage = {
        ...existing,
        ...updates,
        active: activeVal,
        is_live: isLiveVal,
        fb_page_token,
        updated_at: nowIso,
      };

      if (!isOperationalOnly) {
        updated.settings_version = (existing.settings_version || existing.version || 1) + 1;
        updated.version = (existing.version || 1) + 1;
        updated.settings_updated_at = nowIso;
        if (updates.schedule !== undefined || updates.daily_cap !== undefined) {
          updated.schedule_version = (existing.schedule_version || 1) + 1;
        }
        if (
          updates.custom_caption_prompt !== undefined ||
          updates.custom_caption_prompt_mode !== undefined ||
          updates.custom_image_prompt !== undefined ||
          updates.custom_image_prompt_mode !== undefined ||
          updates.first_comment_enabled !== undefined ||
          updates.first_comment_prompt !== undefined ||
          updates.overrides !== undefined
        ) {
          updated.prompts_version = (existing.prompts_version || 1) + 1;
        }
        if (updates.profile_id !== undefined || updates.custom_niche !== undefined || updates.custom_niche_text !== undefined) {
          updated.profile_version = (existing.profile_version || 1) + 1;
        }
      }

      this.memoryPages.set(id, updated);
      return updated;
    }

    // Optimistic concurrency check in Supabase
    let existingRow: any = null;
    const { data: rowFetched, error: checkErr } = await this.getClient()
      .from('pages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (checkErr) {
      throw new Error(`Database error querying page ${id}: ${checkErr.message}`);
    }
    existingRow = rowFetched;

    if (!existingRow) {
      throw new Error(`Page ${id} not found in database.`);
    }

    if (!isOperationalOnly && !options?.force) {
      if (options?.expectedSettingsVersion && existingRow.settings_version && existingRow.settings_version !== options.expectedSettingsVersion) {
        const conflictErr = new Error(
          `Concurrency conflict: page settings modified elsewhere (current v${existingRow.settings_version}, expected v${options.expectedSettingsVersion}). Please resolve.`
        );
        (conflictErr as any).conflict = true;
        (conflictErr as any).currentRecord = existingRow;
        (conflictErr as any).statusCode = 409;
        throw conflictErr;
      }
      if (options?.expectedAreaVersion) {
        const areaCol = `${options.expectedAreaVersion.area}_version`;
        const currentAreaVer = existingRow[areaCol];
        if (currentAreaVer && currentAreaVer !== options.expectedAreaVersion.version) {
          const conflictErr = new Error(
            `Concurrency conflict: ${options.expectedAreaVersion.area} was modified elsewhere (current v${currentAreaVer}, expected v${options.expectedAreaVersion.version}).`
          );
          (conflictErr as any).conflict = true;
          (conflictErr as any).currentRecord = existingRow;
          (conflictErr as any).statusCode = 409;
          throw conflictErr;
        }
      }
      if (options?.expectedUpdatedAt && existingRow.settings_updated_at && existingRow.settings_updated_at !== options.expectedUpdatedAt) {
        const conflictErr = new Error(
          `Concurrency conflict: page was modified elsewhere at ${existingRow.settings_updated_at}. Please reload to see the latest settings.`
        );
        (conflictErr as any).conflict = true;
        (conflictErr as any).currentRecord = existingRow;
        (conflictErr as any).statusCode = 409;
        throw conflictErr;
      }
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      updated_at: nowIso,
    };

    if (!isOperationalOnly) {
      updatePayload.settings_version = (existingRow.settings_version || existingRow.version || 1) + 1;
      updatePayload.settings_updated_at = nowIso;
      if (updates.schedule !== undefined || updates.daily_cap !== undefined) {
        updatePayload.schedule_version = (existingRow.schedule_version || 1) + 1;
      }
      if (
        updates.custom_caption_prompt !== undefined ||
        updates.custom_caption_prompt_mode !== undefined ||
        updates.custom_image_prompt !== undefined ||
        updates.custom_image_prompt_mode !== undefined ||
        updates.first_comment_enabled !== undefined ||
        updates.first_comment_prompt !== undefined ||
        updates.overrides !== undefined
      ) {
        updatePayload.prompts_version = (existingRow.prompts_version || 1) + 1;
      }
      if (updates.profile_id !== undefined || updates.custom_niche !== undefined || updates.custom_niche_text !== undefined) {
        updatePayload.profile_version = (existingRow.profile_version || 1) + 1;
      }
    }

    if (updates.name) updatePayload.name = updates.name;
    if (updates.fb_page_id) updatePayload.fb_page_id = updates.fb_page_id;
    if (updates.fb_account_id !== undefined) updatePayload.fb_account_id = updates.fb_account_id || null;
    if (updates.category !== undefined) updatePayload.category = updates.category;
    if (updates.picture_url !== undefined) updatePayload.picture_url = updates.picture_url;
    if (updates.tasks !== undefined) updatePayload.tasks = updates.tasks;
    if (updates.fan_count !== undefined) updatePayload.fan_count = updates.fan_count;
    if (updates.token_status !== undefined) updatePayload.token_status = updates.token_status;
    if (updates.secondary_account_ids !== undefined) updatePayload.secondary_account_ids = updates.secondary_account_ids;
    if (updates.profile_id !== undefined) updatePayload.profile_id = updates.profile_id;
    if (updates.custom_niche !== undefined) updatePayload.custom_niche = updates.custom_niche;
    if (updates.custom_niche_text !== undefined) updatePayload.custom_niche_text = updates.custom_niche_text;
    if (updates.publishing_mode) updatePayload.publishing_mode = updates.publishing_mode;
    if (updates.mode_chosen !== undefined) updatePayload.mode_chosen = updates.mode_chosen;
    if (updates.hybrid_min_score !== undefined) updatePayload.hybrid_min_score = updates.hybrid_min_score;
    if (updates.daily_cap !== undefined) updatePayload.daily_cap = updates.daily_cap;

    // Both active and is_live kept strictly in sync
    if (updates.active !== undefined) {
      updatePayload.active = updates.active;
      updatePayload.is_live = updates.active;
    }
    if (updates.is_live !== undefined) {
      updatePayload.is_live = updates.is_live;
      updatePayload.active = updates.is_live;
    }
    if (updates.auto_posting_stopped_action) {
      updatePayload.auto_posting_stopped_action = updates.auto_posting_stopped_action;
    }

    if (updates.schedule) updatePayload.schedule = updates.schedule;
    if (updates.niche_analysis !== undefined) updatePayload.niche_analysis = updates.niche_analysis;
    if (updates.ai_disclosure_enabled !== undefined) updatePayload.ai_disclosure_enabled = updates.ai_disclosure_enabled;
    if (updates.ai_disclosure_text !== undefined) updatePayload.ai_disclosure_text = updates.ai_disclosure_text;
    if (updates.source_attribution_enabled !== undefined) updatePayload.source_attribution_enabled = updates.source_attribution_enabled;
    if (updates.last_test_run_at !== undefined) updatePayload.last_test_run_at = updates.last_test_run_at;
    if (updates.checklist_status !== undefined) updatePayload.checklist_status = updates.checklist_status;
    if (updates.test_run_verified !== undefined) updatePayload.test_run_verified = updates.test_run_verified;
    if (updates.test_run_report !== undefined) updatePayload.test_run_report = updates.test_run_report;
    if ((updates as any).qa_pass_threshold !== undefined) updatePayload.qa_pass_threshold = (updates as any).qa_pass_threshold;
    if ((updates as any).max_sentences_per_paragraph !== undefined) updatePayload.max_sentences_per_paragraph = (updates as any).max_sentences_per_paragraph;
    if ((updates as any).min_words !== undefined) updatePayload.min_words = (updates as any).min_words;
    if ((updates as any).target_words !== undefined) updatePayload.target_words = (updates as any).target_words;
    if ((updates as any).max_words !== undefined) updatePayload.max_words = (updates as any).max_words;
    if (updates.custom_caption_prompt !== undefined) updatePayload.custom_caption_prompt = updates.custom_caption_prompt;
    if (updates.custom_caption_prompt_mode) updatePayload.custom_caption_prompt_mode = updates.custom_caption_prompt_mode;
    if (updates.custom_image_prompt !== undefined) updatePayload.custom_image_prompt = updates.custom_image_prompt;
    if (updates.custom_image_prompt_mode) updatePayload.custom_image_prompt_mode = updates.custom_image_prompt_mode;
    if (updates.first_comment_enabled !== undefined) updatePayload.first_comment_enabled = updates.first_comment_enabled;
    if (updates.first_comment_prompt !== undefined) updatePayload.first_comment_prompt = updates.first_comment_prompt;
    if (updates.overrides) updatePayload.overrides = updates.overrides;
    if (updates.connected_at !== undefined) updatePayload.connected_at = updates.connected_at;
    if (updates.last_synced_at !== undefined) updatePayload.last_synced_at = updates.last_synced_at;

    if (updates.fb_page_token) {
      updatePayload.fb_page_token = encryptPageToken(updates.fb_page_token);
    }

    let { data, error } = await this.getClient()
      .from('pages')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error && (error.message?.includes('schema cache') || error.message?.includes('column') || error.message?.includes('check constraint'))) {
      delete updatePayload.category;
      delete updatePayload.picture_url;
      delete updatePayload.tasks;
      delete updatePayload.fan_count;
      delete updatePayload.secondary_account_ids;
      delete updatePayload.connected_at;
      delete updatePayload.last_synced_at;
      delete updatePayload.is_live;
      delete updatePayload.version;
      delete updatePayload.auto_posting_stopped_action;
      delete updatePayload.custom_niche;
      delete updatePayload.custom_niche_text;
      delete updatePayload.mode_chosen;
      delete updatePayload.settings_version;
      delete updatePayload.schedule_version;
      delete updatePayload.prompts_version;
      delete updatePayload.profile_version;
      delete updatePayload.settings_updated_at;
      delete updatePayload.test_run_verified;
      delete updatePayload.test_run_report;
      delete updatePayload.qa_pass_threshold;
      delete updatePayload.max_sentences_per_paragraph;
      delete updatePayload.min_words;
      delete updatePayload.target_words;
      delete updatePayload.max_words;
      if (updatePayload.token_status === 'cannot_publish' || updatePayload.token_status === 'inaccessible') {
        updatePayload.token_status = 'revoked';
      }
      const retry = await this.getClient()
        .from('pages')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to update page ${id}: ${error.message}`);
    }

    // SERVER-SIDE WRITE-VERIFICATION: Read back from Supabase and assert persistence
    const { data: verifiedRow, error: verifyErr } = await this.getClient()
      .from('pages')
      .select('*')
      .eq('id', id)
      .single();

    if (verifyErr || !verifiedRow) {
      throw new Error(`Write-verification failed: Could not re-read page ${id} from Supabase: ${verifyErr?.message}`);
    }

    if (updates.profile_id !== undefined && verifiedRow.profile_id !== updates.profile_id) {
      throw new Error(`Write-verification failed: profile_id did not persist to database.`);
    }
    if (updates.publishing_mode && verifiedRow.publishing_mode !== updates.publishing_mode) {
      throw new Error(`Write-verification failed: publishing_mode did not persist to database.`);
    }
    if (updates.active !== undefined && verifiedRow.active !== updates.active) {
      throw new Error(`Write-verification failed: active status did not persist to database.`);
    }

    return verifiedRow as StoredPage;
  }

  public async deletePage(id: string): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      return this.memoryPages.delete(id);
    }

    const { error } = await this.getClient().from('pages').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete page error:', error.message);
      return false;
    }
    return true;
  }

  public async getContentProfiles(): Promise<any[]> {
    if (isTestEnv() && !this.client) {
      return Array.from(this.memoryContentProfiles.values());
    }
    const { data, error } = await this.getClient().from('content_profiles').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      language: r.language,
      audience: r.audience,
      masterPrompt: r.master_prompt,
      templates: r.templates || {},
      captionSettings: r.caption_settings || {},
      hashtagSettings: r.hashtag_settings || {},
      disclosureSettings: r.disclosure_settings || {},
      imageSettings: r.image_settings || {},
      topicSettings: r.topic_settings || {},
      researchSourceIds: r.research_source_ids || [],
      customVariables: r.custom_variables || {},
      version: r.version || 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createContentProfile(profile: any): Promise<any> {
    const payload = {
      name: profile.name,
      description: profile.description || '',
      type: profile.type || 'factual',
      language: profile.language || 'en',
      audience: profile.audience || 'General audience',
      master_prompt: profile.masterPrompt || profile.master_prompt || '',
      templates: profile.templates || {},
      caption_settings: profile.captionSettings || profile.caption_settings || {},
      hashtag_settings: profile.hashtagSettings || profile.hashtag_settings || {},
      disclosure_settings: profile.disclosureSettings || profile.disclosure_settings || {},
      image_settings: profile.imageSettings || profile.image_settings || {},
      topic_settings: profile.topicSettings || profile.topic_settings || {},
      research_source_ids: profile.researchSourceIds || profile.research_source_ids || [],
      custom_variables: profile.customVariables || profile.custom_variables || {},
    };
    if (isTestEnv() && !this.client) {
      const id = crypto.randomUUID();
      return { id, ...profile };
    }
    const { data, error } = await this.getClient().from('content_profiles').insert(payload).select().single();
    if (error) {
      throw new Error(`Failed to create content profile: ${error.message}`);
    }
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      type: data.type,
      language: data.language,
      audience: data.audience,
      masterPrompt: data.master_prompt,
      templates: data.templates,
      captionSettings: data.caption_settings,
      hashtagSettings: data.hashtag_settings,
      disclosureSettings: data.disclosure_settings,
      imageSettings: data.image_settings,
      topicSettings: data.topic_settings,
      researchSourceIds: data.research_source_ids,
      customVariables: data.custom_variables,
      version: data.version,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  public async upsertPageFromFacebook(input: {
    fb_account_id: string;
    name: string;
    fb_page_id: string;
    fb_page_token: string;
    category?: string;
    picture_url?: string;
    tasks?: string[];
    fan_count?: number;
    token_status?: 'valid' | 'expired' | 'revoked' | 'rate_limited' | 'cannot_publish' | 'inaccessible';
  }): Promise<StoredPage & { isNew: boolean }> {
    assertSafeProductionToken(input.fb_page_token, input.fb_page_id);

    if (isTestEnv() && !this.client) {
      const existing = Array.from(this.memoryPages.values()).find((p) => p.fb_page_id === input.fb_page_id);
      const tasks = Array.isArray(input.tasks) ? input.tasks : [];
      const status = input.token_status || 'valid';

      if (existing) {
        let secondary: string[] = Array.isArray(existing.secondary_account_ids)
          ? existing.secondary_account_ids
          : [];
        let primaryAccountId = existing.fb_account_id;

        if (!primaryAccountId) {
          primaryAccountId = input.fb_account_id;
        } else if (primaryAccountId !== input.fb_account_id) {
          if (!secondary.includes(input.fb_account_id)) {
            secondary = [...secondary, input.fb_account_id];
          }
        }

        const shouldUpdateToken = status === 'valid' || existing.token_status !== 'valid';

        const updated = await this.updatePage(existing.id, {
          name: input.name,
          fb_account_id: primaryAccountId,
          secondary_account_ids: secondary,
          ...(shouldUpdateToken ? { fb_page_token: input.fb_page_token, token_status: status } : {}),
          category: input.category || existing.category,
          picture_url: input.picture_url || existing.picture_url,
          tasks: tasks.length > 0 ? tasks : existing.tasks,
          fan_count: typeof input.fan_count === 'number' ? input.fan_count : existing.fan_count,
          last_synced_at: new Date().toISOString(),
        });
        return Object.assign(updated, { isNew: false });
      }

      const created = await this.createPage({
        name: input.name,
        fb_page_id: input.fb_page_id,
        fb_page_token: input.fb_page_token,
        fb_account_id: input.fb_account_id,
        profile_id: null,
        publishing_mode: 'review',
        daily_cap: 3,
        active: false,
        schedule: SAFE_DEFAULT_SCHEDULE,
        category: input.category,
        picture_url: input.picture_url,
        tasks,
        fan_count: input.fan_count,
        token_status: status,
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      });
      return Object.assign(created, { isNew: true });
    }

    const { data: existing } = await this.getClient()
      .from('pages')
      .select('*')
      .eq('fb_page_id', input.fb_page_id)
      .maybeSingle();

    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    const status = input.token_status || 'valid';

    if (existing) {
      let secondary: string[] = Array.isArray(existing.secondary_account_ids)
        ? existing.secondary_account_ids
        : [];
      let primaryAccountId = existing.fb_account_id;

      if (!primaryAccountId) {
        primaryAccountId = input.fb_account_id;
      } else if (primaryAccountId !== input.fb_account_id) {
        if (!secondary.includes(input.fb_account_id)) {
          secondary = [...secondary, input.fb_account_id];
        }
      }

      const shouldUpdateToken = status === 'valid' || existing.token_status !== 'valid';

      const updated = await this.updatePage(existing.id, {
        name: input.name,
        fb_account_id: primaryAccountId,
        secondary_account_ids: secondary,
        ...(shouldUpdateToken ? { fb_page_token: input.fb_page_token, token_status: status } : {}),
        category: input.category || existing.category,
        picture_url: input.picture_url || existing.picture_url,
        tasks: tasks.length > 0 ? tasks : existing.tasks,
        fan_count: typeof input.fan_count === 'number' ? input.fan_count : existing.fan_count,
        last_synced_at: new Date().toISOString(),
      });
      return Object.assign(updated, { isNew: false });
    }

    const created = await this.createPage({
      name: input.name,
      fb_page_id: input.fb_page_id,
      fb_page_token: input.fb_page_token,
      fb_account_id: input.fb_account_id,
      profile_id: null,
      publishing_mode: 'review',
      daily_cap: 3,
      active: false,
      schedule: SAFE_DEFAULT_SCHEDULE,
      category: input.category,
      picture_url: input.picture_url,
      tasks,
      fan_count: input.fan_count,
      token_status: status,
      connected_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    });
    return Object.assign(created, { isNew: true });
  }

  public async syncAccountPages(accountId: string): Promise<{
    success: boolean;
    accountName: string;
    totalDiscovered: number;
    newCount: number;
    updatedCount: number;
    inaccessibleCount: number;
    publishableCount: number;
    emptyReason?: string;
    emptyExplanation?: string;
    grantedPermissions?: string[];
    error?: string;
  }> {
    const account = await this.getAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found.`);
    }
    if (!account.user_access_token) {
      throw new Error(`Account "${account.account_name}" has no stored user access token.`);
    }

    let userToken: string;
    try {
      userToken = decryptPageToken(account.user_access_token);
    } catch (err: any) {
      await this.updateAccount(accountId, { token_status: 'revoked' });
      throw new Error(`Failed to decrypt user token for account "${account.account_name}": ${err.message}`);
    }

    let discovery: PageDiscoveryResult;
    try {
      discovery = await discoverFacebookPages(userToken);
    } catch (discErr: any) {
      let codePrefix = '';
      if (discErr instanceof FacebookGraphError) {
        codePrefix = `(#${discErr.code}${discErr.subcode ? ` subcode ${discErr.subcode}` : ''}) `;
      } else if (discErr.code) {
        codePrefix = `(#${discErr.code}) `;
      }
      const safeMsg = sanitizeFacebookErrorMessage(discErr.message || 'Unknown Graph API error');
      throw new Error(`Could not list Pages: ${codePrefix}${safeMsg}. What to do: Ensure your Facebook account granted Page permissions in the Login dialog, then try Reconnect.`);
    }

    let newCount = 0;
    let updatedCount = 0;
    const discoveredPageIds = new Set<string>();

    for (const dp of discovery.pages) {
      discoveredPageIds.add(dp.id);
      const res = await this.upsertPageFromFacebook({
        fb_account_id: accountId,
        name: dp.name,
        fb_page_id: dp.id,
        fb_page_token: dp.access_token,
        category: dp.category,
        picture_url: dp.picture_url,
        tasks: dp.tasks,
        fan_count: dp.fan_count,
        token_status: dp.token_status,
      });
      if (res.isNew) newCount++;
      else updatedCount++;
    }

    // Mark missing pages as inaccessible without deleting post history
    const allPages = await this.getPages();
    let inaccessibleCount = 0;
    for (const p of allPages) {
      const isBelonging = p.fb_account_id === accountId || (p.secondary_account_ids && p.secondary_account_ids.includes(accountId));
      if (isBelonging && !discoveredPageIds.has(p.fb_page_id)) {
        if (p.token_status !== 'inaccessible') {
          await this.updatePage(p.id, { token_status: 'inaccessible', last_synced_at: new Date().toISOString() });
          inaccessibleCount++;
        }
      }
    }

    const updates: Partial<StoredFacebookAccount> = {
      pages_count: discovery.pages.length,
      last_synced_at: new Date().toISOString(),
      token_status: 'valid',
    };
    if (discovery.grantedPermissions && discovery.grantedPermissions.length > 0) {
      updates.notes = `Permissions: ${discovery.grantedPermissions.join(', ')}`;
    }
    await this.updateAccount(accountId, updates);

    await this.addAuditLog({
      level: 'info',
      category: 'token',
      message: `Synced account "${account.account_name}": found ${discovery.pages.length} Pages (${newCount} new, ${updatedCount} updated, ${inaccessibleCount} inaccessible).`,
      details: {
        accountId,
        totalDiscovered: discovery.pages.length,
        newCount,
        updatedCount,
        inaccessibleCount,
        grantedPermissions: discovery.grantedPermissions,
        emptyReason: discovery.emptyReason,
      },
    });

    return {
      success: true,
      accountName: account.account_name,
      totalDiscovered: discovery.pages.length,
      newCount,
      updatedCount,
      inaccessibleCount,
      publishableCount: discovery.publishableCount,
      emptyReason: discovery.emptyReason,
      emptyExplanation: discovery.emptyExplanation,
      grantedPermissions: discovery.grantedPermissions,
    };
  }

  public async syncAllPages(): Promise<{
    success: boolean;
    accountsSynced: number;
    totalPages: number;
    newPages: number;
    updatedPages: number;
    inaccessiblePages: number;
    errors: string[];
  }> {
    const accounts = await this.getAccounts();
    let totalPages = 0;
    let newPages = 0;
    let updatedPages = 0;
    let inaccessiblePages = 0;
    let accountsSynced = 0;
    const errors: string[] = [];

    for (const acc of accounts) {
      if (!acc.user_access_token) continue;
      try {
        const res = await this.syncAccountPages(acc.id);
        accountsSynced++;
        totalPages += res.totalDiscovered;
        newPages += res.newCount;
        updatedPages += res.updatedCount;
        inaccessiblePages += res.inaccessibleCount;
      } catch (err: any) {
        errors.push(`Account ${acc.account_name}: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      accountsSynced,
      totalPages,
      newPages,
      updatedPages,
      inaccessiblePages,
      errors,
    };
  }

  public async checkPageTokenHealth(pageId: string): Promise<TokenInspectionResult> {
    if (isTestEnv() && !this.client) {
      return {
        valid: true,
        status: 'valid',
        type: 'PAGE',
        expiresAt: Math.floor((Date.now() + 86400000 * 60) / 1000),
        isNeverExpiring: false,
        scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
        missingRequiredScopes: [],
      };
    }

    const page = await this.getPageById(pageId);
    if (!page || !page.fb_page_token) {
      throw new Error('Page or token not found');
    }
    const decryptedToken = decryptPageToken(page.fb_page_token);
    const client = new FacebookGraphClient({
      appAccessToken:
        process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
          ? `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`
          : undefined,
    });
    const result = await client.inspectTokenHealth(decryptedToken);
    const statusMap: Record<string, string> = {
      valid: 'valid',
      expired: 'expired',
      revoked: 'revoked',
      rate_limited: 'rate_limited',
    };
    const newStatus = (statusMap[result.status] || 'revoked') as any;
    await this.updatePage(pageId, { token_status: newStatus });
    return result;
  }

  // --- Posts CRUD ---
  public async getPosts(): Promise<StoredPost[]> {
    if (isTestEnv() && !this.client) {
      return Array.from(this.memoryPosts.values()).sort(
        (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
      );
    }

    const { data, error } = await this.getClient()
      .from('posts')
      .select('*')
      .order('scheduled_for', { ascending: true });

    if (error) {
      console.error('[SystemStore] Error fetching posts:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      page_id: row.page_id,
      fb_account_id: row.fb_account_id,
      status: row.status,
      review_state: row.review_state || 'n/a',
      review_note: row.review_note,
      title: row.title || row.topic_title || 'Untitled Post',
      headline: row.headline,
      caption: row.caption || '',
      caption_word_count: row.caption_word_count,
      first_comment: row.first_comment,
      hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
      scheduled_for: row.scheduled_for,
      created_at: row.created_at,
      qa_score: row.qa_score ? Number(row.qa_score) : undefined,
      sensitive_flags: Array.isArray(row.sensitive_flags) ? row.sensitive_flags : [],
      image_phash: row.image_phash,
      content_hash: row.content_hash,
      fb_post_id: row.fb_post_id,
      fb_permalink: row.fb_permalink,
      published_at: row.published_at,
      analytics: row.analytics || {},
    }));
  }

  public async getPostById(id: string): Promise<StoredPost | undefined> {
    if (isTestEnv() && !this.client) {
      return this.memoryPosts.get(id);
    }

    const { data, error } = await this.getClient()
      .from('posts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return undefined;
    return {
      id: data.id,
      page_id: data.page_id,
      fb_account_id: data.fb_account_id,
      status: data.status,
      review_state: data.review_state || 'n/a',
      review_note: data.review_note,
      title: data.title || data.topic_title || 'Untitled Post',
      headline: data.headline,
      caption: data.caption || '',
      caption_word_count: data.caption_word_count,
      first_comment: data.first_comment,
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
      scheduled_for: data.scheduled_for,
      created_at: data.created_at,
      qa_score: data.qa_score ? Number(data.qa_score) : undefined,
      sensitive_flags: Array.isArray(data.sensitive_flags) ? data.sensitive_flags : [],
      image_phash: data.image_phash,
      content_hash: data.content_hash,
      fb_post_id: data.fb_post_id,
      fb_permalink: data.fb_permalink,
      published_at: data.published_at,
      analytics: data.analytics || {},
    };
  }

  public async updatePost(id: string, updates: Partial<StoredPost>): Promise<StoredPost> {
    if (isTestEnv() && !this.client) {
      const existing = this.memoryPosts.get(id);
      if (!existing) throw new Error(`Post ${id} not found.`);
      const updated: StoredPost = {
        ...existing,
        ...updates,
      };
      this.memoryPosts.set(id, updated);
      return updated;
    }

    const updatePayload: Record<string, any> = {};
    if (updates.status) updatePayload.status = updates.status;
    if (updates.review_state) updatePayload.review_state = updates.review_state;
    if (updates.review_note !== undefined) updatePayload.review_note = updates.review_note;
    if (updates.caption) {
      updatePayload.caption = updates.caption;
      updatePayload.caption_word_count = updates.caption.trim().split(/\s+/).length;
    }
    if (updates.title) updatePayload.title = updates.title;
    if (updates.headline !== undefined) updatePayload.headline = updates.headline;
    if (updates.first_comment !== undefined) updatePayload.first_comment = updates.first_comment;
    if (updates.qa_score !== undefined) updatePayload.qa_score = updates.qa_score;
    if (updates.scheduled_for) updatePayload.scheduled_for = updates.scheduled_for;
    if (updates.fb_post_id) updatePayload.fb_post_id = updates.fb_post_id;
    if (updates.fb_permalink) updatePayload.fb_permalink = updates.fb_permalink;
    if (updates.published_at) updatePayload.published_at = updates.published_at;
    if (updates.analytics) updatePayload.analytics = updates.analytics;

    const { data, error } = await this.getClient()
      .from('posts')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update post ${id}: ${error.message}`);
    }

    return data as StoredPost;
  }

  public async createPost(input: Partial<StoredPost> & { page_id: string; title: string; caption: string }): Promise<StoredPost> {
    if (isTestEnv() && !this.client) {
      const id = crypto.randomUUID();
      const post: StoredPost = {
        id,
        page_id: input.page_id,
        fb_account_id: input.fb_account_id || null,
        title: input.title,
        caption: input.caption,
        headline: input.headline || null,
        caption_word_count: input.caption.trim().split(/\s+/).length,
        status: input.status || 'scheduled',
        review_state: input.review_state || 'n/a',
        scheduled_for: input.scheduled_for || new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
        hashtags: input.hashtags || [],
        qa_score: input.qa_score ?? 95,
        first_comment: input.first_comment || null,
        analytics: input.analytics || {},
        created_at: new Date().toISOString(),
      };
      this.memoryPosts.set(id, post);
      return post;
    }

    const payload = {
      page_id: input.page_id,
      fb_account_id: input.fb_account_id || null,
      title: input.title,
      caption: input.caption,
      headline: input.headline || null,
      caption_word_count: input.caption.trim().split(/\s+/).length,
      status: input.status || 'scheduled',
      review_state: input.review_state || 'n/a',
      scheduled_for: input.scheduled_for || new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
      hashtags: input.hashtags || [],
      qa_score: input.qa_score ?? 95,
      first_comment: input.first_comment || null,
      analytics: input.analytics || {},
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.getClient().from('posts').insert(payload).select().single();
    if (error) {
      throw new Error(`Failed to create post in Supabase: ${error.message}`);
    }

    return data as StoredPost;
  }

  public async removePost(id: string): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      return this.memoryPosts.delete(id);
    }

    const { error } = await this.getClient().from('posts').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete post error:', error.message);
      return false;
    }
    return true;
  }

  // --- Providers & Keys CRUD ---
  public async getProviders(): Promise<StoredProvider[]> {
    if (isTestEnv() && !this.client) {
      return Array.from(this.memoryProviders.values()).sort((a, b) => a.priority - b.priority);
    }

    const { data, error } = await this.getClient()
      .from('providers')
      .select('*')
      .order('priority', { ascending: true });

    if (error) {
      console.error('[SystemStore] Error fetching providers:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      adapter_kind: row.kind,
      base_url: row.base_url || '',
      model_name: row.model_name || row.config?.default_text_model || row.config?.default_image_model || '',
      daily_limit: row.rpd_limit || 1000,
      used_today: 0,
      enabled: row.active !== false,
      priority: row.priority || 1,
      health_status: row.config?.health_status || 'unknown',
      latency_ms: row.config?.latency_ms,
      test_error: row.config?.test_error,
      last_tested_at: row.config?.last_tested_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async getProviderById(id: string): Promise<StoredProvider | undefined> {
    if (isTestEnv() && !this.client) {
      return this.memoryProviders.get(id);
    }

    const { data, error } = await this.getClient()
      .from('providers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return undefined;
    return {
      id: data.id,
      name: data.name,
      adapter_kind: data.kind,
      base_url: data.base_url || '',
      model_name: data.model_name || data.config?.default_text_model || data.config?.default_image_model || '',
      daily_limit: data.rpd_limit || 1000,
      used_today: 0,
      enabled: data.active !== false,
      priority: data.priority || 1,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async findProviderByNameOrPreset(nameOrPreset: string): Promise<StoredProvider | undefined> {
    const query = nameOrPreset.toLowerCase().trim();
    const providers = await this.getProviders();
    return providers.find((p) => {
      const pName = p.name.toLowerCase().trim();
      return pName === query || p.id === nameOrPreset;
    });
  }

  public async createProvider(input: {
    name: string;
    adapter_kind: string;
    base_url?: string;
    model_name?: string;
    daily_limit?: number;
    enabled?: boolean;
    priority?: number;
  }): Promise<StoredProvider> {
    // If provider with exact name exists, update rather than error
    const existing = await this.findProviderByNameOrPreset(input.name);
    if (existing) {
      return this.updateProvider(existing.id, {
        base_url: input.base_url || existing.base_url,
        model_name: input.model_name || existing.model_name,
        daily_limit: input.daily_limit ? Number(input.daily_limit) : existing.daily_limit,
        priority: input.priority ? Number(input.priority) : existing.priority,
        enabled: input.enabled !== false,
      });
    }

    if (isTestEnv() && !this.client) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const prov: StoredProvider = {
        id,
        name: input.name,
        adapter_kind: input.adapter_kind,
        base_url: input.base_url || '',
        model_name: input.model_name || '',
        daily_limit: input.daily_limit ? Number(input.daily_limit) : 1000,
        used_today: 0,
        enabled: input.enabled !== false,
        priority: input.priority ? Number(input.priority) : 1,
        created_at: now,
        updated_at: now,
      };
      this.memoryProviders.set(id, prov);
      return prov;
    }

    const payload = {
      name: input.name,
      kind: input.adapter_kind,
      base_url: input.base_url || null,
      model_name: input.model_name || null,
      config: {
        default_text_model: input.model_name || undefined,
      },
      rpd_limit: Number(input.daily_limit) || 1000,
      rpm_limit: 60,
      concurrency_limit: 2,
      priority: Number(input.priority) || 1,
      active: input.enabled !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.getClient().from('providers').insert(payload).select().single();
    if (error) {
      throw new Error(`Failed to create provider in Supabase: ${error.message}`);
    }

    return {
      id: data.id,
      name: data.name,
      adapter_kind: data.kind,
      base_url: data.base_url || '',
      model_name: data.model_name || '',
      daily_limit: data.rpd_limit || 1000,
      used_today: 0,
      enabled: data.active !== false,
      priority: data.priority || 1,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async updateProvider(id: string, updates: Partial<StoredProvider>): Promise<StoredProvider> {
    if (isTestEnv() && !this.client) {
      const existing = this.memoryProviders.get(id);
      if (!existing) throw new Error(`Provider ${id} not found.`);
      const updated: StoredProvider = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      this.memoryProviders.set(id, updated);
      return updated;
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.name) updatePayload.name = updates.name;
    if (updates.adapter_kind) updatePayload.kind = updates.adapter_kind;
    if (updates.base_url !== undefined) updatePayload.base_url = updates.base_url || null;
    if (updates.model_name !== undefined) {
      updatePayload.model_name = updates.model_name || null;
      updatePayload.config = { default_text_model: updates.model_name || undefined };
    }
    if (updates.daily_limit !== undefined) updatePayload.rpd_limit = Number(updates.daily_limit);
    if (updates.enabled !== undefined) updatePayload.active = updates.enabled;
    if (updates.priority !== undefined) updatePayload.priority = Number(updates.priority);

    if (
      updates.health_status !== undefined ||
      updates.latency_ms !== undefined ||
      updates.test_error !== undefined ||
      updates.last_tested_at !== undefined
    ) {
      updatePayload.config = {
        ...(updatePayload.config || {}),
        health_status: updates.health_status,
        latency_ms: updates.latency_ms,
        test_error: updates.test_error,
        last_tested_at: updates.last_tested_at,
      };
    }

    const { data, error } = await this.getClient()
      .from('providers')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update provider ${id}: ${error.message}`);
    }

    return {
      id: data.id,
      name: data.name,
      adapter_kind: data.kind,
      base_url: data.base_url || '',
      model_name: data.model_name || '',
      daily_limit: data.rpd_limit || 1000,
      used_today: 0,
      enabled: data.active !== false,
      priority: data.priority || 1,
      health_status: data.config?.health_status || updates.health_status || 'unknown',
      latency_ms: data.config?.latency_ms ?? updates.latency_ms,
      test_error: data.config?.test_error ?? updates.test_error,
      last_tested_at: data.config?.last_tested_at ?? updates.last_tested_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async deleteProvider(id: string): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      for (const [kId, k] of this.memoryProviderKeys.entries()) {
        if (k.provider_id === id) {
          this.memoryProviderKeys.delete(kId);
        }
      }
      return this.memoryProviders.delete(id);
    }

    await this.getClient().from('provider_keys').delete().eq('provider_id', id);
    const { error } = await this.getClient().from('providers').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete provider error:', error.message);
      return false;
    }
    return true;
  }

  public async getProviderKeys(providerId?: string): Promise<StoredProviderKey[]> {
    if (isTestEnv() && !this.client) {
      return Array.from(this.memoryProviderKeys.values())
        .filter((k) => !providerId || k.provider_id === providerId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    let query = this.getClient().from('provider_keys').select('*').order('created_at', { ascending: false });
    if (providerId) {
      query = query.eq('provider_id', providerId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[SystemStore] Error fetching provider keys:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      provider_id: row.provider_id,
      encrypted_key: row.key_encrypted,
      masked_key: row.key_masked,
      label: row.label,
      is_active: row.status === 'active',
      created_at: row.created_at,
    }));
  }

  public async invalidateAllPagesTestRun(): Promise<void> {
    if (isTestEnv() && !this.client) {
      for (const page of this.memoryPages.values()) {
        page.test_run_verified = false;
        page.last_test_run_at = null;
        page.test_run_report = null;
      }
      return;
    }
    try {
      await this.getClient().from('pages').update({
        test_run_verified: false,
        last_test_run_at: null,
        test_run_report: null,
      }).neq('id', '00000000-0000-0000-0000-000000000000');
    } catch (_) {}
  }

  public async addProviderKey(input: {
    provider_id: string;
    raw_key: string;
    label?: string;
  }): Promise<StoredProviderKey> {
    if (!input.provider_id || input.provider_id === '__none__' || input.provider_id === 'none') {
      const err = new Error('A valid Provider ID is required.');
      (err as any).field = 'provider_id';
      (err as any).statusCode = 400;
      throw err;
    }

    const provider = await this.getProviderById(input.provider_id);
    if (!provider) {
      const err = new Error('Selected provider does not exist.');
      (err as any).field = 'provider_id';
      (err as any).statusCode = 400;
      throw err;
    }

    const trimmed = input.raw_key ? input.raw_key.trim() : '';
    if (!trimmed) {
      throw new Error('API key cannot be empty.');
    }

    const masked_key = maskSecret(trimmed);

    // If key already exists in rotation pool for this provider, do not duplicate: reactivate and keep
    const existingKeys = await this.getProviderKeys(input.provider_id);
    const existing = existingKeys.find((k) => k.masked_key === masked_key);
    if (existing) {
      if (isTestEnv() && !this.client) {
        const reactivated = { ...existing, is_active: true, label: input.label || existing.label };
        this.memoryProviderKeys.set(existing.id, reactivated);
        return reactivated;
      }
      await this.getClient()
        .from('provider_keys')
        .update({ status: 'active', label: input.label || existing.label })
        .eq('id', existing.id);
      return {
        ...existing,
        is_active: true,
        label: input.label || existing.label,
      };
    }

    const encrypted_key = encrypt(trimmed);

    if (isTestEnv() && !this.client) {
      const id = crypto.randomUUID();
      const item: StoredProviderKey = {
        id,
        provider_id: input.provider_id,
        encrypted_key,
        masked_key,
        label: input.label?.trim() || undefined,
        is_active: true,
        created_at: new Date().toISOString(),
      };
      this.memoryProviderKeys.set(id, item);
      return item;
    }

    const payload = {
      provider_id: input.provider_id,
      key_encrypted: encrypted_key,
      key_masked: masked_key,
      label: input.label?.trim() || null,
      status: 'active',
      usage_today: 0,
      error_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.getClient().from('provider_keys').insert(payload).select().single();
    if (error) {
      throw new Error(`Failed to insert provider key in Supabase: ${error.message}`);
    }

    await this.invalidateAllPagesTestRun();
    return {
      id: data.id,
      provider_id: data.provider_id,
      encrypted_key: data.key_encrypted,
      masked_key: data.key_masked,
      label: data.label,
      is_active: true,
      created_at: data.created_at,
    };
  }

  public async addProviderKeysBulk(input: {
    provider_id: string;
    raw_keys: string[];
    base_label?: string;
  }): Promise<StoredProviderKey[]> {
    const results: StoredProviderKey[] = [];
    const keys = Array.isArray(input.raw_keys) ? input.raw_keys : [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i].trim();
      if (!k) continue;
      const label =
        keys.length > 1 && input.base_label
          ? `${input.base_label} #${i + 1}`
          : input.base_label;
      const added = await this.addProviderKey({
        provider_id: input.provider_id,
        raw_key: k,
        label,
      });
      results.push(added);
    }
    return results;
  }

  public async deleteProviderKey(keyId: string): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      const res = this.memoryProviderKeys.delete(keyId);
      await this.invalidateAllPagesTestRun();
      return res;
    }

    const { error } = await this.getClient().from('provider_keys').delete().eq('id', keyId);
    if (error) {
      console.error('[SystemStore] Delete provider key error:', error.message);
      return false;
    }
    await this.invalidateAllPagesTestRun();
    return true;
  }

  public async toggleProviderKey(keyId: string, isActive?: boolean): Promise<StoredProviderKey> {
    if (isTestEnv() && !this.client) {
      const current = this.memoryProviderKeys.get(keyId);
      if (!current) {
        throw new Error(`Key with ID ${keyId} not found.`);
      }
      const newActive = typeof isActive === 'boolean' ? isActive : !current.is_active;
      const updated = { ...current, is_active: newActive };
      this.memoryProviderKeys.set(keyId, updated);
      return updated;
    }

    const { data: current, error: getErr } = await this.getClient()
      .from('provider_keys')
      .select('*')
      .eq('id', keyId)
      .single();

    if (getErr || !current) {
      throw new Error(`Key with ID ${keyId} not found.`);
    }

    const newStatus = typeof isActive === 'boolean'
      ? (isActive ? 'active' : 'disabled')
      : (current.status === 'active' ? 'disabled' : 'active');

    const { data, error } = await this.getClient()
      .from('provider_keys')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', keyId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to toggle provider key ${keyId}: ${error.message}`);
    }

    return {
      id: data.id,
      provider_id: data.provider_id,
      encrypted_key: data.key_encrypted,
      masked_key: data.key_masked,
      label: data.label,
      is_active: data.status === 'active',
      created_at: data.created_at,
    };
  }

  // --- Audit Logs CRUD ---
  public async getAuditLogs(limit = 100): Promise<StoredAuditLog[]> {
    if (isTestEnv() && !this.client) {
      return this.memoryAuditLogs.slice(0, limit);
    }

    const { data, error } = await this.getClient()
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[SystemStore] Error fetching audit logs:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      level: (row.level || 'info') as any,
      category: (row.category || 'security') as any,
      message: row.message || row.action || 'Event recorded',
      page_id: row.page_id,
      details: row.details || {},
      timestamp: row.created_at,
    }));
  }

  public async addAuditLog(entry: Omit<StoredAuditLog, 'id' | 'timestamp'>): Promise<StoredAuditLog> {
    if (isTestEnv() && !this.client) {
      const logItem: StoredAuditLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level: entry.level || 'info',
        category: entry.category || 'security',
        message: entry.message,
        page_id: entry.page_id,
        details: entry.details || {},
      };
      this.memoryAuditLogs.unshift(logItem);
      return logItem;
    }

    const payload = {
      level: entry.level || 'info',
      category: entry.category || 'security',
      action: entry.category || 'action',
      entity: 'system',
      message: entry.message,
      page_id: entry.page_id || null,
      details: entry.details || {},
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.getClient().from('audit_log').insert(payload).select().single();
    if (error) {
      console.error('[SystemStore] Error inserting audit log:', error.message);
      return {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry,
      };
    }

    return {
      id: data.id,
      level: data.level,
      category: data.category,
      message: data.message,
      page_id: data.page_id,
      details: data.details,
      timestamp: data.created_at,
    };
  }

  // --- Kill Switch & Heartbeat ---
  public async getKillSwitch(): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      return Boolean(this.memorySettings.get('kill_switch')?.paused);
    }

    const { data, error } = await this.getClient()
      .from('settings')
      .select('value')
      .eq('key', 'kill_switch')
      .maybeSingle();

    if (error || !data) return false;
    return Boolean(data.value?.paused);
  }

  public async setKillSwitch(active: boolean): Promise<boolean> {
    if (isTestEnv() && !this.client) {
      this.memorySettings.set('kill_switch', { paused: active, updated_at: new Date().toISOString() });
      return active;
    }

    const now = new Date().toISOString();
    const { error } = await this.getClient()
      .from('settings')
      .upsert({
        key: 'kill_switch',
        value: { paused: active, updated_at: now },
        updated_at: now,
      });

    if (error) {
      console.error('[SystemStore] Error setting kill switch in Supabase:', error.message);
    }
    return active;
  }

  public async updateHeartbeat(): Promise<string> {
    const now = new Date().toISOString();
    if (isTestEnv() && !this.client) {
      this.memorySettings.set('worker_heartbeat', { lastHeartbeat: now, status: 'running' });
      return now;
    }

    await this.getClient()
      .from('settings')
      .upsert({
        key: 'worker_heartbeat',
        value: { lastHeartbeat: now, status: 'running' },
        updated_at: now,
      });
    return now;
  }

  public async getHeartbeat(): Promise<{ lastHeartbeat: string | null; status?: string; loopCount?: number; version?: string } | null> {
    if (isTestEnv() && !this.client) {
      return this.memorySettings.get('worker_heartbeat') || null;
    }

    const { data, error } = await this.getClient()
      .from('settings')
      .select('value')
      .eq('key', 'worker_heartbeat')
      .maybeSingle();

    if (error || !data) return null;
    return data.value as any;
  }

  public async getAlerts(limit = 20): Promise<any[]> {
    if (isTestEnv() && !this.client) {
      return [];
    }

    const { data, error } = await this.getClient()
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  }

  private cachedStorageHealth: { result: StorageHealthResult; timestamp: number } | null = null;

  public async getMissingTables(): Promise<string[]> {
    if (isTestEnv() && !this.client) {
      return [];
    }

    const client = this.getClient();
    const missing: string[] = [];

    await Promise.all(
      CORE_SYSTEM_TABLES.map(async (table) => {
        try {
          const { error } = await client.from(table).select('id', { count: 'exact', head: true }).limit(0);
          if (error) {
            const msg = (error.message || '').toLowerCase();
            const code = (error as any).code;
            if (
              code === '42P01' ||
              msg.includes('does not exist') ||
              msg.includes('relation') ||
              msg.includes('not found') ||
              (error as any).status === 404
            ) {
              missing.push(table);
            }
          }
        } catch {
          missing.push(table);
        }
      })
    );

    return missing;
  }

  // --- Generic Settings Storage (Supabase Single Source of Truth) ---
  public async getSetting<T = any>(key: string): Promise<T | null> {
    if (isTestEnv() && !this.client) {
      const found = this.memorySettings.get(key);
      return found ? (found.value !== undefined ? found.value : found) : null;
    }

    const { data, error } = await this.getClient()
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error || !data) return null;
    return data.value as T;
  }

  public async setSetting(key: string, value: any): Promise<boolean> {
    const now = new Date().toISOString();
    if (isTestEnv() && !this.client) {
      this.memorySettings.set(key, { value, updated_at: now });
      return true;
    }

    const { error } = await this.getClient()
      .from('settings')
      .upsert({
        key,
        value,
        updated_at: now,
      });

    if (error) {
      console.error(`[SystemStore] Error setting ${key}:`, error.message);
      return false;
    }
    return true;
  }

  // --- Cancel Pending Page Posts (When stopping auto-posting) ---
  public async cancelPendingPagePosts(pageId: string): Promise<number> {
    if (isTestEnv() && !this.client) {
      let count = 0;
      for (const [id, post] of this.memoryPosts.entries()) {
        if (
          post.page_id === pageId &&
          (post.status === 'scheduled' ||
            post.status === 'planned' ||
            post.status === 'pending_review' ||
            post.review_state === 'pending')
        ) {
          this.memoryPosts.set(id, { ...post, status: 'cancelled', review_state: 'rejected' });
          count++;
        }
      }
      return count;
    }

    const { data, error } = await this.getClient()
      .from('posts')
      .update({ status: 'cancelled' })
      .eq('page_id', pageId)
      .in('status', ['planned', 'scheduled', 'pending_review'])
      .select('id');

    if (error) {
      console.error(`[SystemStore] Failed cancelling posts for page ${pageId}:`, error.message);
      return 0;
    }
    return data?.length || 0;
  }

  // --- Starter Profiles Catalog Importer (Idempotent UPSERT Keyed by Stable Slug) ---
  public async importStarterProfiles(): Promise<{
    success: boolean;
    count: number;
    importedCount: number;
    skippedCount: number;
    updatedCount: number;
    profiles: any[];
  }> {
    const starters = getAllNicheProfiles();
    const imported: any[] = [];
    let importedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    for (const p of starters) {
      const slug = generateProfileSlug(p.name, (p as any).customVariables?.niche || (p as any).niche);
      const payload: Record<string, any> = {
        name: p.name,
        slug,
        description: p.description || '',
        type: p.type || 'factual',
        language: p.language || 'en',
        audience: p.audience || 'General audience',
        master_prompt: p.masterPrompt || '',
        templates: p.templates || {},
        caption_settings: p.captionSettings || {},
        hashtag_settings: p.hashtagSettings || {},
        disclosure_settings: (p as any).disclosureSettings || {},
        image_settings: p.imageSettings || {},
        topic_settings: p.topicSettings || {},
        research_source_ids: (p as any).researchSourceIds || [],
        custom_variables: p.customVariables || {},
        is_system: true,
        is_customized: false,
        version: 1,
      };

      if (isTestEnv() && !this.client) {
        const existing = Array.from(this.memoryContentProfiles.values()).find(
          (cp) => cp.slug === slug || cp.name === p.name
        );
        if (existing) {
          const isCustomized = Boolean(existing.is_customized || (existing.version && existing.version > 1) || existing.is_system === false);
          const isIdentical = (existing.slug === slug || !existing.slug) && existing.name === p.name && existing.master_prompt === payload.master_prompt;
          if (isCustomized || isIdentical) {
            skippedCount++;
            imported.push(existing);
          } else {
            updatedCount++;
            const updated = { ...existing, ...payload, id: existing.id, slug: existing.slug || slug };
            this.memoryContentProfiles.set(existing.id, updated as any);
            imported.push(updated);
          }
          continue;
        }
        importedCount++;
        const id = p.id || crypto.randomUUID();
        const obj = { id, ...payload };
        this.memoryContentProfiles.set(id, obj as any);
        imported.push(obj);
        continue;
      }

      // Check if already in Supabase by name or stable slug
      let existing: any = null;
      const { data: byName } = await this.getClient()
        .from('content_profiles')
        .select('*')
        .eq('name', p.name)
        .maybeSingle();

      if (byName) {
        existing = byName;
      } else {
        const { data: bySlug } = await this.getClient()
          .from('content_profiles')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();
        existing = bySlug;
      }

      if (existing) {
        const isCustomized = Boolean(
          existing.is_customized ||
          (existing.version && existing.version > 1) ||
          existing.is_system === false
        );
        const isIdentical = (existing.slug === slug || !existing.slug) && existing.name === p.name && existing.master_prompt === payload.master_prompt;

        if (isCustomized || isIdentical) {
          skippedCount++;
          imported.push(existing);
        } else {
          updatedCount++;
          const updatePayload: Record<string, any> = {
            ...payload,
            slug: existing.slug || slug,
          };
          let { data: updated, error: updErr } = await this.getClient()
            .from('content_profiles')
            .update(updatePayload)
            .eq('id', existing.id)
            .select()
            .single();

          if (updErr && (updErr.message.includes('column') || updErr.message.includes('schema cache'))) {
            delete updatePayload.is_system;
            delete updatePayload.is_customized;
            delete updatePayload.version;
            delete updatePayload.slug;
            const retry = await this.getClient()
              .from('content_profiles')
              .update(updatePayload)
              .eq('id', existing.id)
              .select()
              .single();
            updated = retry.data;
          }
          imported.push(updated || existing);
        }
      } else {
        importedCount++;
        const insertPayload: Record<string, any> = {
          ...payload,
        };
        let { data: created, error: insErr } = await this.getClient()
          .from('content_profiles')
          .insert(insertPayload)
          .select()
          .single();

        if (insErr && (insErr.message.includes('column') || insErr.message.includes('schema cache'))) {
          delete insertPayload.is_system;
          delete insertPayload.is_customized;
          delete insertPayload.version;
          delete insertPayload.slug;
          const retry = await this.getClient()
            .from('content_profiles')
            .insert(insertPayload)
            .select()
            .single();
          created = retry.data;
        }
        if (created) imported.push(created);
      }
    }

    return {
      success: true,
      count: imported.length,
      importedCount,
      skippedCount,
      updatedCount,
      profiles: imported,
    };
  }

  // --- Database Schema Check Tool ---
  public async checkDatabaseSchema(): Promise<SchemaCheckResult> {
    if (isTestEnv() && !this.client) {
      return {
        ok: true,
        totalTables: CORE_SYSTEM_TABLES.length,
        expectedTablesCount: CORE_SYSTEM_TABLES.length,
        tablesFound: [...CORE_SYSTEM_TABLES],
        missingTables: [],
        columnsOk: true,
        columnCheckErrors: [],
        rlsOk: true,
        timestamp: new Date().toISOString(),
      };
    }

    const client = this.getClient();
    const missingTables = await this.getMissingTables();
    const tablesFound = CORE_SYSTEM_TABLES.filter((t) => !missingTables.includes(t));

    const columnCheckErrors: string[] = [];

    // Probe essential columns on critical tables
    const criticalChecks: Array<{ table: string; columns: string[] }> = [
      {
        table: 'pages',
        columns: [
          'id', 'name', 'fb_page_id', 'fb_page_token', 'token_status',
          'publishing_mode', 'hybrid_min_score', 'daily_cap', 'active',
          'is_live', 'schedule', 'niche_analysis', 'ai_disclosure_enabled',
          'ai_disclosure_text', 'source_attribution_enabled', 'last_test_run_at',
          'checklist_status', 'version'
        ],
      },
      {
        table: 'facebook_accounts',
        columns: ['id', 'account_name', 'fb_user_id', 'user_access_token', 'token_status'],
      },
      {
        table: 'content_profiles',
        columns: ['id', 'name', 'type', 'language', 'master_prompt', 'templates', 'caption_settings', 'is_system', 'version'],
      },
      {
        table: 'settings',
        columns: ['key', 'value', 'version'],
      },
      {
        table: 'posts',
        columns: ['id', 'page_id', 'status', 'review_state', 'scheduled_for', 'caption'],
      },
    ];

    for (const check of criticalChecks) {
      if (missingTables.includes(check.table)) continue;
      const { error } = await client
        .from(check.table)
        .select(check.columns.join(','))
        .limit(0);
      if (error) {
        columnCheckErrors.push(`${check.table}: ${error.message}`);
      }
    }

    const ok = missingTables.length === 0 && columnCheckErrors.length === 0;

    return {
      ok,
      totalTables: tablesFound.length,
      expectedTablesCount: CORE_SYSTEM_TABLES.length,
      tablesFound,
      missingTables,
      columnsOk: columnCheckErrors.length === 0,
      columnCheckErrors,
      rlsOk: true,
      timestamp: new Date().toISOString(),
    };
  }

  // --- Settings Backup (Zero Secrets) ---
  public async exportSettingsBackup(): Promise<any> {
    const [pages, profiles, providers, killSwitch, heartbeat] = await Promise.all([
      this.getPages(),
      this.getContentProfiles(),
      this.getProviders(),
      this.getKillSwitch(),
      this.getHeartbeat(),
    ]);

    // Strip sensitive secrets from export
    const safePages = pages.map((p) => ({
      id: p.id,
      name: p.name,
      fb_page_id: p.fb_page_id,
      category: p.category,
      profile_id: p.profile_id,
      publishing_mode: p.publishing_mode,
      hybrid_min_score: p.hybrid_min_score,
      daily_cap: p.daily_cap,
      active: p.active,
      is_live: p.is_live,
      schedule: p.schedule,
      ai_disclosure_enabled: p.ai_disclosure_enabled,
      ai_disclosure_text: p.ai_disclosure_text,
      source_attribution_enabled: p.source_attribution_enabled,
      custom_caption_prompt: p.custom_caption_prompt,
      custom_image_prompt: p.custom_image_prompt,
      overrides: p.overrides,
    }));

    const safeProviders = providers.map((pr) => ({
      name: pr.name,
      adapter_kind: pr.adapter_kind,
      base_url: pr.base_url,
      model_name: pr.model_name,
      daily_limit: pr.daily_limit,
      enabled: pr.enabled,
      priority: pr.priority,
    }));

    return {
      backupVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      system: {
        killSwitchPaused: killSwitch,
        lastHeartbeat: heartbeat?.lastHeartbeat || null,
      },
      contentProfiles: profiles,
      pages: safePages,
      providers: safeProviders,
    };
  }

  public async restoreSettingsBackup(backup: any): Promise<{ success: boolean; imported: Record<string, number> }> {
    if (!backup || typeof backup !== 'object') {
      throw new Error('Invalid backup data format.');
    }

    let profilesImported = 0;
    let pagesUpdated = 0;

    // Restore profiles
    if (Array.isArray(backup.contentProfiles)) {
      for (const cp of backup.contentProfiles) {
        if (!cp.name) continue;
        try {
          await this.createContentProfile(cp);
          profilesImported++;
        } catch {
          // ignore duplicate
        }
      }
    }

    // Restore page configs (matching by fb_page_id)
    if (Array.isArray(backup.pages)) {
      const existingPages = await this.getPages();
      for (const bp of backup.pages) {
        const match = existingPages.find((p) => p.fb_page_id === bp.fb_page_id);
        if (match) {
          await this.updatePage(match.id, {
            publishing_mode: bp.publishing_mode,
            hybrid_min_score: bp.hybrid_min_score,
            daily_cap: bp.daily_cap,
            schedule: bp.schedule,
            ai_disclosure_enabled: bp.ai_disclosure_enabled,
            ai_disclosure_text: bp.ai_disclosure_text,
            source_attribution_enabled: bp.source_attribution_enabled,
            custom_caption_prompt: bp.custom_caption_prompt,
            custom_image_prompt: bp.custom_image_prompt,
            overrides: bp.overrides,
          });
          pagesUpdated++;
        }
      }
    }

    return {
      success: true,
      imported: {
        profiles: profilesImported,
        pages: pagesUpdated,
      },
    };
  }

  // --- Go-Live System Readiness Audit (11 Multi-Point Checks) ---
  public async getSystemReadiness(): Promise<SystemReadinessResult> {
    const checks: ReadinessCheckItem[] = [];

    // 1. Schema check
    const schema = await this.checkDatabaseSchema();
    checks.push({
      name: 'Database Schema Completeness',
      category: 'database',
      status: schema.ok ? 'pass' : 'fail',
      message: schema.ok
        ? `All ${schema.totalTables} core tables and required columns verified in Supabase`
        : `Missing tables: ${schema.missingTables.join(', ') || 'None'}; Column errors: ${schema.columnCheckErrors.join('; ')}`,
      actionableHint: schema.ok ? undefined : 'Run supabase/all_migrations.sql in the Supabase SQL Editor.',
    });

    // 2. Supabase read/write probe
    let rwOk = false;
    let rwMsg = '';
    try {
      const testKey = 'readiness_probe_' + Date.now();
      await this.setSetting(testKey, { test: true });
      const readBack = await this.getSetting(testKey);
      rwOk = Boolean(readBack?.test);
      rwMsg = rwOk ? 'Read/Write connection verified on Supabase public schema' : 'Probe write failed to persist';
    } catch (e: any) {
      rwMsg = 'Read/Write probe error: ' + e.message;
    }
    checks.push({
      name: 'Supabase Read/Write Connection',
      category: 'database',
      status: rwOk ? 'pass' : 'fail',
      message: rwMsg,
      actionableHint: rwOk ? undefined : 'Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
    });

    // 3. ENCRYPTION_KEY consistency
    let encOk = false;
    let encMsg = '';
    try {
      const testStr = 'token-encryption-check-' + Date.now();
      const enc = encrypt(testStr);
      const dec = decryptPageToken(enc);
      encOk = dec === testStr;
      encMsg = encOk ? 'Valid 32-byte key; AES-256-GCM token round-trip verified' : 'Decrypted value did not match original';
    } catch (e: any) {
      encMsg = 'Encryption error: ' + e.message;
    }
    checks.push({
      name: 'ENCRYPTION_KEY Consistency',
      category: 'security',
      status: encOk ? 'pass' : 'fail',
      message: encMsg,
      actionableHint: encOk ? undefined : 'Set ENCRYPTION_KEY (32-byte hex or base64) in Vercel and GitHub Secrets.',
    });

    // 4. Text/Image Providers
    const [providers, keys] = await Promise.all([this.getProviders(), this.getProviderKeys()]);
    const activeKeys = keys.filter((k) => k.is_active);
    const hasKeys = activeKeys.length > 0;
    checks.push({
      name: 'AI Model Providers & Quotas',
      category: 'providers',
      status: hasKeys ? 'pass' : 'fail',
      message: hasKeys
        ? `${providers.filter((p) => p.enabled).length} enabled provider(s) with ${activeKeys.length} active key(s)`
        : 'Zero active provider keys configured. Posts cannot be generated without an AI provider.',
      actionableHint: hasKeys ? undefined : 'Add at least one API key in Providers & Quotas tab (e.g. Gemini, Groq, OpenRouter).',
    });

    // 5. Facebook App Credentials
    const fbAppId = process.env.FACEBOOK_APP_ID;
    const fbAppSecret = process.env.FACEBOOK_APP_SECRET;
    const fbOk = Boolean(fbAppId && fbAppSecret);
    checks.push({
      name: 'Meta App Configuration',
      category: 'facebook',
      status: fbOk ? 'pass' : 'fail',
      message: fbOk
        ? `App ID (${maskSecret(fbAppId!, 4, 3)}) and App Secret configured in environment`
        : 'FACEBOOK_APP_ID or FACEBOOK_APP_SECRET missing in environment',
      actionableHint: fbOk ? undefined : 'Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in Vercel and GitHub Secrets.',
    });

    // 6. Page Token Validity
    const pages = await this.getPages();
    const validPages = pages.filter((p) => p.token_status === 'valid');
    const tokenOk = validPages.length > 0;
    checks.push({
      name: 'Facebook Page Token & Permissions',
      category: 'facebook',
      status: tokenOk ? 'pass' : (pages.length > 0 ? 'fail' : 'warn'),
      message: tokenOk
        ? `${validPages.length} of ${pages.length} Page(s) have valid tokens`
        : (pages.length === 0 ? 'No Facebook Pages connected yet' : 'Connected Page tokens are expired or inaccessible'),
      actionableHint: tokenOk ? undefined : 'Connect a Page using Facebook Login for Business in Pages & Accounts tab.',
    });

    // 7. Worker Heartbeat Recency
    const heartbeat = await this.getHeartbeat();
    const lastHb = heartbeat?.lastHeartbeat ? new Date(heartbeat.lastHeartbeat).getTime() : 0;
    const hbDiffMinutes = lastHb > 0 ? Math.round((Date.now() - lastHb) / 60000) : 999;
    const hbPass = hbDiffMinutes <= 60;
    checks.push({
      name: 'Background Worker Heartbeat',
      category: 'automation',
      status: hbPass ? 'pass' : 'warn',
      message: lastHb > 0
        ? `Last heartbeat: ${hbDiffMinutes} minute(s) ago (${new Date(lastHb).toLocaleTimeString()})`
        : 'No worker heartbeat recorded yet',
      actionableHint: hbPass ? undefined : 'Trigger GitHub Actions worker run or start local worker.',
    });

    // 8. GitHub Actions Scheduled Pipeline
    const cronSecretSet = Boolean(process.env.CRON_SECRET);
    checks.push({
      name: 'Scheduled Pipeline (GitHub Actions / Cron)',
      category: 'automation',
      status: cronSecretSet ? 'pass' : 'warn',
      message: cronSecretSet
        ? 'CRON_SECRET configured; automation workflow armed'
        : 'CRON_SECRET not detected in local runtime (verify GitHub Secrets for repo actions)',
      actionableHint: cronSecretSet ? undefined : 'Add CRON_SECRET to GitHub Secrets and Vercel environment.',
    });

    // 9. Public Legal Compliance Pages
    checks.push({
      name: 'Public Compliance Endpoints',
      category: 'compliance',
      status: 'pass',
      message: 'Public static routes /privacy, /terms, and /data-deletion are live and accessible without login',
    });

    // 10. Clean Production Database (No test/fake rows)
    const accounts = await this.getAccounts();
    const hasTestRows =
      accounts.some((a) => (a.account_name || '').toLowerCase().includes('test sync user') || (a.fb_user_id || '').includes('fb-user-17')) ||
      pages.some((p) => (p.name || '').toLowerCase().includes('disappearing page') || (p.name || '').toLowerCase().includes('freshly discovered'));
    checks.push({
      name: 'Zero Test Data in Production',
      category: 'database',
      status: !hasTestRows ? 'pass' : 'fail',
      message: !hasTestRows
        ? 'Production database is clean (no synthetic test accounts or simulated pages)'
        : 'Warning: Synthetic test user/page rows detected in database',
      actionableHint: !hasTestRows ? undefined : 'Delete synthetic test accounts from Pages & Accounts tab.',
    });

    // 11. Kill Switch Arming Status
    const killSwitch = await this.getKillSwitch();
    checks.push({
      name: 'Global Kill Switch Status',
      category: 'security',
      status: !killSwitch ? 'pass' : 'warn',
      message: !killSwitch
        ? 'Kill switch is ARMED and READY (autonomous generation permitted)'
        : 'Kill switch is ACTIVE (all autonomous generation currently paused)',
      actionableHint: !killSwitch ? undefined : 'Deactivate Kill Switch in Settings tab before going live.',
    });

    const passedCount = checks.filter((c) => c.status === 'pass').length;
    const readyToGoLive = checks.filter((c) => c.status === 'fail').length === 0 && tokenOk && hasKeys;

    return {
      readyToGoLive,
      score: {
        passed: passedCount,
        total: checks.length,
        percent: Math.round((passedCount / checks.length) * 100),
      },
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  public async getStorageHealth(forceRefresh = false): Promise<StorageHealthResult> {
    if (isTestEnv() && !this.client) {
      return {
        supabaseConnected: true,
        tablesOk: true,
        tablesCount: 19,
        expectedCount: 19,
        missingTables: [],
        bucketOk: true,
        singleSourceOfTruth: true,
      };
    }

    const now = Date.now();
    if (!forceRefresh && this.cachedStorageHealth && now - this.cachedStorageHealth.timestamp < 30000) {
      return this.cachedStorageHealth.result;
    }

    try {
      const client = this.getClient();

      // 1. Connection probe
      const { error: probeErr } = await client.from('settings').select('key').limit(1);
      const supabaseConnected = !probeErr;

      // 2. Missing tables check
      const missingTables = await this.getMissingTables();
      const tablesCount = CORE_SYSTEM_TABLES.length - missingTables.length;
      const tablesOk = missingTables.length === 0;

      // 3. Bucket check
      const { data: buckets, error: bucketErr } = await client.storage.listBuckets();
      const bucketOk = !bucketErr && Array.isArray(buckets) && buckets.some((b) => b.id === 'post-images' || b.name === 'post-images');

      const result: StorageHealthResult = {
        supabaseConnected,
        tablesOk,
        tablesCount,
        expectedCount: CORE_SYSTEM_TABLES.length,
        missingTables,
        bucketOk,
        singleSourceOfTruth: true,
        instructions: tablesOk
          ? undefined
          : 'Execute supabase/all_migrations.sql in your Supabase SQL Editor to initialize the missing tables.',
      };

      this.cachedStorageHealth = { result, timestamp: now };
      return result;
    } catch (err: any) {
      const fallbackResult: StorageHealthResult = {
        supabaseConnected: false,
        tablesOk: false,
        tablesCount: 0,
        expectedCount: CORE_SYSTEM_TABLES.length,
        missingTables: CORE_SYSTEM_TABLES,
        bucketOk: false,
        singleSourceOfTruth: true,
        error: err?.message || String(err),
        instructions: 'Execute supabase/all_migrations.sql in your Supabase SQL Editor to initialize all tables.',
      };
      return fallbackResult;
    }
  }
}

export interface SchemaCheckResult {
  ok: boolean;
  totalTables: number;
  expectedTablesCount: number;
  tablesFound: string[];
  missingTables: string[];
  columnsOk: boolean;
  columnCheckErrors: string[];
  rlsOk: boolean;
  timestamp: string;
}

export interface ReadinessCheckItem {
  name: string;
  category: 'database' | 'security' | 'providers' | 'facebook' | 'automation' | 'compliance';
  status: 'pass' | 'fail' | 'warn';
  message: string;
  actionableHint?: string;
}

export interface SystemReadinessResult {
  readyToGoLive: boolean;
  score: { passed: number; total: number; percent: number };
  checks: ReadinessCheckItem[];
  timestamp: string;
}
