import fs from 'node:fs';
import path from 'node:path';

// Auto-load .env file if available
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile();
  }
} catch {
  // Ignore
}

import { encryptPageToken, encrypt, maskSecret } from '@fb-auto/core';

export interface StoredProvider {
  id: string;
  name: string;
  adapter_kind: 'gemini_native' | 'openai_compatible_chat' | 'cloudflare_workers_ai' | 'pollinations_image' | 'custom_http';
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
  fb_account_id?: string; // Associated Facebook Account / Identity ID
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

export interface SystemStoreData {
  accounts: StoredFacebookAccount[];
  pages: StoredPage[];
  posts: StoredPost[];
  providers: StoredProvider[];
  providerKeys: StoredProviderKey[];
  auditLogs: StoredAuditLog[];
  killSwitchActive: boolean;
  workerHeartbeat: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'system-store.json');

function getInitialStore(): SystemStoreData {
  return {
    accounts: [],
    providers: [],
    providerKeys: [],
    pages: [],
    posts: [],
    auditLogs: [],
    killSwitchActive: false,
    workerHeartbeat: new Date().toISOString(),
  };
}

export class SystemStore {
  private static instance: SystemStore;
  private data: SystemStoreData;

  private constructor() {
    this.data = this.load();
  }

  public static getInstance(): SystemStore {
    if (!SystemStore.instance) {
      SystemStore.instance = new SystemStore();
    }
    return SystemStore.instance;
  }

  private load(): SystemStoreData {
    const initial = getInitialStore();
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const loaded: SystemStoreData = JSON.parse(raw);
        let changed = false;
        if (!Array.isArray(loaded.accounts)) {
          loaded.accounts = [];
          changed = true;
        }
        if (!Array.isArray(loaded.auditLogs)) {
          loaded.auditLogs = [];
          changed = true;
        }
        if (!Array.isArray(loaded.providers)) {
          loaded.providers = [];
          changed = true;
        }
        if (!Array.isArray(loaded.providerKeys)) {
          loaded.providerKeys = [];
          changed = true;
        }
        if (!Array.isArray(loaded.pages)) {
          loaded.pages = [];
          changed = true;
        }
        if (!Array.isArray(loaded.posts)) {
          loaded.posts = [];
          changed = true;
        }
        if (changed) {
          this.save(loaded);
        }
        return loaded;
      }
    } catch (e) {
      console.warn('[SystemStore] Could not load store file, initializing new store:', e);
    }

    this.save(initial);
    return initial;
  }

  private save(data = this.data): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[SystemStore] Failed to save store file:', e);
    }
  }

  // --- Facebook Accounts / Identities CRUD ---
  public getAccounts(): StoredFacebookAccount[] {
    return this.data.accounts || [];
  }

  public getAccountById(id: string): StoredFacebookAccount | undefined {
    return (this.data.accounts || []).find((a) => a.id === id);
  }

  public createAccount(input: {
    account_name: string;
    fb_user_id: string;
    email?: string;
    user_access_token?: string;
    notes?: string;
  }): StoredFacebookAccount {
    const id = `fb_acc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const encToken = input.user_access_token ? encryptPageToken(input.user_access_token) : undefined;
    const masked = input.user_access_token ? maskSecret(input.user_access_token) : 'No User Token';

    const newAccount: StoredFacebookAccount = {
      id,
      account_name: input.account_name,
      fb_user_id: input.fb_user_id,
      email: input.email,
      user_access_token: encToken,
      masked_token: masked,
      token_status: 'valid',
      token_expires_at: new Date(Date.now() + 86400 * 1000 * 60).toISOString(),
      notes: input.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!this.data.accounts) this.data.accounts = [];
    this.data.accounts.push(newAccount);
    this.save();
    return newAccount;
  }

  public updateAccount(id: string, updates: Partial<StoredFacebookAccount>): StoredFacebookAccount {
    const idx = (this.data.accounts || []).findIndex((a) => a.id === id);
    if (idx === -1) {
      throw new Error(`Facebook Account with ID ${id} not found.`);
    }

    const existing = this.data.accounts[idx];
    let encToken = existing.user_access_token;
    let masked = existing.masked_token;
    if (updates.user_access_token && updates.user_access_token !== existing.user_access_token) {
      encToken = encryptPageToken(updates.user_access_token);
      masked = maskSecret(updates.user_access_token);
    }

    const updated: StoredFacebookAccount = {
      ...existing,
      ...updates,
      user_access_token: encToken,
      masked_token: masked,
      updated_at: new Date().toISOString(),
    };

    this.data.accounts[idx] = updated;
    this.save();
    return updated;
  }

  public deleteAccount(id: string): boolean {
    const initialLen = (this.data.accounts || []).length;
    this.data.accounts = (this.data.accounts || []).filter((a) => a.id !== id);
    this.data.pages.forEach((p) => {
      if (p.fb_account_id === id) {
        delete p.fb_account_id;
      }
    });
    if (this.data.accounts.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- Pages CRUD ---
  public getPages(): StoredPage[] {
    return this.data.pages;
  }

  public getPageById(id: string): StoredPage | undefined {
    return this.data.pages.find((p) => p.id === id);
  }

  public createPage(input: {
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
  }): StoredPage {
    const id = `page_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const encryptedToken = encryptPageToken(input.fb_page_token);

    const newPage: StoredPage = {
      id,
      fb_account_id: input.fb_account_id,
      name: input.name,
      fb_page_id: input.fb_page_id,
      fb_page_token: encryptedToken,
      token_status: 'valid',
      profile_id: input.profile_id,
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

    this.data.pages.push(newPage);
    this.save();
    return newPage;
  }

  public updatePage(id: string, updates: Partial<StoredPage>): StoredPage {
    const idx = this.data.pages.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Page with ID ${id} not found.`);
    }

    const existing = this.data.pages[idx];
    let encryptedToken = existing.fb_page_token;
    if (updates.fb_page_token && updates.fb_page_token !== existing.fb_page_token) {
      encryptedToken = encryptPageToken(updates.fb_page_token);
    }

    const updated: StoredPage = {
      ...existing,
      ...updates,
      fb_page_token: encryptedToken,
      updated_at: new Date().toISOString(),
    };

    this.data.pages[idx] = updated;
    this.save();
    return updated;
  }

  public deletePage(id: string): boolean {
    const initialLen = this.data.pages.length;
    this.data.pages = this.data.pages.filter((p) => p.id !== id);
    if (this.data.pages.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- Posts CRUD ---
  public getPosts(): StoredPost[] {
    return this.data.posts;
  }

  public getPostById(id: string): StoredPost | undefined {
    return this.data.posts.find((p) => p.id === id);
  }

  public updatePost(id: string, updates: Partial<StoredPost>): StoredPost {
    const idx = this.data.posts.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Post with ID ${id} not found.`);
    }

    const updated: StoredPost = {
      ...this.data.posts[idx],
      ...updates,
    };
    this.data.posts[idx] = updated;
    this.save();
    return updated;
  }

  public removePost(id: string): boolean {
    const initialLen = this.data.posts.length;
    this.data.posts = this.data.posts.filter((p) => p.id !== id);
    if (this.data.posts.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- Providers & Keys CRUD ---
  public getProviders(): StoredProvider[] {
    return this.data.providers;
  }

  public getProviderById(id: string): StoredProvider | undefined {
    return this.data.providers.find((p) => p.id === id);
  }

  public createProvider(input: {
    name: string;
    adapter_kind: 'gemini_native' | 'openai_compatible_chat' | 'cloudflare_workers_ai' | 'pollinations_image' | 'custom_http';
    base_url?: string;
    model_name?: string;
    daily_limit?: number;
    enabled?: boolean;
    priority?: number;
  }): StoredProvider {
    const id = `provider_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newProvider: StoredProvider = {
      id,
      name: input.name,
      adapter_kind: input.adapter_kind,
      base_url: input.base_url || '',
      model_name: input.model_name || '',
      daily_limit: Number(input.daily_limit) || 1000,
      used_today: 0,
      enabled: input.enabled !== false,
      priority: Number(input.priority) || 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data.providers.push(newProvider);
    this.save();
    return newProvider;
  }

  public updateProvider(id: string, updates: Partial<StoredProvider>): StoredProvider {
    const idx = this.data.providers.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Provider with ID ${id} not found.`);
    }
    const updated: StoredProvider = {
      ...this.data.providers[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.data.providers[idx] = updated;
    this.save();
    return updated;
  }

  public deleteProvider(id: string): boolean {
    const initialLen = this.data.providers.length;
    this.data.providers = this.data.providers.filter((p) => p.id !== id);
    // Cascade delete associated keys
    this.data.providerKeys = this.data.providerKeys.filter((k) => k.provider_id !== id);
    if (this.data.providers.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public getProviderKeys(providerId?: string): StoredProviderKey[] {
    if (providerId) {
      return this.data.providerKeys.filter((k) => k.provider_id === providerId);
    }
    return this.data.providerKeys;
  }

  public addProviderKey(input: {
    provider_id: string;
    raw_key: string;
    label?: string;
  }): StoredProviderKey {
    const provider = this.getProviderById(input.provider_id);
    if (!provider) {
      throw new Error(`Provider with ID ${input.provider_id} does not exist.`);
    }
    const trimmed = input.raw_key ? input.raw_key.trim() : '';
    if (!trimmed) {
      throw new Error('API key cannot be empty.');
    }
    const id = `key_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const encrypted_key = encrypt(trimmed);
    const masked_key = maskSecret(trimmed);
    const newKey: StoredProviderKey = {
      id,
      provider_id: input.provider_id,
      encrypted_key,
      masked_key,
      label: input.label?.trim() || undefined,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    this.data.providerKeys.push(newKey);
    this.save();
    return newKey;
  }

  public deleteProviderKey(keyId: string): boolean {
    const initialLen = this.data.providerKeys.length;
    this.data.providerKeys = this.data.providerKeys.filter((k) => k.id !== keyId);
    if (this.data.providerKeys.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public toggleProviderKey(keyId: string, isActive?: boolean): StoredProviderKey {
    const key = this.data.providerKeys.find((k) => k.id === keyId);
    if (!key) {
      throw new Error(`Key with ID ${keyId} not found.`);
    }
    key.is_active = typeof isActive === 'boolean' ? isActive : !key.is_active;
    this.save();
    return key;
  }

  // --- Audit Logs CRUD ---
  public getAuditLogs(limit = 100): StoredAuditLog[] {
    return (this.data.auditLogs || []).slice(0, limit);
  }

  public addAuditLog(entry: Omit<StoredAuditLog, 'id' | 'timestamp'>): StoredAuditLog {
    const newLog: StoredAuditLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    if (!this.data.auditLogs) this.data.auditLogs = [];
    this.data.auditLogs.unshift(newLog);
    if (this.data.auditLogs.length > 200) {
      this.data.auditLogs.length = 200;
    }
    this.save();
    return newLog;
  }

  // --- Kill Switch & Heartbeat ---
  public getKillSwitch(): boolean {
    return this.data.killSwitchActive;
  }

  public setKillSwitch(active: boolean): boolean {
    this.data.killSwitchActive = active;
    this.save();
    return this.data.killSwitchActive;
  }

  public updateHeartbeat(): string {
    this.data.workerHeartbeat = new Date().toISOString();
    return this.data.workerHeartbeat;
  }
}
