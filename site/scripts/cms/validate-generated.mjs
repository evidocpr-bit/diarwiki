import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sha256Hex } from '../../../cms/release/canonicalize.mjs';

const ALLOWED_COMPONENTS = new Set([
  'ArticleFigure', 'ArticleSources', 'ArticleStep', 'FlowDiagram', 'LearnList',
  'MedicalNotice', 'NextArticle', 'QuickAnswer', 'SourceStory',
]);

async function filesRecursively(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await filesRecursively(root, path));
    else result.push({ path, relative: relative(root, path).replaceAll('\\', '/') });
  }
  return result;
}

function safeManifestPath(root, manifestPath) {
  if (typeof manifestPath !== 'string' || manifestPath.length === 0 || manifestPath.includes('\\')) return null;
  const base = resolve(root);
  const target = resolve(base, manifestPath);
  const relation = relative(base, target);
  if (relation === '' || relation.startsWith('..') || relation.includes(`..${sep}`)) return null;
  return target;
}

export async function validateGeneratedContent(root) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'generation-manifest.json'), 'utf8'));
  } catch {
    return { problems: [{ code: 'GENERATION_MANIFEST_MISSING', subject: 'generation-manifest.json' }] };
  }
  const expected = new Map();
  for (const file of manifest.files ?? []) {
    if (!safeManifestPath(root, file.path)) {
      problems.push({ code: 'GENERATED_PATH_FORBIDDEN', subject: String(file.path) });
      continue;
    }
    expected.set(file.path, file.sha256);
  }
  const ids = new Set();
  for (const file of await filesRecursively(root)) {
    if (file.relative === 'generation-manifest.json') continue;
    const contents = await readFile(file.path, 'utf8');
    if (expected.get(file.relative) !== sha256Hex(contents)) {
      problems.push({ code: 'GENERATED_HASH_MISMATCH', subject: file.relative });
    }
    if (extname(file.path) !== '.mdx') continue;
    if (/<\s*script|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*javascript\s*:|\bexport\s+/iu.test(contents)) {
      problems.push({ code: 'GENERATED_ACTIVE_CONTENT', subject: file.relative });
    }
    for (const line of contents.match(/^import\s+.*$/gmu) ?? []) {
      const match = line.match(/^import\s+([A-Za-z]+)\s+from\s+'(?:\.\.\/)+components\/articles\/([A-Za-z]+)\.astro';$/u);
      if (!match || match[1] !== match[2] || !ALLOWED_COMPONENTS.has(match[1])) {
        problems.push({ code: 'GENERATED_IMPORT_FORBIDDEN', subject: file.relative });
      }
    }
    const id = contents.match(/^contentId:\s+"([^"]+)"\s*$/mu)?.[1];
    if (!id) problems.push({ code: 'GENERATED_CONTENT_ID_MISSING', subject: file.relative });
    else if (ids.has(id)) problems.push({ code: 'GENERATED_CONTENT_ID_DUPLICATE', subject: id });
    else ids.add(id);
  }
  for (const path of expected.keys()) {
    try { await readFile(safeManifestPath(root, path)); } catch { problems.push({ code: 'GENERATED_FILE_MISSING', subject: path }); }
  }
  return { problems };
}

async function main() {
  const [root] = process.argv.slice(2);
  if (!root) throw new Error('Укажите каталог сгенерированного содержимого.');
  const result = await validateGeneratedContent(root);
  if (result.problems.length > 0) {
    for (const { code, subject } of result.problems) console.error(`- ${subject}: ${code}`);
    process.exitCode = 1;
    return;
  }
  console.log('Сгенерированное содержимое прошло проверку.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
