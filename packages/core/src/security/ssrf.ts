import dns from 'node:dns/promises';
import net from 'node:net';

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

/**
 * Checks whether an IPv4 or IPv6 string is private, loopback, link-local, or cloud metadata.
 */
export function isPrivateOrBlockedIP(ip: string): boolean {
  if (!net.isIP(ip)) {
    return true; // Not a valid IP address
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;

    // 10.0.0.0/8 (Private RFC 1918)
    if (b0 === 10) return true;

    // 172.16.0.0/12 (Private RFC 1918)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.168.0.0/16 (Private RFC 1918)
    if (b0 === 192 && b1 === 168) return true;

    // 169.254.0.0/16 (Link-local & Cloud Metadata, e.g. 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;

    // 240.0.0.0/4 (Reserved / Broadcast)
    if (b0 >= 240) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    // ::1 (Loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

    // :: (Unspecified)
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.replace('::ffff:', '');
      if (net.isIPv4(v4Part)) {
        return isPrivateOrBlockedIP(v4Part);
      }
    }

    // fe80::/10 (Link-local)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }

    // fc00::/7 (Unique local address, RFC 4193)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }

    return false;
  }

  return true;
}

export interface SSRFValidationResult {
  valid: boolean;
  resolvedIps: string[];
  error?: string;
}

/**
 * Validates a target URL against SSRF rules:
 * 1. Enforces HTTPS (unless allowHttpForTesting is set).
 * 2. Blocks embedded credentials in userinfo.
 * 3. Resolves all DNS A and AAAA records and verifies none point to private/loopback/metadata IPs.
 */
export async function validateUrlAgainstSSRF(
  urlString: string,
  allowHttpForTesting = false
): Promise<SSRFValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, resolvedIps: [], error: `Invalid URL format: ${urlString}` };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'https:') {
    if (!allowHttpForTesting || parsed.protocol !== 'http:') {
      return {
        valid: false,
        resolvedIps: [],
        error: `Insecure protocol '${parsed.protocol}'. Only HTTPS is permitted.`,
      };
    }
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, resolvedIps: [], error: 'URL contains embedded credentials (userinfo).' };
  }

  const hostname = parsed.hostname;

  // 3. If hostname is a raw IP literal, validate immediately
  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIP(hostname)) {
      return {
        valid: false,
        resolvedIps: [hostname],
        error: `Blocked target IP ${hostname} (private, loopback, or cloud metadata).`,
      };
    }
    return { valid: true, resolvedIps: [hostname] };
  }

  // 4. Resolve hostname to all IP addresses
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err: unknown) {
    return {
      valid: false,
      resolvedIps: [],
      error: `DNS resolution failed for host '${hostname}': ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!addresses || addresses.length === 0) {
    return { valid: false, resolvedIps: [], error: `No DNS records found for host '${hostname}'.` };
  }

  const resolvedIps = addresses.map((a) => a.address);

  for (const ip of resolvedIps) {
    if (isPrivateOrBlockedIP(ip)) {
      return {
        valid: false,
        resolvedIps,
        error: `Host '${hostname}' resolved to blocked IP ${ip} (private, loopback, or cloud metadata).`,
      };
    }
  }

  return { valid: true, resolvedIps };
}

/**
 * SSRF-safe HTTP fetch with strict pre-connection DNS validation
 * and safe manual redirect following up to maxRedirects.
 */
export async function ssrfSafeFetch(
  url: string,
  init?: RequestInit,
  maxRedirects = 3,
  allowHttpForTesting = false
): Promise<Response> {
  let currentUrl = url;
  let redirectsRemaining = maxRedirects;

  while (true) {
    const validation = await validateUrlAgainstSSRF(currentUrl, allowHttpForTesting);
    if (!validation.valid) {
      throw new SSRFError(`SSRF Blocked: ${validation.error}`);
    }

    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual', // Never follow redirects automatically
    });

    if (
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.get('location')
    ) {
      if (redirectsRemaining <= 0) {
        throw new SSRFError('Maximum redirect limit exceeded.');
      }
      redirectsRemaining -= 1;

      const locationHeader = response.headers.get('location')!;
      // Resolve relative redirect against current URL
      currentUrl = new URL(locationHeader, currentUrl).toString();
      continue;
    }

    return response;
  }
}

