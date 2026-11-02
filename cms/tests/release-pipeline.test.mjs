import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireReleaseLock } from '../release/release-lock.mjs';
import { fetchReleaseInput } from '../release/fetch-release-input.mjs';
import { claimReleaseRequest, runReleaseJob } from '../release/run-release.mjs';

function fixtureDependencies(overrides = {}) {
  const events = [];
  const request = { id: 'request-1', attempt_count: 0 };
  const snapshot = {
    snapshot_id: 'dw-123', snapshot_sha256: 'a'.repeat(64), manifest: { routes: ['/one/'] },
    content: { materials: [{ content_id: 'one', review_fingerprint: 'b'.repeat(64) }] },
  };
  const dependencies = {
    api: {},
    lock: async () => ({ release: async () => events.push('unlock') }),
    claim: async () => request,
    sourceCommit: async () => 'abcdef0123456789',
    fetchInput: async () => ({ snapshotInput: { materials: [{ id: 'm1' }], pages: [] }, mediaFiles: [] }),
    snapshot: () => snapshot,
    current: async () => '20261021T000000Z-1234567',
    build: async () => ({ archiveSha256: 'c'.repeat(64), workRoot: null }),
    activate: async () => events.push('activate'),
    verify: async () => 'verified',
    rollback: async (target) => events.push(`rollback:${target}`),
    reportSuccess: async () => events.push('success'),
    reportFailure: async (_request, error) => events.push(`failure:${error.code ?? error.message}`),
    cleanup: async () => events.push('cleanup'),
    ...overrides,
  };
  return { dependencies, events };
}

test('exclusive lock rejects a parallel release and can be reacquired', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diarwiki-lock-'));
  const path = join(root, 'release.lock');
  try {
    const first = await acquireReleaseLock(path);
    await assert.rejects(() => acquireReleaseLock(path), { code: 'RELEASE_ALREADY_RUNNING' });
    await first.release();
    const second = await acquireReleaseLock(path);
    await second.release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('successful release builds, activates, verifies and reports once', async () => {
  const { dependencies, events } = fixtureDependencies();
  const result = await runReleaseJob({ now: new Date('2026-10-22T10:20:30Z') }, dependencies);
  assert.equal(result.status, 'published');
  assert.equal(result.release.release_id, '20261022T102030Z-abcdef012345');
  assert.deepEqual(events, ['activate', 'success', 'cleanup', 'unlock']);
});

test('build failure is reported without changing the active release', async () => {
  const { dependencies, events } = fixtureDependencies({ build: async () => { throw Object.assign(new Error('bad build'), { code: 'BUILD_FAILED' }); } });
  await assert.rejects(() => runReleaseJob({}, dependencies), { code: 'BUILD_FAILED' });
  assert.deepEqual(events, ['failure:BUILD_FAILED', 'cleanup', 'unlock']);
});

test('activation failure rolls back to the previous release', async () => {
  const { dependencies, events } = fixtureDependencies({ activate: async () => { throw Object.assign(new Error('activation failed'), { code: 'ACTIVATION_FAILED' }); } });
  await assert.rejects(() => runReleaseJob({}, dependencies), { code: 'ACTIVATION_FAILED' });
  assert.deepEqual(events, ['rollback:20261021T000000Z-1234567', 'failure:ACTIVATION_FAILED', 'cleanup', 'unlock']);
});

test('rollback failure is the terminal reported failure', async () => {
  const { dependencies, events } = fixtureDependencies({
    verify: async () => { throw Object.assign(new Error('verification failed'), { code: 'VERIFY_FAILED' }); },
    rollback: async () => { throw new Error('rollback unavailable'); },
  });
  await assert.rejects(() => runReleaseJob({}, dependencies), { code: 'ROLLBACK_FAILED' });
  assert.deepEqual(events, ['activate', 'failure:ROLLBACK_FAILED', 'cleanup', 'unlock']);
});

test('stage timeout releases the lock', async () => {
  const { dependencies, events } = fixtureDependencies({ claim: () => new Promise(() => {}) });
  await assert.rejects(() => runReleaseJob({ stageTimeoutMs: 10 }, dependencies), { code: 'RELEASE_STAGE_TIMEOUT' });
  assert.deepEqual(events, ['cleanup', 'unlock']);
});

test('claim increments attempts and stops exhausted requests', async () => {
  const calls = [];
  const api = {
    get: async () => [{ id: 'request-1', status: 'queued', attempt_count: 1 }],
    patch: async (path, body) => { calls.push({ path, body }); return body; },
  };
  const claimed = await claimReleaseRequest(api, 3);
  assert.equal(claimed.attempt_count, 2);
  assert.equal(calls[0].body.status, 'building');
  api.get = async () => [{ id: 'request-2', status: 'queued', attempt_count: 3 }];
  assert.equal(await claimReleaseRequest(api, 3), null);
  assert.equal(calls[1].body.last_error_code, 'RETRY_LIMIT_REACHED');
});

test('a selected release retains published materials and excludes unrelated ready drafts', async () => {
  const materials = [
    { id: 'published', content_id: 'published', workflow_status: 'published' },
    { id: 'selected', content_id: 'selected', workflow_status: 'ready_to_publish' },
    { id: 'other-ready', content_id: 'other-ready', workflow_status: 'ready_to_publish' },
  ];
  const api = {
    get: async (path) => {
      if (path.startsWith('/items/materials?')) return materials;
      if (path.startsWith('/items/site_settings')) return { medical_review_required_risks: ['high'] };
      return [];
    },
  };
  const input = await fetchReleaseInput(api, { id: 'r1', material_ids: ['selected'] }, { sourceCommit: 'abcdef012345' });
  assert.deepEqual(input.snapshotInput.materials.map(({ id }) => id), ['published', 'selected']);
});
