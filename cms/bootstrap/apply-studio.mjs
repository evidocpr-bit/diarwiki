import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { DirectusApi, managedKey } from './directus-api.mjs';

const defaultFiles = {
  model: new URL('../schema/content-model.json', import.meta.url),
  studio: new URL('../schema/studio-schema.json', import.meta.url),
  presets: new URL('./presets.json', import.meta.url),
  dashboards: new URL('./dashboards.json', import.meta.url),
  roles: new URL('./roles.json', import.meta.url),
};

const SUPPORTED_PANEL_TYPES = new Set(['metric', 'list']);

function addProblem(problems, code, subject, detail) {
  problems.push({ code, subject, detail });
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function workflowValues(filter) {
  if (!filter || typeof filter !== 'object') return [];
  const result = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'workflow_status' && value && typeof value === 'object') {
      if (typeof value._eq === 'string') result.push(value._eq);
      if (Array.isArray(value._in)) result.push(...value._in);
    } else if (Array.isArray(value)) {
      for (const item of value) result.push(...workflowValues(item));
    } else if (value && typeof value === 'object') {
      result.push(...workflowValues(value));
    }
  }
  return result;
}

export function validateStudioConfiguration({ model, studio, presets, dashboards, roles }) {
  const problems = [];
  for (const [name, manifest] of Object.entries({ model, studio, presets, dashboards, roles })) {
    if (manifest?.schemaVersion !== 1) addProblem(problems, 'schema_version_unsupported', name);
  }

  const collectionMap = new Map((model.collections ?? []).map((collection) => [collection.name, collection]));
  const roleKeys = new Set((roles.roles ?? []).map(({ key }) => key));
  const workflowStatuses = new Set(model.enums?.workflow_status ?? []);
  const configuredCollections = studio.collections ?? [];

  for (const name of duplicateValues(configuredCollections.map(({ collection }) => collection))) {
    addProblem(problems, 'duplicate_collection_meta', name);
  }
  for (const [name] of collectionMap) {
    const config = configuredCollections.find(({ collection }) => collection === name);
    if (!config || typeof config.label !== 'string' || config.label.trim() === '') {
      addProblem(problems, 'collection_meta_missing', name);
    }
  }
  for (const config of configuredCollections) {
    if (!collectionMap.has(config.collection)) addProblem(problems, 'collection_missing', config.collection);
  }

  for (const field of studio.fields ?? []) {
    const collection = collectionMap.get(field.collection);
    if (!collection?.fields?.some(({ name }) => name === field.field)) {
      addProblem(problems, 'field_missing', `${field.collection}.${field.field}`);
    }
  }

  const presetList = presets.presets ?? [];
  for (const key of duplicateValues(presetList.map(({ key }) => key))) {
    addProblem(problems, 'duplicate_preset', key);
  }
  const presetIdentities = [];
  for (const preset of presetList) {
    if (!collectionMap.has(preset.collection)) addProblem(problems, 'collection_missing', `preset:${preset.key}`);
    for (const role of preset.roles ?? []) {
      if (!roleKeys.has(role)) addProblem(problems, 'role_missing', `${preset.key}:${role}`);
      presetIdentities.push(`${role}:${preset.collection}:${preset.bookmark ?? '<default>'}`);
    }
    for (const status of workflowValues(preset.filter)) {
      if (!workflowStatuses.has(status)) addProblem(problems, 'workflow_status_unknown', `${preset.key}:${status}`);
    }
  }
  for (const identity of duplicateValues(presetIdentities)) addProblem(problems, 'duplicate_preset', identity);

  for (const dashboard of dashboards.dashboards ?? []) {
    for (const role of dashboard.roles ?? []) {
      if (!roleKeys.has(role)) addProblem(problems, 'role_missing', `${dashboard.key}:${role}`);
    }
    for (const key of duplicateValues((dashboard.panels ?? []).map(({ key }) => key))) {
      addProblem(problems, 'duplicate_panel', `${dashboard.key}:${key}`);
    }
    for (const panel of dashboard.panels ?? []) {
      const subject = `${dashboard.key}:${panel.key}`;
      if (!SUPPORTED_PANEL_TYPES.has(panel.type)) addProblem(problems, 'panel_type_unsupported', subject);
      if (!collectionMap.has(panel.options?.collection)) addProblem(problems, 'collection_missing', subject);
      if (!Number.isInteger(panel.position_x) || !Number.isInteger(panel.width)
        || panel.position_x < 1 || panel.width < 1 || panel.position_x + panel.width - 1 > 24) {
        addProblem(problems, 'panel_grid_invalid', subject);
      }
      for (const status of workflowValues(panel.options?.filter)) {
        if (!workflowStatuses.has(status)) addProblem(problems, 'workflow_status_unknown', `${subject}:${status}`);
      }
    }
  }
  return { problems };
}

function formatProblems(problems) {
  return problems.map(({ code, subject, detail }) =>
    `- ${subject}: ${code}${detail ? ` (${detail})` : ''}`).join('\n');
}

export async function loadStudioManifest(files = defaultFiles) {
  const entries = await Promise.all(Object.entries(files).map(async ([name, url]) => [
    name,
    JSON.parse(await readFile(url, 'utf8')),
  ]));
  const manifest = Object.fromEntries(entries);
  const result = validateStudioConfiguration(manifest);
  if (result.problems.length > 0) {
    throw new Error(`Конфигурация панели не прошла проверку:\n${formatProblems(result.problems)}`);
  }
  return manifest;
}

function stableUuid(scope, key) {
  const hex = createHash('sha256').update(`diarwiki:${scope}:${key}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function collectionPayload(config) {
  const { collection, label, ...meta } = config;
  return {
    meta: {
      ...meta,
      translations: [{ language: 'ru-RU', translation: label, singular: label, plural: label }],
    },
  };
}

function fieldPayload(config) {
  const { collection, field, label, ...meta } = config;
  return {
    meta: {
      ...meta,
      translations: [{ language: 'ru-RU', translation: label }],
    },
  };
}

async function resolveManagedRoles(api) {
  const rows = await api.get('/roles?limit=-1');
  return new Map(rows.map((role) => [managedKey(role.description), role]));
}

async function applyCollectionMeta(api, studio) {
  for (const config of studio.collections) {
    await api.patch(`/collections/${encodeURIComponent(config.collection)}`, collectionPayload(config));
  }
  for (const config of studio.fields) {
    await api.patch(
      `/fields/${encodeURIComponent(config.collection)}/${encodeURIComponent(config.field)}`,
      fieldPayload(config),
    );
  }
  await api.patch('/settings', studio.projectSettings);
}

async function applyPresets(api, definitions, roleMap) {
  const current = await api.get('/presets?limit=-1');
  for (const definition of definitions) {
    for (const roleKey of definition.roles) {
      const role = roleMap.get(roleKey);
      if (!role) throw new Error(`Управляемая роль ${roleKey} не найдена. Сначала примените apply-access.mjs.`);
      const existing = current.find((preset) =>
        (preset.role?.id ?? preset.role) === role.id
        && preset.user == null
        && preset.collection === definition.collection
        && (preset.bookmark ?? null) === (definition.bookmark ?? null));
      const { key, roles, ...preset } = definition;
      const payload = { ...preset, role: role.id, user: null };
      if (existing) await api.patch(`/presets/${existing.id}`, payload);
      else await api.post('/presets', payload);
    }
  }
}

async function applyDashboards(api, definitions) {
  const [currentDashboards, currentPanels] = await Promise.all([
    api.get('/dashboards?limit=-1'),
    api.get('/panels?limit=-1'),
  ]);
  for (const definition of definitions) {
    const dashboardId = stableUuid('dashboard', definition.key);
    const { key, roles, panels, ...dashboard } = definition;
    const dashboardPayload = { id: dashboardId, ...dashboard };
    if (currentDashboards.some(({ id }) => id === dashboardId)) {
      await api.patch(`/dashboards/${dashboardId}`, dashboardPayload);
    } else {
      await api.post('/dashboards', dashboardPayload);
    }
    for (const panelDefinition of panels) {
      const panelId = stableUuid(`panel:${key}`, panelDefinition.key);
      const { key: panelKey, ...panel } = panelDefinition;
      const payload = { id: panelId, dashboard: dashboardId, ...panel };
      if (currentPanels.some(({ id }) => id === panelId)) await api.patch(`/panels/${panelId}`, payload);
      else await api.post('/panels', payload);
    }
  }
}

export async function applyStudioManifest(api, manifest) {
  const roleMap = await resolveManagedRoles(api);
  await applyCollectionMeta(api, manifest.studio);
  await applyPresets(api, manifest.presets.presets, roleMap);
  await applyDashboards(api, manifest.dashboards.dashboards);
}

function parseArguments(argv) {
  const options = { apply: false, url: undefined, tokenEnv: 'DIRECTUS_BOOTSTRAP_TOKEN' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--apply') options.apply = true;
    else if (argv[index] === '--url') options.url = argv[++index];
    else if (argv[index] === '--token-env') options.tokenEnv = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await loadStudioManifest();
  const panelCount = manifest.dashboards.dashboards.reduce((sum, dashboard) => sum + dashboard.panels.length, 0);
  console.log(`Панель: ${manifest.studio.collections.length} коллекций, ${manifest.studio.fields.length} настроенных полей, ${manifest.presets.presets.length} представлений, ${panelCount} панелей.`);
  if (!options.apply) {
    console.log('Предварительная проверка завершена. Для применения укажите --apply --url <адрес>.');
    return;
  }
  if (!options.url) throw new Error('Для применения укажите --url <адрес Directus>.');
  const token = process.env[options.tokenEnv];
  if (!token) throw new Error(`Переменная ${options.tokenEnv} не задана.`);
  await applyStudioManifest(new DirectusApi(options.url, token), manifest);
  console.log('Русская структура Directus Studio применена. Проверьте её тестовыми ролями на стенде.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
