import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function verifyReleaseManifest(path, expected = {}) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const required = ['release_id', 'source_commit', 'snapshot_id', 'snapshot_sha256', 'archive_sha256', 'built_at', 'routes'];
  if (manifest.schema_version !== 1 || required.some((field) => manifest[field] === undefined)) throw new Error('RELEASE_MANIFEST_INVALID');
  if (!/^\d{8}T\d{6}Z-[a-f\d]{7,40}$/u.test(manifest.release_id)) throw new Error('RELEASE_MANIFEST_INVALID');
  for (const field of ['snapshot_sha256', 'archive_sha256']) {
    if (!/^[a-f\d]{64}$/u.test(manifest[field])) throw new Error('RELEASE_MANIFEST_INVALID');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && manifest[field] !== value) throw new Error(`RELEASE_MANIFEST_MISMATCH: ${field}`);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, releaseId, archiveSha256, snapshotSha256] = process.argv.slice(2);
  if (!path || !releaseId || !archiveSha256 || !snapshotSha256) throw new Error('Usage: verify-release-manifest.mjs PATH RELEASE_ID ARCHIVE_SHA SNAPSHOT_SHA');
  await verifyReleaseManifest(path, {
    release_id: releaseId, archive_sha256: archiveSha256, snapshot_sha256: snapshotSha256,
  });
}
