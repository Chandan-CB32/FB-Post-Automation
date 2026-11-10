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


