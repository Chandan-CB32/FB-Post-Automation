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
