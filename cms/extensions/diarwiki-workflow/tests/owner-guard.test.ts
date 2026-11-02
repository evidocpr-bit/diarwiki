import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OwnerGuardError,
  assertLastOwnerIsPreserved,
  assertNoSelfElevation,
  assertOwnersRemain,
  capabilitiesFromPolicyKeys,
} from '../src/owner-guard.ts';

test('last active owner cannot be suspended, demoted or deleted', () => {
  for (const operation of ['suspend', 'demote', 'delete'] as const) {
    assert.throws(() => assertLastOwnerIsPreserved({
      activeOwnerIds: ['owner-1'],
      targetUserId: 'owner-1',
      operation,
    }), (error: unknown) => error instanceof OwnerGuardError && error.code === 'LAST_OWNER_REQUIRED');
  }
});

test('one owner may be changed when another active owner remains', () => {
  assert.doesNotThrow(() => assertLastOwnerIsPreserved({
    activeOwnerIds: ['owner-1', 'owner-2'],
    targetUserId: 'owner-1',
    operation: 'suspend',
  }));
});

test('bulk mutation cannot remove every active owner at once', () => {
  assert.throws(() => assertOwnersRemain({
    activeOwnerIds: ['owner-1', 'owner-2'],
    affectedUserIds: ['owner-1', 'owner-2'],
    operation: 'delete',
  }), { code: 'LAST_OWNER_REQUIRED' });
  assert.doesNotThrow(() => assertOwnersRemain({
    activeOwnerIds: ['owner-1', 'owner-2'],
    affectedUserIds: ['owner-1'],
    operation: 'delete',
  }));
});

test('a user cannot grant a critical policy to themselves', () => {
  assert.throws(() => assertNoSelfElevation({
    actorUserId: 'editor-1',
    targetUserId: 'editor-1',
    beforePolicyKeys: ['material-edit'],
    afterPolicyKeys: ['material-edit', 'content-publish'],
    criticalPolicyKeys: ['owner-admin', 'content-publish'],
  }), { code: 'SELF_ELEVATION_FORBIDDEN' });
});

test('policy keys produce workflow capabilities without hard-coding a role', () => {
  assert.deepEqual(capabilitiesFromPolicyKeys(['editorial-workflow']), [
    'submit_editorial',
    'editorial_review',
  ]);
  assert.deepEqual(new Set(capabilitiesFromPolicyKeys(['content-publish'])), new Set([
    'publish',
    'archive',
  ]));
  assert.equal(capabilitiesFromPolicyKeys(['owner-admin']).includes('system_workflow'), false);
  assert.equal(capabilitiesFromPolicyKeys(['release-service']).includes('system_workflow'), true);
});
