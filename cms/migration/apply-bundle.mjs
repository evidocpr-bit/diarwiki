import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DirectusApi } from '../bootstrap/directus-api.mjs';
import { createMigrationReport } from './report.mjs';

const SIMPLE_ORDER = [
  'sources', 'library_items', 'pages', 'site_settings', 'materials',
  'block_rich_text', 'block_quick_answer', 'block_learning_list',
  'block_article_step', 'block_medical_notice', 'block_figure',
  'block_flow_diagram', 'block_source_story', 'block_sources',
  'block_next_material', 'block_contact_prompt',
  'material_blocks', 'material_sources', 'material_relations',
];

function encode(value) { return encodeURIComponent(value); }

async function collectionCount(api, collection) {
  const result = await api.get(`/items/${encode(collection)}?aggregate[count]=id&limit=1`);
  return Number(result?.[0]?.count?.id ?? 0);
}

async function uploadFile(baseUrl, token, path, filename, fetchImplementation = fetch) {
  const buffer = await readFile(path);
  const body = new FormData();
  body.append('file', new Blob([buffer]), filename);
  const response = await fetchImplementation(new URL('/files', baseUrl), {
    method: 'POST', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, body,
  });
  if (!response.ok) throw new Error(`Directus API POST /files: HTTP ${response.status}`);
  return (await response.json()).data;
}

async function deleteCreated(api, created) {
  const failures = [];
  for (const { collection, id } of [...created].reverse()) {
    try {
      const path = collection === 'directus_files'
        ? `/files/${encode(id)}`
        : `/items/${encode(collection)}/${encode(id)}`;
      await api.delete(path);
    }
    catch { failures.push(`${collection}:${id}`); }
  }
  return failures;
}

export async function applyMigrationBundle(bundle, options) {
  const report = createMigrationReport(bundle);
  if (!report.safe_to_apply) throw new Error('MIGRATION_BUNDLE_INVALID');
  if (!options.confirmEmpty) throw new Error('CONFIRM_EMPTY_REQUIRED');
  const api = new DirectusApi(options.baseUrl, options.token, options.fetchImplementation ?? fetch);
  const targetCollections = [...new Set([...SIMPLE_ORDER, 'navigation', 'media_metadata'])];
  for (const collection of targetCollections) {
    const count = await collectionCount(api, collection);
    if (count !== 0) throw new Error(`TARGET_COLLECTION_NOT_EMPTY: ${collection}`);
  }

  const created = [];
  const remember = (collection, records) => records.forEach(({ id }) => created.push({ collection, id }));
  try {
    const workspace = resolve(options.workspaceRoot);
    for (const mediaFile of bundle.media_files) {
      const path = resolve(workspace, mediaFile.source_path);
      const relation = relative(workspace, path);
      if (relation.startsWith('..')) throw new Error(`MEDIA_PATH_ESCAPE: ${mediaFile.source_path}`);
      const file = await uploadFile(options.baseUrl, options.token, path, mediaFile.filename, options.fetchImplementation);
      created.push({ collection: 'directus_files', id: file.id });
      const metadata = bundle.collections.media_metadata.find(({ id }) => id === mediaFile.media_id);
      if (!metadata) throw new Error(`MEDIA_METADATA_MISSING: ${mediaFile.media_id}`);
      const payload = {
        id: metadata.id, file: file.id, alt_text: metadata.alt_text, caption: metadata.caption,
        author_or_source: metadata.author_or_source, rights_basis: metadata.rights_basis,
        rights_status: metadata.rights_status, security_findings: [],
      };
      await api.post('/items/media_metadata', payload);
      remember('media_metadata', [payload]);
    }

    for (const collection of SIMPLE_ORDER) {
      let records = bundle.collections[collection] ?? [];
      if (collection === 'material_blocks') {
        records = records.map(({ item, ...record }) => ({ ...record, collection: item.collection, item: item.item }));
      }
      if (records.length === 0) continue;
      await api.post(`/items/${encode(collection)}`, records);
      remember(collection, records);
    }

    const navigation = bundle.collections.navigation ?? [];
    const parents = navigation.filter(({ parent }) => !parent);
    const children = navigation.filter(({ parent }) => parent);
    if (parents.length) { await api.post('/items/navigation', parents); remember('navigation', parents); }
    if (children.length) { await api.post('/items/navigation', children); remember('navigation', children); }

    return { created: created.length, report };
  } catch (error) {
    if (options.keepPartial) throw error;
    const cleanupFailures = await deleteCreated(api, created);
    if (cleanupFailures.length) {
      throw new Error(`${error.message}; MIGRATION_CLEANUP_INCOMPLETE: ${cleanupFailures.join(',')}`, { cause: error });
    }
    throw error;
  }
}

function parseArguments(argv) {
  const options = { workspaceRoot: process.cwd(), keepPartial: false, confirmEmpty: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--bundle') options.bundle = resolve(argv[++index]);
    else if (argv[index] === '--workspace') options.workspaceRoot = resolve(argv[++index]);
    else if (argv[index] === '--confirm-empty') options.confirmEmpty = true;
    else if (argv[index] === '--keep-partial') options.keepPartial = true;
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.bundle) throw new Error('Укажите --bundle <migration-bundle.json>.');
  const baseUrl = process.env.DIRECTUS_URL;
  const token = process.env.DIRECTUS_STATIC_TOKEN;
  if (!baseUrl || !token) throw new Error('DIRECTUS_URL_AND_STATIC_TOKEN_REQUIRED');
  const bundle = JSON.parse(await readFile(options.bundle, 'utf8'));
  const result = await applyMigrationBundle(bundle, { ...options, baseUrl, token });
  console.log(`Миграция завершена. Создано записей и файлов: ${result.created}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
