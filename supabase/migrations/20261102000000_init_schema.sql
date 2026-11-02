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

