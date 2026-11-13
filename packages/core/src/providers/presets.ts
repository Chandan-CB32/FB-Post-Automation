import { ProviderAdapterKind } from '../types/index.js';

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderAdapterKind;
  baseUrl: string;
  defaultTextModel?: string;
  defaultImageModel?: string;
  availableImageModels?: Array<{ id: string; name: string; cost: number }>;
  estimatedCostPerImage?: number;
  rpmLimit: number;
  rpdLimit: number;
  concurrencyLimit: number;
  instructions: string;
  category?: 'popular' | 'image' | 'free_local' | 'specialized';
  config: Record<string, unknown>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // --- Popular & Mainstream ---
  {
    id: 'preset-gemini',
    name: 'Google Gemini',
    kind: 'gemini_native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultTextModel: 'gemini-2.5-flash',
    defaultImageModel: 'gemini-2.5-flash-image',
    availableImageModels: [
      { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image (Nano Banana)', cost: 0.03 },
      { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image (Ultra)', cost: 0.06 },
    ],
    estimatedCostPerImage: 0.03,
    rpmLimit: 15,
    rpdLimit: 1500,
    concurrencyLimit: 2,
    category: 'popular',
    instructions: 'Get an API key at Google AI Studio (https://aistudio.google.com). Note: Image generation requires billing enabled.',
    config: {
      searchGrounding: true,
    },
  },
  {
    id: 'preset-openai',
    name: 'OpenAI (ChatGPT & DALL-E 3)',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.openai.com/v1',
    defaultTextModel: 'gpt-4o',
    defaultImageModel: 'dall-e-3',
    availableImageModels: [
      { id: 'dall-e-3', name: 'DALL-E 3 (Standard 1024x1024 / 1024x1792)', cost: 0.04 },
    ],
    estimatedCostPerImage: 0.04,
    rpmLimit: 60,
    rpdLimit: 10000,
    concurrencyLimit: 4,
    category: 'popular',
    instructions: 'Get your API key at https://platform.openai.com/api-keys.',
    config: {},
  },
  {
    id: 'preset-deepseek',
    name: 'DeepSeek',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultTextModel: 'deepseek-chat',
    rpmLimit: 60,
    rpdLimit: 10000,
    concurrencyLimit: 4,
    category: 'popular',
    instructions: 'Get your API key at https://platform.deepseek.com/api_keys.',
    config: {},
  },
  {
    id: 'preset-groq',
    name: 'Groq',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultTextModel: 'llama-3.3-70b-versatile',
    rpmLimit: 30,
    rpdLimit: 14400,
    concurrencyLimit: 2,
    category: 'popular',
    instructions: 'Get a free high-speed API key at https://console.groq.com/keys.',
    config: {},
  },
  {
    id: 'preset-openrouter',
    name: 'OpenRouter',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultTextModel: 'meta-llama/llama-3.3-70b-instruct:free',
    defaultImageModel: 'black-forest-labs/flux-1-schnell',
    rpmLimit: 20,
    rpdLimit: 200,
    concurrencyLimit: 2,
    category: 'popular',
    instructions: 'Get an API key at https://openrouter.ai/keys. Supports hundreds of models.',
    config: {
      siteUrl: 'https://fb-post-automation.local',
      siteName: 'FB Post Automation',
    },
  },
  {
    id: 'preset-zenmux',
    name: 'ZenMux (Free Image Models)',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://zenmux.ai/api/v1',
    defaultTextModel: 'google/gemini-2.5-flash-free',
    defaultImageModel: 'google/gemini-2.5-flash-image-free',
    availableImageModels: [
      { id: 'google/gemini-2.5-flash-image-free', name: 'Gemini 2.5 Flash Image (Free Tier)', cost: 0.0 },
      { id: 'black-forest-labs/flux-1-schnell-free', name: 'FLUX.1 Schnell (Free Tier)', cost: 0.0 },
    ],
    estimatedCostPerImage: 0.0,
    rpmLimit: 30,
    rpdLimit: 1000,
    concurrencyLimit: 2,
    category: 'image',
    instructions: 'Get a free API key at https://zenmux.ai. Select google/gemini-2.5-flash-image-free for free image generation.',
    config: {},
  },

  // --- Image & Multimodal Generation ---
  {
    id: 'preset-pollinations',
    name: 'Pollinations AI',
    kind: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    defaultImageModel: 'flux',
    availableImageModels: [
      { id: 'flux', name: 'FLUX.1 Schnell (Free, Photorealistic)', cost: 0.0 },
      { id: 'turbo', name: 'SDXL Turbo (High-speed)', cost: 0.002 },
      { id: 'gptimage', name: 'GPT Image (High prompt adherence)', cost: 0.003 },
      { id: 'seedream', name: 'Seedream (ByteDance SDXL)', cost: 0.003 },
      { id: 'nanobanana', name: 'Nano Banana (Gemini 2.5 Flash Image)', cost: 0.004 },
    ],
    estimatedCostPerImage: 0.0,
    rpmLimit: 30,
    rpdLimit: 1000,
    concurrencyLimit: 2,
    category: 'image',
    instructions: '100% Free for FLUX! Enter a Pollinations API token to access premium models.',
    config: {
      nologo: true,
      width: 1080,
      height: 1350,
    },
  },
  {
    id: 'preset-cloudflare',
    name: 'Cloudflare Workers AI',
    kind: 'cloudflare_workers_ai',
    baseUrl: 'https://api.cloudflare.com/client/v4',
    defaultTextModel: '@cf/meta/llama-3.1-8b-instruct',
    defaultImageModel: '@cf/black-forest-labs/flux-1-schnell',
    availableImageModels: [
      { id: '@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 Schnell (Workers AI)', cost: 0.003 },
      { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base 1.0', cost: 0.002 },
    ],
    estimatedCostPerImage: 0.003,
    rpmLimit: 60,
    rpdLimit: 1000,
    concurrencyLimit: 2,
    category: 'image',
    instructions: 'Create an API token at https://dash.cloudflare.com/profile/api-tokens with Workers AI Read permissions.',
    config: {
      neuronsPerDayLimit: 10000,
    },
  },
  {
    id: 'preset-together',
    name: 'Together AI',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.together.xyz/v1',
    defaultTextModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    defaultImageModel: 'black-forest-labs/FLUX.1-schnell',
    availableImageModels: [
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell', cost: 0.003 },
      { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1 Dev', cost: 0.015 },
    ],
    estimatedCostPerImage: 0.003,
    rpmLimit: 30,
    rpdLimit: 5000,
    concurrencyLimit: 2,
    category: 'image',
    instructions: 'Get your API key at https://api.together.ai/settings/api-keys.',
    config: {},
  },

  // --- Specialized & Cloud Compute ---
  {
    id: 'preset-huggingface',
    name: 'Hugging Face Inference',
    kind: 'huggingface_inference',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultTextModel: 'deepseek-ai/DeepSeek-R1',
    rpmLimit: 20,
    rpdLimit: 500,
    concurrencyLimit: 1,
    category: 'specialized',
    instructions: 'Get a user access token at https://huggingface.co/settings/tokens.',
    config: {},
  },
  {
    id: 'preset-nvidia-nim',
    name: 'NVIDIA NIM',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultTextModel: 'meta/llama-3.3-70b-instruct',
    rpmLimit: 20,
    rpdLimit: 1000,
    concurrencyLimit: 2,
    category: 'specialized',
    instructions: 'Sign up for 1,000 free inference credits at https://build.nvidia.com.',
    config: {},
  },
  {
    id: 'preset-fireworks',
    name: 'Fireworks AI',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultTextModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    rpmLimit: 30,
    rpdLimit: 5000,
    concurrencyLimit: 2,
    category: 'specialized',
    instructions: 'Get your API key at https://fireworks.ai/api-keys.',
    config: {},
  },

  // --- Free Local & Custom Endpoints ---
  {
    id: 'preset-ollama',
    name: 'Ollama Local (Offline / Free)',
    kind: 'openai_compatible_chat',
    baseUrl: 'http://localhost:11434/v1',
    defaultTextModel: 'llama3.2',
    rpmLimit: 100,
    rpdLimit: 100000,
    concurrencyLimit: 2,
    category: 'free_local',
    instructions: 'No API key needed! Run `ollama run llama3.2` on your local machine.',
    config: {},
  },
  {
    id: 'preset-custom',
    name: 'Custom OpenAI-Compatible API / Proxy',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.yourdomain.com/v1',
    defaultTextModel: 'gpt-4o-mini',
    rpmLimit: 30,
    rpdLimit: 5000,
    concurrencyLimit: 2,
    category: 'free_local',
    instructions: 'Custom endpoint. Enter your base URL, model name, and API key below.',
    config: {},
  },
];

export function findPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function findPresetByName(name: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Calculates estimated cost per image generation for a given provider and model.
 */
export function getEstimatedCostPerImage(adapterKind: string, model?: string): number {
  const m = (model || '').toLowerCase();
  if (adapterKind === 'pollinations') {
    if (m === 'flux' || !m) return 0.0;
    if (m.includes('turbo')) return 0.002;
    if (m.includes('gptimage') || m.includes('seedream')) return 0.003;
    if (m.includes('nanobanana')) return 0.004;
    return 0.002;
  }
  if (adapterKind === 'gemini_native' || m.includes('gemini')) {
    if (m.includes('pro')) return 0.06;
    if (m.includes('free')) return 0.0;
    return 0.03; // Standard Gemini 2.5 Flash Image is ~$0.03 / image
  }
  if (adapterKind === 'cloudflare_workers_ai' || m.includes('@cf')) {
    return 0.003; // ~$0.0028 per image or free tier
  }
  if (m.includes('dall-e-3') || m.includes('dalle')) {
    return 0.04;
  }
  if (m.includes('free')) {
    return 0.0;
  }
  return 0.005;
}

/**
 * Calculates estimated daily spend based on posts per day.
 */
export function getEstimatedDailyCost(adapterKind: string, model: string | undefined, postsPerDay = 5): number {
  return Number((getEstimatedCostPerImage(adapterKind, model) * postsPerDay).toFixed(4));
}
