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

import { encryptPageToken } from '@fb-auto/core';

export interface StoredPage {
  id: string;
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
  overrides?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface StoredPost {
  id: string;
  page_id: string;
  status: string;
  review_state: 'n/a' | 'pending' | 'approved' | 'rejected';
  review_note?: string;
  title: string;
  headline?: string;
  caption: string;
  caption_word_count?: number;
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
}

export interface SystemStoreData {
  pages: StoredPage[];
  posts: StoredPost[];
  killSwitchActive: boolean;
  workerHeartbeat: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'system-store.json');

function getInitialStore(): SystemStoreData {
  return {
    pages: [
      {
        id: 'page_science_01',
        name: 'Cosmic Horizons & Science Daily',
        fb_page_id: '109283746501',
        fb_page_token: encryptPageToken('EAAB_demo_token_science_world'),
        token_status: 'valid',
        profile_id: 'science_space',
        publishing_mode: 'hybrid',
        hybrid_min_score: 80,
        daily_cap: 3,
        active: true,
        schedule: {
          postsPerDay: 3,
          postingTimes: ['09:00', '14:00', '19:00'],
          timezone: 'UTC',
        },
        custom_caption_prompt:
          'Emphasize recent peer-reviewed astrophysical papers (Nature Astronomy, Astrophysical Journal). Ask an engaging open-ended question at the end for science lovers to discuss.',
        custom_caption_prompt_mode: 'append',
        custom_image_prompt:
          'Deep cosmic blue and violet tones, high contrast, James Webb infrared telescope aesthetic.',
        custom_image_prompt_mode: 'append',
        overrides: {
          'caption.min': 120,
          'caption.target': 180,
          'caption.max': 240,
          'image.aspectRatio': '4:5',
          'image.headlinePanel.enabled': true,
          'image.headlinePanel.backgroundColor': '#050b14',
          'image.headlinePanel.textColor': '#FFFFFF',
          'image.headlinePanel.heightPercent': 26,
        },
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 3).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'page_horror_02',
        name: 'Midnight Crypt Stories',
        fb_page_id: '209384756102',
        fb_page_token: encryptPageToken('EAAB_demo_token_horror_tales'),
        token_status: 'valid',
        profile_id: 'horror_story',
        publishing_mode: 'review',
        hybrid_min_score: 85,
        daily_cap: 2,
        active: true,
        schedule: {
          postsPerDay: 2,
          postingTimes: ['21:00', '01:00'],
          timezone: 'America/New_York',
        },
        custom_caption_prompt:
          'Focus on slow-burn psychological dread rather than gore. End with a subtle eerie realization.',
        custom_caption_prompt_mode: 'append',
        custom_image_prompt:
          'Dark foggy 19th-century gothic atmosphere, heavy shadows, muted desaturated colors.',
        custom_image_prompt_mode: 'append',
        overrides: {
          'caption.min': 600,
          'caption.target': 850,
          'caption.max': 1100,
          'caption.endingStyle': 'cliffhanger',
          'image.aspectRatio': '4:5',
          'image.headlinePanel.enabled': false,
        },
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 2).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    posts: [
      {
        id: 'post_rev_001',
        page_id: 'page_science_01',
        status: 'pending_review',
        review_state: 'pending',
        title: 'James Webb Detects Ocean Atmosphere on K2-18b',
        headline: 'NEW MOLECULAR EVIDENCE OF WATER VAPOR ON TEMPERATE EXOPLANET',
        caption:
          'Astronomers analyzing spectroscopic transmission data from the James Webb Space Telescope have identified atmospheric methane and carbon dioxide in the habitable-zone sub-Neptune K2-18b.\n\nThis discovery marks one of the most promising candidates for a hycean world—an ocean-covered planet beneath a hydrogen-rich atmosphere.\n\nWhat kind of life forms do you think could thrive in deep alien oceans?\n\n#space #astronomy #science #jwst #exoplanet',
        caption_word_count: 67,
        hashtags: ['#space', '#astronomy', '#science', '#jwst', '#exoplanet'],
        scheduled_for: new Date(Date.now() + 86400 * 1000).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
        qa_score: 94,
        sensitive_flags: [],
        image_phash: '0123456789abcdef',
        content_hash: '9f837261a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8',
      },
      {
        id: 'post_rev_002',
        page_id: 'page_horror_02',
        status: 'pending_review',
        review_state: 'pending',
        title: 'The Tallow Candle of Blackwood Chapel',
        headline: 'THE WICK THAT REFUSED TO BE EXTINGUISHED',
        caption:
          'For two centuries, the solitary tallow candle upon the altar of Blackwood Chapel burned with an unearthly violet flame. The caretakers were warned never to snuff it out, for it was not lit to bring light, but to keep the darkness trapped within the crypt below.\n\nTonight, a sudden winter gale forced the iron latch open.\n\n#horror #creepypasta #gothic #ghoststory #mystery',
        caption_word_count: 67,
        hashtags: ['#horror', '#creepypasta', '#gothic', '#ghoststory', '#mystery'],
        scheduled_for: new Date(Date.now() + 86400 * 1000 * 2).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 8).toISOString(),
        qa_score: 91,
        sensitive_flags: [],
        image_phash: 'fedcba9876543210',
        content_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
      },
      {
        id: 'post_sched_003',
        page_id: 'page_science_01',
        status: 'scheduled_on_fb',
        review_state: 'approved',
        title: 'Deep Space Molecular Clouds in Carina',
        headline: 'MASSIVE STELLAR NURSERY IMAGED IN INFRARED',
        caption:
          'Deep inside the Carina Nebula, massive infant stars are sculpting cosmic cliffs of gas and dust.\n\n#space #astronomy #science #jwst #stars',
        caption_word_count: 22,
        hashtags: ['#space', '#astronomy', '#science', '#jwst', '#stars'],
        scheduled_for: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
        qa_score: 96,
        fb_post_id: '109283746501_post_99901',
        fb_permalink: 'https://facebook.com/CosmicHorizons/posts/99901',
      },
      {
        id: 'post_pub_004',
        page_id: 'page_science_01',
        status: 'published',
        review_state: 'approved',
        title: 'Supermassive Black Hole Jet Ejection',
        caption:
          'Relativistic jets shooting outward at 99% light speed have been tracked by ground-based radio telescope arrays.\n\n#space #astronomy #science #blackhole',
        caption_word_count: 20,
        hashtags: ['#space', '#astronomy', '#science', '#blackhole'],
        scheduled_for: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 30).toISOString(),
        published_at: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
        qa_score: 98,
        fb_post_id: '109283746501_post_88801',
        fb_permalink: 'https://facebook.com/CosmicHorizons/posts/88801',
      },
    ],
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
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[SystemStore] Could not load store file, initializing new store:', e);
    }

    const initial = getInitialStore();
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
    publishing_mode?: 'auto' | 'review' | 'hybrid';
    hybrid_min_score?: number;
    daily_cap?: number;
    schedule?: { postsPerDay: number; postingTimes: string[]; timezone: string };
    custom_caption_prompt?: string;
    custom_caption_prompt_mode?: 'append' | 'replace';
    custom_image_prompt?: string;
    custom_image_prompt_mode?: 'append' | 'replace';
    overrides?: Record<string, any>;
  }): StoredPage {
    const id = `page_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const encryptedToken = encryptPageToken(input.fb_page_token);

    const newPage: StoredPage = {
      id,
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
