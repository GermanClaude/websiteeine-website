import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src';

describe('canonicalJson', () => {
  it('sorts keys recursively and removes whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });

  it('is independent of key insertion order', () => {
    const a = { x: 1, y: { p: true, q: null }, z: [1, 2] };
    const b = { z: [1, 2], y: { q: null, p: true }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('sorts by UTF-16 code units (upper case before lower case)', () => {
    expect(canonicalJson({ b: 1, a: 2, B: 3, A: 4, é: 5, '10': 6, '9': 7 })).toBe(
      '{"10":6,"9":7,"A":4,"B":3,"a":2,"b":1,"é":5}',
    );
  });

  it('keeps array order and omits undefined object properties', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
    expect(canonicalJson([1, , 3])).toBe('[1,null,3]');
  });

  it('serializes Date as ISO string with milliseconds', () => {
    expect(canonicalJson({ at: new Date(Date.UTC(2026, 8, 29, 15, 42, 20)) })).toBe('{"at":"2026-09-29T15:42:20.000Z"}');
  });

  it('serializes scalars like JSON.stringify', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(1e21)).toBe('1e+21');
    expect(canonicalJson('a"b\\c\n\u0001')).toBe('"a\\"b\\\\c\\n\\u0001"');
    expect(canonicalJson('\u{1F3AF}')).toBe('"\u{1F3AF}"');
    expect(canonicalJson('\ud800')).toBe('"\\ud800"');
    expect(canonicalJson(Object.create(null) as object)).toBe('{}');
  });

  it('allows repeated (non-circular) references', () => {
    const shared = { v: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['NaN', { n: Number.NaN }],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['bigint', { n: 1n }],
    ['function', { f: () => 1 }],
    ['symbol', { s: Symbol('x') }],
    ['Map', { m: new Map() }],
    ['Set', new Set([1])],
    ['class instance', { c: new (class Foo {})() }],
    ['Buffer-like Uint8Array', { b: new Uint8Array([1]) }],
    ['invalid Date', { d: new Date(Number.NaN) }],
  ])('rejects %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('rejects circular references', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(/Circular/);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => canonicalJson(arr)).toThrow(/Circular/);
  });
});
