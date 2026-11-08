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
