import { pathToFileURL } from 'node:url';

import { loadAccessManifest } from './apply-access.mjs';
import { DirectusApi, managedKey } from './directus-api.mjs';

function parseArguments(argv) {
  const result = { tokenEnv: 'DIRECTUS_BOOTSTRAP_TOKEN', url: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--url') result.url = argv[++index];
    else if (argument === '--token-env') result.tokenEnv = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argument}`);
  }
  if (!result.url) throw new Error('Укажите --url <адрес Directus>.');
  return result;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function comparablePermission(permission) {
  return stableValue({
    fields: [...(permission.fields ?? [])].sort((left, right) => left.localeCompare(right, 'en')),
    permissions: permission.permissions ?? {},
    validation: permission.validation ?? {},
    presets: permission.presets ?? {},
  });
}

export async function verifyAccessManifest(api, manifest) {
  const [currentPolicies, currentRoles, currentAccess] = await Promise.all([
    api.get('/policies?limit=-1'),
    api.get('/roles?limit=-1'),
    api.get('/access?limit=-1'),
  ]);
  const policiesByKey = new Map(currentPolicies.map((item) => [managedKey(item.description), item]));
  const rolesByKey = new Map(currentRoles.map((item) => [managedKey(item.description), item]));
  const problems = [];

  for (const expected of manifest.policies.policies) {
    const actual = policiesByKey.get(expected.key);
    if (!actual) {
      problems.push(`политика ${expected.key} отсутствует`);
      continue;
    }
    if (Boolean(actual.app_access) !== expected.appAccess
      || Boolean(actual.admin_access) !== expected.adminAccess
      || Boolean(actual.enforce_tfa) !== expected.enforceTfa) {
      problems.push(`флаги политики ${expected.key} не совпадают`);
    }
    const permissions = await api.get(`/permissions?limit=-1&filter[policy][_eq]=${encodeURIComponent(actual.id)}`);
    const actualKeys = new Set(permissions.map((permission) => `${permission.collection}:${permission.action}`));
    const expectedKeys = new Set(expected.permissions.map((permission) => `${permission.collection}:${permission.action}`));
    if (actualKeys.size !== expectedKeys.size || [...expectedKeys].some((key) => !actualKeys.has(key))) {
      problems.push(`набор разрешений политики ${expected.key} не совпадает`);
    }
    for (const expectedPermission of expected.permissions) {
      const actualPermission = permissions.find((permission) =>
        permission.collection === expectedPermission.collection
        && permission.action === expectedPermission.action);
      if (!actualPermission) continue;
      const actualShape = JSON.stringify(comparablePermission(actualPermission));
      const expectedShape = JSON.stringify(comparablePermission(expectedPermission));
      if (actualShape !== expectedShape) {
        problems.push(`поля или фильтры ${expected.key}.${expectedPermission.collection}.${expectedPermission.action} не совпадают`);
      }
    }
  }

  for (const expected of manifest.roles.roles) {
    const actual = rolesByKey.get(expected.key);
    if (!actual) {
      problems.push(`роль ${expected.key} отсутствует`);
      continue;
    }
    const accessForRole = currentAccess.filter((item) => (item.role?.id ?? item.role) === actual.id);
    const actualPolicyKeys = new Set(accessForRole.map((item) => {
      const id = item.policy?.id ?? item.policy;
      const policy = currentPolicies.find((candidate) => candidate.id === id);
      return managedKey(policy?.description);
    }).filter(Boolean));
    if (actualPolicyKeys.size !== expected.policies.length
      || expected.policies.some((key) => !actualPolicyKeys.has(key))) {
      problems.push(`набор политик роли ${expected.key} не совпадает`);
    }
  }

  return problems;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const token = process.env[options.tokenEnv];
  if (!token) throw new Error(`Переменная ${options.tokenEnv} не задана.`);
  const manifest = await loadAccessManifest();
  const problems = await verifyAccessManifest(new DirectusApi(options.url, token), manifest);
  if (problems.length > 0) {
    console.error('Проверка доступа не пройдена:');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('Роли, политики и наборы разрешений совпадают с контрактом.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
