-- ============================================================================
-- Migration: Auto Free-Tier Image & Text Providers with 100 RPD for Cloudflare
-- Idempotent SQL script for Supabase SQL Editor.
-- Sets all image & text providers to Automatic Free-Tier model selection ('auto')
-- and updates Cloudflare Workers AI to 100 requests/day (10,000 neurons allowance).
-- ============================================================================

-- 1. Cloudflare Workers AI: Set to Auto (FLUX.1 Schnell) and 100 reqs/day
UPDATE public.providers
SET
  model_name = 'auto',
  rpd_limit = 100,
  config = jsonb_set(
    jsonb_set(
      COALESCE(config, '{}'::jsonb),
      '{default_image_model}',
      '"@cf/black-forest-labs/flux-1-schnell"'::jsonb
    ),
    '{neurons_per_day_limit}',
    '10000'::jsonb
  )
WHERE kind = 'cloudflare_workers_ai'
   OR name ILIKE '%cloudflare%';

-- 2. ZenMux: Set to Auto (Gemini Image Free)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"google/gemini-2.5-flash-image-free"'::jsonb
  )
WHERE name ILIKE '%zenmux%';

-- 3. OpenRouter: Set to Auto (Riverflow Fast Free)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"sourceful/riverflow-v2.5-fast:free"'::jsonb
  )
WHERE name ILIKE '%openrouter%';

-- 4. Pollinations AI: Set to Auto (Flux 100% Free)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"flux"'::jsonb
  )
WHERE kind = 'pollinations'
   OR name ILIKE '%pollinations%';

-- 5. NVIDIA NIM: Set to Auto (SD 3.5 Large)
UPDATE public.providers
SET
  model_name = 'auto',
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{default_image_model}',
    '"stabilityai/stable-diffusion-3.5-large"'::jsonb
  )
WHERE name ILIKE '%nvidia%';
