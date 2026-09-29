/**
 * IP address handling (ARCHITECTURE §8.1). Raw addresses are only used transiently:
 * callers persist `networkHashes()` output, never the input address.
 *
 *   network_hash = hex(HMAC-SHA256(IP_HASH_SECRET, "net:v1:" + normalized))
 *     normalized = IPv4 dotted quad | IPv6 /64 prefix "xxxx:xxxx:xxxx:xxxx::/64"
 *   prefix_hash  = hex(HMAC-SHA256(IP_HASH_SECRET, "pfx:v1:" + prefix))
 *     prefix     = IPv4 /24 "a.b.c.0/24"   | IPv6 /48 prefix "xxxx:xxxx:xxxx::/48"
 *
 * IPv6 groups are lowercase and zero-padded to 4 hex digits; IPv4-mapped IPv6 addresses
 * are treated as IPv4; zone ids are dropped.
 */
import ipaddr from 'ipaddr.js';

import { hmacSha256Hex } from './crypto';

export type IpKind = 'ipv4' | 'ipv6';

export interface NormalizedIp {
  kind: IpKind;
  /** Canonical textual address (IPv4 dotted quad; IPv6 full lowercase, zero-padded). */
  address: string;
}

export interface NetworkHashes {
  network_hash: string;
  prefix_hash: string;
}

const MAX_IP_INPUT_LENGTH = 64;

function parseStrict(input: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IP_INPUT_LENGTH) return null;
  // Only plain dotted-quad IPv4 (no octal/hex/short forms, which parse ambiguously).
  if (ipaddr.IPv4.isValidFourPartDecimal(trimmed)) return ipaddr.IPv4.parse(trimmed);
  if (trimmed.includes(':') && ipaddr.IPv6.isValid(trimmed)) {
    const v6 = ipaddr.IPv6.parse(trimmed);
    return v6.isIPv4MappedAddress() ? v6.toIPv4Address() : v6;
  }
  return null;
}

function hexGroup(part: number): string {
  return part.toString(16).padStart(4, '0');
}

/** Parses and canonicalizes an address; null for anything that is not a plain IP. */
export function normalizeIp(input: string): NormalizedIp | null {
  const parsed = parseStrict(input);
  if (parsed === null) return null;
  if (parsed.kind() === 'ipv4') return { kind: 'ipv4', address: parsed.toString() };
  const v6 = parsed as ipaddr.IPv6;
  return { kind: 'ipv6', address: v6.parts.map(hexGroup).join(':') };
}

export function isValidIp(input: string): boolean {
  return parseStrict(input) !== null;
}

/**
 * True only for globally routable unicast addresses. Private, loopback, link-local,
 * CGNAT, documentation, multicast and other reserved ranges are not public (§6.4:
 * such addresses are never looked up at VPN providers).
 */
export function isPublicIp(input: string): boolean {
  const parsed = parseStrict(input);
  return parsed !== null && parsed.range() === 'unicast';
}

/** The strings that are HMAC'ed (exported for tests and documentation). */
export function networkHashInputs(input: string): { network: string; prefix: string } | null {
  const parsed = parseStrict(input);
  if (parsed === null) return null;
  if (parsed.kind() === 'ipv4') {
    const octets = (parsed as ipaddr.IPv4).octets;
    return {
      network: octets.join('.'),
      prefix: `${octets.slice(0, 3).join('.')}.0/24`,
    };
  }
  const groups = (parsed as ipaddr.IPv6).parts.map(hexGroup);
  return {
    network: `${groups.slice(0, 4).join(':')}::/64`,
    prefix: `${groups.slice(0, 3).join(':')}::/48`,
  };
}

/** Network + prefix hashes of an address, or null when the input is not a valid IP. */
export function networkHashes(input: string, secret: string | Buffer): NetworkHashes | null {
  const inputs = networkHashInputs(input);
  if (inputs === null) return null;
  return {
    network_hash: hmacSha256Hex(secret, `net:v1:${inputs.network}`),
    prefix_hash: hmacSha256Hex(secret, `pfx:v1:${inputs.prefix}`),
  };
}
