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
    accounts: [
      {
        id: 'fb_acc_01',
        account_name: 'Alex Morgan (Primary Creator)',
        fb_user_id: '100084729104820',
        email: 'alex.creator@meta-media.io',
        user_access_token: encryptPageToken('EAAB_alex_user_token_long_lived_9812'),
        masked_token: 'EAAB...9812',
        token_status: 'valid',
        token_expires_at: '2026-12-31T23:59:59Z',
        notes: 'Personal Creator Identity managing Science & Technology channels',
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 30).toISOString(),
      },
      {
        id: 'fb_acc_02',
        account_name: 'Apex Digital Media LLC (Business BM)',
        fb_user_id: '200091827401928',
        email: 'admin@apexdigital.agency',
        user_access_token: encryptPageToken('EAAB_apex_business_token_7410'),
        masked_token: 'EAAB...7410',
        token_status: 'valid',
        token_expires_at: '2027-01-15T00:00:00Z',
        notes: 'Meta Business Manager account managing Engineering, Automotive & Wellness',
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 25).toISOString(),
      },
      {
        id: 'fb_acc_03',
        account_name: 'Viral Legends Media Lab',
        fb_user_id: '300059182303819',
        email: 'publishing@virallegends.com',
        user_access_token: encryptPageToken('EAAB_viral_legends_token_3219'),
        masked_token: 'EAAB...3219',
        token_status: 'valid',
        token_expires_at: '2026-11-28T12:00:00Z',
        notes: 'Publisher identity for Gothic Horror and Cold Case True Crime channels',
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 20).toISOString(),
      },
    ],
    providers: [
      {
        id: 'gemini_flash',
        name: 'Google Gemini 2.5 Flash',
        adapter_kind: 'gemini_native',
        base_url: 'https://generativelanguage.googleapis.com/v1beta',
        model_name: 'gemini-2.5-flash',
        daily_limit: 1500,
        used_today: 520,
        enabled: true,
        priority: 1,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
      {
        id: 'openai_gpt4o',
        name: 'OpenAI GPT-4o',
        adapter_kind: 'openai_compatible_chat',
        base_url: 'https://api.openai.com/v1',
        model_name: 'gpt-4o',
        daily_limit: 500,
        used_today: 110,
        enabled: true,
        priority: 2,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
      {
        id: 'cf_flux',
        name: 'Cloudflare Workers AI (FLUX)',
        adapter_kind: 'cloudflare_workers_ai',
        base_url: 'https://api.cloudflare.com/client/v4',
        model_name: '@cf/black-forest-labs/flux-1-schnell',
        daily_limit: 10000,
        used_today: 3600,
        enabled: true,
        priority: 1,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
      {
        id: 'pollinations',
        name: 'Pollinations AI',
        adapter_kind: 'pollinations_image',
        base_url: 'https://gen.pollinations.ai',
        model_name: 'flux',
        daily_limit: 300,
        used_today: 45,
        enabled: true,
        priority: 2,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
    ],
    providerKeys: [
      {
        id: 'key_gemini_01',
        provider_id: 'gemini_flash',
        encrypted_key: encrypt('AIzaSyDemoKeyForGemini8932'),
        masked_key: 'AIza...8932',
        label: 'Production Primary Gemini',
        is_active: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
      {
        id: 'key_openai_01',
        provider_id: 'openai_gpt4o',
        encrypted_key: encrypt('sk-proj-demoKeyOpenAIChatcdef'),
        masked_key: 'sk-...cdef',
        label: 'Tier-1 Failover Key',
        is_active: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
      {
        id: 'key_cf_01',
        provider_id: 'cf_flux',
        encrypted_key: encrypt('cf-token-workers-ai-7789'),
        masked_key: 'cf-...7789',
        label: 'Cloudflare Image Token',
        is_active: true,
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 7).toISOString(),
      },
    ],
    pages: [
      {
        id: 'page_science_01',
        fb_account_id: 'fb_acc_01',
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
        first_comment_enabled: true,
        first_comment_prompt:
          '💬 What do you think about this discovery? Let us know in the comments below! 👇 Full scientific citations linked in bio.',
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
        fb_account_id: 'fb_acc_03',
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
        first_comment_enabled: true,
        first_comment_prompt:
          '🕯️ Have you ever experienced an unexplained shadow or noise in the dead of night? Share your true encounter below...',
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
      {
        id: 'page_crime_03',
        fb_account_id: 'fb_acc_03',
        name: 'Untold Cold Cases & Forensic Files',
        fb_page_id: '309485761033',
        fb_page_token: encryptPageToken('EAAB_demo_token_cold_cases'),
        token_status: 'valid',
        profile_id: 'crime_story',
        publishing_mode: 'auto',
        hybrid_min_score: 75,
        daily_cap: 3,
        active: true,
        schedule: {
          postsPerDay: 3,
          postingTimes: ['11:00', '16:00', '21:30'],
          timezone: 'UTC',
        },
        custom_caption_prompt:
          'Factual forensic timeline style. Detail evidence chain, investigative milestones, and current case status.',
        custom_caption_prompt_mode: 'append',
        custom_image_prompt:
          'Moody investigation board aesthetic, vintage police report textures, stark noir contrast.',
        custom_image_prompt_mode: 'append',
        first_comment_enabled: true,
        first_comment_prompt:
          '🔍 Do you believe modern genealogical DNA will crack this case in our lifetime? Drop your theory below.',
        overrides: {
          'caption.min': 350,
          'caption.target': 500,
          'caption.max': 700,
          'image.aspectRatio': '4:5',
          'image.headlinePanel.enabled': true,
          'image.headlinePanel.backgroundColor': '#180303',
          'image.headlinePanel.textColor': '#FCA5A5',
          'image.headlinePanel.heightPercent': 24,
        },
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 4).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'page_auto_04',
        fb_account_id: 'fb_acc_02',
        name: 'Apex Supercars & Hyper-Engineering',
        fb_page_id: '409586771044',
        fb_page_token: encryptPageToken('EAAB_demo_token_supercars'),
        token_status: 'valid',
        profile_id: 'science_space',
        publishing_mode: 'hybrid',
        hybrid_min_score: 82,
        daily_cap: 3,
        active: true,
        schedule: {
          postsPerDay: 3,
          postingTimes: ['10:00', '15:00', '20:00'],
          timezone: 'Europe/London',
        },
        custom_caption_prompt:
          'Highlight carbon-fiber monocoques, active aerodynamics, hybrid powertrain telemetry, and track lap times.',
        custom_caption_prompt_mode: 'append',
        custom_image_prompt:
          'Ultra-sleek aerodynamic supercar at golden hour on Monza circuit, motion blur, sharp metallic highlights.',
        custom_image_prompt_mode: 'append',
        first_comment_enabled: true,
        first_comment_prompt:
          '🏎️ Would you take naturally aspirated V12 pure sound or instant quad-motor electric torque? Sound off below! 👇',
        overrides: {
          'caption.min': 150,
          'caption.target': 220,
          'caption.max': 300,
          'image.aspectRatio': '4:5',
          'image.headlinePanel.enabled': true,
          'image.headlinePanel.backgroundColor': '#0a101d',
          'image.headlinePanel.textColor': '#60A5FA',
          'image.headlinePanel.heightPercent': 25,
        },
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 5).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'page_health_05',
        fb_account_id: 'fb_acc_02',
        name: 'Mind & Vitality Longevity Protocol',
        fb_page_id: '509687881055',
        fb_page_token: encryptPageToken('EAAB_demo_token_vitality'),
        token_status: 'valid',
        profile_id: 'science_space',
        publishing_mode: 'review',
        hybrid_min_score: 85,
        daily_cap: 2,
        active: true,
        schedule: {
          postsPerDay: 2,
          postingTimes: ['08:00', '18:00'],
          timezone: 'America/Los_Angeles',
        },
        custom_caption_prompt:
          'Focus on peer-reviewed cellular autophagy, mitochondrial health, circadian rhythms, and non-pharmacological protocols.',
        custom_caption_prompt_mode: 'append',
        custom_image_prompt:
          'Clean Scandinavian wellness aesthetic, natural sunlight, organic textures, vibrant cellular biology art.',
        custom_image_prompt_mode: 'append',
        first_comment_enabled: true,
        first_comment_prompt:
          '🌱 What is your #1 non-negotiable morning habit for sustained mental focus? Let us know!',
        overrides: {
          'caption.min': 200,
          'caption.target': 320,
          'caption.max': 450,
          'image.aspectRatio': '4:5',
          'image.headlinePanel.enabled': true,
          'image.headlinePanel.backgroundColor': '#062016',
          'image.headlinePanel.textColor': '#34D399',
          'image.headlinePanel.heightPercent': 25,
        },
        created_at: new Date(Date.now() - 3600 * 1000 * 24 * 6).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    posts: [
      {
        id: 'post_rev_001',
        page_id: 'page_science_01',
        fb_account_id: 'fb_acc_01',
        status: 'pending_review',
        review_state: 'pending',
        title: 'James Webb Detects Ocean Atmosphere on K2-18b',
        headline: 'NEW MOLECULAR EVIDENCE OF WATER VAPOR ON TEMPERATE EXOPLANET',
        caption:
          'Astronomers analyzing spectroscopic transmission data from the James Webb Space Telescope have identified atmospheric methane and carbon dioxide in the habitable-zone sub-Neptune K2-18b.\n\nThis discovery marks one of the most promising candidates for a hycean world—an ocean-covered planet beneath a hydrogen-rich atmosphere.\n\nWhat kind of life forms do you think could thrive in deep alien oceans?\n\n#space #astronomy #science #jwst #exoplanet',
        caption_word_count: 67,
        first_comment: '🔬 Nature Astronomy paper reference: DOI 10.1038/s41550-023-02104-5. What is your take on extraterrestrial ocean life?',
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
        fb_account_id: 'fb_acc_03',
        status: 'pending_review',
        review_state: 'pending',
        title: 'The Tallow Candle of Blackwood Chapel',
        headline: 'THE WICK THAT REFUSED TO BE EXTINGUISHED',
        caption:
          'For two centuries, the solitary tallow candle upon the altar of Blackwood Chapel burned with an unearthly violet flame. The caretakers were warned never to snuff it out, for it was not lit to bring light, but to keep the darkness trapped within the crypt below.\n\nTonight, a sudden winter gale forced the iron latch open.\n\n#horror #creepypasta #gothic #ghoststory #mystery',
        caption_word_count: 67,
        first_comment: '🕯️ Read with the lights on. Have you ever stayed in a chapel or historic ruin after dark?',
        hashtags: ['#horror', '#creepypasta', '#gothic', '#ghoststory', '#mystery'],
        scheduled_for: new Date(Date.now() + 86400 * 1000 * 2).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 8).toISOString(),
        qa_score: 91,
        sensitive_flags: [],
        image_phash: 'fedcba9876543210',
        content_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
      },
      {
        id: 'post_rev_005',
        page_id: 'page_crime_03',
        fb_account_id: 'fb_acc_03',
        status: 'pending_review',
        review_state: 'pending',
        title: 'The 1974 Lake Geneva Cipher Mystery',
        headline: 'DECIPHERING THE 50-YEAR UNBROKEN CODE OF THE VAUD NOTEBOOK',
        caption:
          'In autumn 1974, an abandoned leather briefcase recovered near the shore of Lake Geneva contained a 48-page handwritten notebook encoded in an intricate geometric substitution cipher.\n\nDespite decades of analysis by forensic linguists, only four lines have ever yielded plaintext—hinting at a clandestine cold-war exchange that never occurred.\n\n#truecrime #coldcase #forensics #history #mystery',
        caption_word_count: 57,
        first_comment: '🔍 Cryptanalysts believe line 17 holds the geographic coordinates. What do you think the cipher hides?',
        hashtags: ['#truecrime', '#coldcase', '#forensics', '#history', '#mystery'],
        scheduled_for: new Date(Date.now() + 86400 * 1000 * 3).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 10).toISOString(),
        qa_score: 88,
        sensitive_flags: [],
        image_phash: '5a4b3c2d1e0f9a8b',
        content_hash: '7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
      },
      {
        id: 'post_rev_006',
        page_id: 'page_health_05',
        fb_account_id: 'fb_acc_02',
        status: 'pending_review',
        review_state: 'pending',
        title: 'Mitochondrial Biogenesis & Cold Thermogenesis',
        headline: 'HOW 3 MINUTES OF COLD STIMULATES PGC-1ALPHA AND BROWN ADIPOSE TISSUE',
        caption:
          'Groundbreaking metabolic research reveals that controlled acute cold exposure triggers the expression of PGC-1alpha, the master transcriptional coactivator regulating mitochondrial biogenesis.\n\nBy activating non-shivering thermogenesis in brown adipose tissue, cellular energy efficiency and insulin sensitivity rise dramatically within hours.\n\n#longevity #biohacking #health #mitochondria #vitality',
        caption_word_count: 51,
        first_comment: '❄️ Do you practice cold showers or ice baths? What difference in mental clarity have you noticed?',
        hashtags: ['#longevity', '#biohacking', '#health', '#mitochondria', '#vitality'],
        scheduled_for: new Date(Date.now() + 86400 * 1000 * 4).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 14).toISOString(),
        qa_score: 93,
        sensitive_flags: [],
        image_phash: '8b7a6c5d4e3f2a1b',
        content_hash: '3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e',
      },
      {
        id: 'post_sched_003',
        page_id: 'page_science_01',
        fb_account_id: 'fb_acc_01',
        status: 'scheduled_on_fb',
        review_state: 'approved',
        title: 'Deep Space Molecular Clouds in Carina',
        headline: 'MASSIVE STELLAR NURSERY IMAGED IN INFRARED',
        caption:
          'Deep inside the Carina Nebula, massive infant stars are sculpting cosmic cliffs of gas and dust.\n\n#space #astronomy #science #jwst #stars',
        caption_word_count: 22,
        first_comment: '✨ High-resolution full uncompressed 120MB composite available in our research archive.',
        hashtags: ['#space', '#astronomy', '#science', '#jwst', '#stars'],
        scheduled_for: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
        qa_score: 96,
        fb_post_id: '109283746501_post_99901',
        fb_permalink: 'https://facebook.com/CosmicHorizons/posts/99901',
      },
      {
        id: 'post_sched_007',
        page_id: 'page_auto_04',
        fb_account_id: 'fb_acc_02',
        status: 'scheduled_on_fb',
        review_state: 'approved',
        title: 'Active Aero Venturi Tunnels of the Gordon Murray T.50',
        headline: 'HOW A 400MM REAR FAN REWROTE AERODYNAMIC LAWS AT 12,100 RPM',
        caption:
          'By utilizing a high-speed rear fan coupled with underfloor ground-effect diffusers, the Gordon Murray T.50 eliminates massive wings while doubling downforce on corner entry.\n\n#hypercars #engineering #motorsport #aerodynamics #t50',
        caption_word_count: 32,
        first_comment: '🏁 Pure analogue driving perfection or would you prefer dual-clutch lap times? Let us know below.',
        hashtags: ['#hypercars', '#engineering', '#motorsport', '#aerodynamics', '#t50'],
        scheduled_for: new Date(Date.now() + 3600 * 1000 * 18).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 16).toISOString(),
        qa_score: 95,
        fb_post_id: '409586771044_post_77701',
        fb_permalink: 'https://facebook.com/ApexSupercars/posts/77701',
      },
      {
        id: 'post_pub_004',
        page_id: 'page_science_01',
        fb_account_id: 'fb_acc_01',
        status: 'published',
        review_state: 'approved',
        title: 'Supermassive Black Hole Jet Ejection',
        headline: 'RELATIVISTIC PLASMA JETS OBSERVED ACCELERATING AT 99% LIGHT SPEED',
        caption:
          'Relativistic jets shooting outward at 99% light speed have been tracked by ground-based radio telescope arrays.\n\n#space #astronomy #science #blackhole',
        caption_word_count: 20,
        first_comment: '🌌 The magnetic field strengths required to collimate these jets exceed 100 Gauss.',
        hashtags: ['#space', '#astronomy', '#science', '#blackhole'],
        scheduled_for: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 30).toISOString(),
        published_at: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
        qa_score: 98,
        fb_post_id: '109283746501_post_88801',
        fb_permalink: 'https://facebook.com/CosmicHorizons/posts/88801',
        analytics: {
          impressions: 48500,
          reach: 34200,
          likes: 2840,
          comments: 312,
          shares: 194,
          clicks: 1420,
          engagement_rate: 9.7,
        },
      },
      {
        id: 'post_pub_008',
        page_id: 'page_auto_04',
        fb_account_id: 'fb_acc_02',
        status: 'published',
        review_state: 'approved',
        title: 'Koenigsegg Jesko Attack Record Run',
        headline: 'THE REVOLUTIONARY LIGHT SPEED TRANSMISSION EXPLAINED',
        caption:
          'Nine forward gears with seven wet multi-disc clutches allow the Koenigsegg Jesko to shift directly from 7th to 4th gear in virtually zero milliseconds.\n\n#koenigsegg #hypercar #jesko #supercars #automotive',
        caption_word_count: 27,
        first_comment: '⚙️ 1,600 horsepower on E85 fuel. Engineering triumph!',
        hashtags: ['#koenigsegg', '#hypercar', '#jesko', '#supercars', '#automotive'],
        scheduled_for: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 52).toISOString(),
        published_at: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
        qa_score: 97,
        fb_post_id: '409586771044_post_66601',
        fb_permalink: 'https://facebook.com/ApexSupercars/posts/66601',
        analytics: {
          impressions: 62400,
          reach: 45100,
          likes: 3950,
          comments: 480,
          shares: 310,
          clicks: 2180,
          engagement_rate: 10.5,
        },
      },
      {
        id: 'post_pub_009',
        page_id: 'page_crime_03',
        fb_account_id: 'fb_acc_03',
        status: 'published',
        review_state: 'approved',
        title: 'The Great Diamond Vault Heist of Antwerp',
        headline: 'HOW A THIEVES GUILD BYPASSED SEVEN TIERS OF SEISMIC AND INFRARED SENSORS',
        caption:
          'In February 2003, a team known as the School of Turin breached the underground Antwerp Diamond Center vault without triggering a single alarm.\n\n#truecrime #heist #history #antwerp #criminology',
        caption_word_count: 25,
        first_comment: '💎 Over $100 million in jewels was taken. The bulk has never been located.',
        hashtags: ['#truecrime', '#heist', '#history', '#antwerp', '#criminology'],
        scheduled_for: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 76).toISOString(),
        published_at: new Date(Date.now() - 3600 * 1000 * 72).toISOString(),
        qa_score: 95,
        fb_post_id: '309485761033_post_55501',
        fb_permalink: 'https://facebook.com/UntoldColdCases/posts/55501',
        analytics: {
          impressions: 38900,
          reach: 28400,
          likes: 2140,
          comments: 260,
          shares: 145,
          clicks: 980,
          engagement_rate: 8.9,
        },
      },
      {
        id: 'post_plan_010',
        page_id: 'page_science_01',
        fb_account_id: 'fb_acc_01',
        status: 'planned',
        review_state: 'n/a',
        title: 'Europa Clipper Arrives at Jupiter System',
        caption: 'Draft queued for topic research and generation.',
        scheduled_for: new Date(Date.now() + 3600 * 1000 * 36).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
      },
      {
        id: 'post_plan_011',
        page_id: 'page_auto_04',
        fb_account_id: 'fb_acc_02',
        status: 'planned',
        review_state: 'n/a',
        title: 'Rimac Nevera R 2,107 HP Track Telemetry',
        caption: 'Draft queued for topic research and generation.',
        scheduled_for: new Date(Date.now() + 3600 * 1000 * 42).toISOString(),
        created_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
      },
    ],
    auditLogs: [
      {
        id: 'log_01',
        level: 'success',
        category: 'publish',
        message: 'Successfully published photo post 109283746501_post_88801 to Facebook Graph API v21.0.',
        page_id: 'page_science_01',
        details: { postId: 'post_pub_004', responseTimeMs: 412, fbPostId: '109283746501_post_88801' },
        timestamp: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
      },
      {
        id: 'log_02',
        level: 'success',
        category: 'qa',
        message: 'Post post_sched_007 passed composite QA with score 95/100 (Safety: 100, Quality: 95, Perceptual: PASS).',
        page_id: 'page_auto_04',
        details: { qaScore: 95, compositePass: true },
        timestamp: new Date(Date.now() - 3600 * 1000 * 16).toISOString(),
      },
      {
        id: 'log_03',
        level: 'info',
        category: 'token',
        message: 'Verified Facebook User Access Token for Alex Morgan (fb_acc_01). Token valid for 60 days.',
        details: { accountId: 'fb_acc_01', status: 'valid' },
        timestamp: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
      },
      {
        id: 'log_04',
        level: 'info',
        category: 'provider',
        message: 'Gemini 2.5 Flash generated caption in 1,180ms (1,340 tokens, quota 520/1500 reqs).',
        details: { provider: 'gemini_flash', tokens: 1340, latencyMs: 1180 },
        timestamp: new Date(Date.now() - 3600 * 1000 * 8).toISOString(),
      },
      {
        id: 'log_05',
        level: 'success',
        category: 'security',
        message: 'Perceptual phash duplicate detector checked image hash 0123456789abcdef against 12 prior images. Min distance: 26 (PASS).',
        page_id: 'page_science_01',
        details: { phash: '0123456789abcdef', minDistance: 26 },
        timestamp: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
      },
      {
        id: 'log_06',
        level: 'info',
        category: 'schedule',
        message: 'Lead-time slot planner locked 5 posts into upcoming 48-hour schedule window across 3 Facebook accounts.',
        details: { accountsCount: 3, pagesCount: 5, lockedSlots: 5 },
        timestamp: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
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
    const initial = getInitialStore();
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const loaded: SystemStoreData = JSON.parse(raw);
        let changed = false;
        if (!Array.isArray(loaded.accounts) || loaded.accounts.length === 0) {
          loaded.accounts = initial.accounts;
          changed = true;
        }
        if (!Array.isArray(loaded.auditLogs) || loaded.auditLogs.length === 0) {
          loaded.auditLogs = initial.auditLogs;
          changed = true;
        }
        if (!Array.isArray(loaded.providers) || loaded.providers.length === 0) {
          loaded.providers = initial.providers;
          changed = true;
        }
        if (!Array.isArray(loaded.providerKeys) || loaded.providerKeys.length === 0) {
          loaded.providerKeys = initial.providerKeys;
          changed = true;
        }
        if (!Array.isArray(loaded.pages) || loaded.pages.length < initial.pages.length) {
          loaded.pages = initial.pages;
          changed = true;
        }
        if (!Array.isArray(loaded.posts) || loaded.posts.length < initial.posts.length) {
          loaded.posts = initial.posts;
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
