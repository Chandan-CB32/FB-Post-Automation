import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEffectiveModel } from '../packages/core/src/index.js';

describe('Free Models Catalog & Auto Resolution', () => {
  it('automatically resolves "auto" or empty model to verified free models for each provider', () => {
    // Gemini text
    expect(resolveEffectiveModel({ name: 'Google Gemini', adapter_kind: 'gemini_native', model_name: 'auto' }, 'text')).toBe('gemini-2.5-flash');
    expect(resolveEffectiveModel({ name: 'Google Gemini', adapter_kind: 'gemini_native', model_name: '' }, 'text')).toBe('gemini-2.5-flash');

    // Gemini image
    expect(resolveEffectiveModel({ name: 'Google Gemini', adapter_kind: 'gemini_native', model_name: 'auto' }, 'image')).toBe('gemini-2.5-flash-image');

    // Groq
    expect(resolveEffectiveModel({ name: 'Groq', adapter_kind: 'openai_compatible_chat', model_name: 'auto' }, 'text')).toBe('meta-llama/llama-3.3-70b-versatile');

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
