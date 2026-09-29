/**
 * Canonical JSON (ARCHITECTURE §9.1) used for audit-chain hashing.
 *
 * Rules:
 *  - object keys sorted recursively by UTF-16 code unit order (C#: StringComparer.Ordinal);
 *  - no whitespace; arrays keep their order;
 *  - object properties whose value is `undefined` are omitted; `undefined` array items become `null`
 *    (same as JSON.stringify);
 *  - Date → ISO-8601 string with milliseconds (`toISOString`);
 *  - strings and numbers are serialized exactly like ECMAScript JSON.stringify;
 *  - non-finite numbers, bigint, functions, symbols and non-plain objects (Map, Set, class
 *    instances, Buffers) are rejected with a TypeError so hashing never silently changes.
 */

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`Unsupported ${typeof value} value at ${path}`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`Invalid Date at ${path}`);
    return JSON.stringify(value.toISOString());
  }
  if (seen.has(value)) throw new TypeError(`Circular reference at ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      // Index loop (not map) so sparse holes serialize as null like JSON.stringify.
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const item: unknown = value[index];
        items.push(item === undefined ? 'null' : serialize(item, `${path}[${index}]`, seen));
      }
      return `[${items.join(',')}]`;
    }
    if (!isPlainObject(value)) throw new TypeError(`Unsupported non-plain object at ${path}`);
    const keys = Object.keys(value).sort();
    const members: string[] = [];
    for (const key of keys) {
      const member = value[key];
      if (member === undefined) continue;
      members.push(`${JSON.stringify(key)}:${serialize(member, `${path}.${key}`, seen)}`);
    }
    return `{${members.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** Deterministic JSON serialization (see module documentation). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new TypeError('Cannot canonicalize undefined');
  return serialize(value, '$', new Set());
}
