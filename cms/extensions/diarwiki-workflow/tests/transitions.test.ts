import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITIES,
  WorkflowRuleError,
  assertTransitionAllowed,
  deriveReviewInvalidation,
  requiresMedicalReview,
} from '../src/transitions.ts';

test('editorial policy can submit a draft but cannot publish it', () => {
  assert.doesNotThrow(() => assertTransitionAllowed({
    from: 'draft',
    to: 'editorial_review',
    capabilities: [CAPABILITIES.SUBMIT_EDITORIAL],
    risk: 'low',
  }));

  assert.throws(() => assertTransitionAllowed({
    from: 'ready_to_publish',
    to: 'published',
    capabilities: [CAPABILITIES.SUBMIT_EDITORIAL],
    risk: 'low',
  }), (error: unknown) => error instanceof WorkflowRuleError && error.code === 'CAPABILITY_REQUIRED');
});

test('a high-risk material cannot skip medical review', () => {
  assert.equal(requiresMedicalReview({ risk: 'high' }), true);
  assert.throws(() => assertTransitionAllowed({
    from: 'editorial_review',
    to: 'ready_to_publish',
    capabilities: [CAPABILITIES.EDITORIAL_REVIEW],
    risk: 'high',
    currentReviewValid: false,
  }), (error: unknown) => error instanceof WorkflowRuleError && error.code === 'MEDICAL_REVIEW_REQUIRED');
});

test('project rules can require medical review for lower-risk materials', () => {
  assert.equal(requiresMedicalReview({ risk: 'medium', projectRequiresMedicalReview: true }), true);
  assert.throws(() => assertTransitionAllowed({
    from: 'editorial_review',
    to: 'ready_to_publish',
    capabilities: [CAPABILITIES.EDITORIAL_REVIEW],
    risk: 'medium',
    projectRequiresMedicalReview: true,
    currentReviewValid: false,
  }), { code: 'MEDICAL_REVIEW_REQUIRED' });
});

test('reviewer can approve only a version with a matching fingerprint', () => {
  assert.throws(() => assertTransitionAllowed({
    from: 'medical_review',
    to: 'ready_to_publish',
    capabilities: [CAPABILITIES.MEDICAL_REVIEW],
    risk: 'high',
    currentReviewValid: false,
  }), { code: 'REVIEW_FINGERPRINT_MISMATCH' });

  assert.doesNotThrow(() => assertTransitionAllowed({
    from: 'medical_review',
    to: 'ready_to_publish',
    capabilities: [CAPABILITIES.MEDICAL_REVIEW],
    risk: 'high',
    currentReviewValid: true,
  }));
});

test('only the release service can mark a successful publication; owner may archive', () => {
  assert.doesNotThrow(() => assertTransitionAllowed({
    from: 'ready_to_publish',
    to: 'published',
    capabilities: [CAPABILITIES.SYSTEM],
    risk: 'high',
    currentReviewValid: true,
  }));
  assert.throws(() => assertTransitionAllowed({
    from: 'ready_to_publish',
    to: 'published',
    capabilities: [CAPABILITIES.PUBLISH],
    risk: 'low',
  }), { code: 'CAPABILITY_REQUIRED' });
  assert.doesNotThrow(() => assertTransitionAllowed({
    from: 'published',
    to: 'archived',
    capabilities: [CAPABILITIES.ARCHIVE],
    risk: 'low',
  }));
});

test('unsupported jumps are rejected even for an owner-like capability set', () => {
  assert.throws(() => assertTransitionAllowed({
    from: 'draft',
    to: 'published',
    capabilities: Object.values(CAPABILITIES),
    risk: 'low',
  }), { code: 'TRANSITION_NOT_ALLOWED' });
});

test('a reviewed public change invalidates the medical decision', () => {
  assert.deepEqual(deriveReviewInvalidation({
    workflowStatus: 'ready_to_publish',
    medicalReviewStatus: 'reviewed',
    previousFingerprint: 'aaa',
    nextFingerprint: 'bbb',
  }), {
    workflow_status: 'revision_required',
    medical_review_status: 'revision_required',
    review_fingerprint: null,
  });
});

test('unchanged content and an unreviewed draft are not invalidated', () => {
  assert.equal(deriveReviewInvalidation({
    workflowStatus: 'ready_to_publish',
    medicalReviewStatus: 'reviewed',
    previousFingerprint: 'aaa',
    nextFingerprint: 'aaa',
  }), null);
  assert.equal(deriveReviewInvalidation({
    workflowStatus: 'draft',
    medicalReviewStatus: 'pending',
    previousFingerprint: null,
    nextFingerprint: 'bbb',
  }), null);
});
