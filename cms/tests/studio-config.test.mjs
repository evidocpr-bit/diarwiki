import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadStudioManifest, validateStudioConfiguration } from '../bootstrap/apply-studio.mjs';

const files = {
  model: new URL('../schema/content-model.json', import.meta.url),
  studio: new URL('../schema/studio-schema.json', import.meta.url),
  presets: new URL('../bootstrap/presets.json', import.meta.url),
  dashboards: new URL('../bootstrap/dashboards.json', import.meta.url),
  roles: new URL('../bootstrap/roles.json', import.meta.url),
};

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('the committed Russian Studio configuration is internally consistent', async () => {
  const manifest = await loadStudioManifest(files);
  assert.equal(manifest.studio.projectSettings.default_language, 'ru-RU');
});

test('every project collection has Russian navigation metadata', async () => {
  const [model, studio, presets, dashboards, roles] = await Promise.all(Object.values(files).map(readJson));
  const configured = new Set(studio.collections.map(({ collection }) => collection));
  const missing = model.collections.map(({ name }) => name).filter((name) => !configured.has(name));
  assert.deepEqual(missing, []);
  assert.deepEqual(validateStudioConfiguration({ model, studio, presets, dashboards, roles }).problems, []);
});

test('editorial queues cover every actionable workflow state', async () => {
  const presets = await readJson(files.presets);
  const states = new Set(presets.presets
    .filter(({ collection }) => collection === 'materials')
    .flatMap(({ filter }) => filter?.workflow_status?._in ?? [filter?.workflow_status?._eq].filter(Boolean)));
  for (const state of [
    'draft',
    'editorial_review',
    'changes_requested',
    'medical_review',
    'revision_required',
    'ready_to_publish',
    'publish_failed',
    'published',
  ]) assert.equal(states.has(state), true, `missing queue for ${state}`);
});

test('reviewer queue is restricted to the current reviewer', async () => {
  const presets = await readJson(files.presets);
  const assigned = presets.presets.find(({ key }) => key === 'reviewer-assigned-materials');
  assert.ok(assigned.roles.includes('medical_reviewer'));
  assert.equal(assigned.filter.assigned_reviewer._eq, '$CURRENT_USER');
  assert.deepEqual(assigned.filter.workflow_status._in, ['medical_review', 'revision_required']);
});

test('preset identities are unique and reference declared roles', async () => {
  const [model, studio, presets, dashboards, roles] = await Promise.all(Object.values(files).map(readJson));
  const result = validateStudioConfiguration({ model, studio, presets, dashboards, roles });
  assert.equal(result.problems.some(({ code }) => code === 'duplicate_preset'), false);
  assert.equal(result.problems.some(({ code }) => code === 'role_missing'), false);
});

test('dashboard panels fit the 24-column grid and use supported types', async () => {
  const dashboards = await readJson(files.dashboards);
  for (const dashboard of dashboards.dashboards) {
    for (const panel of dashboard.panels) {
      assert.ok(panel.position_x >= 1);
      assert.ok(panel.position_x + panel.width - 1 <= 24);
      assert.ok(['metric', 'list'].includes(panel.type));
    }
  }
});

test('unknown field metadata is rejected', async () => {
  const [model, studio, presets, dashboards, roles] = await Promise.all(Object.values(files).map(readJson));
  studio.fields.push({ collection: 'materials', field: 'does_not_exist', interface: 'input' });
  const { problems } = validateStudioConfiguration({ model, studio, presets, dashboards, roles });
  assert.ok(problems.some(({ code, subject }) =>
    code === 'field_missing' && subject === 'materials.does_not_exist'));
});
