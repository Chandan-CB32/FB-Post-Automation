import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// Auto-load .env file if available
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // Ignore
}

import {
  encryptPageToken,
  decryptPageToken,
  encrypt,
  maskSecret,
  FacebookGraphClient,
  type TokenInspectionResult,
} from '@fb-auto/core';

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
  token_status: 'valid' | 'expired' | 'rate_limited';
  token_expires_at?: string;
  notes?: string;
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
  token_status: 'valid' | 'expired' | 'revoked' | 'rate_limited';
  profile_id: string;
  publishing_mode: 'auto' | 'review' | 'hybrid';
  hybrid_min_score: number;
  daily_cap: number;
  active: boolean;
  schedule: {
    postsPerDay: number;
    postingTimes: string[];
    timezone: string;
  };
  custom_caption_prompt?: string;
  custom_caption_prompt_mode?: 'append' | 'replace';
  custom_image_prompt?: string;
  custom_image_prompt_mode?: 'append' | 'replace';
  first_comment_enabled?: boolean;
  first_comment_prompt?: string;
  overrides?: Record<string, any>;
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

export class SystemStore {
  private static instance: SystemStore;
  private client: SupabaseClient | null = null;

  private constructor() {
    this.initClient();
  }

  public static getInstance(): SystemStore {
    if (!SystemStore.instance) {
      SystemStore.instance = new SystemStore();
    }
    return SystemStore.instance;
  }

  private initClient(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.warn('[SystemStore] Missing Supabase URL or SERVICE_ROLE_KEY');
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
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async getAccountById(id: string): Promise<StoredFacebookAccount | undefined> {
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
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async createAccount(input: {
    account_name: string;
    fb_user_id: string;
    email?: string;
    user_access_token?: string;
    token_status?: 'valid' | 'expired' | 'rate_limited';
    token_expires_at?: string;
    notes?: string;
  }): Promise<StoredFacebookAccount> {
    const encToken = input.user_access_token ? encryptPageToken(input.user_access_token) : null;
    const masked = input.user_access_token ? maskSecret(input.user_access_token) : 'No User Token';

    const insertPayload = {
      account_name: input.account_name,
      fb_user_id: input.fb_user_id,
      email: input.email || null,
      user_access_token: encToken,
      masked_token: masked,
      token_status: input.token_status || 'valid',
      token_expires_at: input.token_expires_at || new Date(Date.now() + 86400 * 1000 * 60).toISOString(),
      notes: input.notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.getClient()
      .from('facebook_accounts')
      .insert(insertPayload)
      .select()
      .single();

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
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async updateAccount(id: string, updates: Partial<StoredFacebookAccount>): Promise<StoredFacebookAccount> {
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.account_name) updatePayload.account_name = updates.account_name;
    if (updates.email !== undefined) updatePayload.email = updates.email;
    if (updates.notes !== undefined) updatePayload.notes = updates.notes;
    if (updates.token_status) updatePayload.token_status = updates.token_status;

    if (updates.user_access_token) {
      updatePayload.user_access_token = encryptPageToken(updates.user_access_token);
      updatePayload.masked_token = maskSecret(updates.user_access_token);
    }

    const { data, error } = await this.getClient()
      .from('facebook_accounts')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update Facebook Account ${id}: ${error.message}`);
    }

    return data as StoredFacebookAccount;
  }

  public async deleteAccount(id: string): Promise<boolean> {
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
    const status = result.status === 'valid' ? 'valid' : 'expired';
    await this.updateAccount(accountId, { token_status: status });
    return result;
  }

  // --- Pages CRUD ---
  public async getPages(): Promise<StoredPage[]> {
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
      profile_id: row.profile_id || 'default-niche',
      publishing_mode: row.publishing_mode || 'hybrid',
      hybrid_min_score: Number(row.hybrid_min_score) || 80,
      daily_cap: row.daily_cap || 3,
      active: row.active !== false,
      schedule: row.schedule || {
        postsPerDay: 3,
        postingTimes: ['10:00', '15:00', '20:00'],
        timezone: 'UTC',
      },
      custom_caption_prompt: row.custom_caption_prompt || '',
      custom_caption_prompt_mode: row.custom_caption_prompt_mode || 'append',
      custom_image_prompt: row.custom_image_prompt || '',
      custom_image_prompt_mode: row.custom_image_prompt_mode || 'append',
      first_comment_enabled: row.first_comment_enabled !== false,
      first_comment_prompt: row.first_comment_prompt || '',
      overrides: row.overrides || {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async getPageById(id: string): Promise<StoredPage | undefined> {
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
      profile_id: data.profile_id || 'default-niche',
      publishing_mode: data.publishing_mode || 'hybrid',
      hybrid_min_score: Number(data.hybrid_min_score) || 80,
      daily_cap: data.daily_cap || 3,
      active: data.active !== false,
      schedule: data.schedule || {
        postsPerDay: 3,
        postingTimes: ['10:00', '15:00', '20:00'],
        timezone: 'UTC',
      },
      custom_caption_prompt: data.custom_caption_prompt || '',
      custom_caption_prompt_mode: data.custom_caption_prompt_mode || 'append',
      custom_image_prompt: data.custom_image_prompt || '',
      custom_image_prompt_mode: data.custom_image_prompt_mode || 'append',
      first_comment_enabled: data.first_comment_enabled !== false,
      first_comment_prompt: data.first_comment_prompt || '',
      overrides: data.overrides || {},
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async createPage(input: {
    name: string;
    fb_page_id: string;
    fb_page_token: string;
    profile_id: string;
    fb_account_id?: string;
    publishing_mode?: 'auto' | 'review' | 'hybrid';
    hybrid_min_score?: number;
    daily_cap?: number;
    schedule?: { postsPerDay: number; postingTimes: string[]; timezone: string };
    custom_caption_prompt?: string;
    custom_caption_prompt_mode?: 'append' | 'replace';
    custom_image_prompt?: string;
    custom_image_prompt_mode?: 'append' | 'replace';
    first_comment_enabled?: boolean;
    first_comment_prompt?: string;
    overrides?: Record<string, any>;
  }): Promise<StoredPage> {
    const encryptedToken = encryptPageToken(input.fb_page_token);

    const payload = {
      fb_account_id: input.fb_account_id || null,
      name: input.name,
      fb_page_id: input.fb_page_id,
      fb_page_token: encryptedToken,
      token_status: 'valid',
      profile_id: input.profile_id && input.profile_id.length > 20 ? input.profile_id : null,
      publishing_mode: input.publishing_mode || 'hybrid',
      hybrid_min_score: input.hybrid_min_score ?? 80,
      daily_cap: input.daily_cap ?? 3,
      active: true,
      schedule: input.schedule || {
        postsPerDay: 3,
        postingTimes: ['10:00', '15:00', '20:00'],
        timezone: 'UTC',
      },
      custom_caption_prompt: input.custom_caption_prompt || '',
      custom_caption_prompt_mode: input.custom_caption_prompt_mode || 'append',
      custom_image_prompt: input.custom_image_prompt || '',
      custom_image_prompt_mode: input.custom_image_prompt_mode || 'append',
      first_comment_enabled: input.first_comment_enabled !== false,
      first_comment_prompt: input.first_comment_prompt || '',
      overrides: input.overrides || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.getClient().from('pages').insert(payload).select().single();
    if (error) {
      throw new Error(`Failed to create Facebook Page in Supabase: ${error.message}`);
    }

    return {
      ...payload,
      id: data.id,
      profile_id: input.profile_id,
    } as StoredPage;
  }

  public async updatePage(id: string, updates: Partial<StoredPage>): Promise<StoredPage> {
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.name) updatePayload.name = updates.name;
    if (updates.fb_page_id) updatePayload.fb_page_id = updates.fb_page_id;
    if (updates.fb_account_id !== undefined) updatePayload.fb_account_id = updates.fb_account_id || null;
    if (updates.publishing_mode) updatePayload.publishing_mode = updates.publishing_mode;
    if (updates.hybrid_min_score !== undefined) updatePayload.hybrid_min_score = updates.hybrid_min_score;
    if (updates.daily_cap !== undefined) updatePayload.daily_cap = updates.daily_cap;
    if (updates.active !== undefined) updatePayload.active = updates.active;
    if (updates.schedule) updatePayload.schedule = updates.schedule;
    if (updates.custom_caption_prompt !== undefined) updatePayload.custom_caption_prompt = updates.custom_caption_prompt;
    if (updates.custom_caption_prompt_mode) updatePayload.custom_caption_prompt_mode = updates.custom_caption_prompt_mode;
    if (updates.custom_image_prompt !== undefined) updatePayload.custom_image_prompt = updates.custom_image_prompt;
    if (updates.custom_image_prompt_mode) updatePayload.custom_image_prompt_mode = updates.custom_image_prompt_mode;
    if (updates.first_comment_enabled !== undefined) updatePayload.first_comment_enabled = updates.first_comment_enabled;
    if (updates.first_comment_prompt !== undefined) updatePayload.first_comment_prompt = updates.first_comment_prompt;
    if (updates.overrides) updatePayload.overrides = updates.overrides;

    if (updates.fb_page_token) {
      updatePayload.fb_page_token = encryptPageToken(updates.fb_page_token);
    }

    const { data, error } = await this.getClient()
      .from('pages')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update page ${id}: ${error.message}`);
    }

    return data as StoredPage;
  }

  public async deletePage(id: string): Promise<boolean> {
    const { error } = await this.getClient().from('pages').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete page error:', error.message);
      return false;
    }
    return true;
  }

  public async upsertPageFromFacebook(input: {
    fb_account_id: string;
    name: string;
    fb_page_id: string;
    fb_page_token: string;
  }): Promise<StoredPage> {
    const { data: existing } = await this.getClient()
      .from('pages')
      .select('id')
      .eq('fb_page_id', input.fb_page_id)
      .maybeSingle();

    if (existing) {
      return await this.updatePage(existing.id, {
        name: input.name,
        fb_account_id: input.fb_account_id,
        fb_page_token: input.fb_page_token,
        token_status: 'valid',
      });
    }

    return await this.createPage({
      name: input.name,
      fb_page_id: input.fb_page_id,
      fb_page_token: input.fb_page_token,
      fb_account_id: input.fb_account_id,
      profile_id: 'default-niche',
      publishing_mode: 'hybrid',
      daily_cap: 3,
    });
  }

  public async checkPageTokenHealth(pageId: string): Promise<TokenInspectionResult> {
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
    const { error } = await this.getClient().from('posts').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete post error:', error.message);
      return false;
    }
    return true;
  }

  // --- Providers & Keys CRUD ---
  public async getProviders(): Promise<StoredProvider[]> {
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
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async getProviderById(id: string): Promise<StoredProvider | undefined> {
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
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  public async deleteProvider(id: string): Promise<boolean> {
    await this.getClient().from('provider_keys').delete().eq('provider_id', id);
    const { error } = await this.getClient().from('providers').delete().eq('id', id);
    if (error) {
      console.error('[SystemStore] Delete provider error:', error.message);
      return false;
    }
    return true;
  }

  public async getProviderKeys(providerId?: string): Promise<StoredProviderKey[]> {
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

  public async addProviderKey(input: {
    provider_id: string;
    raw_key: string;
    label?: string;
  }): Promise<StoredProviderKey> {
    const trimmed = input.raw_key ? input.raw_key.trim() : '';
    if (!trimmed) {
      throw new Error('API key cannot be empty.');
    }

    const masked_key = maskSecret(trimmed);

    // If key already exists in rotation pool for this provider, do not duplicate: reactivate and keep
    const existingKeys = await this.getProviderKeys(input.provider_id);
    const existing = existingKeys.find((k) => k.masked_key === masked_key);
    if (existing) {
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
    const { error } = await this.getClient().from('provider_keys').delete().eq('id', keyId);
    if (error) {
      console.error('[SystemStore] Delete provider key error:', error.message);
      return false;
    }
    return true;
  }

  public async toggleProviderKey(keyId: string, isActive?: boolean): Promise<StoredProviderKey> {
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
    const { data, error } = await this.getClient()
      .from('settings')
      .select('value')
      .eq('key', 'kill_switch')
      .maybeSingle();

    if (error || !data) return false;
    return Boolean(data.value?.paused);
  }

  public async setKillSwitch(active: boolean): Promise<boolean> {
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
    await this.getClient()
      .from('settings')
      .upsert({
        key: 'worker_heartbeat',
        value: { lastHeartbeat: now },
        updated_at: now,
      });
    return now;
  }

  private cachedStorageHealth: { result: StorageHealthResult; timestamp: number } | null = null;

  public async getMissingTables(): Promise<string[]> {
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

  // --- Storage Health Check (PRD & Requirements) ---
  public async getStorageHealth(forceRefresh = false): Promise<StorageHealthResult> {
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
