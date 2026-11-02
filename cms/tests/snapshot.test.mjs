import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createReviewFingerprint } from '../extensions/diarwiki-workflow/src/review-fingerprint.ts';
import {
  createSnapshot,
  writeSnapshotExclusive,
} from '../release/create-snapshot.mjs';
import { verifySnapshot } from '../release/verify-snapshot.mjs';

const fixtureUrl = new URL('./fixtures/snapshot-input.json', import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

test('identical content produces identical canonical JSON and SHA-256', async () => {
  const first = await fixture();
  const second = structuredClone(first);
  second.materials.reverse();
  second.sources.reverse();
  second.site_settings = Object.fromEntries(Object.entries(second.site_settings).reverse());

  const a = createSnapshot(first);
  const b = createSnapshot(second);
  assert.equal(a.snapshot_sha256, b.snapshot_sha256);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.match(a.snapshot_id, /^dw-[a-f0-9]{20}$/u);
});

test('draft content cannot enter a release snapshot', async () => {
  const input = await fixture();
  input.materials[0].workflow_status = 'draft';
  assert.throws(() => createSnapshot(input), { code: 'MATERIAL_NOT_RELEASE_READY' });
});

test('high-risk content requires a current matching medical review', async () => {
  const input = await fixture();
  input.materials[0].risk = 'high';
  assert.throws(() => createSnapshot(input), { code: 'CURRENT_MEDICAL_REVIEW_REQUIRED' });
});

test('high-risk content passes with an approved review of the exact fingerprint', async () => {
  const input = await fixture();
  const material = input.materials[0];
  material.risk = 'high';
  const fingerprint = createReviewFingerprint({
    material,
    blocks: material.blocks,
    sources: material.sources,
    media: material.media,
    related: material.related,
  });
  material.medical_review_status = 'reviewed';
  material.review_fingerprint = fingerprint;
  input.medical_reviews.push({
    material: material.id,
    fingerprint,
    reviewer_name: 'Анна Иванова',
    reviewer_specialty: 'Врач-эндокринолог',
    reviewer_profile_url: 'https://example.test/doctor',
    decision: 'approved',
    reviewed_at: '2026-10-22T04:03:02Z',
    evidence_reference: 'review-evidence-42',
    owner_confirmed_by: 'owner-user-id',
    owner_confirmed_at: '2026-10-22T05:00:00Z',
  });
  const snapshot = createSnapshot(input);
  assert.equal(snapshot.content.materials[0].medical_review.fingerprint, fingerprint);
});

test('unsafe or rights-restricted referenced media stops the snapshot', async () => {
  const input = await fixture();
  input.materials[0].media[0].security_status = 'failed';
  assert.throws(() => createSnapshot(input), { code: 'MEDIA_NOT_RELEASE_READY' });
});

test('non-public library links are omitted', async () => {
  const input = await fixture();
  input.library_items[0].public_link_status = 'hidden_pending_permission';
  const snapshot = createSnapshot(input);
  assert.deepEqual(snapshot.content.library_items, []);
});

test('verification detects tampering', async () => {
  const snapshot = createSnapshot(await fixture());
  assert.deepEqual(verifySnapshot(snapshot).problems, []);
  snapshot.content.materials[0].title = 'Подменённый заголовок';
  assert.ok(verifySnapshot(snapshot).problems.some(({ code }) => code === 'SNAPSHOT_HASH_MISMATCH'));
});

test('snapshot file is created once and cannot be overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diarwiki-snapshot-'));
  const path = join(root, 'release.json');
  try {
    const snapshot = createSnapshot(await fixture());
    await writeSnapshotExclusive(path, snapshot);
    await assert.rejects(() => writeSnapshotExclusive(path, snapshot), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), snapshot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
