import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { validateAccessConfiguration } from '../bootstrap/access-contract.mjs';

const policiesUrl = new URL('../bootstrap/policies.json', import.meta.url);
const rolesUrl = new URL('../bootstrap/roles.json', import.meta.url);
const modelUrl = new URL('../schema/content-model.json', import.meta.url);

async function loadConfiguration() {
  const [policies, roles, model] = await Promise.all([
    readFile(policiesUrl, 'utf8').then(JSON.parse),
    readFile(rolesUrl, 'utf8').then(JSON.parse),
    readFile(modelUrl, 'utf8').then(JSON.parse),
  ]);
  return { policies, roles, model };
}

test('the committed roles and policies satisfy the approved access matrix', async () => {
  const configuration = await loadConfiguration();
  const result = validateAccessConfiguration(configuration);

  assert.deepEqual(result.problems, []);
});

test('only the owner receives publishing rights initially', async () => {
  const configuration = await loadConfiguration();
  configuration.roles.roles.find(({ key }) => key === 'editor').policies.push('content-publish');
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) => problem.code === 'initial_publisher_unsafe'));
});

test('all human roles require TFA through every app-access policy', async () => {
  const configuration = await loadConfiguration();
  configuration.policies.policies.find(({ key }) => key === 'material-edit').enforceTfa = false;
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) =>
    problem.code === 'tfa_not_enforced' && problem.subject === 'material-edit'));
});

test('the release service cannot access the Directus Studio', async () => {
  const configuration = await loadConfiguration();
  configuration.policies.policies.find(({ key }) => key === 'release-service').appAccess = true;
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) => problem.code === 'service_has_app_access'));
});

test('medical reviewers can only read assigned material payloads', async () => {
  const configuration = await loadConfiguration();
  const medical = configuration.policies.policies.find(({ key }) => key === 'medical-review');
  medical.permissions.find(({ collection }) => collection === 'block_article_step').permissions = {};
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) =>
    problem.code === 'review_scope_missing' && problem.subject === 'medical-review.block_article_step'));
});

test('editors cannot directly set review proof or publication fields', async () => {
  const configuration = await loadConfiguration();
  const edit = configuration.policies.policies.find(({ key }) => key === 'material-edit');
  edit.permissions.find(({ collection, action }) =>
    collection === 'materials' && action === 'update').fields.push('review_fingerprint');
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) =>
    problem.code === 'protected_field_writable' && problem.subject === 'materials.review_fingerprint'));
});

test('non-admin write permissions may not use a wildcard field list', async () => {
  const configuration = await loadConfiguration();
  const edit = configuration.policies.policies.find(({ key }) => key === 'material-edit');
  edit.permissions.find(({ collection, action }) =>
    collection === 'materials' && action === 'update').fields = ['*'];
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) => problem.code === 'write_wildcard_forbidden'));
});

test('permissions must reference declared collections and allowed actions', async () => {
  const configuration = await loadConfiguration();
  configuration.policies.policies.find(({ key }) => key === 'material-edit').permissions.push({
    collection: 'missing_collection',
    action: 'execute',
    fields: ['title'],
  });
  const { problems } = validateAccessConfiguration(configuration);

  assert.ok(problems.some((problem) => problem.code === 'permission_collection_missing'));
  assert.ok(problems.some((problem) => problem.code === 'permission_action_invalid'));
});
