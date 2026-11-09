-- ============================================================================
-- Supabase Delta Migration: 2026-11-09
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

