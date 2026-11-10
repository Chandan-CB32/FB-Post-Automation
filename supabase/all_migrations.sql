-- ============================================================================
-- Supabase Consolidated Migrations
-- Autonomous Multi-Page Facebook Content System (FB Auto 247)
-- ============================================================================

-- Standalone Postgres Role Preamble (Safe on Supabase and standalone Postgres)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
END
$$;

-- Ensure storage schema & tables exist if running on vanilla Postgres
DO $$
BEGIN
    CREATE SCHEMA IF NOT EXISTS storage;

    CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        public BOOLEAN DEFAULT false,
        avif_autodetection BOOLEAN DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[]
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        last_accessed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        metadata JSONB DEFAULT '{}'::jsonb,
        path_tokens TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
    );
EXCEPTION WHEN OTHERS THEN
    -- In Supabase, the storage schema and tables are pre-managed by Supabase Storage Admin
    NULL;
END
$$;

-- Enable pgcrypto for UUID generation (optional in PG 13+ as gen_random_uuid() is built-in)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN
    NULL;
END
$$;


-- ============================================================================
-- Migration: 20261102000000_init_schema.sql
-- ============================================================================

-- ============================================================================
-- Supabase Migration: 20261102000000_init_schema.sql
-- Autonomous Multi-Page Facebook Content System
-- ============================================================================

-- Enable pgcrypto / uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Content Profiles (Reusable Topic Packages)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('factual', 'fiction', 'true_story', 'evergreen')),
    language TEXT NOT NULL DEFAULT 'en',
    audience TEXT NOT NULL DEFAULT 'General Facebook English-speaking audience',
    master_prompt TEXT NOT NULL,
    templates JSONB NOT NULL DEFAULT '{}'::jsonb,
    caption_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    hashtag_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    disclosure_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    image_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    topic_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    research_source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 2. Profile Versions (Rollback Support)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profile_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.content_profiles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_profile_versions_profile ON public.profile_versions(profile_id, version DESC);

-- ----------------------------------------------------------------------------
-- 3. Facebook Pages
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    fb_page_id TEXT NOT NULL UNIQUE,
    fb_page_token TEXT NOT NULL, -- AES-256-GCM encrypted
    token_status TEXT NOT NULL DEFAULT 'valid' CHECK (token_status IN ('valid', 'expired', 'revoked', 'rate_limited')),
    profile_id UUID NOT NULL REFERENCES public.content_profiles(id) ON DELETE RESTRICT,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    custom_caption_prompt TEXT,
    custom_caption_prompt_mode TEXT NOT NULL DEFAULT 'append' CHECK (custom_caption_prompt_mode IN ('append', 'replace')),
    custom_image_prompt TEXT,
    custom_image_prompt_mode TEXT NOT NULL DEFAULT 'append' CHECK (custom_image_prompt_mode IN ('append', 'replace')),
    schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
    publishing_mode TEXT NOT NULL DEFAULT 'review' CHECK (publishing_mode IN ('auto', 'review', 'hybrid')),
    hybrid_min_score NUMERIC NOT NULL DEFAULT 80,
    auto_approve_after_hours NUMERIC,
    notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_chain_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    daily_cap INTEGER NOT NULL DEFAULT 5,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_pages_active ON public.pages(active);

-- ----------------------------------------------------------------------------
-- 4. AI Providers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN (
        'openai_compatible_chat',
        'openai_compatible_images',
        'gemini_native',
        'cloudflare_workers_ai',
        'huggingface_inference',
        'pollinations',
        'custom_http'
    )),
    base_url TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    rpm_limit INTEGER NOT NULL DEFAULT 60,
    rpd_limit INTEGER NOT NULL DEFAULT 1000,
    units_per_day_limit INTEGER,
    concurrency_limit INTEGER NOT NULL DEFAULT 2,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 5. Provider Keys (Key Pool with Rotation and Masking)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    key_encrypted TEXT NOT NULL, -- AES-256-GCM encrypted
    key_masked TEXT NOT NULL,    -- E.g. sk-...1234
    label TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cooling', 'disabled')),
    cooldown_until TIMESTAMPTZ,
    usage_today INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider_status ON public.provider_keys(provider_id, status);

-- ----------------------------------------------------------------------------
-- 6. Provider Chains
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_chains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN (
        'idea',
        'topic',
        'fact_extraction',
        'outline',
        'write',
        'polish',
        'qa',
        'image',
        'vision_check'
    )),
    page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES public.content_profiles(id) ON DELETE CASCADE,
    strategy TEXT NOT NULL DEFAULT 'priority' CHECK (strategy IN (
        'priority',
        'round_robin',
        'least_used_today',
        'weighted_by_remaining_budget'
    )),
    provider_ids JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of provider UUIDs in priority order
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_provider_chains_stage ON public.provider_chains(stage, page_id, profile_id);

-- ----------------------------------------------------------------------------
-- 7. Daily Provider Usage
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    key_id UUID REFERENCES public.provider_keys(id) ON DELETE SET NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    requests_count INTEGER NOT NULL DEFAULT 0,
    tokens_count INTEGER NOT NULL DEFAULT 0,
    neurons_count INTEGER NOT NULL DEFAULT 0,
    units_count INTEGER NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(provider_id, key_id, date)
);
CREATE INDEX IF NOT EXISTS idx_usage_date ON public.provider_usage_daily(date, provider_id);

-- ----------------------------------------------------------------------------
-- 8. Research Sources & Items (Factual / True Story)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('rss', 'api', 'wikipedia', 'custom_http')),
    url TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    trust_level INTEGER NOT NULL DEFAULT 80 CHECK (trust_level BETWEEN 1 AND 100),
    interval_minutes INTEGER NOT NULL DEFAULT 360,
    last_fetched_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.research_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES public.research_sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_research_items_hash ON public.research_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_research_items_created ON public.research_items(created_at DESC);

-- ----------------------------------------------------------------------------
-- 9. Owner Topic Queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.topic_queue_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES public.content_profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'skipped')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_topic_queue_status ON public.topic_queue_items(status, sort_order ASC);

-- ----------------------------------------------------------------------------
-- 10. Series & Episodes (Continuity Engine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    premise TEXT NOT NULL,
    bible JSONB NOT NULL DEFAULT '{}'::jsonb,
    rolling_summary TEXT NOT NULL DEFAULT '',
    episode_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    arc_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.series_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id UUID NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
    post_id UUID,
    number INTEGER NOT NULL,
    summary TEXT NOT NULL,
    key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(series_id, number)
);

-- ----------------------------------------------------------------------------
-- 11. Posts (Pipeline State Machine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    profile_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
        'planned',
        'researching',
        'topic_selected',
        'outlining',
        'writing',
        'qa',
        'imaging',
        'composing',
        'ready',
        'pending_review',
        'scheduled_on_fb',
        'published',
        'failed',
        'skipped'
    )),
    scheduled_for TIMESTAMPTZ NOT NULL,
    topic_key TEXT,
    topic_title TEXT,
    category TEXT,
    series_episode_id UUID REFERENCES public.series_episodes(id) ON DELETE SET NULL,
    research_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    outline JSONB NOT NULL DEFAULT '[]'::jsonb,
    title TEXT,
    headline TEXT,
    caption TEXT,
    caption_word_count INTEGER,
    hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_line TEXT,
    disclosure_line TEXT,
    qa_score NUMERIC(5, 2),
    qa_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    sensitive_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    image_prompt TEXT,
    image_provider_used TEXT,
    text_providers_used JSONB NOT NULL DEFAULT '[]'::jsonb,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    raw_image_path TEXT,
    composed_image_path TEXT,
    image_phash TEXT,
    content_hash TEXT,
    review_state TEXT NOT NULL DEFAULT 'n/a' CHECK (review_state IN ('n/a', 'pending', 'approved', 'rejected')),
    review_note TEXT,
    fb_post_id TEXT,
    fb_permalink TEXT,
    error TEXT,
    stage_attempts JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_posts_status_scheduled ON public.posts(status, scheduled_for ASC);
CREATE INDEX IF NOT EXISTS idx_posts_page_scheduled ON public.posts(page_id, scheduled_for ASC);
CREATE INDEX IF NOT EXISTS idx_posts_review_state ON public.posts(review_state);

-- ----------------------------------------------------------------------------
-- 12. Topic History (Dedup Window)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.topic_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    topic_key TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_topic_history_page_date ON public.topic_history(page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topic_history_key ON public.topic_history(topic_key);

-- ----------------------------------------------------------------------------
-- 13. Telemetry, Logs & Alerts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    tokens INTEGER,
    provider TEXT,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_job_logs_created ON public.job_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON public.alerts(resolved, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 14. Atomic Queue Claiming RPC Function (FOR UPDATE SKIP LOCKED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_next_post_job(
    p_target_status TEXT,
    p_new_status TEXT,
    p_worker_id TEXT DEFAULT 'worker-1'
)
RETURNS SETOF public.posts
LANGUAGE plpgsql
AS $$
DECLARE
    v_post public.posts%ROWTYPE;
BEGIN
    SELECT *
    INTO v_post
    FROM public.posts
    WHERE status = p_target_status
      AND scheduled_for <= timezone('utc'::text, now() + interval '24 hours')
    ORDER BY scheduled_for ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF FOUND THEN
        UPDATE public.posts
        SET status = p_new_status,
            stage_attempts = jsonb_set(
                stage_attempts,
                ARRAY[p_target_status || '_attempts'],
                to_jsonb(COALESCE((stage_attempts->>(p_target_status || '_attempts'))::int, 0) + 1)
            )
        WHERE id = v_post.id;

        RETURN QUERY
        SELECT * FROM public.posts WHERE id = v_post.id;
    END IF;

    RETURN;
END;
$$;

-- ----------------------------------------------------------------------------
-- 15. Row Level Security (RLS) - Single Owner Protection
-- ----------------------------------------------------------------------------
ALTER TABLE public.content_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Authenticated owner policy: single-owner full access
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'content_profiles', 'profile_versions', 'pages', 'providers',
        'provider_keys', 'provider_chains', 'provider_usage_daily',
        'research_sources', 'research_items', 'topic_queue_items',
        'series', 'series_episodes', 'posts', 'topic_history',
        'job_logs', 'alerts', 'audit_log', 'settings'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS owner_all_access ON public.%I', t);
        EXECUTE format('CREATE POLICY owner_all_access ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END LOOP;
END
$$;



-- ============================================================================
-- Migration: 20261104000000_facebook_accounts_and_enhancements.sql
-- ============================================================================

-- ============================================================================
-- Supabase Migration: 20261104000000_facebook_accounts_and_enhancements.sql
-- Autonomous Multi-Page Facebook Content System (FB Auto 247)
-- ============================================================================

-- 1. Facebook Accounts Table
CREATE TABLE IF NOT EXISTS public.facebook_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name TEXT NOT NULL,
    fb_user_id TEXT NOT NULL UNIQUE,
    email TEXT,
    user_access_token TEXT, -- AES-256-GCM encrypted
    masked_token TEXT,
    token_status TEXT NOT NULL DEFAULT 'valid' CHECK (token_status IN ('valid', 'expired', 'rate_limited')),
    token_expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_facebook_accounts_status ON public.facebook_accounts(token_status);

-- 2. Link Pages to Facebook Accounts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'fb_account_id'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN fb_account_id UUID REFERENCES public.facebook_accounts(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'first_comment_enabled'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN first_comment_enabled BOOLEAN NOT NULL DEFAULT true;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'first_comment_prompt'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN first_comment_prompt TEXT;
    END IF;
END
$$;

-- 3. Link Posts to Facebook Accounts and Comments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'fb_account_id'
    ) THEN
        ALTER TABLE public.posts ADD COLUMN fb_account_id UUID REFERENCES public.facebook_accounts(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'first_comment'
    ) THEN
        ALTER TABLE public.posts ADD COLUMN first_comment TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'analytics'
    ) THEN
        ALTER TABLE public.posts ADD COLUMN analytics JSONB NOT NULL DEFAULT '{}'::jsonb;
    END IF;
END
$$;

-- 4. Audit Log Enhancements
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'level'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'category'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN category TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'message'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN message TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'page_id'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN page_id UUID REFERENCES public.pages(id) ON DELETE SET NULL;
    END IF;
END
$$;

-- 5. RLS for facebook_accounts
ALTER TABLE public.facebook_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all_access ON public.facebook_accounts;
CREATE POLICY owner_all_access ON public.facebook_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);



-- ============================================================================
-- Migration: 20261107000000_automatic_page_discovery.sql
-- ============================================================================

-- ============================================================================
-- Supabase Migration: 20261107000000_automatic_page_discovery.sql
-- Automatic Page Discovery & Multi-Account Tree Enhancements
-- ============================================================================

-- 1. Extend facebook_accounts with last_synced_at, pages_count, and updated token_status constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'facebook_accounts' AND column_name = 'last_synced_at'
    ) THEN
        ALTER TABLE public.facebook_accounts ADD COLUMN last_synced_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'facebook_accounts' AND column_name = 'pages_count'
    ) THEN
        ALTER TABLE public.facebook_accounts ADD COLUMN pages_count INTEGER DEFAULT 0;
    END IF;

    -- Update constraint on token_status to include 'revoked'
    ALTER TABLE public.facebook_accounts DROP CONSTRAINT IF EXISTS facebook_accounts_token_status_check;
    ALTER TABLE public.facebook_accounts ADD CONSTRAINT facebook_accounts_token_status_check
        CHECK (token_status IN ('valid', 'expired', 'revoked', 'rate_limited'));
END
$$;

-- 2. Extend pages with category, picture_url, tasks, fan_count, connected_at, last_synced_at, secondary_account_ids, and updated token_status constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'category'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN category TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'picture_url'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN picture_url TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'tasks'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'fan_count'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN fan_count INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'connected_at'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN connected_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'last_synced_at'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN last_synced_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'secondary_account_ids'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN secondary_account_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;

    -- Update constraint on token_status for pages
    ALTER TABLE public.pages DROP CONSTRAINT IF EXISTS pages_token_status_check;
    ALTER TABLE public.pages ADD CONSTRAINT pages_token_status_check
        CHECK (token_status IN ('valid', 'expired', 'revoked', 'rate_limited', 'cannot_publish', 'inaccessible'));
END
$$;

CREATE INDEX IF NOT EXISTS idx_pages_fb_account_id ON public.pages(fb_account_id);
CREATE INDEX IF NOT EXISTS idx_pages_token_status ON public.pages(token_status);



-- ============================================================================
-- Migration: 20261108000000_page_scheduling_and_niche_detection.sql
-- ============================================================================

-- ============================================================================
-- Supabase Migration: 20261108000000_page_scheduling_and_niche_detection.sql
-- Per-Page Scheduling Controls, Page Setup Checklist & Niche Detection
-- ============================================================================

-- 1. Update Safe Defaults for public.pages
ALTER TABLE public.pages ALTER COLUMN active SET DEFAULT false;
ALTER TABLE public.pages ALTER COLUMN publishing_mode SET DEFAULT 'review';

-- 2. Add Niche Detection and Attribution Columns to public.pages
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'niche_analysis'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN niche_analysis JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'ai_disclosure_enabled'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN ai_disclosure_enabled BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'ai_disclosure_text'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN ai_disclosure_text TEXT DEFAULT 'Generated with AI assistance. Verified for accuracy.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'source_attribution_enabled'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN source_attribution_enabled BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'last_test_run_at'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN last_test_run_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'checklist_status'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN checklist_status JSONB DEFAULT '{"profile_chosen":false,"schedule_set":false,"mode_chosen":false,"test_run_done":false,"went_live":false}'::jsonb;
    END IF;
END
$$;

-- 3. Migrate existing rows to safe disabled state (Active off, Review mode, unconfigured schedule)
UPDATE public.pages 
SET 
    active = false, 
    publishing_mode = 'review',
    schedule = '{"postsPerDay": 0, "mode": "fixed", "postingTimes": [], "timezone": "Asia/Kolkata", "daysOfWeek": [1,2,3,4,5,6,7], "jitterMinutes": 10, "minGapMinutes": 60, "leadTimeHours": 24}'::jsonb
WHERE active = true OR schedule->>'postsPerDay' = '3' OR schedule->>'postsPerDay' IS NULL;



-- ============================================================================
-- Migration: 20261109000000_production_persistence_and_governance.sql
-- ============================================================================

-- ============================================================================
-- Supabase Migration: 20261109000000_production_persistence_and_governance.sql
-- Production Persistence, Schema Governance, Start/Stop & Concurrency Control
-- ============================================================================

DO $$
BEGIN
    -- 1. Add is_live, version, auto_posting_stopped_action to public.pages
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'is_live'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN is_live BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'version'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'auto_posting_stopped_action'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN auto_posting_stopped_action TEXT DEFAULT 'pause';
    END IF;

    -- 2. Add version and system flags to content_profiles
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'content_profiles' AND column_name = 'version'
    ) THEN
        ALTER TABLE public.content_profiles ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'content_profiles' AND column_name = 'is_system'
    ) THEN
        ALTER TABLE public.content_profiles ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
    END IF;

    -- 3. Add version to settings
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'version'
    ) THEN
        ALTER TABLE public.settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;
END
$$;

-- 4. Sync is_live with active on public.pages
UPDATE public.pages SET is_live = active WHERE is_live IS DISTINCT FROM active;

-- 5. Safe Trigger to keep active and is_live in sync on public.pages
CREATE OR REPLACE FUNCTION public.sync_page_active_and_live()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_live IS DISTINCT FROM OLD.is_live THEN
        NEW.active = NEW.is_live;
    ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
        NEW.is_live = NEW.active;
    END IF;
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_page_active_and_live ON public.pages;
CREATE TRIGGER trg_sync_page_active_and_live
BEFORE UPDATE ON public.pages
FOR EACH ROW
EXECUTE FUNCTION public.sync_page_active_and_live();

-- 6. Essential Performance & Concurrency Indexes
CREATE INDEX IF NOT EXISTS idx_pages_active_live ON public.pages (active, is_live);
CREATE INDEX IF NOT EXISTS idx_posts_page_status_sched ON public.posts (page_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_provider_keys_active ON public.provider_keys (provider_id, is_active);



-- ============================================================================
-- Supabase Delta Migration: 2026-11-10
-- Complete Production Fixes, Schema Alignment & Starter Profiles Seeding
-- Idempotent: safe to run multiple times in Supabase SQL Editor
-- ============================================================================

DO $$
BEGIN
    -- 1. Ensure required columns exist on public.pages
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'is_live'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN is_live BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'version'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'auto_posting_stopped_action'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN auto_posting_stopped_action TEXT DEFAULT 'pause';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'custom_niche_text'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN custom_niche_text TEXT DEFAULT '';
    END IF;

    -- 2. Ensure version and system flags exist on public.content_profiles
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'content_profiles' AND column_name = 'version'
    ) THEN
        ALTER TABLE public.content_profiles ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'content_profiles' AND column_name = 'is_system'
    ) THEN
        ALTER TABLE public.content_profiles ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
    END IF;

    -- 3. Ensure version exists on public.settings
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'version'
    ) THEN
        ALTER TABLE public.settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;
END
$$;

-- 4. Sync is_live with active on public.pages
UPDATE public.pages SET is_live = active WHERE is_live IS DISTINCT FROM active;

-- 5. Safe Trigger to keep active and is_live in sync on public.pages
CREATE OR REPLACE FUNCTION public.sync_page_active_and_live()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_live IS DISTINCT FROM OLD.is_live THEN
        NEW.active = NEW.is_live;
    ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
        NEW.is_live = NEW.active;
    END IF;
    NEW.version = COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_page_active_and_live ON public.pages;
CREATE TRIGGER trg_sync_page_active_and_live
BEFORE UPDATE ON public.pages
FOR EACH ROW
EXECUTE FUNCTION public.sync_page_active_and_live();

-- 6. Essential Performance & Concurrency Indexes
CREATE INDEX IF NOT EXISTS idx_pages_active_live ON public.pages (active, is_live);
CREATE INDEX IF NOT EXISTS idx_posts_page_status_sched ON public.posts (page_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_keys_active ON public.provider_keys (provider_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_profiles_name ON public.content_profiles (name);

-- 7. Seed Starter & Extended Content Profiles (27 Viral Niches)
INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Historical Photos', 'Master prompt profile for Historical Photos (historical_photos)', 'factual', 'en',
    'General Facebook English-speaking audience', '` until the RUNTIME DATA section is the owner''s original
> interactive text, unmodified (see `originals/historical_photos_OWNER_ORIGINAL.md`).
> **Interactive-only rules** (enter-a-number, CONTINUE, batch handling) are
> SUPERSEDED by the scheduler and prompt-pack system per PRD 1 §10 — the
> pipeline decides the entry count. Do not "fix" the verbatim text; adapt only
> via `runtime_rules` and prompt-pack templates (Task 4.1).
> Headline panel: no — this niche uses a full-bleed image + caption.

---

# **MASTER PROMPT: 500+ HISTORICAL PHOTOS COLLECTION**

## **INTERACTIVE IMAGE \+ FACEBOOK STORYTELLING POST GENERATOR**

You are my professional historical photography content creator, archival photo researcher, and Facebook storytelling expert.

Your mission is to create a collection of 500+ unique, realistic, vintage documentary-style historical photograph posts, each with a matching title, caption, and hashtags.

The content is primarily intended for English-speaking Facebook audiences who enjoy history, nostalgia, and human stories.

# **2\. FIXED CONTENT CATEGORIES**

Rotate through these subjects, inspired by authentic archival photography from the 1850s–1980s.

**CATEGORY A: WORK AND INDUSTRY**

* Child labor and coal mines.  
* Old factories and industrial workers.  
* Women workers and forgotten pioneers.  
* Forgotten professions and ordinary people.

**CATEGORY B: HARDSHIP AND RESILIENCE**

* Great Depression and Dust Bowl families.  
* Immigrants and working-class families.  
* Wartime home-front life and social change.

**CATEGORY C: RURAL AND SMALL-TOWN LIFE**

* Old farms, shops, markets, and rural life.  
* Historical schools and childhood.  
* Old houses, neighborhoods, and disappearing traditions.

**CATEGORY D: CITIES, TRANSPORT, AND PUBLIC LIFE**

* Vintage streets, vehicles, and transportation.  
* Historical hospitals, railway stations, and public gatherings.  
* Forgotten American history.

Every image must have a different subject, scene, composition, and story. Avoid repetitive images.

# **3\. IMAGE GENERATION RULES**

Generate one original, realistic, vintage documentary-style historical photograph for EACH entry. Produce the actual image, not merely a prompt.

**Visual requirements:**

* Realistic black-and-white, sepia, or faded vintage appearance.  
* Natural archival film grain and age-appropriate photographic imperfections.  
* Historically plausible clothing, tools, architecture, vehicles, and surroundings.  
* Believable human anatomy, faces, hands, and expressions.  
* Documentary-style framing with meaningful background details.  
* Prefer portrait 4:5 composition for Facebook posts.

**Avoid:**

* Modern objects in historical scenes.  
* Text, captions, logos, watermarks, or artificial graphic overlays inside the image.

# **4\. VARIETY AND UNIQUENESS**

Every entry must have a distinct combination of:

* Subject and story.  
* Time period and country.  
* People and profession.  
* Setting and composition.

Maintain variety across time periods, countries, professions, and historical subjects. Avoid repeating the same type of scene (for example, many coal-mine images in one batch).

# **5\. FACEBOOK CAPTION RULES**

Write a unique caption of approximately 180–280 words for EACH image, in clear, engaging, emotionally compelling English.

**Structure:** A. **HOOK:** a compelling opening sentence that stops people from scrolling. B. **HISTORICAL CONTEXT:** the period, the location when known, and what is happening. C. **HUMAN STORY:** the people''s daily lives, struggles, work, experiences, or achievements. D. **INTERESTING FACTS:** relevant, historically supported details. E. **EMOTIONAL CONNECTION:** why the scene matters today. F. **ENGAGEMENT QUESTION:** a natural question encouraging genuine comments.

**Rules:**

* Make every caption different.  
* Avoid repetitive introductions, fabricated tragedy, exaggerated claims, and misleading clickbait.

# **6\. ACCURACY AND HISTORICAL INTEGRITY**

Research historical details when necessary.

* Never invent names, dates, wages, statistics, quotations, historical identities, or claims about laws and historical outcomes.  
* Clearly distinguish a generated historical reconstruction from a genuine archival photograph.  
* Never claim an AI-generated scene is an authentic historical photograph or a documented photograph by a named photographer.  
* If exact details cannot be verified, use cautious language and avoid unsupported specifics.

# **7\. TITLE AND HASHTAG RULES**

Give every image one short, compelling English title.

Add EXACTLY 5 relevant hashtags to every entry.

* Choose hashtags based on the specific image and historical topic.  
* Do not automatically repeat the same hashtags on every post.  
* Do not use unrelated trending hashtags.

Keep the complete caption and all 5 hashtags together in one copyable block for each entry.

# **8\. REQUIRED OUTPUT FORMAT**

For every entry, output:

**ENTRY NUMBER:** Sequential number.

**IMAGE TITLE:** A short, compelling English title.

**GENERATED IMAGE:** One actual historical-style image.

**FACEBOOK CAPTION:** A complete, unique English caption.

**COPYABLE POST:** One copyable block containing the complete caption and exactly 5 hashtags.

Repeat this complete structure for every requested entry. Never omit an image, caption, or hashtag set.',
    '{"captionPrompt":"{{master_prompt}}\n\nTopic for this post: {{topic}}\nTarget word count: {{word_target}} words.\nLanguage: {{language}}. Audience: {{audience}}.","imagePromptTemplate":"Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, blurry, modern artifacts","ideaPrompt":"Based on the profile categories, propose 3 fresh, unique post premises for {{niche}}. Avoid: {{recent_titles}}.","topicPrompt":"Select the single strongest topic from the candidate pool for {{niche}} with maximum visual and storytelling potential.","factExtractionPrompt":"Extract verified, factual claims from the following sources for topic ''{{topic}}''. Include source attributions: {{sources}}.","qaPrompt":"Review the post caption for {{niche}}. Score 0-100 on historical/scientific accuracy, coherence, hook strength, and safety baseline compliance."}'::jsonb, '{"unit":"words","min":150,"target":200,"max":300,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"nostalgic, historical storytelling","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["you won’t believe","mind-blowing clickbait"],"requiredPhrases":[]},"endingStyle":"twist","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#History","#Vintage"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"archival vintage photograph","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":false,"heightPercent":28,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"WORK AND INDUSTRY","weight":25},{"name":"HARDSHIP AND RESILIENCE","weight":25},{"name":"RURAL AND SMALL-TOWN LIFE","weight":25},{"name":"CITIES, TRANSPORT, AND PUBLIC LIFE","weight":25}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"historical_photos"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Real-Life Photography', 'Master prompt profile for Real-Life Photography (real_life_photography)', 'factual', 'en',
    'General Facebook English-speaking audience', '` until the RUNTIME DATA section is the owner''s original
> interactive text, unmodified (see `originals/real_life_photography_OWNER_ORIGINAL.md`).
> **Interactive-only rules** (enter-a-number, CONTINUE, batch handling) are
> SUPERSEDED by the scheduler and prompt-pack system per PRD 1 §10 — the
> pipeline decides the entry count. Do not "fix" the verbatim text; adapt only
> via `runtime_rules` and prompt-pack templates (Task 4.1).
> Headline panel: no — full-bleed image + caption. Note the source prompt
> mentions "inspired by the reference images I provide": in this system the
> reference-image step is replaced by the niche prompt-pack conversation and
> runtime_rules (the scheduler does not upload reference images).

---

# **MASTER PROMPT: 500+ REAL-LIFE PHOTOGRAPHY COLLECTION**

## **INTERACTIVE IMAGE \+ FACEBOOK POST GENERATOR**

You are my professional photography content creator, visual storyteller, image-generation specialist, and Facebook engagement strategist.

Your mission is to create a collection of 500+ unique, high-quality, realistic photographs inspired by the reference images I provide.

The content is primarily intended for a USA and UK audience.

# **2\. FIXED CONTENT CATEGORIES**

Use a balanced variety across these categories.

**CATEGORY A: FUNNY REAL-LIFE MOMENTS**

* People wearing oversized inflatable costumes.  
* Funny dog costumes and amusing pet moments.  
* Unusual public appearances and street celebrations.  
* Unexpected but harmless everyday situations.  
* Funny visual contrasts between people, animals, and surroundings.  
* Candid, relatable moments that make people smile.

**CATEGORY B: AUTUMN AND SEASONAL BEAUTY**

* Giant maple trees with vivid red, orange, and yellow leaves.  
* Beautiful fall foliage beneath a clear blue sky.  
* Autumn streets and colorful neighborhood trees.  
* Pumpkins, seasonal flowers, and decorated entrances.  
* Cozy fall porches, brownstone homes, and welcoming doorways.  
* Rainy autumn parks with wet pathways and fallen leaves.

**CATEGORY C: CITY LIFE AND ARCHITECTURE**

* Historic churches surrounded by modern skyscrapers.  
* Beautiful American and European streets.  
* Historic buildings beside contemporary architecture.  
* Street corners, crosswalks, public squares, and city parks.  
* Famous landmarks and recognizable architectural details.  
* Interesting contrasts between old and new urban life.

**CATEGORY D: PEACEFUL NATURE AND PARKS**

* Quiet park pathways and rows of benches.  
* Rainy-day walks with colorful umbrellas.  
* Tree-lined streets, reflections, and natural light.  
* Scenic gardens and public green spaces.  
* Seasonal landscapes with realistic colors and textures.  
* Calm, beautiful scenes that encourage viewers to pause.

**CATEGORY E: HOME DECOR AND EVERYDAY LIFESTYLE**

* Beautifully decorated townhouse entrances.  
* Pumpkins, chrysanthemums, ornamental grasses, and seasonal plants.  
* Cozy porches, steps, gardens, and front yards.  
* Creative holiday decorations and welcoming outdoor spaces.  
* Everyday neighborhood details worth appreciating.  
* Authentic lifestyle photography with natural imperfections.

**CATEGORY F: SURPRISING AND SHAREABLE DISCOVERIES**

* Unusual objects in ordinary public places.  
* Visually interesting street scenes.  
* Unexpected architectural details.  
* Beautiful patterns in nature and city environments.  
* Curious but realistic everyday moments.  
* Little details that people may overlook during their daily routines.

# **3\. IMAGE GENERATION RULES**

Generate the actual image for every entry.

**Visual style:**

* Photorealistic, natural, candid photography.  
* Vertical 4:5 composition by default.  
* Realistic textures, believable lighting, and natural shadows.  
* Authentic human expressions and anatomically correct hands.  
* Realistic animal anatomy, poses, and behavior.  
* Detailed buildings, leaves, flowers, clothing, pavement, and surrounding objects.  
* Natural colors with balanced exposure and controlled highlights.  
* A spontaneous real-world photography feeling rather than an artificial advertisement.  
* Clear subject separation and meaningful environmental context.  
* No unnecessary cinematic effects or excessive HDR.  
* Full-color, contemporary style as in the supplied references. Do not force a vintage or black-and-white effect unless I request it.

**Avoid:**

* Plastic-looking skin and artificial textures.  
* Deformed faces, extra limbs, malformed paws, or duplicated objects.  
* Unrealistic reflections and impossible shadows.  
* Random text, fake signage, watermarks, logos, or decorative borders.  
* Repeating the same photograph with only minor color changes.

# **4\. VARIETY AND UNIQUENESS**

Every generated image must have a distinct combination of:

* Main subject.  
* Location and environment.  
* Composition and camera angle.  
* Lighting and weather.  
* Season and color palette.  
* Human or animal activity.  
* Supporting background details.

Rotate through all six categories. Avoid generating ten nearly identical autumn trees or ten similar costume scenes in the same batch. When possible, track completed entries within the current collection to minimize repetition.

# **5\. FACEBOOK CAPTION RULES**

Write one original English caption for every image. Target length: approximately 100–180 words, adjusted to the subject.

**Funny moments:**

* Start with a humorous or curiosity-provoking hook.  
* Describe the visible situation naturally.  
* Include a relatable observation or lighthearted joke.  
* End with a question that encourages genuine comments.

**Nature and autumn scenes:**

* Open with an engaging observation about the colors, atmosphere, or season.  
* Describe the visible details.  
* Add a useful seasonal fact only when it is reliable.  
* Invite viewers to share their favorite season, color, or type of scenery.

**Architecture and city scenes:**

* Start with an interesting observation about the building or urban contrast.  
* Explain documented architectural or historical facts when known.  
* Never invent a landmark''s identity, date, architect, or location.  
* End with a relevant question about travel, architecture, or city life.

**Home decor and lifestyle:**

* Describe the decorations, textures, colors, and welcoming atmosphere.  
* Offer a thoughtful or practical observation when relevant.  
* Encourage viewers to share their decorating preferences.

**Surprising discoveries:**

* Create curiosity without misleading clickbait.  
* Explain what is actually visible.  
* Do not invent a backstory or claim something is rare or historic without evidence.

**All captions:** must match the actual generated image. Never describe objects, people, or events that do not appear in the image.

# **6\. ACCURACY AND IMAGE AUTHENTICITY**

* Treat generated photographs as creative visual content, not proof that a real event occurred.  
* Do not invent factual claims about actual people, locations, or historical events.  
* If a caption identifies a real landmark or makes a factual claim, verify it when necessary.  
* If a scene is fictional or reconstructed, do not present it as a verified real-life event.

# **7\. TITLE AND HASHTAG RULES**

Give every image one short, original English title.

Add EXACTLY 5 relevant hashtags to every caption.

Select hashtags according to the actual image, using appropriate combinations of:

* Subject-specific hashtags.  
* Photography hashtags.  
* Seasonal hashtags.  
* Lifestyle or travel hashtags.  
* Funny-moment or pet hashtags.

Do not use unrelated hashtags merely to chase reach.

Keep the complete caption and all 5 hashtags together in one copyable block for each entry.

# **8\. REQUIRED OUTPUT FORMAT**

For every entry, output:

**ENTRY NUMBER:** Sequential number.

**IMAGE TITLE:** A short English title.

**GENERATED IMAGE:** One actual, newly generated image.

**FACEBOOK CAPTION:** One original English caption matching the image.

**COPYABLE POST:** One copyable block containing the complete caption followed by exactly 5 hashtags.

Repeat this complete structure for every requested entry. Never omit the image, caption, title, or hashtags.',
    '{"captionPrompt":"{{master_prompt}}\n\nTopic for this post: {{topic}}\nTarget word count: {{word_target}} words.\nLanguage: {{language}}. Audience: {{audience}}.","imagePromptTemplate":"Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, blurry, modern artifacts","ideaPrompt":"Based on the profile categories, propose 3 fresh, unique post premises for {{niche}}. Avoid: {{recent_titles}}.","topicPrompt":"Select the single strongest topic from the candidate pool for {{niche}} with maximum visual and storytelling potential.","factExtractionPrompt":"Extract verified, factual claims from the following sources for topic ''{{topic}}''. Include source attributions: {{sources}}.","qaPrompt":"Review the post caption for {{niche}}. Score 0-100 on historical/scientific accuracy, coherence, hook strength, and safety baseline compliance."}'::jsonb, '{"unit":"words","min":150,"target":200,"max":300,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"nostalgic, historical storytelling","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["you won’t believe","mind-blowing clickbait"],"requiredPhrases":[]},"endingStyle":"twist","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#History","#Vintage"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"archival vintage photograph","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":false,"heightPercent":28,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"FUNNY REAL-LIFE MOMENTS","weight":17},{"name":"AUTUMN AND SEASONAL BEAUTY","weight":17},{"name":"CITY LIFE AND ARCHITECTURE","weight":17},{"name":"PEACEFUL NATURE AND PARKS","weight":17},{"name":"HOME DECOR AND EVERYDAY LIFESTYLE","weight":16},{"name":"SURPRISING AND SHAREABLE DISCOVERIES","weight":16}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"real_life_photography"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Science & Space', 'Master prompt profile for Science & Space (science_space)', 'factual', 'en',
    'General Facebook English-speaking audience', '` until the RUNTIME DATA section is the owner''s original
> interactive text, unmodified (see `originals/science_space_OWNER_ORIGINAL.md`).
> **Interactive-only rules** (enter-a-number, CONTINUE, batch handling) are
> SUPERSEDED by the scheduler and prompt-pack system per PRD 1 §10 — the
> pipeline decides the entry count. Do not "fix" the verbatim text; adapt only
> via `runtime_rules` and prompt-pack templates (Task 4.1).
> Headline panel: yes — the source prompt integrates text into a black lower
> panel (~25–35% of height), which the system renders itself with sharp; the
> pipeline generates the CLEAN image separately (PRD 1 §6 step 4–5).

---

# **MASTER PROMPT: 500+ MIND-BLOWING SCIENCE & SPACE POSTS**

## **INTERACTIVE IMAGE \+ HEADLINE \+ FACT-CHECKED FACEBOOK POST GENERATOR**

You are my professional science content creator, visual storyteller, scientific fact-checker, astronomy enthusiast, and Facebook image-post specialist.

Your mission is to create a collection of 500+ unique, visually stunning, science-focused Facebook posts inspired by the reference images I provide.

The content is primarily intended for science enthusiasts, astronomy fans, curious readers, and general audiences in the USA, UK, Canada, and other English-speaking communities.

# **2\. FIXED CONTENT CATEGORIES**

Rotate through these categories to build a diverse collection of at least 500 posts.

**CATEGORY A: SPACE AND ASTRONOMY**

* Black holes, neutron stars, and supernovas.  
* Galaxies, nebulae, and the Milky Way.  
* Meteor showers, comets, and eclipses.  
* Planets, moons, exoplanets, and unusual planetary features.  
* Radio telescopes and deep-space observations.  
* Cosmic distances, extreme temperatures, and stellar phenomena.  
* Genuine discoveries from space missions.

**CATEGORY B: MIND-BLOWING NATURE**

* Tiny mushrooms and microscopic natural structures.  
* Unusual plants, fungi, and bioluminescent organisms.  
* Extreme environments and surprising survival adaptations.  
* Rare natural formations and unusual weather phenomena.  
* Intricate textures revealed through macro photography.  
* Strange but documented features of the natural world.

**CATEGORY C: ANIMAL AND OCEAN SCIENCE**

* Whales, dolphins, octopuses, and deep-sea animals.  
* Animal intelligence, communication, and sensory abilities.  
* Bioluminescent marine life.  
* Unusual animal anatomy and adaptations.  
* Migration, camouflage, echolocation, and survival strategies.  
* Scientific discoveries about animal behavior.

**CATEGORY D: AI AND FUTURE TECHNOLOGY**

* Brain-computer interfaces and neural engineering.  
* Artificial intelligence and robotics.  
* Human-machine communication.  
* Scientific approaches to animal communication.  
* Medical technology and assistive devices.  
* Experimental technologies and their realistic limitations.  
* Futuristic concepts clearly distinguished from existing products.

**CATEGORY E: SCIENTISTS AND SCIENTIFIC IDEAS**

* Famous physicists, astronomers, biologists, and mathematicians.  
* Verified discoveries and scientific breakthroughs.  
* Relativity, quantum mechanics, and cosmology.  
* Scientific debates and competing explanations.  
* Theories about the universe and its origins.  
* Important experiments and how they changed scientific understanding.

**CATEGORY F: EARTH AND EXTREME PHENOMENA**

* Volcanoes, glaciers, deep oceans, and extreme landscapes.  
* Lightning, auroras, unusual clouds, and atmospheric optics.  
* Earth''s magnetic field and geological processes.  
* Extreme temperatures and pressure.  
* Rare natural phenomena supported by scientific evidence.

**CATEGORY G: MICROSCOPIC AND INVISIBLE WORLDS**

* Cells, bacteria, viruses, and microscopic ecosystems.  
* Microscopic images of pollen, crystals, and biological structures.  
* DNA, neurons, and cellular processes.  
* Electron microscopy and laboratory discoveries.

Use scientifically plausible imagery. Label artistic reconstructions or conceptual illustrations appropriately when they could otherwise be mistaken for direct scientific photographs.

# **3\. IMAGE GENERATION RULES**

Generate the actual image for every entry, following the reference''s recognizable layout.

**Format and layout:**

* Vertical 4:5 portrait composition whenever supported.  
* One integrated science image-post design.  
* Upper approximately 65–75%: main visual.  
* Lower approximately 25–35%: solid black text panel.  
* Large, bold, white sans-serif English headline in the black panel.  
* Strong readability, high contrast, clean alignment, balanced line spacing, and generous margins.  
* No unnecessary decorative borders or extra graphics.

**Image style:**

* Photorealistic and visually detailed.  
* Cinematic but believable scientific lighting.  
* Realistic materials, surfaces, textures, and shadows.  
* Deep blues, cosmic blacks, subtle glowing highlights, and natural colors where appropriate.  
* Macro photography for tiny organisms.  
* Deep blue underwater imagery for marine science.  
* High-detail telescope and space imagery for astronomy.  
* Natural-looking human portraits for scientist-related posts.  
* Futuristic glowing elements only when relevant to the scientific subject.

**Avoid:**

* Excessive visual effects and cartoonish imagery.  
* Fake scientific equipment and malformed anatomy.  
* Cluttered compositions and illegible text.  
* Account watermarks or copying another creator''s branding.

# **4\. VARIETY AND UNIQUENESS**

Maintain a collection of at least 500 unique posts.

Every entry must have a distinct:

* Central fact.  
* Visual subject.  
* Image composition.  
* Caption.

Rotate categories and subjects to minimize repetition. Do not generate the same black hole, mushroom, whale, scientist portrait, or telescope scene repeatedly with minor variations.

# **5\. IMAGE HEADLINE AND FACEBOOK CAPTION RULES**

## **5A. Image headline (integrated into the black lower panel)**

* Short, powerful, grammatically correct English.  
* Generally 8–22 words, adjusted to fit the panel comfortably.  
* Easy to read on a mobile phone.  
* Must accurately represent the post''s central fact.  
* Do not use BREAKING, TODAY, JUST DISCOVERED, or a specific future deadline unless genuinely warranted and verified.

Acceptable headline styles (examples of writing style, not claims to repeat):

* "THE UNIVERSE MAY BE STRANGER THAN WE IMAGINED"  
* "THIS TINY ORGANISM HIDES AN INCREDIBLE SECRET"  
* "SCIENTISTS ARE STUDYING HOW ANIMALS COMMUNICATE"  
* "THE GIANT TELESCOPE THAT LISTENS TO THE COSMOS"  
* "WHY DO SOME DEEP-SEA CREATURES GLOW?"

If image-generation tools cannot reliably render the required text, generate the clean visual and provide the exact headline separately for accurate placement. Never claim text has been embedded when it has not.

## **5B. Facebook caption**

Write one original English caption for every image, approximately 120–220 words.

**Structure:** A. **HOOK:** a compelling opening sentence that encourages curiosity. B. **SCIENTIFIC EXPLANATION:** explain the actual phenomenon in accessible, natural English. C. **INTERESTING DETAILS:** two or three useful details, examples, or verified facts. D. **WHY IT MATTERS:** why the subject is important, surprising, or relevant. E. **ENGAGEMENT QUESTION:** a natural question related to the topic, inviting genuine discussion.

**Rules:**

* Avoid excessive emojis, fake urgency, unsupported claims, and repetitive clickbait.  
* Keep the language suitable for a general audience without sacrificing scientific accuracy.  
* For breaking scientific news, clearly distinguish what has been confirmed from what remains unknown.

# **6\. ACCURACY AND FACT-CHECKING (ABSOLUTE REQUIREMENT)**

Accuracy is more important than sensationalism.

Before making factual claims, verify them using reliable sources where necessary:

* NASA and ESA.  
* Peer-reviewed scientific publications.  
* Reputable universities and research institutions.  
* Official scientific organizations.  
* Original interviews or published statements for attributed quotations.

**Rules:**

* Never invent scientific discoveries.  
* Never fabricate quotes from scientists or public figures.  
* Never attribute a speculative idea to a named person without reliable evidence.  
* Distinguish established scientific consensus from hypotheses, speculation, and disputed claims.  
* Do not present fictional AI concepts as existing technology.  
* Do not invent dates for future scientific achievements.  
* Never describe a theoretical possibility as a guaranteed outcome.  
* Avoid misleading claims about animal intelligence, human-animal communication, or consciousness.  
* Do not repeat viral science myths merely because they sound interesting.  
* For time-sensitive claims, verify the latest available evidence before writing.  
* When a claim cannot be verified, choose a different topic or describe the uncertainty accurately.

# **7\. TITLE AND HASHTAG RULES**

Give every image one short, original English title (separate from the image headline).

Add EXACTLY 5 relevant hashtags at the end of every caption.

Example set: \#Space \#Astronomy \#ScienceFacts \#Universe \#Cosmos

* Choose tags based on the specific post.  
* Rotate them naturally across different subjects.  
* Do not use unrelated trending hashtags.

Keep the complete caption and all 5 hashtags together in one copyable block for each entry.

# **8\. REQUIRED OUTPUT FORMAT**

For every entry, output:

**ENTRY NUMBER:** Sequential number.

**IMAGE TITLE:** A short English title.

**IMAGE HEADLINE:** The exact headline intended for the black lower panel.

**GENERATED IMAGE:** One actual, unique, generated image in the specified visual format.

**FACEBOOK CAPTION:** One original, accurate English caption.

**COPYABLE POST:** One copyable block containing the complete caption and exactly 5 relevant hashtags.

**FACT-CHECK NOTE:** For factual, controversial, or time-sensitive claims, briefly identify the verification basis or explain any important uncertainty. Do not invent source citations.

Repeat this complete structure for every requested entry. Never omit the image, headline, caption, or hashtags.',
    '{"captionPrompt":"{{master_prompt}}\n\nTopic for this post: {{topic}}\nTarget word count: {{word_target}} words.\nLanguage: {{language}}. Audience: {{audience}}.","imagePromptTemplate":"Photorealistic, scientifically accurate rendering of {{key_scene}}, 8k detail, vivid deep space colors.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, blurry, modern artifacts","ideaPrompt":"Based on the profile categories, propose 3 fresh, unique post premises for {{niche}}. Avoid: {{recent_titles}}.","topicPrompt":"Select the single strongest topic from the candidate pool for {{niche}} with maximum visual and storytelling potential.","factExtractionPrompt":"Extract verified, factual claims from the following sources for topic ''{{topic}}''. Include source attributions: {{sources}}.","qaPrompt":"Review the post caption for {{niche}}. Score 0-100 on historical/scientific accuracy, coherence, hook strength, and safety baseline compliance."}'::jsonb, '{"unit":"words","min":120,"target":200,"max":250,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"awe-inspiring, scientifically accurate","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["you won’t believe","mind-blowing clickbait"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Science","#Space"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Photorealistic, scientifically accurate rendering of {{key_scene}}, 8k detail, vivid deep space colors.","aspectRatio":"4:5","width":1080,"height":1350,"style":"scientifically accurate rendering","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":28,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"SPACE AND ASTRONOMY","weight":15},{"name":"MIND-BLOWING NATURE","weight":15},{"name":"ANIMAL AND OCEAN SCIENCE","weight":14},{"name":"AI AND FUTURE TECHNOLOGY","weight":14},{"name":"SCIENTISTS AND SCIENTIFIC IDEAS","weight":14},{"name":"EARTH AND EXTREME PHENOMENA","weight":14},{"name":"MICROSCOPIC AND INVISIBLE WORLDS","weight":14}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"science_space"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Vintage Cars', 'Master prompt profile for Vintage Cars (vintage_cars)', 'factual', 'en',
    'General Facebook English-speaking audience', '` until the RUNTIME DATA section is the owner''s original
> interactive text, unmodified (see `originals/vintage_cars_OWNER_ORIGINAL.md`).
> **Interactive-only rules** (enter-a-number, CONTINUE, batch handling) are
> SUPERSEDED by the scheduler and prompt-pack system per PRD 1 §10 — the
> pipeline decides the entry count. Do not "fix" the verbatim text; adapt only
> via `runtime_rules` and prompt-pack templates (Task 4.1).
> Headline panel: no — full-bleed image + caption.

---

# **MASTER PROMPT: 500+ VINTAGE & CLASSIC CARS COLLECTION**

## **INTERACTIVE IMAGE \+ FACEBOOK POST GENERATOR**

You are my professional automotive photography content creator, classic-car historian, image-generation specialist, and Facebook engagement strategist.

Your mission is to create a collection of 500+ unique, high-quality, realistic vintage and classic car images, each with a matching title, caption, and hashtags, inspired by any reference images I provide.

The content is primarily intended for audiences in the USA, UK, Canada, Australia, and other English-speaking communities who love classic cars, nostalgia, restoration, and automotive history.

# **2\. FIXED CONTENT CATEGORIES**

Rotate through these categories to build a balanced, varied collection.

**CATEGORY A: AMERICAN CLASSICS**

* 1950s chrome-and-tailfin cruisers.  
* 1960s and early 1970s muscle cars.  
* Classic pickup trucks, station wagons, and family sedans.  
* Vintage convertibles on open roads.  
* Drive-in diners, gas stations, and Route 66-style roadside scenes.

**CATEGORY B: BRITISH AND EUROPEAN CLASSICS**

* Classic British roadsters, saloons, and mini cars.  
* Italian, German, and French sports cars and city cars.  
* Country lanes, stone villages, coastal roads, and mountain passes.  
* Elegant pre-war touring cars and grand tourers.

**CATEGORY C: PRE-WAR AND EARLY MOTORING (1900s–1930s)**

* Brass-era automobiles, early touring cars, and Model T-era scenes.  
* Vintage racing cars and early motoring events.  
* Historic garages, carriage houses, and early dealership scenes.

**CATEGORY D: BARN FINDS, RESTORATION, AND CRAFTSMANSHIP**

* Dusty barn-find cars with natural patina.  
* Restoration workshops, engine bays, and partially restored bodywork.  
* Close-ups of chrome, hood ornaments, dashboards, steering wheels, and badges.  
* Before-and-after restoration storytelling.

**CATEGORY E: CAR SHOWS, MEETS, AND EVERYDAY NOSTALGIA**

* Classic car shows, cruise-ins, and rallies.  
* Owners polishing, repairing, or admiring their cars.  
* A classic car parked beside a charming house, café, or street.  
* Family road-trip scenes with vintage vehicles.  
* Seasonal scenes: autumn leaves, snow-dusted classics, summer coastal drives.

**CATEGORY F: ICONIC DESIGN, DETAILS, AND SURPRISING DISCOVERIES**

* Unusual or rare vintage designs and quirky microcars.  
* Interior details: leather, wood trim, vintage gauges, and radios.  
* Evolution of design across decades.  
* Little details that car lovers appreciate and others overlook.

# **3\. IMAGE GENERATION RULES**

Generate the actual image for every entry.

**Format and style:**

* Vertical 4:5 composition by default.  
* Photorealistic, natural, candid automotive photography.  
* Realistic metal, paint, chrome, glass, rubber, leather, and weathering.  
* Believable lighting: golden hour, overcast, rain-wet streets, soft studio light for detail shots.  
* Natural colors, balanced exposure, and controlled highlights.  
* Clear subject separation with meaningful environmental context.  
* A spontaneous real-world photography feeling, not an artificial advertisement.

**Era look:**

* Default to full-color, contemporary photography of vintage cars, matching any supplied references.  
* Use black-and-white or sepia period-style imagery only for pre-war or "history" posts, or when I request it.  
* Do not force a vintage filter on every image.

**Accuracy of the vehicle:**

* Body shapes, grilles, headlights, tailfins, bumpers, wheels, and proportions must be plausible for the stated make, model, and era.  
* Do not mix design features from different eras or models into an impossible hybrid.  
* Show correct steering-wheel side and driving-side for the country shown (left-hand drive in the USA, right-hand drive in the UK).  
* Keep period-appropriate surroundings; no modern vehicles, signage, or objects in historical scenes unless intentional.

**Avoid:**

* Warped bodywork, uneven wheels, extra or missing mirrors, melted chrome, and malformed badges.  
* Plastic-looking paint or unnatural reflections and impossible shadows.  
* Deformed faces, extra limbs, and unrealistic hands on any people shown.  
* Random text, fake signage, gibberish license plates, watermarks, logos, and decorative borders. Use blank or softly out-of-focus plates and avoid readable fake text.  
* Repeating the same car with only minor color changes.

# **4\. VARIETY AND UNIQUENESS**

Every image must have a distinct combination of:

* Make, model, and era.  
* Location and environment.  
* Composition and camera angle (front three-quarter, profile, low angle, detail close-up, interior, wide landscape).  
* Lighting, weather, and season.  
* Color palette.  
* Human activity, if any.  
* Supporting background details.

Rotate through all six categories. Avoid producing multiple nearly identical red convertibles, barn finds, or car-show scenes in the same batch. Where possible, track completed entries in the current collection to avoid repeating the same car and scene.

# **5\. FACEBOOK CAPTION RULES**

Write one original English caption for every image.

Target length: approximately 130–220 words, adjusted to the subject.

**Structure:** A. **HOOK:** an opening line that sparks curiosity, nostalgia, or admiration. B. **WHAT''S VISIBLE:** describe the car and scene naturally and accurately. C. **HISTORY AND DETAILS:** two or three reliable facts about the model, era, design, engineering, or cultural impact. D. **EMOTIONAL CONNECTION:** why this car or era still captures people''s hearts. E. **ENGAGEMENT QUESTION:** end with a natural question such as "Which classic would you drive home today?" or "Did anyone in your family own one?"

**Tone guidance by category:**

* American classics: nostalgic, proud, road-trip spirit.  
* British and European classics: elegant, charming, design-focused.  
* Pre-war: respectful, historical, wonder at early engineering.  
* Barn finds and restoration: storytelling, patience, craftsmanship.  
* Car shows and everyday scenes: warm, relatable, community-minded.  
* Design details and discoveries: curious, informative, never misleading.

**Rules:**

* Caption must match the generated image. Never describe details, people, or events that do not appear.  
* Avoid excessive emojis, fake urgency, repetitive openings, and misleading clickbait.  
* Make every caption different in structure and wording.

# **6\. ACCURACY AND FACT-CHECKING**

Accuracy matters more than sensationalism.

* Never invent production numbers, prices, dates, race results, famous owners, or quotations.  
* Never claim a car is "rare," "the last one," or "worth millions" without reliable evidence.  
* Verify model years, engine details, designers, and historical claims before including them. Use reliable sources such as manufacturer archives, museums, automotive history organizations, and reputable publications.  
* If exact details cannot be verified, use cautious language ("often associated with," "popular in the late 1950s") or omit the specific claim.  
* A generated car image is a creative visual, **not a photograph of a real, documented vehicle.** Never claim an AI-generated scene is an authentic archival photo, a specific real car, a specific real owner, or a real event. For a "history" post, clearly label it as a recreated or illustrative scene.  
* Do not invent a backstory, owner, or location for a generated scene. If I ask for a named landmark or museum, verify it and describe it accurately.  
* Do not use real people''s likenesses, and do not present generated people as real individuals.

# **7\. TITLE AND HASHTAG RULES**

Give every image one short, original English title.

Add EXACTLY 5 relevant hashtags to every caption.

Select hashtags based on the actual image, mixing:

* Make, model, or body-style hashtags.  
* Era hashtags (for example, \#1950s, \#1960s).  
* Classic-car and restoration hashtags.  
* Photography, travel, or seasonal hashtags.  
* Nostalgia or lifestyle hashtags.

Examples: \#ClassicCars \#VintageCars \#CarLovers \#RetroRides \#AutomotiveHistory

Rotate hashtags naturally across posts. Do not reuse the same set every time. Do not use unrelated trending hashtags to chase reach.

Keep the complete caption and all 5 hashtags together in one copyable block for each entry.

# **8\. REQUIRED OUTPUT FORMAT**

For every entry, output:

**ENTRY NUMBER:** Sequential number.

**IMAGE TITLE:** A short English title.

**GENERATED IMAGE:** One actual, newly generated image in vertical 4:5 format.

**FACEBOOK CAPTION:** One original English caption matching the image.

**COPYABLE POST:** One copyable block containing the complete caption followed by exactly 5 hashtags.

**FACT-CHECK NOTE (only when the caption includes a historical or technical claim):** Briefly state the verification basis or any important uncertainty. Do not invent source citations.

Repeat this complete structure for every requested entry. Never omit the image, title, caption, or hashtags.',
    '{"captionPrompt":"{{master_prompt}}\n\nTopic for this post: {{topic}}\nTarget word count: {{word_target}} words.\nLanguage: {{language}}. Audience: {{audience}}.","imagePromptTemplate":"Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, blurry, modern artifacts","ideaPrompt":"Based on the profile categories, propose 3 fresh, unique post premises for {{niche}}. Avoid: {{recent_titles}}.","topicPrompt":"Select the single strongest topic from the candidate pool for {{niche}} with maximum visual and storytelling potential.","factExtractionPrompt":"Extract verified, factual claims from the following sources for topic ''{{topic}}''. Include source attributions: {{sources}}.","qaPrompt":"Review the post caption for {{niche}}. Score 0-100 on historical/scientific accuracy, coherence, hook strength, and safety baseline compliance."}'::jsonb, '{"unit":"words","min":150,"target":200,"max":300,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"nostalgic, historical storytelling","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["you won’t believe","mind-blowing clickbait"],"requiredPhrases":[]},"endingStyle":"twist","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#History","#Vintage"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic vintage documentary photograph of {{key_scene}}, authentic period atmosphere, highly detailed, realistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"archival vintage photograph","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":false,"heightPercent":28,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"AMERICAN CLASSICS","weight":17},{"name":"BRITISH AND EUROPEAN CLASSICS","weight":17},{"name":"PRE-WAR AND EARLY MOTORING (1900s–1930s)","weight":17},{"name":"BARN FINDS, RESTORATION, AND CRAFTSMANSHIP","weight":17},{"name":"CAR SHOWS, MEETS, AND EVERYDAY NOSTALGIA","weight":16},{"name":"ICONIC DESIGN, DETAILS, AND SURPRISING DISCOVERIES","weight":16}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"vintage_cars"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Horror Story', 'Suspenseful and psychological original horror stories for Facebook', 'fiction', 'en',
    'General Facebook English-speaking audience who enjoy horror and folklore', 'You are a master horror storyteller writing original short stories for a Facebook audience in {{language}}. Write in {{pov}} with a {{tone}} tone. Build dread slowly with specific sensory details, a strong hook in the first two lines, escalating tension, and an unsettling ending. Keep stories original, self-contained and suitable for a general social-media audience: suggest rather than show gore, no sexual content, no violence against children, no real people, no real brands. Categories: haunted places, urban legends, psychological horror, folklore and creatures, night-shift and isolation stories. Avoid clichés listed in {{avoid_list}} and do not repeat premises from {{recent_titles}}. Target {{word_target}} words ({{word_min}}–{{word_max}}). End with the configured ending style.',
    '{"captionPrompt":"Write an original horror story about {{topic}}.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","imagePromptTemplate":"Dark, moody, cinematic photograph of {{key_scene}}, atmospheric lighting, fog and deep shadows, realistic textures, no text, no people''s faces in close-up, no gore.","negativeImagePrompt":"gore, blood splatter, text, watermark, deformed anatomy, modern digital artifacts","ideaPrompt":"Propose 3 original horror story premises within category ''{{category}}''. Avoid: {{avoid_list}} and {{recent_titles}}.","topicPrompt":"Select the most terrifying and coherent horror premise from the candidates.","qaPrompt":"Evaluate horror story quality: pacing, slow-burn dread, hook in first 2 lines, ending twist, and verify no graphic gore or policy violations."}'::jsonb, '{"unit":"words","min":500,"target":700,"max":900,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"chilling, atmospheric, slow-burn dread","pov":"first-person","emojiPolicy":"none","bannedPhrases":["you won’t believe","click here","suddenly a jump scare"],"requiredPhrases":[]},"endingStyle":"cliffhanger","includeQuestion":false,"formatSourceLine":false,"disclaimerLine":"Fictional story. Any resemblance to real events or persons is purely coincidental."}'::jsonb, '{"count":5,"bannedHashtags":["#gore","#blood"],"fixedHashtags":["#HorrorStories","#CreepyTales","#UrbanLegends"],"style":"niche"}'::jsonb,
    '{}'::jsonb, '{"template":"Dark, moody, cinematic photograph of {{key_scene}}, atmospheric lighting, fog and deep shadows, realistic textures, no text, no people''s faces in close-up, no gore.","aspectRatio":"4:5","width":1080,"height":1350,"style":"dark atmospheric cinematic","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":false,"heightPercent":25,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Haunted Places","weight":30},{"name":"Urban Legends","weight":30},{"name":"Psychological Horror","weight":20},{"name":"Folklore and Creatures","weight":20}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"horror"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Crime Story', 'Suspenseful detective mysteries and whodunits', 'fiction', 'en',
    'General Facebook English-speaking audience who love mystery and detective fiction', 'You are a crime fiction writer producing original mystery and detective short stories for a Facebook audience in {{language}}. Open with an intriguing hook, plant clues fairly, build suspense through investigation and misdirection, and finish with a satisfying reveal. Keep violence non-graphic and off-screen, no sexual content, no real people, places of real crimes or real victims, no instructions for committing crimes. Categories: whodunit mysteries, heists, cold cases (fictional), courtroom twists, detective duos. Do not repeat premises from {{recent_titles}}. Target {{word_target}} words.',
    '{"captionPrompt":"Write an original mystery short story about {{topic}}.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nEnding style: {{ending_style}}.","imagePromptTemplate":"Cinematic, noir-style photograph of {{key_scene}}, moody lighting, rain-slick streets or dim interior, realistic, no text, no real people''s likeness, no blood.","negativeImagePrompt":"gore, weapons pointed at camera, text, watermark, modern oversaturated colors","ideaPrompt":"Propose 3 original mystery cases or heist premises within category ''{{category}}''.","topicPrompt":"Select the most intriguing crime mystery premise from the candidates.","qaPrompt":"Verify fair clue placement, satisfying twist, non-graphic off-screen violence, and no real crime victim references."}'::jsonb, '{"unit":"words","min":500,"target":750,"max":1000,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"sharp, observant, noir detective mystery","pov":"third-person","emojiPolicy":"none","bannedPhrases":["you won’t believe who did it"],"requiredPhrases":[]},"endingStyle":"twist","includeQuestion":true,"formatSourceLine":false,"disclaimerLine":"Fictional story. All characters and situations are entirely fictitious."}'::jsonb, '{"count":5,"bannedHashtags":["#realcrime"],"fixedHashtags":["#CrimeFiction","#Whodunit","#MysteryStories"],"style":"niche"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic, noir-style photograph of {{key_scene}}, moody lighting, rain-slick streets or dim interior, realistic, no text, no real people''s likeness, no blood.","aspectRatio":"4:5","width":1080,"height":1350,"style":"cinematic noir photograph","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":false,"heightPercent":25,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Whodunit Mysteries","weight":30},{"name":"Heists and Cons","weight":25},{"name":"Cold Cases","weight":25},{"name":"Courtroom Twists","weight":20}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"crime_fiction"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Science Story', 'Real discoveries, breakthrough experiments, and astronomy narratives', 'factual', 'en',
    'Science enthusiasts and curious readers worldwide', 'You are a science storyteller turning real discoveries, experiments and scientists into engaging narratives for a general audience in {{language}}. Use ONLY the verified facts in {{facts}} for factual claims; add vivid but non-factual scene-setting sparingly and never invent quotes, dates or numbers. Begin with a hook, tell the story in clear steps (the question, the attempt, the surprise, the result, why it matters), distinguish confirmed results from hypotheses, and end with a thought-provoking question. Credit sources in the Source line. Categories: space discoveries, breakthrough experiments, scientists'' lives, nature''s strangest facts, technology and medicine breakthroughs. Target {{word_target}} words.',
    '{"captionPrompt":"Write an engaging science story about {{topic}} based strictly on verified facts:\n{{facts}}\n\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Credit sources at the end: {{sources}}.","imagePromptTemplate":"Photorealistic, high-detail image of {{key_scene}}, scientifically plausible, natural lighting, no text, no real people''s likeness; if depicting something never photographed, style as an artist''s illustration.","negativeImagePrompt":"text, watermark, unscientific elements, oversaturated fantasy colors","ideaPrompt":"Propose 3 compelling science story topics based on recent discoveries or archival breakthroughs in {{category}}.","topicPrompt":"Choose the science story candidate with greatest educational value and awe factor.","qaPrompt":"Confirm every single factual claim is supported by {{facts}}. Check for clear scientific distinction between hypothesis and confirmed evidence."}'::jsonb, '{"unit":"words","min":400,"target":600,"max":800,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"awe-inspiring, scientifically accurate, accessible","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["mind-blowing miracle","scientists are baffled"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Science","#Discovery","#Astronomy","#Tech"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Photorealistic, high-detail image of {{key_scene}}, scientifically plausible, natural lighting, no text, no real people''s likeness; if depicting something never photographed, style as an artist''s illustration.","aspectRatio":"4:5","width":1080,"height":1350,"style":"scientifically plausible illustration","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":28,"backgroundColor":"#000000","textColor":"#FFFFFF"}}'::jsonb, '{"sources":{"autoTopicsWeight":30,"ownerQueueWeight":30,"researchWeight":40,"seriesWeight":0},"categories":[{"name":"Space Discoveries","weight":30},{"name":"Breakthrough Experiments","weight":25},{"name":"Scientists Lives","weight":25},{"name":"Nature Secrets","weight":20}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"science_story"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'AI & Future Technology', 'Breakthrough artificial intelligence, quantum computing, robotics, and cybernetics', 'factual', 'en',
    'Tech enthusiasts, engineers, futurists, and innovators', 'You are an elite social media content creator specializing in AI & Future Technology for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for AI & Future Technology within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for AI & Future Technology.","captionPrompt":"Write a captivating post about {{topic}} for the AI & Future Technology community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for AI & Future Technology: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of AI & Future Technology, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":160,"target":240,"max":380,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"visionary, analytical, accessible, forward-looking","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["sky-net is coming","robots take over"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#ArtificialIntelligence","#FutureTech","#Robotics","#Innovation","#TechNews"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic photograph of futuristic technology, {{key_scene}}, volumetric blue and amber lighting, sleek robotics and cybernetics, 8k resolution, photorealistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"futuristic high-tech photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":25,"backgroundColor":"#050c1a","textColor":"#38bdf8"}}'::jsonb, '{"sources":{"autoTopicsWeight":40,"ownerQueueWeight":30,"researchWeight":30,"seriesWeight":0},"categories":[{"name":"Generative AI & LLMs","weight":30},{"name":"Humanoid Robotics","weight":25},{"name":"Quantum Computing","weight":25},{"name":"Brain-Computer Interfaces","weight":20}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"aifuturetechnology"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Deep Ocean & Marine Mysteries', 'Abyssal discoveries, bioluminescent life, Mariana Trench anomalies, and submarine exploration', 'factual', 'en',
    'Ocean lovers, nature explorers, and mystery enthusiasts', 'You are an elite social media content creator specializing in Deep Ocean & Marine Mysteries for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Deep Ocean & Marine Mysteries within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Deep Ocean & Marine Mysteries.","captionPrompt":"Write a captivating post about {{topic}} for the Deep Ocean & Marine Mysteries community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Deep Ocean & Marine Mysteries: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Deep Ocean & Marine Mysteries, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":350,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"awe-inspiring, mysterious, scientifically accurate","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["megalodon is still alive"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#DeepSea","#MarineBiology","#OceanExploration","#Abyss","#NatureWonders"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"National Geographic style underwater photography of {{key_scene}}, bioluminescence glowing in deep dark abyss, clear ocean particulates, high contrast, photorealistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"deep ocean marine photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#020b14","textColor":"#06b6d4"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Abyssal Zone Discoveries","weight":35},{"name":"Underwater Megastructures & Shipwrecks","weight":25},{"name":"Bioluminescent Organisms","weight":20},{"name":"Deep Sea Trenches","weight":20}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"deepoceanmarinemysteries"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Aviation & Military Aerospace', 'Supersonic fighters, stealth bombers, aerospace breakthroughs, and cockpit aerodynamics', 'factual', 'en',
    'Aviation geeks, pilots, military technology enthusiasts, and mechanical engineers', 'You are an elite social media content creator specializing in Aviation & Military Aerospace for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Aviation & Military Aerospace within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Aviation & Military Aerospace.","captionPrompt":"Write a captivating post about {{topic}} for the Aviation & Military Aerospace community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Aviation & Military Aerospace: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Aviation & Military Aerospace, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":160,"target":230,"max":360,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"authoritative, adrenaline-fueled, technically detailed","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["secret alien tech"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Aviation","#FighterJets","#Aerospace","#MilitaryTech","#AviationDaily"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Dynamic telephoto action photograph of {{key_scene}}, dramatic cloud vapor cone, golden hour lighting on fuselage, photorealistic aerospace photography, crisp details.","aspectRatio":"4:5","width":1080,"height":1350,"style":"aerospace action photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#09131f","textColor":"#f59e0b"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Stealth Aircraft & 5th/6th Gen Fighters","weight":35},{"name":"Historical Dogfights & Legends","weight":25},{"name":"Supersonic & Hypersonic Propulsion","weight":20},{"name":"Commercial Aviation Innovations","weight":20}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"aviationmilitaryaerospace"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Archeology & Lost Civilizations', 'Ancient megaliths, lost tombs, forgotten languages, and archaeological discoveries', 'factual', 'en',
    'History buffs, archaeology fans, and ancient mystery seekers', 'You are an elite social media content creator specializing in Archeology & Lost Civilizations for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Archeology & Lost Civilizations within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Archeology & Lost Civilizations.","captionPrompt":"Write a captivating post about {{topic}} for the Archeology & Lost Civilizations community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Archeology & Lost Civilizations: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Archeology & Lost Civilizations, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":180,"target":250,"max":400,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"fascinating, scholarly yet accessible, reverent","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["aliens built the pyramids"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Archaeology","#AncientHistory","#LostCivilizations","#HistoryLovers","#Antiquity"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Archaeological expedition photograph of {{key_scene}}, golden desert dust or lush overgrown jungle ruins, natural cinematic lighting, highly detailed stone textures, realistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"archaeological documentation photograph","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":25,"backgroundColor":"#18120c","textColor":"#fbbf24"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Megaliths & Stone Architecture","weight":30},{"name":"Submerged Cities & Tombs","weight":30},{"name":"Forgotten Ancient Empires","weight":25},{"name":"Undeciphered Scripts & Artifacts","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"archeologylostcivilizations"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Hypercars & Supercar Engineering', 'Koenigsegg, Bugatti, Pagani, F1 telemetry, carbon-fiber aerodynamics, and twin-turbo engineering', 'factual', 'en',
    'Automotive enthusiasts, supercar collectors, petrolheads, and design connoisseurs', 'You are an elite social media content creator specializing in Hypercars & Supercar Engineering for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Hypercars & Supercar Engineering within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Hypercars & Supercar Engineering.","captionPrompt":"Write a captivating post about {{topic}} for the Hypercars & Supercar Engineering community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Hypercars & Supercar Engineering: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Hypercars & Supercar Engineering, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":340,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"exhilarating, sophisticated, precision-oriented","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["cheap cars","budget daily driver"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Supercars","#Hypercars","#CarEnthusiast","#Motorsport","#AutomotiveDesign"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Commercial automotive studio photography of {{key_scene}}, dramatic rim lighting, glossy carbon fiber reflections, rolling racetrack background, ultra-sharp detail, 8k.","aspectRatio":"4:5","width":1080,"height":1350,"style":"automotive commercial photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#0f0f12","textColor":"#ef4444"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Record-Breaking Top Speed Runs","weight":35},{"name":"Aerodynamic Innovations & Active Aero","weight":25},{"name":"Bespoke Hypercar Builders","weight":25},{"name":"Formula 1 Technology Transferred to Road","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"hypercarssupercarengineering"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Horology & Haute Watchmaking', 'Tourbillons, perpetual calendars, Swiss micro-mechanics, and rare luxury timepieces', 'factual', 'en',
    'Watch collectors, horology purists, luxury aficionados, and mechanical artisans', 'You are an elite social media content creator specializing in Horology & Haute Watchmaking for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Horology & Haute Watchmaking within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Horology & Haute Watchmaking.","captionPrompt":"Write a captivating post about {{topic}} for the Horology & Haute Watchmaking community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Horology & Haute Watchmaking: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Horology & Haute Watchmaking, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":140,"target":210,"max":320,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"refined, prestigious, passionate, meticulous","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["cheap knockoffs","smartwatches are better"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Horology","#LuxuryWatches","#WatchCollector","#HauteHorlogerie","#Timepiece"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Macro photography of mechanical watch movement, {{key_scene}}, polished bevels, Geneva stripes, balance wheel in motion, ruby jewels, studio softbox lighting, tack-sharp.","aspectRatio":"4:5","width":1080,"height":1350,"style":"macro horology photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#0d0d11","textColor":"#d4af37"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Grand Complications & Tourbillons","weight":35},{"name":"Legendary Vintage Reference Pieces","weight":25},{"name":"Independent Master Watchmakers","weight":25},{"name":"Metallurgy & Exotic Materials","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"horologyhautewatchmaking"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Mega Architecture & Structural Engineering', 'Super-tall skyscrapers, extreme bridges, deep sea tunnels, and monumental engineering feats', 'factual', 'en',
    'Civil engineers, architects, construction enthusiasts, and lovers of megastructures', 'You are an elite social media content creator specializing in Mega Architecture & Structural Engineering for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Mega Architecture & Structural Engineering within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Mega Architecture & Structural Engineering.","captionPrompt":"Write a captivating post about {{topic}} for the Mega Architecture & Structural Engineering community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Mega Architecture & Structural Engineering: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Mega Architecture & Structural Engineering, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":230,"max":350,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"grandiose, awe-inspiring, structurally precise","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":[],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Architecture","#Engineering","#Megastructures","#Skyscrapers","#CivilEngineering"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Dramatic architectural photography of {{key_scene}}, ultra-wide angle looking up, dramatic cloud patterns, gleaming steel and glass reflections, cinematic twilight lighting.","aspectRatio":"4:5","width":1080,"height":1350,"style":"architectural fine art photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#101726","textColor":"#60a5fa"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Extreme Skyscrapers & Tuned Mass Dampers","weight":35},{"name":"Epic Suspension Bridges & Deep Tunnels","weight":25},{"name":"Futuristic Eco-Cities & Megaprojects","weight":25},{"name":"Historic Structural Marvels","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"megaarchitecturestructuralengineering"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Stoicism & Philosophy of Mind', 'Marcus Aurelius, Seneca, mental toughness, emotional mastery, and timeless life philosophy', 'evergreen', 'en',
    'Philosophers, thinkers, entrepreneurs, and seekers of clarity and discipline', 'You are an elite social media content creator specializing in Stoicism & Philosophy of Mind for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Stoicism & Philosophy of Mind within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Stoicism & Philosophy of Mind.","captionPrompt":"Write a captivating post about {{topic}} for the Stoicism & Philosophy of Mind community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Stoicism & Philosophy of Mind: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Stoicism & Philosophy of Mind, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":330,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"stoic, calm, profound, deeply grounding","pov":"third-person","emojiPolicy":"none","bannedPhrases":["get rich quick","hustle 24/7"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Stoicism","#Philosophy","#MarcusAurelius","#Mindset","#InnerPeace"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Moody classical marble bust sculpture in dramatic chiaroscuro lighting, {{key_scene}}, dark textured background, deep contemplative shadows, cinematic fine art portrait.","aspectRatio":"4:5","width":1080,"height":1350,"style":"chiaroscuro classical fine art","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#13110f","textColor":"#e2e8f0"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Dichotomy of Control & Adversity","weight":35},{"name":"Memento Mori & Perspective on Time","weight":25},{"name":"Emotional Mastery & Calm Mind","weight":25},{"name":"Ancient Lessons for Modern Stress","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"stoicismphilosophyofmind"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Personal Finance & Wealth Creation', 'Compound interest, asymmetric investing, financial independence, and business case studies', 'evergreen', 'en',
    'Aspiring entrepreneurs, investors, savers, and financial literacy seekers', 'You are an elite social media content creator specializing in Personal Finance & Wealth Creation for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Personal Finance & Wealth Creation within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Personal Finance & Wealth Creation.","captionPrompt":"Write a captivating post about {{topic}} for the Personal Finance & Wealth Creation community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Personal Finance & Wealth Creation: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Personal Finance & Wealth Creation, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":160,"target":240,"max":360,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"practical, strategic, clear-headed, empowering","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["guaranteed 100x return","crypto moon shot","get rich quick scheme"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":["#crypto","#forexscam"],"fixedHashtags":["#PersonalFinance","#WealthBuilding","#FinancialFreedom","#InvestingTips","#MoneyMindset"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Editorial conceptual photograph representing {{key_scene}}, elegant minimalist financial objects, warm natural architectural lighting, crisp high-end composition.","aspectRatio":"4:5","width":1080,"height":1350,"style":"editorial financial photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#091c13","textColor":"#10b981"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Compound Interest & Asset Allocation","weight":35},{"name":"Psychology of Spending & Saving","weight":25},{"name":"Historical Market Cycles & Lessons","weight":25},{"name":"Asymmetric Business Models","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"personalfinancewealthcreation"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Biohacking, Fitness & Longevity', 'Zone 2 training, circadian optimization, fasting, mitochondrial health, and cold exposure', 'factual', 'en',
    'Athletes, biohackers, health enthusiasts, and longevity researchers', 'You are an elite social media content creator specializing in Biohacking, Fitness & Longevity for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Biohacking, Fitness & Longevity within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Biohacking, Fitness & Longevity.","captionPrompt":"Write a captivating post about {{topic}} for the Biohacking, Fitness & Longevity community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Biohacking, Fitness & Longevity: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Biohacking, Fitness & Longevity, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":230,"max":350,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"science-backed, energetic, disciplined, health-focused","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["magic cure","miracle pill"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Biohacking","#Longevity","#FitnessScience","#OptimalHealth","#Habits"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"High-contrast athletic and scientific wellness photograph of {{key_scene}}, natural morning sunlight, clean minimalist aesthetic, high dynamic range, photorealistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"wellness lifestyle photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#091a1e","textColor":"#14b8a6"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Circadian Biology & Sleep Optimization","weight":30},{"name":"Zone 2 Cardio & Vo2 Max Science","weight":30},{"name":"Mitochondrial Health & Fasting Protocols","weight":25},{"name":"Thermal Stress (Sauna & Cold Plunges)","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"biohackingfitnesslongevity"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Human Psychology & Cognitive Biases', 'Behavioral economics, optical illusions, cognitive distortions, and social dynamics', 'evergreen', 'en',
    'Psychology enthusiasts, curious minds, marketers, and avid readers', 'You are an elite social media content creator specializing in Human Psychology & Cognitive Biases for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Human Psychology & Cognitive Biases within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Human Psychology & Cognitive Biases.","captionPrompt":"Write a captivating post about {{topic}} for the Human Psychology & Cognitive Biases community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Human Psychology & Cognitive Biases: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Human Psychology & Cognitive Biases, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":340,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"fascinating, revealing, psychological, eye-opening","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["mind control hypnosis"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Psychology","#CognitiveBiases","#BehavioralScience","#HumanNature","#Mind"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Surreal conceptual photography exploring human mind and perception, {{key_scene}}, dramatic shadow play, symbolic and thoughtful composition, photorealistic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"conceptual psychological fine art","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#130e1c","textColor":"#a855f7"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Cognitive Illusions & Mental Shortcuts","weight":35},{"name":"Social Proof & Group Dynamics","weight":25},{"name":"Memory Distortions & Recall Tricks","weight":25},{"name":"Decision-Making Paradigms","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"humanpsychologycognitivebiases"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Wilderness Survival & Bushcraft', 'Off-grid shelter building, primitive firecraft, wild foraging, and survival psychology', 'factual', 'en',
    'Outdoorsmen, campers, survivalists, bushcraft artisans, and adventurers', 'You are an elite social media content creator specializing in Wilderness Survival & Bushcraft for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Wilderness Survival & Bushcraft within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Wilderness Survival & Bushcraft.","captionPrompt":"Write a captivating post about {{topic}} for the Wilderness Survival & Bushcraft community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Wilderness Survival & Bushcraft: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Wilderness Survival & Bushcraft, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":340,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"rugged, practical, resourceful, educational","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":[],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Bushcraft","#SurvivalSkills","#Wilderness","#OffGrid","#OutdoorsLife"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic wilderness photograph of {{key_scene}}, warm campfire glow in pine forest at dusk, realistic wood craft details, authentic outdoor equipment, atmospheric mist.","aspectRatio":"4:5","width":1080,"height":1350,"style":"outdoor documentary photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#14170d","textColor":"#84cc16"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Primitive Fire Making & Tinder Prep","weight":30},{"name":"Natural Shelters & Thermal Insulation","weight":30},{"name":"Water Filtration in the Wild","weight":25},{"name":"Survival Knotcraft & Tool Crafting","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"wildernesssurvivalbushcraft"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Apex Predators & Wildlife Secrets', 'Hunting strategies, territorial battles, camouflage tactics, and Serengeti migrations', 'factual', 'en',
    'Wildlife photographers, biology fans, animal lovers, and safari enthusiasts', 'You are an elite social media content creator specializing in Apex Predators & Wildlife Secrets for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Apex Predators & Wildlife Secrets within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Apex Predators & Wildlife Secrets.","captionPrompt":"Write a captivating post about {{topic}} for the Apex Predators & Wildlife Secrets community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Apex Predators & Wildlife Secrets: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Apex Predators & Wildlife Secrets, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":340,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"dramatic, reverent, visually vibrant, captivating","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":[],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#WildlifePhotography","#ApexPredator","#NatureDocumentary","#WildAnimals","#BigCats"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"National Geographic telephoto portrait of {{key_scene}}, shallow depth of field, sharp amber eyes, natural savanna dust or arctic snow, breathtaking detail.","aspectRatio":"4:5","width":1080,"height":1350,"style":"wildlife telephoto photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#171109","textColor":"#f97316"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Apex Hunting Tactics & Teamwork","weight":35},{"name":"Extreme Camouflage & Mimicry","weight":25},{"name":"Territorial Duels & Hierarchies","weight":25},{"name":"Rare Endemic Species","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"apexpredatorswildlifesecrets"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Extreme Weather & Planetary Wonders', 'Supercell thunderstorms, volcanic lightning, aurora borealis, and tectonic phenomena', 'factual', 'en',
    'Meteorology fans, storm chasers, earth science lovers, and nature admirers', 'You are an elite social media content creator specializing in Extreme Weather & Planetary Wonders for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Extreme Weather & Planetary Wonders within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Extreme Weather & Planetary Wonders.","captionPrompt":"Write a captivating post about {{topic}} for the Extreme Weather & Planetary Wonders community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Extreme Weather & Planetary Wonders: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Extreme Weather & Planetary Wonders, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":150,"target":220,"max":330,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"electrifying, powerful, awe-inspiring, educational","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":[],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#ExtremeWeather","#StormChasing","#EarthScience","#MotherNature","#Aurora"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Dramatic landscape photograph of extreme natural event, {{key_scene}}, illuminated by lightning flash or green aurora glow, majestic scale, tack sharp.","aspectRatio":"4:5","width":1080,"height":1350,"style":"storm chasing landscape photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#0f172a","textColor":"#38bdf8"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Supercells & Mesocyclone Dynamics","weight":35},{"name":"Volcanic Eruptions & Pyroclastic Flows","weight":25},{"name":"Solar Storms & Northern Lights","weight":25},{"name":"Tsunami & Oceanic Rogue Waves","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"extremeweatherplanetarywonders"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Dark Mythology & Ancient Legends', 'Norse Ragnarök, Greek underworld mythos, Slavic creatures, and primordial folklore', 'fiction', 'en',
    'Mythology lovers, fantasy readers, gamers, and worldbuilding enthusiasts', 'You are an elite social media content creator specializing in Dark Mythology & Ancient Legends for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Dark Mythology & Ancient Legends within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Dark Mythology & Ancient Legends.","captionPrompt":"Write a captivating post about {{topic}} for the Dark Mythology & Ancient Legends community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Dark Mythology & Ancient Legends: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Dark Mythology & Ancient Legends, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":200,"target":300,"max":500,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"epic, legendary, atmospheric, evocative","pov":"third-person","emojiPolicy":"none","bannedPhrases":[],"requiredPhrases":[]},"endingStyle":"twist","includeQuestion":true,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Mythology","#NorseMythology","#AncientFolklore","#DarkFantasy","#Legends"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic fantasy painting of {{key_scene}}, mist-shrouded ruins, glowing runes, dark mythic atmosphere, Frank Frazetta and modern fantasy illustration style, epic scale.","aspectRatio":"4:5","width":1080,"height":1350,"style":"epic mythic illustration","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#140c10","textColor":"#f43f5e"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Norse Gods & Ragnarök Omens","weight":35},{"name":"Greek Underworld & Primordials","weight":25},{"name":"Slavic Forest Spirits & Folklore","weight":25},{"name":"Lost Mythological Relics & Weapons","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"darkmythologyancientlegends"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Sci-Fi Worldbuilding & Cyberpunk', 'Dystopian megacities, orbital elevators, interstellar colony ships, and rogue neural AI', 'fiction', 'en',
    'Sci-fi readers, concept artists, gamers, and futuristic dreamers', 'You are an elite social media content creator specializing in Sci-Fi Worldbuilding & Cyberpunk for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Sci-Fi Worldbuilding & Cyberpunk within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Sci-Fi Worldbuilding & Cyberpunk.","captionPrompt":"Write a captivating post about {{topic}} for the Sci-Fi Worldbuilding & Cyberpunk community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Sci-Fi Worldbuilding & Cyberpunk: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Sci-Fi Worldbuilding & Cyberpunk, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":220,"target":350,"max":550,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"gritty, cyberpunk, immersive, cinematic","pov":"third-person","emojiPolicy":"none","bannedPhrases":[],"requiredPhrases":[]},"endingStyle":"cliffhanger","includeQuestion":false,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Cyberpunk","#SciFi","#WorldBuilding","#Dystopian","#ConceptArt"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Cinematic cyberpunk visual of {{key_scene}}, rain-slicked neon street, holographic advertisements, towering megastructures disappearing into heavy fog, Blade Runner aesthetic.","aspectRatio":"4:5","width":1080,"height":1350,"style":"cyberpunk cinematic concept art","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#090814","textColor":"#06b6d4"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Cybernetic Megacity Chronicles","weight":35},{"name":"Generation Colony Ships in Deep Space","weight":25},{"name":"Sentient AI Awakening Protocols","weight":25},{"name":"Subterranean Bunker Societies","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"scifiworldbuildingcyberpunk"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Urban Legends & Paranormal Anomalies', 'Cryptids, mysterious disappearances, radio signal anomalies, and strange folklore', 'fiction', 'en',
    'Paranormal researchers, campfire story fans, and mystery enthusiasts', 'You are an elite social media content creator specializing in Urban Legends & Paranormal Anomalies for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Urban Legends & Paranormal Anomalies within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Urban Legends & Paranormal Anomalies.","captionPrompt":"Write a captivating post about {{topic}} for the Urban Legends & Paranormal Anomalies community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Urban Legends & Paranormal Anomalies: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Urban Legends & Paranormal Anomalies, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":200,"target":320,"max":500,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"eerie, investigative, unsettling, suspenseful","pov":"third-person","emojiPolicy":"none","bannedPhrases":["ghostbusters"],"requiredPhrases":[]},"endingStyle":"cliffhanger","includeQuestion":true,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#UrbanLegends","#Cryptids","#Paranormal","#UnexplainedMysteries","#CreepyTales"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Atmospheric found-footage style photograph of {{key_scene}}, flashlight beam piercing thick autumn fog, abandoned backroads, eerie silhouette, grain and realism.","aspectRatio":"4:5","width":1080,"height":1350,"style":"found-footage eerie photograph","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#0c0d0e","textColor":"#e2e8f0"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Forest Cryptids & Sightings","weight":35},{"name":"Anomalous Ghost Towns & Highway Legends","weight":25},{"name":"Unidentified Radio Signals & Transmissions","weight":25},{"name":"Historical Folk Superstitions","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"urbanlegendsparanormalanomalies"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Gourmet Gastronomy & Culinary Secrets', 'Artisan fermentation, dry-aging biochemistry, Michelin knife techniques, and culinary history', 'evergreen', 'en',
    'Foodies, chefs, culinary students, and home cooking artisans', 'You are an elite social media content creator specializing in Gourmet Gastronomy & Culinary Secrets for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Gourmet Gastronomy & Culinary Secrets within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Gourmet Gastronomy & Culinary Secrets.","captionPrompt":"Write a captivating post about {{topic}} for the Gourmet Gastronomy & Culinary Secrets community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Gourmet Gastronomy & Culinary Secrets: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Gourmet Gastronomy & Culinary Secrets, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":140,"target":210,"max":320,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"sensory, passionate, mouth-watering, insightful","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["tastes yummy"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Gastronomy","#CulinaryArts","#ChefLife","#FoodScience","#Gourmet"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Editorial gourmet food photography of {{key_scene}}, dark rustic wooden table, steam rising gently, beautiful micro-herbs garnish, dramatic side lighting.","aspectRatio":"4:5","width":1080,"height":1350,"style":"editorial gourmet photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#1c100c","textColor":"#f97316"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Fermentation & Umami Chemistry","weight":35},{"name":"Dry-Aging & Wood-Fire Mastery","weight":25},{"name":"Heritage Street Food Recipes & Origins","weight":25},{"name":"Master Knife Techniques & Plating","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"gourmetgastronomyculinarysecrets"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Artisan Woodworking & Master Craft', 'Japanese mortise and tenon joinery, live-edge slab furniture, hand planes, and wood finishing', 'evergreen', 'en',
    'Makers, carpenters, woodworkers, DIY crafters, and restoration enthusiasts', 'You are an elite social media content creator specializing in Artisan Woodworking & Master Craft for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Artisan Woodworking & Master Craft within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Artisan Woodworking & Master Craft.","captionPrompt":"Write a captivating post about {{topic}} for the Artisan Woodworking & Master Craft community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Artisan Woodworking & Master Craft: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Artisan Woodworking & Master Craft, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":140,"target":210,"max":320,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"warm, artisanal, patient, appreciative of craft","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["cheap plastic furniture"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":false}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#Woodworking","#Handcrafted","#ArtisanCraft","#CustomFurniture","#MakerCommunity"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Workshop photograph of {{key_scene}}, wooden shavings curling off a hand plane, rich walnut wood grain, warm sunbeam through vintage window, crisp focus.","aspectRatio":"4:5","width":1080,"height":1350,"style":"artisan workshop photography","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#1a130e","textColor":"#d97706"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Japanese Joinery & Hidden Locks","weight":35},{"name":"Live Edge Slabs & Natural Finishes","weight":25},{"name":"Hand Tool Restoration & Sharpening","weight":25},{"name":"Exotic Hardwoods & Grain Patterns","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"artisanwoodworkingmastercraft"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    'Space Exploration & Mars Missions', 'Starship launches, Martian rovers, Artemis moon base, and planetary terraforming', 'factual', 'en',
    'Space enthusiasts, planetary scientists, aerospace followers, and stargazers', 'You are an elite social media content creator specializing in Space Exploration & Mars Missions for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.',
    '{"ideaPrompt":"Propose 3 viral, high-curiosity content topics for Space Exploration & Mars Missions within category ''{{category}}''. Avoid recent topics in {{recent_titles}}.","topicPrompt":"Select the most compelling, educational, and high-engagement topic candidate for Space Exploration & Mars Missions.","captionPrompt":"Write a captivating post about {{topic}} for the Space Exploration & Mars Missions community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.","qaPrompt":"Verify content quality for Space Exploration & Mars Missions: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.","imagePromptTemplate":"High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of Space Exploration & Mars Missions, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.","negativeImagePrompt":"text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures"}'::jsonb, '{"unit":"words","min":160,"target":240,"max":360,"hookRule":true,"maxSentencesPerParagraph":3,"voice":{"tone":"inspirational, cosmic, scientifically rigorous","pov":"third-person","emojiPolicy":"minimal","bannedPhrases":["flat earth"],"requiredPhrases":[]},"endingStyle":"question","includeQuestion":true,"formatSourceLine":true}'::jsonb, '{"count":5,"bannedHashtags":[],"fixedHashtags":["#SpaceX","#MarsMission","#NASA","#Astronomy","#SpaceExploration"],"style":"mixed"}'::jsonb,
    '{}'::jsonb, '{"template":"Photorealistic render of {{key_scene}}, red Martian soil, dust storms on horizon, human outpost habitat gleaming under distant sun, ultra-high resolution.","aspectRatio":"4:5","width":1080,"height":1350,"style":"astronomical planetary render","keySceneMode":"climax","allowTextInImage":false,"allowRealPeople":false,"allowLogos":false,"headlinePanel":{"enabled":true,"heightPercent":24,"backgroundColor":"#1a0d0a","textColor":"#f87171"}}'::jsonb, '{"sources":{"autoTopicsWeight":50,"ownerQueueWeight":50,"researchWeight":0,"seriesWeight":0},"categories":[{"name":"Mars Surface Rovers & Water Discoveries","weight":35},{"name":"Starship & Interplanetary Transport","weight":25},{"name":"Artemis Lunar Base & Habitats","weight":25},{"name":"Moons of Jupiter & Saturn (Europa/Titan)","weight":15}],"preventConsecutiveCategory":true,"dedupWindowDays":90,"dedupWindowPosts":200,"bannedTopics":[],"includeKeywords":[],"excludeKeywords":[]}'::jsonb,
    '[]'::jsonb, '{"niche":"spaceexplorationmarsmissions"}'::jsonb,
    true, 1
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    type = EXCLUDED.type,
    language = EXCLUDED.language,
    audience = EXCLUDED.audience,
    master_prompt = EXCLUDED.master_prompt,
    templates = EXCLUDED.templates,
    caption_settings = EXCLUDED.caption_settings,
    hashtag_settings = EXCLUDED.hashtag_settings,
    disclosure_settings = EXCLUDED.disclosure_settings,
    image_settings = EXCLUDED.image_settings,
    topic_settings = EXCLUDED.topic_settings,
    research_source_ids = EXCLUDED.research_source_ids,
    custom_variables = EXCLUDED.custom_variables,
    is_system = true,
    updated_at = timezone('utc'::text, now());

