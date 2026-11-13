-- ============================================================================
-- Migration: Strict Priority Image Generation Fallback Chain (#1 to #8)
-- Idempotent SQL script for Supabase SQL Editor.
-- Preserves existing text providers, existing keys, and page schedules.
-- ============================================================================

-- 1. Upsert the 8 Image Providers in Strict Priority Order (#1 to #8)

-- #1 ZenMux: Gemini image model free variant (google/gemini-2.5-flash-image-free)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222201',
  'ZenMux (Gemini Image Free)',
  'openai_compatible_images',
  'https://zenmux.ai/api/v1',
  'google/gemini-2.5-flash-image-free',
  '{"status": "needs_key", "health_status": "needs_key", "chain_type": "image", "default_image_model": "google/gemini-2.5-flash-image-free", "endpoint_type": "standard_images", "license": "Google Terms of Service", "commercial": true}'::jsonb,
  30, 1000, 1, false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 1;

-- #2 Vercel AI Gateway: FLUX.2 klein 4B (bfl/flux-2-klein-4b)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222202',
  'Vercel AI Gateway (FLUX.2 klein 4B)',
  'openai_compatible_images',
  'https://gateway.ai.vercel.com/v1',
  'bfl/flux-2-klein-4b',
  '{"status": "needs_key", "health_status": "needs_key", "chain_type": "image", "default_image_model": "bfl/flux-2-klein-4b", "endpoint_type": "standard_images", "license": "Apache 2.0", "commercial": true, "monthly_credit_usd": 5.0}'::jsonb,
  30, 1000, 2, false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 2;

-- #3 NVIDIA NIM: Stable Diffusion 3.5 Large / Qwen-Image
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222203',
  'NVIDIA NIM (SD 3.5 Large)',
  'openai_compatible_images',
  'https://integrate.api.nvidia.com/v1',
  'stabilityai/stable-diffusion-3.5-large',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "stabilityai/stable-diffusion-3.5-large", "alternate_model": "qwen/qwen-image", "endpoint_type": "nvidia_nim", "license": "Stability AI Community License", "commercial": true}'::jsonb,
  60, 1000, 3, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 3;

-- Link existing NVIDIA key to NVIDIA NIM Image provider
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '5a670858-6d71-40d0-a136-d68ccf7f9983'::uuid,
  '22222222-2222-2222-2222-222222222203'::uuid,
  k.key_encrypted,
  k.key_masked,
  'NVIDIA NIM Image Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '676cb9d7-7459-4c06-8feb-d1f639ad756f'
ON CONFLICT (id) DO NOTHING;

-- #4 Cloudflare Workers AI: Leonardo Lucid Origin / Phoenix 1.0 (cap 3 imgs/day)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222204',
  'Cloudflare Workers AI (Leonardo Lucid)',
  'cloudflare_workers_ai',
  'https://api.cloudflare.com/client/v4',
  '@cf/leonardo/lucid-origin',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "@cf/leonardo/lucid-origin", "alternate_model": "@cf/leonardo/phoenix-1.0", "num_steps": 20, "daily_cap": 3, "license": "Cloudflare / Leonardo Terms", "commercial": true}'::jsonb,
  10, 3, 4, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 4;

-- Link existing Cloudflare key
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '747137a3-b960-47cf-8e00-894630f70784'::uuid,
  '22222222-2222-2222-2222-222222222204'::uuid,
  k.key_encrypted,
  k.key_masked,
  'Cloudflare Shared Image Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '11111111-1111-1111-1111-111111111104'
ON CONFLICT (id) DO NOTHING;

-- #5 OpenRouter: sourceful/riverflow-v2.5-fast:free (chat modalities)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222205',
  'OpenRouter (Riverflow v2.5 Fast Free)',
  'openai_compatible_images',
  'https://openrouter.ai/api/v1',
  'sourceful/riverflow-v2.5-fast:free',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "sourceful/riverflow-v2.5-fast:free", "endpoint_type": "openrouter_chat_modalities", "license": "OpenRouter Free Terms", "commercial": true}'::jsonb,
  20, 200, 5, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 5;

-- Link existing OpenRouter key
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '96ad2f7f-3121-4d1c-a09f-38a14e989985'::uuid,
  '22222222-2222-2222-2222-222222222205'::uuid,
  k.key_encrypted,
  k.key_masked,
  'OpenRouter Shared Image Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '11111111-1111-1111-1111-111111111102'
ON CONFLICT (id) DO NOTHING;

-- #6 Alibaba Cloud Model Studio: Wanx Turbo / Qwen-Image (90-day free pool)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222206',
  'Alibaba Cloud Model Studio (Wanx Turbo)',
  'openai_compatible_images',
  'https://dashscope.aliyuncs.com/api/v1',
  'wanx2.1-t2i-turbo',
  '{"status": "needs_key", "health_status": "needs_key", "chain_type": "image", "default_image_model": "wanx2.1-t2i-turbo", "endpoint_type": "alibaba_dashscope_async", "license": "Alibaba Cloud Model Studio Terms", "commercial": true, "free_quota_images": 500}'::jsonb,
  30, 500, 6, false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 6;

-- #7 Pollinations AI: Keyed gen endpoint with watermark rejection
UPDATE public.providers
SET
  name = 'Pollinations AI (Keyed Flux)',
  priority = 7,
  config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{reject_watermarks}', 'true'::jsonb
  )
WHERE id = '11111111-1111-1111-1111-111111111105';

-- #8 Cloudflare Workers AI: FLUX.1 schnell (LAST Fallback inside 1500 neuron reserve)
INSERT INTO public.providers (
  id, name, kind, base_url, model_name, config, rpm_limit, rpd_limit, priority, active
) VALUES (
  '22222222-2222-2222-2222-222222222208',
  'Cloudflare Workers AI (FLUX.1 Schnell Fallback)',
  'cloudflare_workers_ai',
  'https://api.cloudflare.com/client/v4',
  '@cf/black-forest-labs/flux-1-schnell',
  '{"status": "active", "health_status": "healthy", "chain_type": "image", "default_image_model": "@cf/black-forest-labs/flux-1-schnell", "num_steps": 4, "is_last_fallback": true, "reserve_neurons": 1500, "license": "Apache 2.0", "commercial": true}'::jsonb,
  60, 1000, 8, true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  base_url = EXCLUDED.base_url,
  model_name = EXCLUDED.model_name,
  config = EXCLUDED.config,
  priority = 8;

-- Link existing Cloudflare key to Schnell fallback
INSERT INTO public.provider_keys (id, provider_id, key_encrypted, key_masked, label, status)
SELECT
  '747137a3-b960-47cf-8e00-894630f70788'::uuid,
  '22222222-2222-2222-2222-222222222208'::uuid,
  k.key_encrypted,
  k.key_masked,
  'Cloudflare Schnell Fallback Key',
  'active'
FROM public.provider_keys k
WHERE k.provider_id = '11111111-1111-1111-1111-111111111104'
ON CONFLICT (id) DO NOTHING;

-- 2. Upsert Global Image Chain in public.provider_chains
INSERT INTO public.provider_chains (
  id, name, stage, strategy, provider_ids
) VALUES (
  '33333333-3333-3333-3333-333333333301',
  'Strict Priority Image Chain (#1 to #8)',
  'image',
  'priority',
  '["22222222-2222-2222-2222-222222222201", "22222222-2222-2222-2222-222222222202", "22222222-2222-2222-2222-222222222203", "22222222-2222-2222-2222-222222222204", "22222222-2222-2222-2222-222222222205", "22222222-2222-2222-2222-222222222206", "11111111-1111-1111-1111-111111111105", "22222222-2222-2222-2222-222222222208"]'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  strategy = 'priority',
  provider_ids = EXCLUDED.provider_ids;
