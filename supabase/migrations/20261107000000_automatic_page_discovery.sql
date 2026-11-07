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
