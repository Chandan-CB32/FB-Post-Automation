import fs from 'node:fs';
import path from 'node:path';

const preamble = `-- ============================================================================
-- Supabase Consolidated Migrations
-- Autonomous Multi-Page Facebook Content System (FB Auto 247)
-- ============================================================================

-- Standalone Postgres Role Preamble (Safe on Supabase and standalone Postgres)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
END
$$;

-- Ensure storage schema & tables exist if running on vanilla Postgres
DO $$
BEGIN
    CREATE SCHEMA IF NOT EXISTS storage;

    CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        public BOOLEAN DEFAULT false,
        avif_autodetection BOOLEAN DEFAULT false,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[]
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT REFERENCES storage.buckets(id),
        name TEXT,
        owner UUID,
        created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        last_accessed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
        metadata JSONB DEFAULT '{}'::jsonb,
        path_tokens TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
    );
EXCEPTION WHEN OTHERS THEN
    -- In Supabase, the storage schema and tables are pre-managed by Supabase Storage Admin
    NULL;
END
$$;

-- Enable pgcrypto for UUID generation (optional in PG 13+ as gen_random_uuid() is built-in)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN
    NULL;
END
$$;
`;

const migrationsDir = 'supabase/migrations';
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
console.log('Including migrations in order:', files);

let fullContent = preamble + '\n';
for (const f of files) {
  const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
  fullContent += `\n-- ============================================================================\n-- Migration: ${f}\n-- ============================================================================\n\n` + content + '\n';
}

fs.writeFileSync('supabase/all_migrations.sql', fullContent, 'utf8');
console.log('Successfully wrote supabase/all_migrations.sql, bytes:', fullContent.length);

