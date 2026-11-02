import { chmod, open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { createReviewFingerprint } from '../extensions/diarwiki-workflow/src/review-fingerprint.ts';
import { canonicalStringify, normalizeCanonical, sha256Hex, stableSort } from './canonicalize.mjs';

const RELEASE_READY = new Set(['ready_to_publish', 'published']);

const MATERIAL_FIELDS = [
  'content_id', 'slug', 'content_type', 'title', 'description', 'summary', 'risk',
  'article_format', 'level', 'disclaimer_scope', 'sort_order', 'audiences', 'topics',
  'table_of_contents', 'public_updated_at',
];
const SOURCE_FIELDS = [
  'source_id', 'title', 'author_or_organization', 'url', 'doi',
  'bibliographic_description', 'language', 'source_type', 'accessed_at',
];
const MEDIA_FIELDS = [
  'id', 'sha256', 'filename', 'mime_type', 'width', 'height', 'alt_text', 'caption',
  'author_or_source',
];
const LIBRARY_FIELDS = [
  'library_id', 'slug', 'title', 'description', 'category', 'resource_type',
  'author_or_organization', 'publisher', 'source_year', 'language', 'format', 'pages',
  'editorial_status', 'benefit', 'caution', 'rights_note', 'topics', 'featured',
  'access_label', 'additional_links', 'public_url', 'alternative_url',
  'medical_review_status', 'last_checked_at',
];
const PAGE_FIELDS = ['page_id', 'slug', 'title', 'summary', 'body', 'template_key', 'public_updated_at'];
const NAVIGATION_FIELDS = ['id', 'label', 'href', 'placement', 'sort_order', 'parent'];
const SETTINGS_FIELDS = [
  'project_name', 'canonical_origin', 'editor_email', 'owner_name', 'owner_status',
  'owner_location', 'partner_name', 'partner_url', 'mission',
];
const REVIEW_FIELDS = [
  'fingerprint', 'reviewer_name', 'reviewer_specialty', 'reviewer_profile_url',
  'decision', 'reviewed_at', 'evidence_reference', 'owner_confirmed_by',
  'owner_confirmed_at',
];
const REDIRECT_FIELDS = ['from_path', 'to_path'];

export class SnapshotError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SnapshotError';
    this.code = code;
    this.details = details;
  }
}

function pick(record, fields) {
  return Object.fromEntries(fields
    .filter((field) => record?.[field] !== undefined)
    .map((field) => [field, record[field]]));
}

function materialReference(review) {
  return typeof review.material === 'object'
    ? review.material.id ?? review.material.content_id
    : review.material;
}

function publicMedia(media) {
  if (media.security_status !== 'passed' || media.rights_status !== 'approved') {
    throw new SnapshotError(
      'MEDIA_NOT_RELEASE_READY',
      `Медиа ${media.id ?? media.filename ?? '<unknown>'} не прошло проверку или не имеет подтверждённых прав.`,
    );
  }
  if (!/^[a-f\d]{64}$/u.test(media.sha256 ?? '')) {
    throw new SnapshotError('MEDIA_NOT_RELEASE_READY', 'У медиа отсутствует корректный SHA-256.');
  }
  return pick(media, MEDIA_FIELDS);
}

function currentReview(material, reviews, fingerprint, required) {
  const identifiers = new Set([material.id, material.content_id].filter(Boolean));
  const review = reviews
    .filter((candidate) => identifiers.has(materialReference(candidate)))
    .filter(({ decision, fingerprint: reviewed }) => decision === 'approved' && reviewed === fingerprint)
    .sort((left, right) => String(right.reviewed_at).localeCompare(String(left.reviewed_at), 'en'))[0];
  const statusMatches = material.medical_review_status === 'reviewed'
    && material.review_fingerprint === fingerprint;
  if (review && statusMatches && (!review.evidence_reference || !review.owner_confirmed_by || !review.owner_confirmed_at)) {
    throw new SnapshotError(
      'MEDICAL_REVIEW_OWNER_CONFIRMATION_REQUIRED',
      `Для медицинской рецензии материала ${material.content_id} требуется подтверждение владельца и ссылка на доказательство.`,
    );
  }
  if (required && (!review || !statusMatches)) {
    throw new SnapshotError(
      'CURRENT_MEDICAL_REVIEW_REQUIRED',
      `Для материала ${material.content_id} нет действующей медицинской рецензии текущей версии.`,
    );
  }
  return review && statusMatches ? pick(review, REVIEW_FIELDS) : null;
}

function normalizeMaterial(material, reviews, requiredRisks) {
  if (!RELEASE_READY.has(material.workflow_status)) {
    throw new SnapshotError(
      'MATERIAL_NOT_RELEASE_READY',
      `Материал ${material.content_id} имеет статус ${material.workflow_status}.`,
    );
  }
  const blocks = [...(material.blocks ?? [])]
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)
      || String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en'))
    .map(({ id, sort_order, block_type, item }) => ({ id, sort_order, block_type, item }));
  const sources = stableSort(material.sources ?? [], (source) => source.source_id).map((source) => pick(source, SOURCE_FIELDS));
  const media = stableSort(material.media ?? [], (item) => item.id ?? item.sha256).map(publicMedia);
  const related = stableSort(material.related ?? [], (item) => item.content_id)
    .map((item) => pick(item, ['content_id', 'slug', 'title']));
  const reviewSet = { material, blocks, sources, media: material.media ?? [], related };
  const fingerprint = createReviewFingerprint(reviewSet);
  const required = material.risk === 'high' || requiredRisks.includes(material.risk);
  const medicalReview = currentReview(material, reviews, fingerprint, required);
  return {
    ...pick(material, MATERIAL_FIELDS),
    blocks,
    sources,
    media,
    related,
    review_fingerprint: fingerprint,
    medical_review: medicalReview,
  };
}

function routeForSlug(slug) {
  const clean = String(slug).replace(/^\/+|\/+$/gu, '');
  return `/${clean}/`;
}

function assertUnique(items, identity, code) {
  const values = items.map(identity);
  if (values.some((value) => value === undefined || value === null || value === '')) {
    throw new SnapshotError(code, 'В снимке отсутствует обязательный стабильный идентификатор.');
  }
  if (new Set(values).size !== values.length) {
    throw new SnapshotError(code, 'В снимке обнаружены повторяющиеся стабильные идентификаторы.');
  }
}

function snapshotPayload(input) {
  if (!input || typeof input !== 'object') throw new SnapshotError('SNAPSHOT_INPUT_INVALID', 'Входные данные снимка отсутствуют.');
  if (typeof input.source_commit !== 'string' || input.source_commit.length < 7) {
    throw new SnapshotError('SNAPSHOT_INPUT_INVALID', 'Не указан проверяемый commit исходного кода.');
  }
  const requiredRisks = input.site_settings?.medical_review_required_risks ?? ['high'];
  if (!Array.isArray(requiredRisks) || !requiredRisks.includes('high')) {
    throw new SnapshotError('SNAPSHOT_INPUT_INVALID', 'Высокий риск должен требовать медицинской проверки.');
  }
  const materials = stableSort(input.materials ?? [], (item) => item.content_id)
    .map((material) => normalizeMaterial(material, input.medical_reviews ?? [], requiredRisks));
  const sources = stableSort(input.sources ?? [], (item) => item.source_id).map((item) => pick(item, SOURCE_FIELDS));
  const libraryItems = stableSort(
    (input.library_items ?? []).filter((item) =>
      !item.archived && item.public_link_status === 'public' && item.rights_status === 'approved'),
    (item) => item.library_id,
  ).map((item) => pick(item, LIBRARY_FIELDS));
  const pages = stableSort(input.pages ?? [], (item) => item.page_id).map((page) => {
    if (!RELEASE_READY.has(page.workflow_status)) {
      throw new SnapshotError('PAGE_NOT_RELEASE_READY', `Страница ${page.page_id} не готова к выпуску.`);
    }
    return pick(page, PAGE_FIELDS);
  });
  const navigation = [...(input.navigation ?? [])]
    .filter(({ enabled }) => enabled)
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)
      || String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en'))
    .map((item) => pick(item, NAVIGATION_FIELDS));
  const redirects = stableSort(
    (input.redirects ?? []).filter(({ status }) => status === undefined || status === 'active'),
    (item) => item.from_path,
  ).map((item) => pick(item, REDIRECT_FIELDS));
  assertUnique(materials, (item) => item.content_id, 'MATERIAL_ID_COLLISION');
  assertUnique(sources, (item) => item.source_id, 'SOURCE_ID_COLLISION');
  assertUnique(libraryItems, (item) => item.library_id, 'LIBRARY_ID_COLLISION');
  assertUnique(pages, (item) => item.page_id, 'PAGE_ID_COLLISION');
  assertUnique(redirects, (item) => item.from_path, 'REDIRECT_COLLISION');
  const mediaManifest = stableSort(
    materials.flatMap((material) => material.media),
    (item) => item.id ?? item.sha256,
  ).filter((item, index, array) => array.findIndex((other) => other.sha256 === item.sha256) === index);
  const routes = [
    ...materials.map(({ slug }) => routeForSlug(slug)),
    ...pages.map(({ slug }) => routeForSlug(slug)),
    ...libraryItems.map(({ slug }) => `/library/${String(slug).replace(/^\/+|\/+$/gu, '')}/`),
  ].sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(routes).size !== routes.length) throw new SnapshotError('ROUTE_COLLISION', 'В снимке обнаружены совпадающие публичные адреса.');

  return {
    schema_version: 1,
    source_commit: input.source_commit,
    content: {
      materials,
      sources,
      library_items: libraryItems,
      pages,
      navigation,
      site_settings: pick(input.site_settings ?? {}, SETTINGS_FIELDS),
      media_manifest: mediaManifest,
      redirects,
    },
    manifest: {
      counts: {
        materials: materials.length,
        sources: sources.length,
        library_items: libraryItems.length,
        pages: pages.length,
        media: mediaManifest.length,
        redirects: redirects.length,
      },
      routes,
    },
  };
}

export function createSnapshot(input) {
  const payload = normalizeCanonical(snapshotPayload(input));
  const snapshotSha256 = sha256Hex(canonicalStringify(payload));
  return normalizeCanonical({
    ...payload,
    snapshot_id: `dw-${snapshotSha256.slice(0, 20)}`,
    snapshot_sha256: snapshotSha256,
  });
}

export async function writeSnapshotExclusive(path, snapshot) {
  const handle = await open(path, 'wx', 0o444);
  try {
    await handle.writeFile(`${canonicalStringify(snapshot)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  try { await chmod(path, 0o444); } catch { /* Windows ACLs may ignore POSIX mode bits. */ }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--input') options.input = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.input || !options.output) throw new Error('Укажите --input <json> и --output <json>.');
  const snapshot = createSnapshot(JSON.parse(await readFile(options.input, 'utf8')));
  await writeSnapshotExclusive(options.output, snapshot);
  console.log(`Создан снимок ${snapshot.snapshot_id}; SHA-256 ${snapshot.snapshot_sha256}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
