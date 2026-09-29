import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isPublicIp, isValidIp, networkHashes, networkHashInputs, normalizeIp } from '../../src/lib/ip';

const SECRET = 'test-ip-hash-secret-0123456789abcdef';
const hmac = (message: string) => createHmac('sha256', SECRET).update(message).digest('hex');

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.4', { kind: 'ipv4', address: '203.0.113.4' }],
    [' 203.0.113.4 ', { kind: 'ipv4', address: '203.0.113.4' }],
    ['::ffff:203.0.113.4', { kind: 'ipv4', address: '203.0.113.4' }],
    ['::FFFF:cb00:7104', { kind: 'ipv4', address: '203.0.113.4' }],
    ['2001:DB8::1', { kind: 'ipv6', address: '2001:0db8:0000:0000:0000:0000:0000:0001' }],
    ['fe80::1%eth0', { kind: 'ipv6', address: 'fe80:0000:0000:0000:0000:0000:0000:0001' }],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeIp(input)).toEqual(expected);
  });

  it.each(['', 'localhost', '010.1.1.1', '1.2.3', '0x7f.0.0.1', '256.1.1.1', '[::1]', '1.2.3.4/24', '1.2.3.4:80', 'a'.repeat(100), '::g'])(
    'rejects %s',
    (input) => {
      expect(normalizeIp(input)).toBeNull();
      expect(isValidIp(input)).toBe(false);
      expect(networkHashes(input, SECRET)).toBeNull();
    },
  );
});

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8'])('%s is public', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each([
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.1.1',
    '203.0.113.4',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::',
    'not an ip',
  ])('%s is not public', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});

describe('networkHashes (§8.1)', () => {
  it('hashes IPv4 addresses and their /24', () => {
    expect(networkHashInputs('203.0.113.4')).toEqual({ network: '203.0.113.4', prefix: '203.0.113.0/24' });
    expect(networkHashes('203.0.113.4', SECRET)).toEqual({
      network_hash: hmac('net:v1:203.0.113.4'),
      prefix_hash: hmac('pfx:v1:203.0.113.0/24'),
    });
    const neighbour = networkHashes('203.0.113.99', SECRET);
    const own = networkHashes('203.0.113.4', SECRET);
    expect(neighbour?.prefix_hash).toBe(own?.prefix_hash);
    expect(neighbour?.network_hash).not.toBe(own?.network_hash);
  });

  it('hashes IPv6 by /64 (network) and /48 (prefix)', () => {
    expect(networkHashInputs('2001:db8:1:2:aaaa::1')).toEqual({
      network: '2001:0db8:0001:0002::/64',
      prefix: '2001:0db8:0001::/48',
    });
    const a = networkHashes('2001:db8:1:2::1', SECRET);
    const sameSubnet = networkHashes('2001:db8:1:2:ffff:ffff:ffff:ffff', SECRET);
    const sameSite = networkHashes('2001:db8:1:3::1', SECRET);
    expect(sameSubnet).toEqual(a);
    expect(sameSite?.prefix_hash).toBe(a?.prefix_hash);
    expect(sameSite?.network_hash).not.toBe(a?.network_hash);
  });

  it('treats IPv4-mapped IPv6 as IPv4 and depends on the secret', () => {
    expect(networkHashes('::ffff:203.0.113.4', SECRET)).toEqual(networkHashes('203.0.113.4', SECRET));
    expect(networkHashes('203.0.113.4', 'other-secret')).not.toEqual(networkHashes('203.0.113.4', SECRET));
  });

  it('never returns the raw address', () => {
    const hashes = networkHashes('198.51.100.23', SECRET);
    expect(hashes?.network_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes?.prefix_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(hashes)).not.toContain('198.51.100');
  });
});
