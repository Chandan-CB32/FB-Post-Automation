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
