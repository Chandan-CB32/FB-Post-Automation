-- ============================================================================
-- Supabase Consolidated Migrations
-- Autonomous Multi-Page Facebook Content System
-- ============================================================================

-- >>> Migration: 20261102000000_init_schema.sql <<<

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

-- >>> Migration: 20261104000000_facebook_accounts_and_enhancements.sql <<<

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

-- >>> Migration: 20261107000000_automatic_page_discovery.sql <<<

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

-- >>> Migration: 20261108000000_page_scheduling_and_niche_detection.sql <<<

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

-- >>> Migration: 20261109000000_production_persistence_and_governance.sql <<<

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

-- >>> Migration: 20261110000000_schema_alignment_and_versioning.sql <<<

-- ============================================================================
-- Migration: 20261110000000_schema_alignment_and_versioning.sql
-- Isolated Area Versions, Safe Triggers & Foreign Key Resiliency
-- ============================================================================

DO $$
BEGIN
    -- 1. Ensure required columns exist on public.pages
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'custom_niche'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN custom_niche TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'custom_niche_text'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN custom_niche_text TEXT DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'mode_chosen'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN mode_chosen BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'settings_version'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'schedule_version'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN schedule_version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'prompts_version'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN prompts_version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'profile_version'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'settings_updated_at'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN settings_updated_at TIMESTAMPTZ DEFAULT now();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'test_run_verified'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN test_run_verified BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'test_run_report'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN test_run_report JSONB DEFAULT NULL;
    END IF;

    -- QA configuration and editorial word limits on public.pages
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'qa_pass_threshold'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN qa_pass_threshold INTEGER DEFAULT 80;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'max_sentences_per_paragraph'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN max_sentences_per_paragraph INTEGER DEFAULT 3;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'min_words'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN min_words INTEGER DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'target_words'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN target_words INTEGER DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'max_words'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN max_words INTEGER DEFAULT NULL;
    END IF;

    -- 2. Ensure version, slug, customization and system flags exist on public.content_profiles
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'content_profiles' AND column_name = 'slug'
    ) THEN
        ALTER TABLE public.content_profiles ADD COLUMN slug TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'content_profiles' AND column_name = 'is_customized'
    ) THEN
        ALTER TABLE public.content_profiles ADD COLUMN is_customized BOOLEAN NOT NULL DEFAULT false;
    END IF;

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

-- 4. Safe Trigger to keep active and is_live in sync on public.pages
-- NOTICE: Operational writes (token inspection, sync, metrics) must NEVER bump version
CREATE OR REPLACE FUNCTION public.sync_page_active_and_live()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_live IS DISTINCT FROM OLD.is_live THEN
        NEW.active = NEW.is_live;
    ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
        NEW.is_live = NEW.active;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_page_active_and_live ON public.pages;
CREATE TRIGGER trg_sync_page_active_and_live
BEFORE UPDATE ON public.pages
FOR EACH ROW
EXECUTE FUNCTION public.sync_page_active_and_live();

-- 5. Essential Performance & Concurrency Indexes
CREATE INDEX IF NOT EXISTS idx_pages_active_live ON public.pages (active, is_live);
CREATE INDEX IF NOT EXISTS idx_posts_page_status_sched ON public.posts (page_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_keys_active ON public.provider_keys (provider_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_profiles_name ON public.content_profiles (name);
CREATE INDEX IF NOT EXISTS idx_pages_settings_version ON public.pages (settings_version);

-- 6. Content Profiles Slug Backfill & Unique Index
UPDATE public.content_profiles 
SET slug = lower(trim(regexp_replace(regexp_replace(name, '&', '', 'g'), '[^a-zA-Z0-9]+', '-', 'g'), '-'))
WHERE slug IS NULL OR slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_profiles_slug ON public.content_profiles (slug);

-- 7. Resilient Foreign Key & Orphan Cleanup
-- Clean up orphaned profile references (stale profile IDs)
UPDATE public.pages 
SET profile_id = NULL 
WHERE profile_id IS NOT NULL 
  AND profile_id NOT IN (SELECT id FROM public.content_profiles);

-- Recreate foreign key with ON DELETE SET NULL to ensure deleting a profile never cascades or errors
ALTER TABLE public.pages DROP CONSTRAINT IF EXISTS pages_profile_id_fkey;
ALTER TABLE public.pages 
ADD CONSTRAINT pages_profile_id_fkey 
FOREIGN KEY (profile_id) REFERENCES public.content_profiles(id) ON DELETE SET NULL;

-- >>> Migration: 20261112000000_headline_emphasis_settings.sql <<<

-- Migration: 20261112000000_headline_emphasis_settings.sql
-- Idempotent schema additions for headline emphasis, font selection, and viral card panel styling.

DO $$
BEGIN
  -- 1. Add headline_segments to posts table if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'headline_segments'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN headline_segments JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- 2. Add image styling columns to pages table if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_headline_panel_enabled'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_headline_panel_enabled BOOLEAN DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_font_family'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_font_family TEXT DEFAULT 'Roboto Condensed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_panel_color'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_panel_color TEXT DEFAULT '#000000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_panel_height_mode'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_panel_height_mode TEXT DEFAULT 'auto';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_min_font_size'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_min_font_size INTEGER DEFAULT 76;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_highlight_enabled'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_highlight_enabled BOOLEAN DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_highlight_colors'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_highlight_colors JSONB DEFAULT '["#FFD21F", "#22D3EE"]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_highlight_match_niche'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_highlight_match_niche BOOLEAN DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'image_vision_verification_enabled'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN image_vision_verification_enabled BOOLEAN DEFAULT false;
  END IF;

END $$;

-- >>> Migration: 20261115_content_variety_engine.sql <<<

-- ============================================================================
-- CONTENT VARIETY ENGINE & CATEGORY DISTRIBUTION MIGRATION (Idempotent)
-- ============================================================================

-- 1. Ensure pages table has category distribution and variety configuration columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'category_weights'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN category_weights JSONB DEFAULT '{
      "Space & Astronomy": 20,
      "Animals & Ocean Life": 14,
      "Earth & Extreme Phenomena": 11,
      "Physics & Chemistry": 11,
      "Human Body & Brain": 10,
      "Plants/Fungi & Nature": 8,
      "Ancient Life & Evolution": 8,
      "Technology & AI": 7,
      "Microscopic World": 6,
      "Scientists & Big Ideas": 5
    }'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'max_daily_space'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN max_daily_space INTEGER DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'max_daily_per_category'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN max_daily_per_category INTEGER DEFAULT 2;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'vision_check_enabled'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN vision_check_enabled BOOLEAN DEFAULT true;
  END IF;
END $$;

-- 2. Add category and image_brief columns to posts if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN category TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'image_brief'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN image_brief JSONB;
  END IF;
END $$;

-- 3. Add category index to posts for fast 50-post deficit calculation
CREATE INDEX IF NOT EXISTS idx_posts_page_category_created 
ON public.posts(page_id, category, created_at DESC);

-- 4. Research sources registry table
CREATE TABLE IF NOT EXISTS public.research_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  feed_type TEXT NOT NULL DEFAULT 'rss',
  enabled BOOLEAN NOT NULL DEFAULT true,
  terms TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Seed initial reputable research sources (idempotent upsert)
INSERT INTO public.research_sources (id, name, category, url, feed_type, enabled, terms, description)
VALUES
  ('nasa_breaking', 'NASA Breaking News', 'Space & Astronomy', 'https://www.nasa.gov/news-release/feed/', 'rss', true, 'Public domain US government work.', 'Mission updates, planetary science, James Webb observations.'),
  ('esa_space_science', 'ESA Space Science', 'Space & Astronomy', 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', 'rss', true, 'Open editorial attribution.', 'European Space Agency astrophysics, solar system, and cosmology.'),
  ('sciencedaily_animals', 'ScienceDaily Plants & Animals', 'Animals & Ocean Life', 'https://www.sciencedaily.com/rss/plants_animals.xml', 'rss', true, 'Free RSS feed for news aggregation.', 'Peer-reviewed zoology, marine biology, and evolutionary adaptations.'),
  ('noaa_ocean_news', 'NOAA News Releases', 'Animals & Ocean Life', 'https://www.noaa.gov/news-releases/rss', 'rss', true, 'Public domain US government agency.', 'Oceanic exploration, marine ecosystems, and fisheries science.'),
  ('physorg_earth', 'Phys.org Earth Sciences', 'Earth & Extreme Phenomena', 'https://phys.org/rss-feed/earth-news/', 'rss', true, 'Free public RSS for editorial syndication.', 'Geology, seismology, volcanology, deep mantle discoveries.'),
  ('usgs_hazards', 'USGS Natural Hazards', 'Earth & Extreme Phenomena', 'https://www.usgs.gov/news/rss', 'rss', true, 'Public domain US Geological Survey.', 'Plate tectonics, volcanic eruptions, and planetary geology.'),
  ('physorg_physics', 'Phys.org Physics News', 'Physics & Chemistry', 'https://phys.org/rss-feed/physics-news/', 'rss', true, 'Free public RSS feed.', 'Quantum optics, superconductivity, particle physics, and thermodynamics.'),
  ('quanta_physics', 'Quanta Magazine Physics', 'Physics & Chemistry', 'https://api.quantamagazine.org/feed', 'rss', true, 'Non-profit foundation science journalism.', 'Deep investigative science reporting on theoretical physics.'),
  ('nih_news_releases', 'NIH News Releases', 'Human Body & Brain', 'https://www.nih.gov/news-events/news-releases/rss', 'rss', true, 'Public domain National Institutes of Health.', 'Neuroscience, immunology, cellular genetics, and human physiology.'),
  ('sciencedaily_mind', 'ScienceDaily Mind & Brain', 'Human Body & Brain', 'https://www.sciencedaily.com/rss/mind_brain.xml', 'rss', true, 'Free public RSS feed.', 'Cognitive architecture, brain mapping, perception, and neurotransmitters.'),
  ('physorg_biology', 'Phys.org Biology & Nature', 'Plants/Fungi & Nature', 'https://phys.org/rss-feed/biology-news/', 'rss', true, 'Free public RSS feed.', 'Mycology, mycorrhizal networks, plant bio-signaling, and botany.'),
  ('eurekalert_biology', 'EurekAlert Biology News', 'Plants/Fungi & Nature', 'https://www.eurekalert.org/rss/biology.xml', 'rss', true, 'AAAS press release platform; open media distribution.', 'Botanical defense mechanisms, fungal symbiosis, and forest ecosystems.'),
  ('sciencedaily_fossils', 'ScienceDaily Fossils & Ruins', 'Ancient Life & Evolution', 'https://www.sciencedaily.com/rss/fossils_ruins.xml', 'rss', true, 'Free public RSS feed.', 'Paleontology, fossil discoveries, Cambrian explosion, and hominid evolution.'),
  ('sciencedaily_ai', 'ScienceDaily AI & Computing', 'Technology & AI', 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml', 'rss', true, 'Free public RSS feed.', 'Brain-computer interfaces, quantum computing, and bio-inspired robotics.'),
  ('physorg_nano', 'Phys.org Nanotechnology & Cells', 'Microscopic World', 'https://phys.org/rss-feed/nanotechnology-news/', 'rss', true, 'Free public RSS feed.', 'Molecular machinery, tardigrade cryptobiosis, diatoms, and phages.'),
  ('nature_news', 'Nature News', 'Scientists & Big Ideas', 'https://www.nature.com/nature.rss', 'rss', true, 'Free RSS headlines with standard attribution.', 'Milestone experimental breakthroughs, history of science, and Nobel laureates.')
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  url = EXCLUDED.url,
  terms = EXCLUDED.terms,
  description = EXCLUDED.description,
  updated_at = timezone('utc', now());

-- >>> Migration: 20261118_content_library.sql <<<

-- ============================================================================
-- Supabase Migration: 20261118_content_library.sql
-- Excel + Image Library Content Mode (Multi-Page Facebook Automation)
-- ============================================================================

-- 1. Add content_source_mode to pages and content_profiles
ALTER TABLE public.pages
ADD COLUMN IF NOT EXISTS content_source_mode TEXT NOT NULL DEFAULT 'full_ai'
CHECK (content_source_mode IN ('full_ai', 'excel_library', 'hybrid'));

ALTER TABLE public.content_profiles
ADD COLUMN IF NOT EXISTS content_source_mode TEXT NOT NULL DEFAULT 'full_ai'
CHECK (content_source_mode IN ('full_ai', 'excel_library', 'hybrid'));

CREATE INDEX IF NOT EXISTS idx_pages_content_source_mode ON public.pages(content_source_mode);

-- 2. Content Libraries Table
CREATE TABLE IF NOT EXISTS public.content_libraries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'excel' CHECK (source_type IN ('excel', 'csv', 'sheets')),
    original_filename TEXT,
    total_rows INTEGER NOT NULL DEFAULT 0,
    imported_rows INTEGER NOT NULL DEFAULT 0,
    matched_rows INTEGER NOT NULL DEFAULT 0,
    published_rows INTEGER NOT NULL DEFAULT 0,
    exhausted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_content_libraries_page ON public.content_libraries(page_id);

-- 3. Library Assets Table (Uploaded Images)
CREATE TABLE IF NOT EXISTS public.library_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    library_id UUID REFERENCES public.content_libraries(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    aspect_ratio TEXT CHECK (aspect_ratio IN ('4:5', '1:1', '16:9', 'other')),
    status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'used', 'image_deleted', 'archived')),
    matched_item_id UUID,
    caption_hint TEXT,
    vision_labels JSONB NOT NULL DEFAULT '[]'::jsonb,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_library_assets_page_status ON public.library_assets(page_id, status);
CREATE INDEX IF NOT EXISTS idx_library_assets_sha256 ON public.library_assets(sha256);

-- 4. Library Items Table (Spreadsheet Rows)
CREATE TABLE IF NOT EXISTS public.library_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    library_id UUID NOT NULL REFERENCES public.content_libraries(id) ON DELETE CASCADE,
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    external_id TEXT,
    planned_slot TIMESTAMPTZ,
    category TEXT,
    content_idea TEXT NOT NULL,
    image_idea TEXT,
    image_prompt TEXT,
    image_filename_hint TEXT,
    teaser_seed TEXT,
    hidden_clue TEXT,
    key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    matched_asset_id UUID REFERENCES public.library_assets(id) ON DELETE SET NULL,
    match_method TEXT CHECK (match_method IN ('exact', 'ignore_ext', 'normalized', 'manual', 'vision', 'order')),
    match_confidence NUMERIC CHECK (match_confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'matched', 'drafted', 'qa_passed', 'scheduled', 'publishing', 'published', 'failed', 'needs_review', 'skipped'
    )),
    post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
    vision_verification JSONB NOT NULL DEFAULT '{}'::jsonb,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_library_items_page_status ON public.library_items(page_id, status);
CREATE INDEX IF NOT EXISTS idx_library_items_lib_row ON public.library_items(library_id, row_index);
CREATE INDEX IF NOT EXISTS idx_library_items_slot ON public.library_items(planned_slot);
CREATE INDEX IF NOT EXISTS idx_library_items_post ON public.library_items(post_id);

-- 5. Circular FK for library_assets -> library_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_library_assets_matched_item'
    ) THEN
        ALTER TABLE public.library_assets
        ADD CONSTRAINT fk_library_assets_matched_item
        FOREIGN KEY (matched_item_id) REFERENCES public.library_items(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 6. Row Level Security
ALTER TABLE public.content_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
    tables text[] := ARRAY['content_libraries', 'library_assets', 'library_items'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS owner_all_access ON public.%I', t);
        EXECUTE format('CREATE POLICY owner_all_access ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;

-- 7. Private Storage Bucket for Library Images
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-images', 'library-images', false)
ON CONFLICT (id) DO NOTHING;

-- >>> Migration: 20261118_content_library_drive.sql <<<

-- ============================================================================
-- Supabase Migration: 20261118_content_library_drive.sql
-- Google Drive Source Support for Excel + Image Library Mode
-- ============================================================================

-- 1. Extend library_assets for Google Drive and external file sources
ALTER TABLE public.library_assets
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload'
CHECK (source IN ('upload', 'drive'));

ALTER TABLE public.library_assets
ADD COLUMN IF NOT EXISTS drive_file_id TEXT,
ADD COLUMN IF NOT EXISTS drive_md5 TEXT,
ADD COLUMN IF NOT EXISTS drive_modified_at TIMESTAMPTZ;

-- Make storage_path nullable (Drive files do not use Supabase bucket storage)
ALTER TABLE public.library_assets
ALTER COLUMN storage_path DROP NOT NULL;

-- Update status constraint on library_assets to include 'archived' and 'missing'
ALTER TABLE public.library_assets
DROP CONSTRAINT IF EXISTS library_assets_status_check;

ALTER TABLE public.library_assets
ADD CONSTRAINT library_assets_status_check
CHECK (status IN ('unmatched', 'matched', 'used', 'image_deleted', 'archived', 'missing'));

-- Unique constraint on (library_id, drive_file_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_assets_lib_drive_file
ON public.library_assets(library_id, drive_file_id)
WHERE drive_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_library_assets_source
ON public.library_assets(source);

CREATE INDEX IF NOT EXISTS idx_library_assets_drive_md5
ON public.library_assets(drive_md5);

-- 2. Extend content_libraries for Google Drive configurations
ALTER TABLE public.content_libraries
ADD COLUMN IF NOT EXISTS image_source TEXT NOT NULL DEFAULT 'upload'
CHECK (image_source IN ('drive', 'upload'));

ALTER TABLE public.content_libraries
ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
ADD COLUMN IF NOT EXISTS posted_folder_id TEXT,
ADD COLUMN IF NOT EXISTS after_publish_action TEXT NOT NULL DEFAULT 'move_to_posted'
CHECK (after_publish_action IN ('move_to_posted', 'trash', 'leave')),
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_content_libraries_image_source
ON public.content_libraries(image_source);

-- >>> Migration: auto_free_tier_providers.sql <<<

-- ============================================================================
-- Migration: Auto Free-Tier Image & Text Providers with 100 RPD for Cloudflare
-- Idempotent SQL script for Supabase SQL Editor.
-- Sets all image & text providers to Automatic Free-Tier model selection ('auto')
-- and updates Cloudflare Workers AI to 100 requests/day (10,000 neurons allowance).
-- ============================================================================

-- 1. Cloudflare Workers AI: Set to Auto (FLUX.1 Schnell) and 100 reqs/day
UPDATE public.providers
SET
  model_name = 'auto',
  rpd_limit = 100,
  config = jsonb_set(
    jsonb_set(
      COALESCE(config, '{}'::jsonb),
      '{default_image_model}',
      '"@cf/black-forest-labs/flux-1-schnell"'::jsonb
    ),
    '{neurons_per_day_limit}',
    '10000'::jsonb
  )
WHERE kind = 'cloudflare_workers_ai'
   OR name ILIKE '%cloudflare%';

-- 2. ZenMux: Set to Auto (Gemini Image Free)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"google/gemini-2.5-flash-image-free"'::jsonb
  )
WHERE name ILIKE '%zenmux%';

-- 3. OpenRouter: Set to Auto (Riverflow Fast Free)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"sourceful/riverflow-v2.5-fast:free"'::jsonb
  )
WHERE name ILIKE '%openrouter%';

-- 4. Pollinations AI: Set to Auto (Flux 100% Free)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"flux"'::jsonb
  )
WHERE kind = 'pollinations'
   OR name ILIKE '%pollinations%';

-- 5. NVIDIA NIM: Set to Auto (SD 3.5 Large)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"stabilityai/stable-diffusion-3.5-large"'::jsonb
  )
WHERE name ILIKE '%nvidia%';

-- >>> Migration: image_priority_chain.sql <<<

-- ============================================================================
-- Migration: Strict Priority Image Generation Fallback Chain (#1 to #8)
-- Idempotent SQL script for Supabase SQL Editor.
-- Preserves existing text providers, existing keys, and page schedules.
-- ============================================================================

-- 1. Upsert the 8 Image Providers in Strict Priority Order (#1 to #8)

-- #1 ZenMux: Gemini image model free variant (google/gemini-2.5-flash-image-free)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222201',
  'ZenMux (Gemini Image Free)',
  'openai_compatible_images',
  'https://zenmux.ai/api/v1',
  'google/gemini-2.5-flash-image-free',
  '{"status": "needs_key", "health_status": "needs_key", "chain_type": "image", "default_image_model": "google/gemini-2.5-flash-image-free", "endpoint_type": "standard_images", "license": "Google Terms of Service", "commercial": true}'::jsonb,
  30, 1000, 1, false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 1;

-- #2 Vercel AI Gateway: FLUX.2 klein 4B (bfl/flux-2-klein-4b)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222202',
  'Vercel AI Gateway (FLUX.2 klein 4B)',
  'openai_compatible_images',
  'https://gateway.ai.vercel.com/v1',
  'bfl/flux-2-klein-4b',
  '{"status": "needs_key", "health_status": "needs_key", "chain_type": "image", "default_image_model": "bfl/flux-2-klein-4b", "endpoint_type": "standard_images", "license": "Apache 2.0", "commercial": true, "monthly_credit_usd": 5.0}'::jsonb,
  30, 1000, 2, false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 2;

-- #3 NVIDIA NIM: Stable Diffusion 3.5 Large / Qwen-Image
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222203',
  'NVIDIA NIM (SD 3.5 Large)',
  'openai_compatible_images',
  'https://integrate.api.nvidia.com/v1',
  'stabilityai/stable-diffusion-3.5-large',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "stabilityai/stable-diffusion-3.5-large", "alternate_model": "qwen/qwen-image", "endpoint_type": "nvidia_nim", "license": "Stability AI Community License", "commercial": true}'::jsonb,
  60, 1000, 3, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 3;

-- Link existing NVIDIA key to NVIDIA NIM Image provider
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '5a670858-6d71-40d0-a136-d68ccf7f9983'::uuid,
  '22222222-2222-2222-2222-222222222203'::uuid,
  k.key_encrypted,
  k.key_masked,
  'NVIDIA NIM Image Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '676cb9d7-7459-4c06-8feb-d1f639ad756f'
ON CONFLICT (id) DO NOTHING;

-- #4 Cloudflare Workers AI: FLUX.1 Schnell (4 steps, ~100-200 neurons/img -> 50-100+ imgs/day free tier)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222204',
  'Cloudflare Workers AI (FLUX.1 Schnell)',
  'cloudflare_workers_ai',
  'https://api.cloudflare.com/client/v4',
  '@cf/black-forest-labs/flux-1-schnell',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "@cf/black-forest-labs/flux-1-schnell", "account_id": "8a49b9104077d7d64bf20ffc9249b891", "daily_neurons": 10000, "steps": 4, "license": "Apache 2.0", "commercial": true}'::jsonb,
  60, 100, 4, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  rpd_limit = 100,
  priority = 4;

-- Link existing Cloudflare key
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '747137a3-b960-47cf-8e00-894630f70784'::uuid,
  '22222222-2222-2222-2222-222222222204'::uuid,
  k.key_encrypted,
  k.key_masked,
  'Cloudflare Shared Image Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '11111111-1111-1111-1111-111111111104'
ON CONFLICT (id) DO NOTHING;

-- #5 OpenRouter: sourceful/riverflow-v2.5-fast:free (chat modalities)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222205',
  'OpenRouter (Riverflow v2.5 Fast Free)',
  'openai_compatible_images',
  'https://openrouter.ai/api/v1',
  'sourceful/riverflow-v2.5-fast:free',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "sourceful/riverflow-v2.5-fast:free", "endpoint_type": "openrouter_chat_modalities", "license": "OpenRouter Free Terms", "commercial": true}'::jsonb,
  20, 200, 5, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 5;

-- Link existing OpenRouter key
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '96ad2f7f-3121-4d1c-a09f-38a14e989985'::uuid,
  '22222222-2222-2222-2222-222222222205'::uuid,
  k.key_encrypted,
  k.key_masked,
  'OpenRouter Shared Image Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '11111111-1111-1111-1111-111111111102'
ON CONFLICT (id) DO NOTHING;

-- #6 Alibaba Cloud Model Studio: Wanx Turbo / Qwen-Image (90-day free pool)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222206',
  'Alibaba Cloud Model Studio (Wanx Turbo)',
  'openai_compatible_images',
  'https://dashscope.aliyuncs.com/api/v1',
  'wanx2.1-t2i-turbo',
  '{"status": "needs_key", "health_status": "needs_key", "chain_type": "image", "default_image_model": "wanx2.1-t2i-turbo", "endpoint_type": "alibaba_dashscope_async", "license": "Alibaba Cloud Model Studio Terms", "commercial": true, "free_quota_images": 500}'::jsonb,
  30, 500, 6, false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 6;

-- #7 Pollinations AI: Keyed gen endpoint with watermark rejection
UPDATE public.providers
SET
  name = 'Pollinations AI (Keyed Flux)',
  priority = 7,
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{reject_watermarks}', 'true'::jsonb
  )
WHERE id = '11111111-1111-1111-1111-111111111105';

-- #8 Cloudflare Workers AI: FLUX.1 schnell (LAST Fallback inside 1500 neuron reserve)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222208',
  'Cloudflare Workers AI (FLUX.1 Schnell Fallback)',
  'cloudflare_workers_ai',
  'https://api.cloudflare.com/client/v4',
  '@cf/black-forest-labs/flux-1-schnell',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "@cf/black-forest-labs/flux-1-schnell", "num_steps": 4, "is_last_fallback": true, "reserve_neurons": 1500, "license": "Apache 2.0", "commercial": true}'::jsonb,
  60, 1000, 8, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 8;

-- Link existing Cloudflare key to Schnell fallback
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '747137a3-b960-47cf-8e00-894630f70788'::uuid,
  '22222222-2222-2222-2222-222222222208'::uuid,
  k.key_encrypted,
  k.key_masked,
  'Cloudflare Schnell Fallback Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '11111111-1111-1111-1111-111111111104'
ON CONFLICT (id) DO NOTHING;

-- 2. Upsert Global Image Chain in public.provider_chains
INSERT INTO public.provider_chains (
  id, name, stage, strategy, provider_ids
) VALUES (
  '33333333-3333-3333-3333-333333333301',
  'Strict Priority Image Chain (#1 to #8)',
  'image',
  'priority',
  '["22222222-2222-2222-2222-222222222201", "22222222-2222-2222-2222-222222222202", "22222222-2222-2222-2222-222222222203", "22222222-2222-2222-2222-222222222204", "22222222-2222-2222-2222-222222222205", "22222222-2222-2222-2222-222222222206", "11111111-1111-1111-1111-111111111105", "22222222-2222-2222-2222-222222222208"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  strategy = 'priority',
  provider_ids = EXCLUDED.provider_ids;

-- ----------------------------------------------------------------------------
-- 16. Storage Bucket: post-images (Private)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'post-images',
    'post-images',
    false,
    10485760, -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS Policy for post-images
DO $$
BEGIN
    DROP POLICY IF EXISTS "Authenticated users full access to post-images" ON storage.objects;
    CREATE POLICY "Authenticated users full access to post-images"
    ON storage.objects
    FOR ALL
    TO authenticated
    USING (bucket_id = 'post-images')
    WITH CHECK (bucket_id = 'post-images');
END
$$;

-- ----------------------------------------------------------------------------
-- 17. Verification Helper: check_table_rls_status
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_table_rls_status()
RETURNS TABLE (table_name text, rls_enabled boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT tablename::text, rowsecurity::boolean
  FROM pg_tables
  WHERE schemaname = 'public';
$$;
