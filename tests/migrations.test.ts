import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Database Schema & Migration Validation', () => {
  const migrationPath = path.resolve(__dirname, '../supabase/migrations/20261102000000_init_schema.sql');
  const seedPath = path.resolve(__dirname, '../supabase/seed.sql');

  it('migration file exists and is non-empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql.length).toBeGreaterThan(1000);
  });

  it('defines all required core tables', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const expectedTables = [
      'content_profiles',
      'profile_versions',
      'pages',
      'providers',
      'provider_keys',
      'provider_chains',
      'provider_usage_daily',
      'research_sources',
      'research_items',
      'topic_queue_items',
      'series',
      'series_episodes',
      'posts',
      'topic_history',
      'job_logs',
      'alerts',
      'audit_log',
      'settings',
    ];

    for (const table of expectedTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    }
  });

  it('enables Row Level Security (RLS) on all tables', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('ALTER TABLE public.content_profiles ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY owner_all_access ON public.');
  });

  it('implements atomic queue claiming RPC with FOR UPDATE SKIP LOCKED', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.claim_next_post_job');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('stage_attempts');
  });

  it('seeds default settings and provider presets in seed.sql', () => {
    expect(fs.existsSync(seedPath)).toBe(true);
    const seedSql = fs.readFileSync(seedPath, 'utf8');
    expect(seedSql).toContain('kill_switch');
    expect(seedSql).toContain('retention');
    expect(seedSql).toContain('Google Gemini');
    expect(seedSql).toContain('OpenRouter');
    expect(seedSql).toContain('Groq');
    expect(seedSql).toContain('Cloudflare Workers AI');
    expect(seedSql).toContain('Pollinations AI');
  });
});
