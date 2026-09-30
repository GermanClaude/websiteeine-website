/**
 * CIDR list VPN provider (§6.4 `cidr-list`).
 *
 * List files contain one entry per line: `a.b.c.d/nn`, `xxxx::/nn` or a bare
 * address (treated as /32 / /128). `#` and `;` start comments; blank lines are
 * ignored. Matching is O(number of distinct prefix lengths): entries are stored
 * as Sets of masked network keys per prefix length.
 */
import { readFileSync } from 'node:fs';

import ipaddr from 'ipaddr.js';
import type { VpnConfidence, VpnType } from '@scpsl-trust/shared';

import { NOT_DETECTED, type VpnCheckResult, type VpnDetectionProvider } from './types';

const IPV4_BITS = 32;
const IPV6_BITS = 128;

function ipv4ToInt(octets: number[]): number {
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

function ipv6ToBigInt(parts: number[]): bigint {
  let value = 0n;
  for (const part of parts) value = (value << 16n) | BigInt(part);
  return value;
}

function maskV4(value: number, prefix: number): number {
  if (prefix === 0) return 0;
  return (value >>> (IPV4_BITS - prefix)) >>> 0;
}

function maskV6(value: bigint, prefix: number): bigint {
  if (prefix === 0) return 0n;
  return value >> BigInt(IPV6_BITS - prefix);
}

export interface CidrParseIssue {
  file: string;
  line: number;
  entry: string;
  reason: string;
}

export class CidrMatcher {
  /** prefix length → set of masked network values. */
  private readonly v4 = new Map<number, Set<number>>();
  private readonly v6 = new Map<number, Set<bigint>>();
  readonly issues: CidrParseIssue[] = [];
  private count = 0;

  get size(): number {
    return this.count;
  }

  addEntry(entry: string, context: { file: string; line: number }): boolean {
    const [addressPart, prefixPart, ...rest] = entry.split('/');
    if (addressPart === undefined || rest.length > 0) {
      this.issues.push({ ...context, entry, reason: 'malformed entry' });
      return false;
    }
    let parsed: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      if (ipaddr.IPv4.isValidFourPartDecimal(addressPart)) {
        parsed = ipaddr.IPv4.parse(addressPart);
      } else if (addressPart.includes(':') && ipaddr.IPv6.isValid(addressPart)) {
        const v6 = ipaddr.IPv6.parse(addressPart);
        parsed = v6.isIPv4MappedAddress() ? v6.toIPv4Address() : v6;
      } else {
        this.issues.push({ ...context, entry, reason: 'not an IP address' });
        return false;
      }
    } catch {
      this.issues.push({ ...context, entry, reason: 'not an IP address' });
      return false;
    }
    const maxBits = parsed.kind() === 'ipv4' ? IPV4_BITS : IPV6_BITS;
    let prefix = maxBits;
    if (prefixPart !== undefined) {
      if (!/^\d{1,3}$/.test(prefixPart)) {
        this.issues.push({ ...context, entry, reason: 'invalid prefix length' });
        return false;
      }
      prefix = Number(prefixPart);
      if (prefix < 0 || prefix > maxBits) {
        this.issues.push({ ...context, entry, reason: 'invalid prefix length' });
        return false;
      }
    }
    if (parsed.kind() === 'ipv4') {
      const key = maskV4(ipv4ToInt((parsed as ipaddr.IPv4).octets), prefix);
      let set = this.v4.get(prefix);
      if (set === undefined) this.v4.set(prefix, (set = new Set()));
      if (!set.has(key)) this.count += 1;
      set.add(key);
    } else {
      const key = maskV6(ipv6ToBigInt((parsed as ipaddr.IPv6).parts), prefix);
      let set = this.v6.get(prefix);
      if (set === undefined) this.v6.set(prefix, (set = new Set()));
      if (!set.has(key)) this.count += 1;
      set.add(key);
    }
    return true;
  }

  addText(text: string, file = '<inline>'): void {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const entry = lines[i]!.replace(/[#;].*$/, '').trim();
      if (entry.length === 0) continue;
      this.addEntry(entry, { file, line: i + 1 });
    }
  }

  addFile(path: string): void {
    this.addText(readFileSync(path, 'utf8'), path);
  }

  matches(ip: string): boolean {
    let parsed: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      if (ipaddr.IPv4.isValidFourPartDecimal(ip)) parsed = ipaddr.IPv4.parse(ip);
      else if (ip.includes(':') && ipaddr.IPv6.isValid(ip)) {
        const v6 = ipaddr.IPv6.parse(ip);
        parsed = v6.isIPv4MappedAddress() ? v6.toIPv4Address() : v6;
      } else return false;
    } catch {
      return false;
    }
    if (parsed.kind() === 'ipv4') {
      const value = ipv4ToInt((parsed as ipaddr.IPv4).octets);
      for (const [prefix, set] of this.v4) if (set.has(maskV4(value, prefix))) return true;
      return false;
    }
    const value = ipv6ToBigInt((parsed as ipaddr.IPv6).parts);
    for (const [prefix, set] of this.v6) if (set.has(maskV6(value, prefix))) return true;
    return false;
  }
}

export interface CidrListProviderOptions {
  paths?: readonly string[];
  /** Extra list text (tests). */
  text?: string;
  confidence?: Exclude<VpnConfidence, 'not_detected'>;
  type?: VpnType;
}

export class CidrListVpnProvider implements VpnDetectionProvider {
  readonly name = 'cidr-list';
  readonly matcher = new CidrMatcher();
  private readonly confidence: Exclude<VpnConfidence, 'not_detected'>;
  private readonly type: VpnType;

  constructor(options: CidrListProviderOptions = {}) {
    this.confidence = options.confidence ?? 'likely';
    this.type = options.type ?? 'hosting';
    for (const path of options.paths ?? []) this.matcher.addFile(path);
    if (options.text !== undefined) this.matcher.addText(options.text);
  }

  async check(ip: string): Promise<VpnCheckResult> {
    if (!this.matcher.matches(ip)) return NOT_DETECTED(this.name);
    return { detected: true, confidence: this.confidence, type: this.type, provider: this.name };
  }
}
