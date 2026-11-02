import { ProviderDefinition, ProviderRouter } from './provider-router.js';
import { getNextAvailableKey } from '@fb-auto/core';

export interface HealthCheckResult {
  providerId: string;
  name: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  timestamp: string;
}

export class ProviderHealthChecker {
  constructor(private router?: ProviderRouter) {}

  /**
   * Pings a single provider with a tiny test prompt to confirm endpoint accessibility and key validity.
   */
  async checkProvider(
    provider: ProviderDefinition,
    encryptionKey?: string
  ): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();
    const startTime = Date.now();

    if (!provider.active) {
      return {
        providerId: provider.providerId,
        name: provider.name,
        healthy: false,
        latencyMs: 0,
        error: 'Provider is marked inactive.',
        timestamp,
      };
    }

    const keyInfo = getNextAvailableKey(provider.keys, new Date(), encryptionKey);
    if (!keyInfo) {
      return {
        providerId: provider.providerId,
        name: provider.name,
        healthy: false,
        latencyMs: 0,
        error: 'No active keys available for provider.',
        timestamp,
      };
    }

    try {
      if (this.router) {
        // Run a micro test via router
        if (provider.kind === 'pollinations' || provider.kind === 'openai_compatible_images') {
          await this.router.executeImage('image', {
            prompt: 'ping',
            width: 256,
            height: 256,
            encryptionKey,
          });
        } else {
          await this.router.executeText('qa', {
            prompt: 'ping',
            maxTokens: 1,
            encryptionKey,
          });
        }
      }

      const latencyMs = Date.now() - startTime;
      return {
        providerId: provider.providerId,
        name: provider.name,
        healthy: true,
        latencyMs,
        timestamp,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        providerId: provider.providerId,
        name: provider.name,
        healthy: false,
        latencyMs,
        error: errorMsg,
        timestamp,
      };
    }
  }

  /**
   * Pings all active providers and returns health telemetry.
   */
  async checkAll(
    providers: ProviderDefinition[],
    encryptionKey?: string
  ): Promise<HealthCheckResult[]> {
    const checks = providers.map((p) => this.checkProvider(p, encryptionKey));
    return Promise.all(checks);
  }
}

