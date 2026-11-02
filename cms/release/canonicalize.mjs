import { createHash } from 'node:crypto';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export function normalizeCanonical(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/\r\n?/gu, '\n').normalize('NFC').trim();
    if (ISO_DATETIME.test(normalized)) {
      const timestamp = Date.parse(normalized);
      if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
    }
    return normalized;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeCanonical).filter((item) => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => [key, normalizeCanonical(item)]));
  }
  throw new TypeError(`Неподдерживаемый тип снимка: ${typeof value}`);
}

export function canonicalStringify(value) {
  return JSON.stringify(normalizeCanonical(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableSort(items, identity) {
  return [...items].sort((left, right) => String(identity(left)).localeCompare(String(identity(right)), 'en'));
}
