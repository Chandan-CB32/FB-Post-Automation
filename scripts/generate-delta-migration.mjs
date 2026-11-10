import fs from 'node:fs';
import { getAllNicheProfiles } from '../packages/core/dist/profiles/seed-profiles.js';

const profiles = getAllNicheProfiles();

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function escJson(obj) {
  if (obj === null || obj === undefined) return "'{}'::jsonb";
  return "'" + JSON.stringify(obj).replace(/'/g, "''") + "'::jsonb";
}

let sql = `-- ============================================================================
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
    -- Do NOT bump NEW.version or settings_version here!
    -- Operational writes (token checks, sync, metrics) must NEVER bump user settings versions.
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
CREATE INDEX IF NOT EXISTS idx_pages_settings_version ON public.pages (settings_version);

-- 7. Seed Starter & Extended Content Profiles (27 Viral Niches)
`;

for (const p of profiles) {
  sql += `INSERT INTO public.content_profiles (
    name, description, type, language, audience, master_prompt,
    templates, caption_settings, hashtag_settings, disclosure_settings,
    image_settings, topic_settings, research_source_ids, custom_variables,
    is_system, version
) VALUES (
    ${esc(p.name)}, ${esc(p.description)}, ${esc(p.type)}, ${esc(p.language || 'en')},
    ${esc(p.audience || 'General audience')}, ${esc(p.masterPrompt)},
    ${escJson(p.templates)}, ${escJson(p.captionSettings)}, ${escJson(p.hashtagSettings)},
    ${escJson(p.disclosureSettings)}, ${escJson(p.imageSettings)}, ${escJson(p.topicSettings)},
    ${escJson(p.researchSourceIds || [])}, ${escJson(p.customVariables || {})},
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

`;
}

fs.writeFileSync('supabase/delta_20261110.sql', sql, 'utf8');
console.log('Successfully wrote supabase/delta_20261110.sql (' + sql.length + ' bytes)');

