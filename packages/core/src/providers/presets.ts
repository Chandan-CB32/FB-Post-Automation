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
    rpmLimit: 15,
    rpdLimit: 1500,
    concurrencyLimit: 2,
    category: 'popular',
    instructions: 'Get a free API key at Google AI Studio (https://aistudio.google.com).',
    config: {
      searchGrounding: true,
    },
  },
  {
    id: 'preset-openai',
    name: 'OpenAI (ChatGPT & GPT-4o)',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.openai.com/v1',
    defaultTextModel: 'gpt-4o',
    defaultImageModel: 'dall-e-3',
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
    id: 'preset-anthropic',
    name: 'Anthropic Claude',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultTextModel: 'anthropic/claude-3.5-sonnet',
    rpmLimit: 30,
    rpdLimit: 5000,
    concurrencyLimit: 3,
    category: 'popular',
    instructions: 'Use an OpenRouter key at https://openrouter.ai/keys to access Claude 3.5 Sonnet.',
    config: {},
  },
  {
    id: 'preset-mistral',
    name: 'Mistral AI',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultTextModel: 'mistral-large-latest',
    rpmLimit: 30,
    rpdLimit: 5000,
    concurrencyLimit: 2,
    category: 'popular',
    instructions: 'Get your API key at https://console.mistral.ai/api-keys.',
    config: {},
  },
  {
    id: 'preset-perplexity',
    name: 'Perplexity AI',
    kind: 'openai_compatible_chat',
    baseUrl: 'https://api.perplexity.ai',
    defaultTextModel: 'sonar-pro',
    rpmLimit: 20,
    rpdLimit: 2000,
    concurrencyLimit: 2,
    category: 'popular',
    instructions: 'Get your API key at https://www.perplexity.ai/settings/api.',
    config: {},
  },

  // --- Image & Multimodal Generation ---
  {
    id: 'preset-pollinations',
    name: 'Pollinations AI',
    kind: 'pollinations',
    baseUrl: 'https://gen.pollinations.ai',
    defaultImageModel: 'flux',
    rpmLimit: 30,
    rpdLimit: 1000,
    concurrencyLimit: 2,
    category: 'image',
    instructions: '100% Free! Works without any API key, or enter a Pollinations seed/token.',
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
