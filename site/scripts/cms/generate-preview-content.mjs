import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { canonicalStringify, sha256Hex } from '../../../cms/release/canonicalize.mjs';
import { generateContent } from './generate-content.mjs';

const PREVIEW_ID = /^pv-[a-z0-9][a-z0-9-]{5,63}$/u;

function route(slug, prefix = '') {
  return `/${prefix}${String(slug).replace(/^\/+|\/+$/gu, '')}/`;
}

export function createPreviewSnapshot(input) {
  if (!input || input.schema_version !== 1 || !PREVIEW_ID.test(input.preview_id ?? '') || !input.content) {
    throw new Error('PREVIEW_INPUT_INVALID');
  }
  const content = {
    materials: input.content.materials ?? [], sources: input.content.sources ?? [],
    library_items: input.content.library_items ?? [], pages: input.content.pages ?? [],
    navigation: input.content.navigation ?? [], site_settings: input.content.site_settings ?? {},
    media_manifest: input.content.media_manifest ?? [], redirects: input.content.redirects ?? [],
  };
  const routes = [
    ...content.materials.map(({ slug }) => route(slug)),
    ...content.pages.map(({ slug }) => route(slug)),
    ...content.library_items.map(({ slug }) => route(slug, 'library/')),
  ].sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(routes).size !== routes.length) throw new Error('PREVIEW_ROUTE_COLLISION');
  const payload = {
    schema_version: 1,
    created_at: input.created_at ?? new Date().toISOString(),
    source_commit: input.source_commit ?? 'preview',
    release_request_id: `preview:${input.preview_id}`,
    content,
    manifest: {
      routes,
      counts: {
        materials: content.materials.length, sources: content.sources.length,
        library_items: content.library_items.length, pages: content.pages.length,
        media: content.media_manifest.length, redirects: content.redirects.length,
      },
    },
  };
  const snapshotSha256 = sha256Hex(canonicalStringify(payload));
  return {
    snapshot_id: `dw-${snapshotSha256.slice(0, 20)}`,
    snapshot_sha256: snapshotSha256,
    ...payload,
  };
}

export async function generatePreviewContent(input, outputRoot) {
  const snapshot = createPreviewSnapshot(input);
  const result = await generateContent(snapshot, outputRoot, { contentStatus: 'draft', mode: 'preview' });
  return { snapshot, ...result };
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
  if (!options.input || !options.output) throw new Error('Укажите --input <preview.json> и --output <пустой каталог>.');
  await mkdir(options.output, { recursive: true });
  const result = await generatePreviewContent(JSON.parse(await readFile(options.input, 'utf8')), options.output);
  console.log(`Предпросмотр ${result.snapshot.snapshot_id}: материалов ${result.materialCount}, страниц ${result.pageCount}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
