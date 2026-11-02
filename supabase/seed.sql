-- ============================================================================
-- Supabase Seed Data: seed.sql
-- Default Settings & Provider Presets
-- ============================================================================

-- Global System Settings
INSERT INTO public.settings (key, value, updated_at)
VALUES
    ('kill_switch', '{"paused": false, "reason": null}'::jsonb, now()),
    ('retention', '{"published_image_hours": 24, "failed_image_days": 3, "research_items_days": 30, "logs_days": 90}'::jsonb, now()),
    ('storage_limits', '{"warning_percent": 70, "safe_mode_percent": 90}'::jsonb, now()),
    ('defaults', '{"timezone": "UTC", "jitter_minutes": 10, "min_gap_hours": 2, "max_posts_per_day_warn": 5}'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Provider Presets (Active = false until keys are added via dashboard)
INSERT INTO public.providers (id, name, kind, base_url, config, rpm_limit, rpd_limit, concurrency_limit, active)
VALUES
    (
        '11111111-1111-1111-1111-111111111101',
        'Google Gemini',
        'gemini_native',
        'https://generativelanguage.googleapis.com/v1beta',
        '{"default_text_model": "gemini-2.5-flash", "search_grounding": true}'::jsonb,
        15,
        1500,
        2,
        false
    ),
    (
        '11111111-1111-1111-1111-111111111102',
        'OpenRouter',
        'openai_compatible_chat',
        'https://openrouter.ai/api/v1',
        '{"default_text_model": "meta-llama/llama-3.3-70b-instruct:free", "site_url": "https://fb-auto.local", "site_name": "FB Automation"}'::jsonb,
        20,
        200,
        2,
        false
    ),
    (
        '11111111-1111-1111-1111-111111111103',
        'Groq',
        'openai_compatible_chat',
        'https://api.groq.com/openai/v1',
        '{"default_text_model": "llama-3.3-70b-versatile"}'::jsonb,
        30,
        14400,
        2,
        false
    ),
    (
        '11111111-1111-1111-1111-111111111104',
        'Cloudflare Workers AI',
        'cloudflare_workers_ai',
        'https://api.cloudflare.com/client/v4',
        '{"default_image_model": "@cf/black-forest-labs/flux-1-schnell", "neurons_per_day_limit": 10000}'::jsonb,
        60,
        1000,
        2,
        false
    ),
    (
        '11111111-1111-1111-1111-111111111105',
        'Pollinations AI',
        'pollinations',
        'https://gen.pollinations.ai',
        '{"default_image_model": "flux", "nologo": true, "width": 1080, "height": 1350}'::jsonb,
        30,
        500,
        2,
        false
    ),
    (
        '11111111-1111-1111-1111-111111111106',
        'Hugging Face Inference',
        'huggingface_inference',
        'https://router.huggingface.co/v1',
        '{"default_text_model": "deepseek-ai/DeepSeek-R1"}'::jsonb,
        20,
        500,
        1,
        false
    )
ON CONFLICT (name) DO NOTHING;

