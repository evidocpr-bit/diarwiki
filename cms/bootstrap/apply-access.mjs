import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { formatAccessProblems, validateAccessConfiguration } from './access-contract.mjs';
import { DirectusApi, managedDescription, managedKey } from './directus-api.mjs';

const defaultFiles = {
  policies: new URL('./policies.json', import.meta.url),
  roles: new URL('./roles.json', import.meta.url),
  model: new URL('../schema/content-model.json', import.meta.url),
};

export async function loadAccessManifest(files = defaultFiles) {
  const [policies, roles, model] = await Promise.all([
    readFile(files.policies, 'utf8').then(JSON.parse),
    readFile(files.roles, 'utf8').then(JSON.parse),
    readFile(files.model, 'utf8').then(JSON.parse),
  ]);
  const result = validateAccessConfiguration({ policies, roles, model });
  if (result.problems.length > 0) {
    throw new Error(`Матрица доступа не прошла проверку:\n${formatAccessProblems(result.problems)}`);
  }
  return { policies, roles, model };
}

function policyPayload(policy) {
  return {
    name: policy.name,
    description: managedDescription(policy.key, policy.description),
    icon: policy.icon,
    app_access: policy.appAccess,
    admin_access: policy.adminAccess,
    enforce_tfa: policy.enforceTfa,
  };
}

function rolePayload(role) {
  return {
    name: role.name,
    description: managedDescription(role.key, role.description),
    icon: role.icon,
  };
}

function permissionPayload(policyId, permission) {
  return {
    policy: policyId,
    collection: permission.collection,
    action: permission.action,
    permissions: permission.permissions ?? {},
    validation: permission.validation ?? {},
    presets: permission.presets ?? {},
    fields: permission.fields ?? [],
  };
}

async function upsertManagedEntities(api, path, definitions, payloadFor) {
  const current = await api.get(`/${path}?limit=-1`);
  const byKey = new Map(current.map((item) => [managedKey(item.description), item]));
  const result = new Map();

  for (const definition of definitions) {
    const existing = byKey.get(definition.key);
    const saved = existing
      ? await api.patch(`/${path}/${existing.id}`, payloadFor(definition))
      : await api.post(`/${path}`, payloadFor(definition));
    result.set(definition.key, saved);
  }
  return result;
}

async function reconcilePermissions(api, policyDefinitions, savedPolicies) {
  for (const policy of policyDefinitions) {
    const policyId = savedPolicies.get(policy.key).id;
    const current = await api.get(`/permissions?limit=-1&filter[policy][_eq]=${encodeURIComponent(policyId)}`);
    const desiredKeys = new Set();

    for (const permission of policy.permissions ?? []) {
      const key = `${permission.collection}:${permission.action}`;
      desiredKeys.add(key);
      const existing = current.find((item) => `${item.collection}:${item.action}` === key);
      const payload = permissionPayload(policyId, permission);
      if (existing) await api.patch(`/permissions/${existing.id}`, payload);
      else await api.post('/permissions', payload);
    }

    for (const existing of current) {
      const key = `${existing.collection}:${existing.action}`;
      if (!desiredKeys.has(key)) await api.delete(`/permissions/${existing.id}`);
    }
  }
}

async function reconcileRolePolicies(api, roleDefinitions, savedRoles, savedPolicies) {
  const current = await api.get('/access?limit=-1');
  for (const role of roleDefinitions) {
    const roleId = savedRoles.get(role.key).id;
    const desiredPolicyIds = new Set(role.policies.map((key) => savedPolicies.get(key).id));
    const existing = current.filter((access) => access.role === roleId || access.role?.id === roleId);

    for (const policyId of desiredPolicyIds) {
      const found = existing.some((access) => (access.policy?.id ?? access.policy) === policyId);
      if (!found) await api.post('/access', { role: roleId, policy: policyId });
    }
    for (const access of existing) {
      const policyId = access.policy?.id ?? access.policy;
      if (!desiredPolicyIds.has(policyId)) await api.delete(`/access/${access.id}`);
    }
  }
}

export async function applyAccessManifest(api, manifest) {
  const savedPolicies = await upsertManagedEntities(
    api,
    'policies',
    manifest.policies.policies,
    policyPayload,
  );
  const savedRoles = await upsertManagedEntities(
    api,
    'roles',
    manifest.roles.roles,
    rolePayload,
  );
  await reconcilePermissions(api, manifest.policies.policies, savedPolicies);
  await reconcileRolePolicies(api, manifest.roles.roles, savedRoles, savedPolicies);
  return { savedPolicies, savedRoles };
}

function parseArguments(argv) {
  const result = { apply: false, tokenEnv: 'DIRECTUS_BOOTSTRAP_TOKEN', url: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') result.apply = true;
    else if (argument === '--url') result.url = argv[++index];
    else if (argument === '--token-env') result.tokenEnv = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${argument}`);
  }
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await loadAccessManifest();
  const permissionCount = manifest.policies.policies.reduce(
    (total, policy) => total + (policy.permissions?.length ?? 0),
    0,
  );
  console.log(`Матрица доступа: ${manifest.roles.roles.length} роли, ${manifest.policies.policies.length} политик, ${permissionCount} разрешений.`);

  if (!options.apply) {
    console.log('Предварительная проверка завершена. Для применения укажите --apply --url <адрес>.');
    return;
  }
  if (!options.url) throw new Error('Для применения укажите --url <адрес Directus>.');
  const token = process.env[options.tokenEnv];
  if (!token) throw new Error(`Переменная ${options.tokenEnv} не задана.`);

  const api = new DirectusApi(options.url, token);
  await applyAccessManifest(api, manifest);
  console.log('Управляемые роли, политики и разрешения применены. Запустите verify-access.mjs.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
