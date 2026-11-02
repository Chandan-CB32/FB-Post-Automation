import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DatabaseConfig {
  supabaseUrl?: string;
  supabaseServiceKey?: string;
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(config?: DatabaseConfig): SupabaseClient | null {
  const url = config?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = config?.supabaseServiceKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedClient;
}

export function resetSupabaseClient(): void {
  cachedClient = null;
}
