const REQUIRED_ROLES = ['owner', 'editor', 'medical_reviewer', 'release_service'];
const HUMAN_ROLES = new Set(['owner', 'editor', 'medical_reviewer']);
const VALID_ACTIONS = new Set(['create', 'read', 'update', 'delete']);
const PROTECTED_MATERIAL_FIELDS = new Set([
  'medical_review_status',
  'review_fingerprint',
  'published_at',
]);
const REVIEW_SCOPED_COLLECTIONS = [
  'materials',
  'material_blocks',
  'block_rich_text',
  'block_quick_answer',
  'block_learning_list',
  'block_article_step',
  'block_medical_notice',
  'block_figure',
  'block_flow_diagram',
  'block_source_story',
  'block_sources',
  'block_next_material',
  'block_contact_prompt',
];

const MESSAGES = {
  duplicate_policy: 'ключ политики должен быть уникальным',
  duplicate_role: 'ключ роли должен быть уникальным',
  initial_publisher_unsafe: 'в первой версии право публикации назначается только владельцу',
  permission_action_invalid: 'действие разрешения не поддерживается',
  permission_collection_missing: 'разрешение ссылается на неизвестную коллекцию',
  policy_missing: 'роль ссылается на неизвестную политику',
  protected_field_writable: 'редакционная политика не должна напрямую изменять защищённое поле',
  required_role_missing: 'отсутствует обязательная начальная роль',
  review_scope_missing: 'доступ врача не ограничен назначенным материалом',
  schema_version_unsupported: 'поддерживается только schemaVersion=1',
  service_has_app_access: 'служебная роль не должна получать доступ к панели',
  tfa_not_enforced: 'политика с доступом к панели должна требовать 2FA',
  write_wildcard_forbidden: 'неадминистративная запись должна перечислять разрешённые поля явно',
};

function addProblem(problems, code, subject, detail) {
  problems.push({ code, subject, detail, message: MESSAGES[code] });
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function hasReviewerScope(permission) {
  const serialized = JSON.stringify(permission.permissions ?? {});
  return serialized.includes('$CURRENT_USER') && serialized.includes('assigned_reviewer');
}

export function validateAccessConfiguration({ policies, roles, model }) {
  const problems = [];
  if (policies?.schemaVersion !== 1 || roles?.schemaVersion !== 1) {
    addProblem(problems, 'schema_version_unsupported', 'access');
  }

  const policyList = Array.isArray(policies?.policies) ? policies.policies : [];
  const roleList = Array.isArray(roles?.roles) ? roles.roles : [];
  const policyKeys = policyList.map(({ key }) => key);
  const roleKeys = roleList.map(({ key }) => key);
  const policyMap = new Map(policyList.map((policy) => [policy.key, policy]));

  for (const key of duplicates(policyKeys)) addProblem(problems, 'duplicate_policy', key);
  for (const key of duplicates(roleKeys)) addProblem(problems, 'duplicate_role', key);
  for (const key of REQUIRED_ROLES) {
    if (!roleKeys.includes(key)) addProblem(problems, 'required_role_missing', key);
  }

  const allowedCollections = new Set([
    ...(model?.collections ?? []).map(({ name }) => name),
    ...(model?.allowedSystemRelations ?? []),
    'directus_roles',
    'directus_policies',
    'directus_permissions',
    'directus_access',
    'directus_dashboards',
    'directus_panels',
    'directus_presets',
  ]);

  for (const policy of policyList) {
    if (policy.appAccess && !policy.enforceTfa) {
      addProblem(problems, 'tfa_not_enforced', policy.key);
    }
    if (policy.key === 'release-service' && (policy.appAccess || policy.adminAccess)) {
      addProblem(problems, 'service_has_app_access', policy.key);
    }

    for (const permission of policy.permissions ?? []) {
      const subject = `${policy.key}.${permission.collection}.${permission.action}`;
      if (!allowedCollections.has(permission.collection)) {
        addProblem(problems, 'permission_collection_missing', subject);
      }
      if (!VALID_ACTIONS.has(permission.action)) {
        addProblem(problems, 'permission_action_invalid', subject);
      }
      if (permission.action !== 'read'
        && !policy.adminAccess
        && (!Array.isArray(permission.fields) || permission.fields.includes('*'))) {
        addProblem(problems, 'write_wildcard_forbidden', subject);
      }
    }
  }

  for (const role of roleList) {
    for (const policyKey of role.policies ?? []) {
      if (!policyMap.has(policyKey)) addProblem(problems, 'policy_missing', role.key, policyKey);
    }
    if (HUMAN_ROLES.has(role.key)) {
      for (const policyKey of role.policies ?? []) {
        const policy = policyMap.get(policyKey);
        if (policy?.appAccess && !policy.enforceTfa) {
          addProblem(problems, 'tfa_not_enforced', policy.key);
        }
      }
    }
  }

  for (const role of roleList) {
    if (role.key !== 'owner' && role.policies?.includes('content-publish')) {
      addProblem(problems, 'initial_publisher_unsafe', role.key);
    }
  }

  for (const policyKey of ['material-edit', 'editorial-workflow']) {
    const policy = policyMap.get(policyKey);
    for (const permission of policy?.permissions ?? []) {
      if (permission.collection !== 'materials' || permission.action !== 'update') continue;
      for (const field of permission.fields ?? []) {
        if (PROTECTED_MATERIAL_FIELDS.has(field)) {
          addProblem(problems, 'protected_field_writable', `materials.${field}`, policyKey);
        }
      }
    }
  }

  const medicalPolicy = policyMap.get('medical-review');
  for (const collection of REVIEW_SCOPED_COLLECTIONS) {
    const permission = medicalPolicy?.permissions?.find((candidate) =>
      candidate.collection === collection && candidate.action === 'read');
    if (!permission || !hasReviewerScope(permission)) {
      addProblem(problems, 'review_scope_missing', `medical-review.${collection}`);
    }
  }

  return { problems };
}

export function formatAccessProblems(problems) {
  return problems.map(({ subject, message, detail }) =>
    `- ${subject}${detail ? ` (${detail})` : ''}: ${message}`).join('\n');
}
