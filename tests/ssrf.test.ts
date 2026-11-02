import { describe, it, expect } from 'vitest';
import { isPrivateOrBlockedIP, validateUrlAgainstSSRF } from '../packages/core/src/security/ssrf.js';

describe('SSRF Protection Module', () => {
  it('correctly classifies private and blocked IPv4 addresses', () => {
    // Loopback
    expect(isPrivateOrBlockedIP('127.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIP('127.255.255.255')).toBe(true);
    expect(isPrivateOrBlockedIP('0.0.0.0')).toBe(true);

    // Private RFC 1918
    expect(isPrivateOrBlockedIP('10.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIP('10.254.0.1')).toBe(true);
    expect(isPrivateOrBlockedIP('172.16.0.1')).toBe(true);
    expect(isPrivateOrBlockedIP('172.31.255.255')).toBe(true);
    expect(isPrivateOrBlockedIP('192.168.1.1')).toBe(true);
    expect(isPrivateOrBlockedIP('192.168.0.254')).toBe(true);

    // Link-local & Cloud Metadata
    expect(isPrivateOrBlockedIP('169.254.169.254')).toBe(true);
    expect(isPrivateOrBlockedIP('169.254.1.1')).toBe(true);

    // Carrier-grade NAT
    expect(isPrivateOrBlockedIP('100.64.0.1')).toBe(true);

    // Multicast & Broadcast
    expect(isPrivateOrBlockedIP('224.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIP('255.255.255.255')).toBe(true);

    // Public Internet IPs
    expect(isPrivateOrBlockedIP('8.8.8.8')).toBe(false);
    expect(isPrivateOrBlockedIP('1.1.1.1')).toBe(false);
    expect(isPrivateOrBlockedIP('104.26.10.1')).toBe(false);
  });

  it('correctly classifies private and blocked IPv6 addresses', () => {
    // Loopback & Unspecified
    expect(isPrivateOrBlockedIP('::1')).toBe(true);
    expect(isPrivateOrBlockedIP('::')).toBe(true);

    // IPv4-mapped IPv6
    expect(isPrivateOrBlockedIP('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIP('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateOrBlockedIP('::ffff:8.8.8.8')).toBe(false);

    // Link-local & Unique Local
    expect(isPrivateOrBlockedIP('fe80::1')).toBe(true);
    expect(isPrivateOrBlockedIP('fc00::1')).toBe(true);
    expect(isPrivateOrBlockedIP('fd12:3456:789a::1')).toBe(true);

    // Public IPv6
    expect(isPrivateOrBlockedIP('2001:4860:4860::8888')).toBe(false);
  });

  it('rejects URLs with insecure http protocol by default', async () => {
    const res = await validateUrlAgainstSSRF('http://example.com/api');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Only HTTPS is permitted');
  });

  it('rejects URLs with embedded credentials in userinfo', async () => {
    const res = await validateUrlAgainstSSRF('https://admin:secret@example.com/api');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('embedded credentials');
  });

  it('rejects direct IP targeting of private addresses', async () => {
    const res1 = await validateUrlAgainstSSRF('https://127.0.0.1/admin');
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('Blocked target IP');

    const res2 = await validateUrlAgainstSSRF('https://169.254.169.254/latest/meta-data/');
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('Blocked target IP');
  });

  it('resolves and validates valid public HTTPS URLs', async () => {
    // Example: google DNS or cloudflare DNS domain
    const res = await validateUrlAgainstSSRF('https://one.one.one.one');
    expect(res.valid).toBe(true);
    expect(res.resolvedIps.length).toBeGreaterThan(0);
  });
});

