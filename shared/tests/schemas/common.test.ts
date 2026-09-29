import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CaseNumberSchema,
  EmailInputSchema,
  HttpsUrlSchema,
  HttpUrlSchema,
  IpAddressSchema,
  IsoDateTimeSchema,
  optionalText,
  paginated,
  PaginationQuerySchema,
  patchText,
  PlayerRefSchema,
  QueryBooleanSchema,
  ServerIdSchema,
  UserIdStringSchema,
  UuidSchema,
} from '../../src';

describe('PaginationQuerySchema', () => {
  it('defaults and coerces query strings', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, page_size: 25 });
    expect(PaginationQuerySchema.parse({ page: '3', page_size: '100' })).toEqual({ page: 3, page_size: 100 });
    expect(PaginationQuerySchema.parse({ page: ' 2 ' })).toEqual({ page: 2, page_size: 25 });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { page: '' },
    { page: ['1', '2'] },
    { page: '10001' },
    { page_size: '0' },
    { page_size: '101' },
    { page_size: '1e3' },
    { page_size: 'Infinity' },
  ])('rejects %j', (query) => {
    expect(PaginationQuerySchema.safeParse(query).success).toBe(false);
  });

  it('paginated() models { items, page, page_size, total }', () => {
    const schema = paginated(z.object({ id: z.number() }));
    expect(schema.safeParse({ items: [{ id: 1 }], page: 1, page_size: 25, total: 1 }).success).toBe(true);
    expect(schema.safeParse({ items: [], page: 0, page_size: 25, total: 0 }).success).toBe(false);
    expect(schema.safeParse({ items: [], page: 1, page_size: 101, total: 0 }).success).toBe(false);
    expect(schema.safeParse({ items: [], page: 1, page_size: 25, total: -1 }).success).toBe(false);
  });
});

describe('scalars', () => {
  it('UuidSchema', () => {
    expect(UuidSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(true);
    expect(UuidSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c330').success).toBe(false);
    expect(UuidSchema.safeParse("' OR 1=1 --").success).toBe(false);
  });

  it('IsoDateTimeSchema accepts ISO date-times only', () => {
    for (const ok of ['2026-09-29T15:42:20.000Z', '2020-01-01T00:00:00Z', '2026-09-29T15:42:20+02:00']) {
      expect(IsoDateTimeSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['2026-09-29', '1790000000000', '2026-13-01T00:00:00Z', 'yesterday', '']) {
      expect(IsoDateTimeSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(IsoDateTimeSchema.safeParse(new Date()).success).toBe(false);
  });

  it('ServerIdSchema / CaseNumberSchema', () => {
    expect(ServerIdSchema.safeParse('srv_7k4x92m8pq174kf9').success).toBe(true);
    expect(ServerIdSchema.safeParse('srv_7K4X92M8PQ174KF9').success).toBe(false);
    expect(ServerIdSchema.safeParse('server_x').success).toBe(false);
    expect(CaseNumberSchema.safeParse('CASE-2026-001337').success).toBe(true);
    expect(CaseNumberSchema.safeParse('CASE-2026-1337').success).toBe(false);
  });

  it('IpAddressSchema', () => {
    for (const ok of ['203.0.113.4', '2001:db8::1', '::ffff:203.0.113.4']) expect(IpAddressSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['203.0.113.256', 'localhost', '203.0.113.4/24', 'fe80::1%eth0', '']) {
      expect(IpAddressSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('EmailInputSchema trims and lower-cases', () => {
    expect(EmailInputSchema.parse('  Foo@Example.ORG ')).toBe('foo@example.org');
    expect(EmailInputSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailInputSchema.safeParse(`${'a'.repeat(250)}@x.org`).success).toBe(false);
  });

  it('URL schemas only allow http(s) with a host', () => {
    expect(HttpsUrlSchema.safeParse('https://clips.example.org/v/1').success).toBe(true);
    for (const bad of ['http://clips.example.org', 'javascript:alert(1)', 'https:/x', 'data:text/html,<script>', 'ftp://x.org']) {
      expect(HttpsUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(HttpUrlSchema.safeParse('http://localhost:5173/whitelist').success).toBe(true);
    expect(HttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrlSchema.safeParse(`https://x.org/${'a'.repeat(2100)}`).success).toBe(false);
  });

  it('QueryBooleanSchema parses strings strictly', () => {
    expect(QueryBooleanSchema.parse('true')).toBe(true);
    expect(QueryBooleanSchema.parse('false')).toBe(false);
    expect(QueryBooleanSchema.parse('0')).toBe(false);
    expect(QueryBooleanSchema.safeParse('maybe').success).toBe(false);
  });
});

describe('player identity schemas', () => {
  it('PlayerRefSchema validates ids per type', () => {
    expect(PlayerRefSchema.safeParse({ type: 'steam', id: '76561198000000001' }).success).toBe(true);
    const bad = PlayerRefSchema.safeParse({ type: 'steam', id: '123' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['id']);
    expect(PlayerRefSchema.safeParse({ type: 'epic', id: '76561198000000001' }).success).toBe(false);
    expect(PlayerRefSchema.safeParse({ type: 'steam' }).success).toBe(false);
    expect(PlayerRefSchema.safeParse({ type: 'steam', id: 76561198000000001 }).success).toBe(false);
    expect(PlayerRefSchema.parse({ type: 'steam', id: '76561198000000001', ip: '1.2.3.4' })).toEqual({
      type: 'steam',
      id: '76561198000000001',
    });
  });

  it('UserIdStringSchema requires the canonical form', () => {
    expect(UserIdStringSchema.safeParse('76561198000000001@steam').success).toBe(true);
    expect(UserIdStringSchema.safeParse('76561198000000001%40steam').success).toBe(false);
    expect(UserIdStringSchema.safeParse('76561198000000001@STEAM').success).toBe(false);
    expect(UserIdStringSchema.safeParse('1@steam').success).toBe(false);
  });
});

describe('text helpers', () => {
  it('optionalText normalizes absent / null / blank to null', () => {
    const schema = z.object({ note: optionalText(10) });
    expect(schema.parse({})).toEqual({ note: null });
    expect(schema.parse({ note: null })).toEqual({ note: null });
    expect(schema.parse({ note: '   ' })).toEqual({ note: null });
    expect(schema.parse({ note: ' hi ' })).toEqual({ note: 'hi' });
    expect(schema.safeParse({ note: 'x'.repeat(11) }).success).toBe(false);
  });

  it('patchText keeps undefined (unchanged) distinct from null (clear)', () => {
    const schema = z.object({ note: patchText(10) });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ note: null })).toEqual({ note: null });
    expect(schema.parse({ note: '' })).toEqual({ note: null });
    expect(schema.parse({ note: ' x ' })).toEqual({ note: 'x' });
  });
});
