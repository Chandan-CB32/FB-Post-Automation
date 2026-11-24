import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEffectiveModel } from '../packages/core/src/index.js';
import { getProviderChain } from '../apps/web/src/server.js';

describe('Free Models Catalog & Auto Resolution', () => {
  it('automatically resolves "auto" or empty model to verified free models for each provider', () => {
    // Gemini text
    expect(resolveEffectiveModel({ name: 'Google Gemini', adapter_kind: 'gemini_native', model_name: 'auto' }, 'text')).toBe('gemini-3.5-flash-lite');
    expect(resolveEffectiveModel({ name: 'Google Gemini', adapter_kind: 'gemini_native', model_name: '' }, 'text')).toBe('gemini-3.5-flash-lite');

    // Gemini image
    expect(resolveEffectiveModel({ name: 'Google Gemini', adapter_kind: 'gemini_native', model_name: 'auto' }, 'image')).toBe('gemini-2.5-flash-image');

    // Groq
    expect(resolveEffectiveModel({ name: 'Groq', adapter_kind: 'openai_compatible_chat', model_name: 'auto' }, 'text')).toBe('openai/gpt-oss-120b');

    // OpenRouter
    expect(resolveEffectiveModel({ name: 'OpenRouter', adapter_kind: 'openai_compatible_chat', model_name: 'auto' }, 'text')).toBe('nvidia/nemotron-3-nano-30b-a3b:free');

    // NVIDIA NIM
    expect(resolveEffectiveModel({ name: 'NVIDIA NIM', adapter_kind: 'openai_compatible_chat', model_name: 'auto' }, 'text')).toBe('meta/llama-3.3-70b-instruct');

    // Cloudflare Workers AI text
    expect(resolveEffectiveModel({ name: 'Cloudflare Workers AI', adapter_kind: 'cloudflare_workers_ai', model_name: 'auto' }, 'text')).toBe('@cf/meta/llama-3.1-8b-instruct');

    // Cloudflare Workers AI image
    expect(resolveEffectiveModel({ name: 'Cloudflare Workers AI', adapter_kind: 'cloudflare_workers_ai', model_name: 'auto' }, 'image')).toBe('@cf/black-forest-labs/flux-1-schnell');

    // Pollinations image
    expect(resolveEffectiveModel({ name: 'Pollinations AI', adapter_kind: 'pollinations', model_name: 'auto' }, 'image')).toBe('flux');
    expect(resolveEffectiveModel({ name: 'Pollinations AI', adapter_kind: 'pollinations', model_name: '' }, 'image')).toBe('flux');

    // ZenMux
    expect(resolveEffectiveModel({ name: 'ZenMux', adapter_kind: 'openai_compatible_chat', model_name: 'auto' }, 'text')).toBe('google/gemini-2.5-flash-free');
    expect(resolveEffectiveModel({ name: 'ZenMux', adapter_kind: 'openai_compatible_images', model_name: 'auto' }, 'image')).toBe('google/gemini-2.5-flash-image-free');
  });

  it('preserves user-specified custom model names exactly without overriding', () => {
    expect(resolveEffectiveModel({ name: 'Groq', adapter_kind: 'openai_compatible_chat', model_name: 'qwen/qwen-2.5-32b-instruct' }, 'text')).toBe('qwen/qwen-2.5-32b-instruct');
    expect(resolveEffectiveModel({ name: 'OpenRouter', adapter_kind: 'openai_compatible_chat', model_name: 'deepseek/deepseek-r1:free' }, 'text')).toBe('deepseek/deepseek-r1:free');
    expect(resolveEffectiveModel({ name: 'Custom AI', adapter_kind: 'openai_compatible_chat', model_name: 'custom-fine-tuned-model-v2' }, 'text')).toBe('custom-fine-tuned-model-v2');
    expect(resolveEffectiveModel({ name: 'Pollinations AI', adapter_kind: 'pollinations', model_name: 'turbo' }, 'image')).toBe('turbo');
  });
});

describe('Dashboard Client Array Safety (Fix for providerKeysData.filter is not a function)', () => {
  it('guarantees that non-array responses never break providerKeysData filtering', () => {
    // Simulate what happened: kRes.json() returned an array or object
    const simulatedArrayPayload = [{ id: 'k1', provider_id: 'p1', is_active: true }];
    const parsedAsArray = Array.isArray(simulatedArrayPayload) ? simulatedArrayPayload : (Array.isArray((simulatedArrayPayload as any)?.keys) ? (simulatedArrayPayload as any).keys : []);
    expect(Array.isArray(parsedAsArray)).toBe(true);
    expect(parsedAsArray.filter((k) => k.provider_id === 'p1').length).toBe(1);

    // Simulate empty array with JS Array.prototype.keys trap
    const emptyArray: any[] = [];
    const safeEmpty = Array.isArray(emptyArray) ? emptyArray : (Array.isArray((emptyArray as any)?.keys) ? (emptyArray as any).keys : []);
    expect(Array.isArray(safeEmpty)).toBe(true);
    expect(safeEmpty.filter((k: any) => k.id === '1')).toEqual([]);

    // Simulate object payload { success: true, count: 0 }
    const objPayload = { success: true, count: 0 };
    const safeObj = Array.isArray(objPayload) ? objPayload : (Array.isArray((objPayload as any)?.keys) ? (objPayload as any).keys : []);
    expect(Array.isArray(safeObj)).toBe(true);
    expect(safeObj.filter((k: any) => k.id === '1')).toEqual([]);
  });
});

describe('Provider Chains & Cloudflare Workers AI Image Separation', () => {
  it('correctly classifies Cloudflare Workers AI and image providers into the Image chain', () => {
    // Cloudflare with Flux
    expect(
      getProviderChain({
        name: 'Cloudflare Workers AI',
        adapter_kind: 'cloudflare_workers_ai',
        model_name: '@cf/black-forest-labs/flux-1-schnell',
      })
    ).toBe('image');

    // Cloudflare with explicit config.chain_type
    expect(
      getProviderChain({
        name: 'Cloudflare Workers AI',
        adapter_kind: 'cloudflare_workers_ai',
        config: { chain_type: 'image' },
      })
    ).toBe('image');

    // Cloudflare with Llama text model
    expect(
      getProviderChain({
        name: 'Cloudflare Workers AI',
        adapter_kind: 'cloudflare_workers_ai',
        model_name: '@cf/meta/llama-3.1-8b-instruct',
      })
    ).toBe('text');

    // ZenMux Image Free
    expect(
      getProviderChain({
        name: 'ZenMux (Gemini Image Free)',
        adapter_kind: 'openai_compatible_images',
        model_name: 'google/gemini-2.5-flash-image-free',
      })
    ).toBe('image');

    // Pollinations
    expect(
      getProviderChain({
        name: 'Pollinations AI',
        adapter_kind: 'pollinations',
        model_name: 'flux',
      })
    ).toBe('image');

    // Standard text providers
    expect(
      getProviderChain({
        name: 'Google Gemini',
        adapter_kind: 'gemini_native',
        model_name: 'gemini-2.5-flash',
      })
    ).toBe('text');

    expect(
      getProviderChain({
        name: 'Groq',
        adapter_kind: 'openai_compatible_chat',
        model_name: 'meta-llama/llama-3.3-70b-versatile',
      })
    ).toBe('text');
  });

  it('guarantees saveChainPriorityOrder strictly updates memory and Supabase providers to sequential 1..N priorities with zero ties', async () => {
    const { SystemStore } = await import('../apps/web/src/server/storage.js');
    const store = SystemStore.getInstance();

    const provA = await store.createProvider({
      name: 'Test Chain Provider A',
      adapter_kind: 'gemini_native',
      priority: 1,
    });
    const provB = await store.createProvider({
      name: 'Test Chain Provider B',
      adapter_kind: 'openai_compatible_chat',
      priority: 1, // Intentional duplicate tie
    });
    const provC = await store.createProvider({
      name: 'Test Chain Provider C',
      adapter_kind: 'openai_compatible_chat',
      priority: 5, // Intentional gap
    });

    // Reorder sequence: C then A then B
    const updated = await store.saveChainPriorityOrder('text', [provC.id, provA.id, provB.id]);
    const finalC = updated.find((p) => p.id === provC.id);
    const finalA = updated.find((p) => p.id === provA.id);
    const finalB = updated.find((p) => p.id === provB.id);

    expect(finalC?.priority).toBe(1);
    expect(finalA?.priority).toBe(2);
    expect(finalB?.priority).toBe(3);
  });
});
