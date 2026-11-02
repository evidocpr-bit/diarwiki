import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { validateContentModel } from '../scripts/validate-model.mjs';

const modelUrl = new URL('../schema/content-model.json', import.meta.url);

async function loadModel() {
  return JSON.parse(await readFile(modelUrl, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

test('the committed content model satisfies the DiarWiki CMS contract', async () => {
  const model = await loadModel();
  const result = validateContentModel(model);

  assert.deepEqual(result.problems, []);
});

test('requires every first-release collection', async () => {
  const model = await loadModel();
  model.collections = model.collections.filter(({ name }) => name !== 'medical_reviews');
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) =>
    problem.code === 'required_collection_missing' && problem.subject === 'medical_reviews'));
});

test('content_id and slug must remain unique and immutable', async () => {
  const model = await loadModel();
  const materials = model.collections.find(({ name }) => name === 'materials');
  const contentId = materials.fields.find(({ name }) => name === 'content_id');
  const slug = materials.fields.find(({ name }) => name === 'slug');
  contentId.immutable = false;
  slug.unique = false;

  const { problems } = validateContentModel(model);
  assert.ok(problems.some((problem) =>
    problem.code === 'identity_field_unsafe' && problem.subject === 'materials.content_id'));
  assert.ok(problems.some((problem) =>
    problem.code === 'identity_field_unsafe' && problem.subject === 'materials.slug'));
});

test('workflow and risk enums preserve the approved values', async () => {
  const model = await loadModel();
  const changed = clone(model);
  changed.enums.workflow_status = ['draft', 'published'];
  changed.enums.risk_level = ['low', 'medium'];

  const { problems } = validateContentModel(changed);
  assert.ok(problems.some((problem) => problem.subject === 'workflow_status'));
  assert.ok(problems.some((problem) => problem.subject === 'risk_level'));
});

test('high-risk publication must require a current medical review', async () => {
  const model = await loadModel();
  model.invariants = model.invariants.filter(({ id }) => id !== 'high-risk-review-required');
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) => problem.code === 'medical_invariant_missing'));
});

test('project review settings always keep high risk mandatory', async () => {
  const model = await loadModel();
  const settings = model.collections.find(({ name }) => name === 'site_settings');
  const field = settings.fields.find(({ name }) => name === 'medical_review_required_risks');
  field.default = ['medium'];
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) =>
    problem.code === 'medical_risk_config_unsafe'
    && problem.subject === 'site_settings.medical_review_required_risks'));
});

test('public media requires a passed security audit', async () => {
  const model = await loadModel();
  const media = model.collections.find(({ name }) => name === 'media_metadata');
  const security = media.fields.find(({ name }) => name === 'security_status');
  assert.equal(security?.enum, 'media_security_status');
  assert.equal(security?.default, 'pending');
  assert.ok(model.invariants.some(({ id }) => id === 'media-security-required'));

  media.fields = media.fields.filter(({ name }) => name !== 'security_status');
  model.invariants = model.invariants.filter(({ id }) => id !== 'media-security-required');
  const { problems } = validateContentModel(model);
  assert.ok(problems.some(({ code }) => code === 'media_security_missing'));
});

test('review fingerprint covers public content, sources, and media checksums', async () => {
  const model = await loadModel();
  model.reviewFingerprint = model.reviewFingerprint.filter((entry) => entry !== 'media.sha256');
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) =>
    problem.code === 'fingerprint_dependency_missing' && problem.subject === 'media.sha256'));
});

test('SHA-256 values are stored verbatim instead of using password-hash fields', async () => {
  const model = await loadModel();
  const locations = [
    ['materials', 'review_fingerprint'],
    ['media_metadata', 'sha256'],
    ['medical_reviews', 'fingerprint'],
    ['releases', 'snapshot_sha256'],
  ];
  for (const [collectionName, fieldName] of locations) {
    const collection = model.collections.find(({ name }) => name === collectionName);
    const field = collection.fields.find(({ name }) => name === fieldName);
    assert.equal(field.type, 'string');
    assert.equal(field.format, 'sha256');
    assert.equal(field.maxLength, 64);
  }
  const media = model.collections.find(({ name }) => name === 'media_metadata');
  media.fields.find(({ name }) => name === 'sha256').type = 'hash';
  const { problems } = validateContentModel(model);
  assert.ok(problems.some(({ code, subject }) =>
    code === 'sha256_storage_unsafe' && subject === 'media_metadata.sha256'));
});

test('rich text blocks require the sanitized editor format', async () => {
  const model = await loadModel();
  const richText = model.collections.find(({ name }) => name === 'block_rich_text');
  richText.fields.find(({ name }) => name === 'content').format = 'raw_html';
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) => problem.code === 'unsafe_rich_text'));
});

test('relations may only target declared collections or allowed Directus collections', async () => {
  const model = await loadModel();
  const materials = model.collections.find(({ name }) => name === 'materials');
  materials.fields.push({
    name: 'broken_relation',
    type: 'relation',
    relation: { kind: 'many-to-one', target: 'missing_collection' },
  });
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) =>
    problem.code === 'relation_target_missing' && problem.subject === 'materials.broken_relation'));
});

test('every block payload keeps an explicit parent material for permission filtering', async () => {
  const model = await loadModel();
  const blockCollection = model.collections.find(({ name }) => name === 'block_article_step');
  blockCollection.fields = blockCollection.fields.filter(({ name }) => name !== 'material');
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) =>
    problem.code === 'block_parent_missing' && problem.subject === 'block_article_step.material'));
});

test('collection and field names are unique', async () => {
  const model = await loadModel();
  model.collections.push(clone(model.collections[0]));
  const materials = model.collections.find(({ name }) => name === 'materials');
  materials.fields.push(clone(materials.fields[0]));
  const { problems } = validateContentModel(model);

  assert.ok(problems.some((problem) => problem.code === 'duplicate_collection'));
  assert.ok(problems.some((problem) => problem.code === 'duplicate_field'));
});
