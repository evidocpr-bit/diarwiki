import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { canonicalStringify, sha256Hex } from './canonicalize.mjs';

function problem(code, subject) {
  return { code, subject };
}

export function verifySnapshot(snapshot) {
  const problems = [];
  if (!snapshot || snapshot.schema_version !== 1 || !snapshot.content || !snapshot.manifest) {
    return { problems: [problem('SNAPSHOT_SHAPE_INVALID', 'root')] };
  }
  const { snapshot_id: snapshotId, snapshot_sha256: expected, ...payload } = snapshot;
  const actual = sha256Hex(canonicalStringify(payload));
  if (!/^[a-f\d]{64}$/u.test(expected ?? '') || actual !== expected) {
    problems.push(problem('SNAPSHOT_HASH_MISMATCH', 'snapshot_sha256'));
  }
  if (snapshotId !== `dw-${actual.slice(0, 20)}`) problems.push(problem('SNAPSHOT_ID_MISMATCH', 'snapshot_id'));

  const routes = snapshot.manifest.routes ?? [];
  if (new Set(routes).size !== routes.length) problems.push(problem('ROUTE_COLLISION', 'manifest.routes'));
  for (const media of snapshot.content.media_manifest ?? []) {
    if (!/^[a-f\d]{64}$/u.test(media.sha256 ?? '')) problems.push(problem('MEDIA_HASH_INVALID', media.id));
  }
  const counts = snapshot.manifest.counts ?? {};
  for (const [key, collection] of [
    ['materials', snapshot.content.materials],
    ['sources', snapshot.content.sources],
    ['library_items', snapshot.content.library_items],
    ['pages', snapshot.content.pages],
    ['media', snapshot.content.media_manifest],
    ['redirects', snapshot.content.redirects],
  ]) {
    if (!Array.isArray(collection) || counts[key] !== collection.length) {
      problems.push(problem('SNAPSHOT_COUNT_MISMATCH', `manifest.counts.${key}`));
    }
  }
  return { problems, actualSha256: actual };
}

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) throw new Error('Укажите путь к снимку JSON.');
  const snapshot = JSON.parse(await readFile(path, 'utf8'));
  const result = verifySnapshot(snapshot);
  if (result.problems.length > 0) {
    for (const { code, subject } of result.problems) console.error(`- ${subject}: ${code}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Снимок ${snapshot.snapshot_id} подтверждён; SHA-256 ${result.actualSha256}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
