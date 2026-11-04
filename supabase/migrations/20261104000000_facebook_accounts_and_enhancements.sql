-- ============================================================================
-- Supabase Migration: 20261104000000_facebook_accounts_and_enhancements.sql
-- Autonomous Multi-Page Facebook Content System (FB Auto 247)
-- ============================================================================

-- 1. Facebook Accounts Table
CREATE TABLE IF NOT EXISTS public.facebook_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name TEXT NOT NULL,
    fb_user_id TEXT NOT NULL UNIQUE,
    email TEXT,
    user_access_token TEXT, -- AES-256-GCM encrypted
    masked_token TEXT,
    token_status TEXT NOT NULL DEFAULT 'valid' CHECK (token_status IN ('valid', 'expired', 'rate_limited')),
    token_expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_facebook_accounts_status ON public.facebook_accounts(token_status);

-- 2. Link Pages to Facebook Accounts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'fb_account_id'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN fb_account_id UUID REFERENCES public.facebook_accounts(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'first_comment_enabled'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN first_comment_enabled BOOLEAN NOT NULL DEFAULT true;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'pages' AND column_name = 'first_comment_prompt'
    ) THEN
        ALTER TABLE public.pages ADD COLUMN first_comment_prompt TEXT;
    END IF;
END
$$;

-- 3. Link Posts to Facebook Accounts and Comments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'fb_account_id'
    ) THEN
        ALTER TABLE public.posts ADD COLUMN fb_account_id UUID REFERENCES public.facebook_accounts(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'first_comment'
    ) THEN
        ALTER TABLE public.posts ADD COLUMN first_comment TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'analytics'
    ) THEN
        ALTER TABLE public.posts ADD COLUMN analytics JSONB NOT NULL DEFAULT '{}'::jsonb;
    END IF;
END
$$;

-- 4. Audit Log Enhancements
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'level'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'category'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN category TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'message'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN message TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'page_id'
    ) THEN
        ALTER TABLE public.audit_log ADD COLUMN page_id UUID REFERENCES public.pages(id) ON DELETE SET NULL;
    END IF;
END
$$;

-- 5. RLS for facebook_accounts
ALTER TABLE public.facebook_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all_access ON public.facebook_accounts;
CREATE POLICY owner_all_access ON public.facebook_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

