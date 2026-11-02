import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PREVIEW_ID_PATTERN } from './preview-token.mjs';

function contained(root, target) {
  const relation = relative(resolve(root), resolve(target));
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
}

export async function cleanupPreviews(previewRoot, options = {}) {
  const root = resolve(previewRoot);
  const metaRoot = resolve(root, '.meta');
  const publicRoot = resolve(root, 'p');
  const now = options.now ?? Date.now();
  const removed = [];
  const retained = [];
  for (const entry of await readdir(metaRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const metadataPath = resolve(metaRoot, entry.name);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const previewId = metadata.preview_id;
    if (!PREVIEW_ID_PATTERN.test(previewId ?? '') || entry.name !== `${previewId}.json`) {
      retained.push({ previewId: entry.name, reason: 'invalid_metadata' });
      continue;
    }
    if (Date.parse(metadata.expires_at) > now) {
      retained.push({ previewId, reason: 'active' });
      continue;
    }
    const directory = resolve(publicRoot, previewId);
    if (!contained(publicRoot, directory)) throw new Error('PREVIEW_CLEANUP_PATH_ESCAPE');
    const info = await lstat(directory).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error(`PREVIEW_CLEANUP_SYMLINK: ${previewId}`);
    if (info?.isDirectory()) await rm(directory, { recursive: true, force: false });
    await rm(metadataPath, { force: false });
    removed.push(previewId);
  }
  return { removed, retained };
}

async function main() {
  const root = process.argv[2] ?? process.env.DIARWIKI_PREVIEW_ROOT;
  if (!root) throw new Error('Укажите корневой каталог предпросмотров.');
  const result = await cleanupPreviews(root);
  console.log(`Удалено предпросмотров: ${result.removed.length}; сохранено: ${result.retained.length}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
