import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve('supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let combinedSql = `-- ============================================================================
-- Supabase Consolidated Migrations
-- Autonomous Multi-Page Facebook Content System
-- ============================================================================

`;

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  combinedSql += `-- >>> Migration: ${file} <<<\n\n`;
  combinedSql += content.trim();
  combinedSql += '\n\n';
}

// Append storage bucket setup and RLS
combinedSql += `-- ----------------------------------------------------------------------------
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
`;

const outputPath = path.resolve('supabase/all_migrations.sql');
fs.writeFileSync(outputPath, combinedSql, 'utf8');
console.log(`Wrote combined migrations to: ${outputPath} (${fs.statSync(outputPath).size} bytes)`);
