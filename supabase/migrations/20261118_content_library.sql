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
