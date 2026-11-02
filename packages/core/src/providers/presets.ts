import { ProviderAdapterKind } from '../types/index.js';

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderAdapterKind;
  baseUrl: string;
  defaultTextModel?: string;
  defaultImageModel?: string;
  rpmLimit: number;
  rpdLimit: number;
  concurrencyLimit: number;
  instructions: string;
  config: Record<string, unknown>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'preset-gemini',
    name: 'Google Gemini',
    kind: 'gemini_native',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultTextModel: 'gemini-2.5-flash',
    rpmLimit: 15,
    rpdLimit: 1500,
    concurrencyLimit: 2,
    instructions: 'Get a free API key at Google AI Studio (https://aistudio.google.com).',
    config: {
      searchGrounding: true,
    },
  },
  {
    id: 'preset-openrouter',
    name: 'OpenRouter',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultTextModel: 'meta-llama/llama-3.3-70b-instruct:free',
    rpmLimit: 20,
    rpdLimit: 200,
    concurrencyLimit: 2,
    instructions: 'Get an API key at https://openrouter.ai/keys. Free models use :free tag.',
    config: {
      siteUrl: 'https://fb-post-automation.local',
      siteName: 'FB Post Automation',
    },
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
    instructions: 'Get a free high-speed API key at https://console.groq.com/keys.',
    config: {},
  },
  {
    id: 'preset-cloudflare',
    name: 'Cloudflare Workers AI',
    kind: 'cloudflare_workers_ai',
    baseUrl: 'https://api.cloudflare.com/client/v4',
    defaultTextModel: '@cf/meta/llama-3.1-8b-instruct',
    defaultImageModel: '@cf/black-forest-labs/flux-1-schnell',
    rpmLimit: 60,
    rpdLimit: 1000,
    concurrencyLimit: 2,
    instructions: 'Create an API token at https://dash.cloudflare.com/profile/api-tokens with Workers AI Read permissions.',
    config: {
      neuronsPerDayLimit: 10000,
    },
  },
  {
    id: 'preset-pollinations',
    name: 'Pollinations AI',
    kind: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    defaultImageModel: 'flux',
    rpmLimit: 30,
    rpdLimit: 500,
    concurrencyLimit: 2,
    instructions: 'Works without a key, or register at https://enter.pollinations.ai for higher limits.',
    config: {
      nologo: true,
      width: 1080,
      height: 1350,
    },
  },
  {
    id: 'preset-huggingface',
    name: 'Hugging Face Inference',
    kind: 'huggingface_inference',
    baseUrl: 'https://router.huggingface.co/v1',
    defaultTextModel: 'deepseek-ai/DeepSeek-R1',
    rpmLimit: 20,
    rpdLimit: 500,
    concurrencyLimit: 1,
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
    instructions: 'Sign up for 1,000 free inference credits at https://build.nvidia.com.',
    config: {},
  },
];

export function findPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function findPresetByName(name: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

