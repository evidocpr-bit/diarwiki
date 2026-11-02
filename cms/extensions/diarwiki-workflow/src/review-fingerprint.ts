import { createHash } from 'node:crypto';

type UnknownRecord = Record<string, unknown>;

const MATERIAL_FIELDS = [
  'content_id',
  'slug',
  'content_type',
  'title',
  'description',
  'summary',
  'risk',
  'article_format',
  'level',
  'disclaimer_scope',
  'sort_order',
  'audiences',
  'topics',
  'table_of_contents',
  'public_updated_at',
] as const;

const SOURCE_FIELDS = [
  'source_id',
  'title',
  'author_or_organization',
  'url',
  'doi',
  'bibliographic_description',
  'language',
  'source_type',
  'accessed_at',
  'usage_note',
] as const;

const MEDIA_FIELDS = [
  'id',
  'sha256',
  'alt_text',
  'caption',
  'author_or_source',
] as const;

const RELATED_FIELDS = ['content_id', 'title', 'slug'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function pick(source: UnknownRecord, fields: readonly string[]) {
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function normalizeString(value: string) {
  const normalized = value.replace(/\r\n?/gu, '\n').normalize('NFC').trim();
  if (ISO_DATE.test(normalized)) {
    const time = Date.parse(normalized);
    if (!Number.isNaN(time)) return new Date(time).toISOString();
  }
  return normalized;
}

function canonicalValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return normalizeString(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(canonicalValue).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as UnknownRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  throw new TypeError(`Неподдерживаемый тип в проверяемом наборе: ${typeof value}`);
}

function byStableIdentifier(left: UnknownRecord, right: UnknownRecord) {
  const a = String(left.source_id ?? left.content_id ?? left.id ?? '');
  const b = String(right.source_id ?? right.content_id ?? right.id ?? '');
  return a.localeCompare(b, 'en');
}

export type ReviewSet = {
  material: UnknownRecord;
  blocks?: UnknownRecord[];
  sources?: UnknownRecord[];
  media?: UnknownRecord[];
  related?: UnknownRecord[];
};

export function normalizeReviewSet(input: ReviewSet) {
  const blocks = (input.blocks ?? [])
    .map((block): UnknownRecord => ({
      ...pick(block, ['id', 'sort_order', 'block_type']),
      item: block.item ?? null,
    }))
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)
      || String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en'));

  return canonicalValue({
    schema_version: 1,
    material: pick(input.material, MATERIAL_FIELDS),
    blocks,
    sources: (input.sources ?? []).map((item) => pick(item, SOURCE_FIELDS)).sort(byStableIdentifier),
    media: (input.media ?? []).map((item) => pick(item, MEDIA_FIELDS)).sort(byStableIdentifier),
    related: (input.related ?? []).map((item) => pick(item, RELATED_FIELDS)).sort(byStableIdentifier),
  }) as {
    schema_version: number;
    material: UnknownRecord;
    blocks: UnknownRecord[];
    sources: UnknownRecord[];
    media: UnknownRecord[];
    related: UnknownRecord[];
  };
}

export function canonicalizeReviewSet(input: ReviewSet) {
  return JSON.stringify(normalizeReviewSet(input));
}

export function createReviewFingerprint(input: ReviewSet) {
  return createHash('sha256').update(canonicalizeReviewSet(input), 'utf8').digest('hex');
}
