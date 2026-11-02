import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifySnapshot } from '../../../cms/release/verify-snapshot.mjs';
import { canonicalStringify, sha256Hex } from '../../../cms/release/canonicalize.mjs';
import { sha256Content } from '../review-markers.mjs';
import { importStatements, renderBlocks, sanitizeRichText } from './render-blocks.mjs';

const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9/_-]*[a-z0-9])?$/u;

function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || !SAFE_SLUG.test(slug) || slug.includes('..') || slug.includes('//')) {
    throw new Error(`UNSAFE_SLUG: ${slug}`);
  }
}

function safePath(root, ...parts) {
  const base = resolve(root);
  const target = resolve(base, ...parts);
  const relation = relative(base, target);
  if (relation.startsWith('..') || relation.includes(`..${sep}`)) throw new Error('OUTPUT_PATH_ESCAPE');
  return target;
}

async function writeExclusive(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'wx');
  try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
}

function yamlValue(value) {
  return JSON.stringify(value).replace(/</gu, '\\u003c');
}

function componentImportBase(slug) {
  const directoryDepth = slug.split('/').length - 1;
  return `${'../'.repeat(directoryDepth + 2)}components/articles`.replace(/\/$/u, '');
}

function materialFrontmatter(material, status = 'published') {
  const review = material.medical_review;
  return {
    title: material.title,
    description: material.description,
    summary: material.summary,
    schemaVersion: 1,
    contentId: material.content_id,
    ...(Number.isInteger(material.sort_order) && material.sort_order > 0 ? { order: material.sort_order } : {}),
    contentType: material.content_type,
    status,
    audience: material.audiences ?? [],
    topics: material.topics ?? [],
    medicalReview: review ? 'reviewed' : 'pending',
    reviewedBy: review?.reviewer_name ?? null,
    reviewerSpecialty: review?.reviewer_specialty ?? null,
    reviewerProfileUrl: review?.reviewer_profile_url ?? null,
    reviewedAt: review?.reviewed_at ?? null,
    reviewedContentHash: review?.fingerprint ?? null,
    publishedAt: null,
    updatedAt: material.public_updated_at,
    lastUpdated: material.public_updated_at,
    sourceIds: (material.sources ?? []).map(({ source_id }) => source_id),
    relatedIds: (material.related ?? []).map(({ content_id }) => content_id),
    risk: material.risk,
    articleFormat: material.article_format,
    level: material.level,
    disclaimerScope: material.disclaimer_scope,
    tableOfContents: material.table_of_contents ?? true,
  };
}

function mdxDocument(frontmatter, imports, body) {
  const header = Object.entries(frontmatter).map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n');
  return `---\n${header}\n---\n\n${imports ? `${imports}\n\n` : ''}${body}\n`;
}

function sourceDocument(source) {
  return {
    id: source.source_id,
    title: source.title,
    organization: source.author_or_organization,
    url: source.url,
    language: source.language,
    accessedAt: source.accessed_at,
    ...(source.bibliographic_description ? { note: source.bibliographic_description } : {}),
  };
}

export async function generateContent(snapshot, outputRoot, options = {}) {
  const verification = verifySnapshot(snapshot);
  if (verification.problems.length > 0) throw new Error(`SNAPSHOT_INVALID: ${verification.problems.map(({ code }) => code).join(', ')}`);
  const contentStatus = options.contentStatus ?? 'published';
  if (!['draft', 'ready', 'published', 'archived'].includes(contentStatus)) throw new Error('CONTENT_STATUS_INVALID');
  const existing = await readdir(outputRoot);
  if (existing.length > 0) throw new Error('OUTPUT_DIRECTORY_NOT_EMPTY');
  await Promise.all(['docs', 'sources', 'data', 'review-records'].map((directory) => mkdir(safePath(outputRoot, directory), { recursive: true })));

  const generated = [];
  for (const material of snapshot.content.materials) {
    assertSafeSlug(material.slug);
    const rendered = renderBlocks(material.blocks ?? [], material);
    const path = safePath(outputRoot, 'docs', `${material.slug}.mdx`);
    const imports = importStatements(rendered.imports, componentImportBase(material.slug));
    const contents = mdxDocument(materialFrontmatter(material, contentStatus), imports, rendered.body);
    await writeExclusive(path, contents);
    generated.push({ path: relative(outputRoot, path).replaceAll('\\', '/'), sha256: sha256Hex(contents) });
    if (material.medical_review) {
      const review = material.medical_review;
      if (!review.evidence_reference || !review.owner_confirmed_at) throw new Error('MEDICAL_REVIEW_EVIDENCE_INCOMPLETE');
      const recordPath = safePath(outputRoot, 'review-records', `${material.content_id}.json`);
      const record = {
        contentId: material.content_id,
        contentPath: `${material.slug}.mdx`,
        contentHash: sha256Content(contents),
        reviewerName: review.reviewer_name,
        reviewerSpecialty: review.reviewer_specialty,
        reviewerProfileUrl: review.reviewer_profile_url ?? null,
        reviewedAt: String(review.reviewed_at).slice(0, 10),
        evidenceType: 'cms-record',
        evidenceRef: review.evidence_reference,
        approvedBy: 'site-owner',
        approvedAt: String(review.owner_confirmed_at).slice(0, 10),
      };
      const recordContents = `${canonicalStringify(record)}\n`;
      await writeExclusive(recordPath, recordContents);
      generated.push({ path: relative(outputRoot, recordPath).replaceAll('\\', '/'), sha256: sha256Hex(recordContents) });
    }
  }

  for (const page of snapshot.content.pages) {
    assertSafeSlug(page.slug);
    const path = safePath(outputRoot, 'docs', `${page.slug}.mdx`);
    const contents = mdxDocument({
      title: page.title,
      description: page.summary ?? page.title,
      summary: page.summary ?? page.title,
      schemaVersion: 1,
      contentId: page.page_id,
      contentType: 'page',
      status: contentStatus,
      audience: [], topics: [], medicalReview: 'pending', reviewedBy: null,
      reviewerSpecialty: null, reviewerProfileUrl: null, reviewedAt: null,
      reviewedContentHash: null, publishedAt: null, updatedAt: page.public_updated_at,
      lastUpdated: page.public_updated_at, sourceIds: [], relatedIds: [], risk: 'low',
      articleFormat: 'reference', level: 'basic', disclaimerScope: 'standard',
      tableOfContents: false,
    }, '', sanitizeRichText(page.body ?? ''));
    await writeExclusive(path, contents);
    generated.push({ path: relative(outputRoot, path).replaceAll('\\', '/'), sha256: sha256Hex(contents) });
  }

  for (const source of snapshot.content.sources) {
    const path = safePath(outputRoot, 'sources', `${source.source_id}.json`);
    const contents = `${canonicalStringify(sourceDocument(source))}\n`;
    await writeExclusive(path, contents);
    generated.push({ path: relative(outputRoot, path).replaceAll('\\', '/'), sha256: sha256Hex(contents) });
  }

  for (const [name, value] of Object.entries({
    library: snapshot.content.library_items,
    navigation: snapshot.content.navigation,
    site_settings: snapshot.content.site_settings,
    redirects: snapshot.content.redirects,
    media_manifest: snapshot.content.media_manifest,
  })) {
    const path = safePath(outputRoot, 'data', `${name}.json`);
    const contents = `${canonicalStringify(value)}\n`;
    await writeExclusive(path, contents);
    generated.push({ path: relative(outputRoot, path).replaceAll('\\', '/'), sha256: sha256Hex(contents) });
  }

  generated.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const generationManifest = {
    schema_version: 1,
    mode: options.mode ?? 'release',
    snapshot_id: snapshot.snapshot_id,
    snapshot_sha256: snapshot.snapshot_sha256,
    files: generated,
  };
  await writeExclusive(
    safePath(outputRoot, 'generation-manifest.json'),
    `${canonicalStringify(generationManifest)}\n`,
  );
  return { materialCount: snapshot.content.materials.length, pageCount: snapshot.content.pages.length, files: generated };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--snapshot') options.snapshot = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.snapshot || !options.output) throw new Error('Укажите --snapshot <json> и --output <пустой каталог>.');
  await mkdir(options.output, { recursive: true });
  const result = await generateContent(JSON.parse(await readFile(options.snapshot, 'utf8')), options.output);
  console.log(`Создано материалов: ${result.materialCount}; страниц: ${result.pageCount}; файлов: ${result.files.length}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
