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

