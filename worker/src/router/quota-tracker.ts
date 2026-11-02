import { getSupabaseClient } from '@fb-auto/core';

export interface UsageIncrement {
  providerId: string;
  keyId?: string;
  tokens?: number;
  neurons?: number;
  units?: number;
  cost?: number;
  date?: string; // YYYY-MM-DD
}

export interface DailyUsageRecord {
  providerId: string;
  keyId?: string;
  date: string;
  requestsCount: number;
  tokensCount: number;
  neuronsCount: number;
  unitsCount: number;
  estimatedCost: number;
}

export interface QuotaStatus {
  isExceeded: boolean;
  isWarning: boolean;
  percentUsed: number;
  remainingRequests: number;
}

export class QuotaTracker {
  // In-memory telemetry cache: Map<`${providerId}:${keyId || 'all'}:${date}`, DailyUsageRecord>
  private usageStore = new Map<string, DailyUsageRecord>();

  private getDateKey(date?: string | Date): string {
    if (!date) return new Date().toISOString().split('T')[0];
    if (date instanceof Date) return date.toISOString().split('T')[0];
    return date;
  }

  private buildStoreKey(providerId: string, keyId: string | undefined, dateStr: string): string {
    return `${providerId}:${keyId || 'all'}:${dateStr}`;
  }

  /**
   * Records usage after a successful generation request.
   */
  async recordUsage(params: UsageIncrement): Promise<DailyUsageRecord> {
    const dateStr = this.getDateKey(params.date);
    const storeKey = this.buildStoreKey(params.providerId, params.keyId, dateStr);

    let record = this.usageStore.get(storeKey);
    if (!record) {
      record = {
        providerId: params.providerId,
        keyId: params.keyId,
        date: dateStr,
        requestsCount: 0,
        tokensCount: 0,
        neuronsCount: 0,
        unitsCount: 0,
        estimatedCost: 0,
      };
      this.usageStore.set(storeKey, record);
    }

    record.requestsCount += 1;
    if (params.tokens) record.tokensCount += params.tokens;
    if (params.neurons) record.neuronsCount += params.neurons;
    if (params.units) record.unitsCount += params.units;
    if (params.cost) record.estimatedCost += params.cost;

    // Async persist to Supabase if connected
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('provider_usage_daily').upsert(
          {
            provider_id: params.providerId,
            key_id: params.keyId || null,
            date: dateStr,
            requests_count: record.requestsCount,
            tokens_count: record.tokensCount,
            neurons_count: record.neuronsCount,
            units_count: record.unitsCount,
            estimated_cost: record.estimatedCost,
          },
          { onConflict: 'provider_id,key_id,date' }
        );
      } catch (err) {
        console.warn('[QuotaTracker] Failed to persist daily usage to Supabase:', err);
      }
    }

    return record;
  }

  /**
   * Retrieves current daily usage for a provider.
   */
  getDailyUsage(providerId: string, keyId?: string, date?: string): DailyUsageRecord {
    const dateStr = this.getDateKey(date);
    const storeKey = this.buildStoreKey(providerId, keyId, dateStr);
    return (
      this.usageStore.get(storeKey) || {
        providerId,
        keyId,
        date: dateStr,
        requestsCount: 0,
        tokensCount: 0,
        neuronsCount: 0,
        unitsCount: 0,
        estimatedCost: 0,
      }
    );
  }

  /**
   * Computes quota consumption and flags 80% warnings and 100% capacity exhaustion.
   */
  checkQuotaStatus(
    providerId: string,
    limits: { rpdLimit?: number; unitsPerDayLimit?: number },
    date?: string
  ): QuotaStatus {
    const usage = this.getDailyUsage(providerId, undefined, date);
    const limit = limits.rpdLimit || 0;

    if (limit <= 0) {
      return {
        isExceeded: false,
        isWarning: false,
        percentUsed: 0,
        remainingRequests: Infinity,
      };
    }

    const percentUsed = Math.min(100, Math.round((usage.requestsCount / limit) * 100));
    const isWarning = percentUsed >= 80;
    const isExceeded = usage.requestsCount >= limit;
    const remainingRequests = Math.max(0, limit - usage.requestsCount);

    return {
      isExceeded,
      isWarning,
      percentUsed,
      remainingRequests,
    };
  }

  resetStore(): void {
    this.usageStore.clear();
  }
}
