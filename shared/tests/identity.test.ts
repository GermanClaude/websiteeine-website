import { describe, expect, it } from 'vitest';
import {
  isCanonicalUserId,
  isPlayerRef,
  isValidPlayerId,
  parseUserId,
  parseUserIdOrThrow,
  samePlayer,
  toUserId,
  type PlayerIdType,
  type PlayerRef,
} from '../src';

describe('isValidPlayerId', () => {
  it.each<[PlayerIdType, string]>([
    ['steam', '76561198000000001'],
    ['discord', '12345678901234567'],
    ['discord', '12345678901234567890'],
    ['northwood', 'a'],
    ['northwood', 'staff.member_01-x'],
    ['northwood', 'a'.repeat(64)],
  ])('%s %s is valid', (type, id) => {
    expect(isValidPlayerId(type, id)).toBe(true);
  });

  it.each<[PlayerIdType, string]>([
    ['steam', '7656119800000000'],
    ['steam', '765611980000000011'],
    ['steam', '7656119800000000a'],
    ['steam', ' 76561198000000001'],
    ['steam', '76561198000000001\n'],
    ['steam', '７６５６１１９８００００００００１'],
    ['discord', '1234567890123456'],
    ['discord', '123456789012345678901'],
    ['northwood', ''],
    ['northwood', 'Upper'],
    ['northwood', 'a'.repeat(65)],
    ['northwood', 'with space'],
    ['northwood', 'a@b'],
    ['northwood', '../etc/passwd/'],
  ])('%s %j is invalid', (type, id) => {
    expect(isValidPlayerId(type, id)).toBe(false);
  });

  it('rejects unknown types', () => {
    expect(isValidPlayerId('epic' as PlayerIdType, '76561198000000001')).toBe(false);
  });
});

describe('toUserId / parseUserId', () => {
  const steam: PlayerRef = { type: 'steam', id: '76561198000000001' };

  it('round-trips every type', () => {
    for (const ref of [
      steam,
      { type: 'discord', id: '123456789012345678' },
      { type: 'northwood', id: 'staff.member' },
    ] satisfies PlayerRef[]) {
      const userId = toUserId(ref);
      expect(userId).toBe(`${ref.id}@${ref.type}`);
      expect(parseUserId(userId)).toEqual(ref);
      expect(isCanonicalUserId(userId)).toBe(true);
    }
  });

  it('accepts a URL-encoded @ but it is not canonical', () => {
    expect(parseUserId('76561198000000001%40steam')).toEqual(steam);
    expect(parseUserId('76561198000000001%40STEAM')).toBeNull();
    expect(isCanonicalUserId('76561198000000001%40steam')).toBe(false);
  });

  it.each([
    '',
    '76561198000000001',
    '@steam',
    '76561198000000001@',
    '76561198000000001@Steam',
    '76561198000000001@epic',
    '76561198000000001@@steam',
    'a@b@northwood',
    '7656119800000000@steam',
    '76561198000000001@steam ',
    ' 76561198000000001@steam',
    '76561198000000001@discord@steam',
    'x'.repeat(200),
  ])('rejects %j', (value) => {
    expect(parseUserId(value)).toBeNull();
    expect(isCanonicalUserId(value)).toBe(false);
    expect(() => parseUserIdOrThrow(value)).toThrow(TypeError);
  });

  it('toUserId throws on invalid references', () => {
    expect(() => toUserId({ type: 'steam', id: '123' })).toThrow(TypeError);
    expect(() => toUserId({ type: 'epic', id: '76561198000000001' } as unknown as PlayerRef)).toThrow(TypeError);
  });

  it('isPlayerRef / samePlayer', () => {
    expect(isPlayerRef(steam)).toBe(true);
    expect(isPlayerRef({ type: 'steam', id: 76561198000000001 })).toBe(false);
    expect(isPlayerRef(null)).toBe(false);
    expect(isPlayerRef('76561198000000001@steam')).toBe(false);
    expect(samePlayer(steam, { ...steam })).toBe(true);
    expect(samePlayer(steam, { type: 'discord', id: steam.id })).toBe(false);
  });
});
