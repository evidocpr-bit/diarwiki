import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_COLLECTIONS = [
  'materials',
  'material_blocks',
  'material_sources',
  'material_relations',
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
  'sources',
  'library_items',
  'pages',
  'navigation',
  'site_settings',
  'media_metadata',
  'review_assignments',
  'medical_reviews',
  'editorial_comments',
  'release_requests',
  'releases',
  'redirects',
];

const REQUIRED_ENUMS = new Map([
  ['workflow_status', [
    'draft',
    'editorial_review',
    'changes_requested',
    'medical_review',
    'revision_required',
    'ready_to_publish',
    'published',
    'publish_failed',
    'archived',
  ]],
  ['risk_level', ['low', 'medium', 'high']],
  ['block_type', [
    'rich_text',
    'quick_answer',
    'learning_list',
    'article_step',
    'medical_notice',
    'figure',
    'flow_diagram',
    'source_story',
    'sources',
    'next_material',
    'contact_prompt',
  ]],
]);

const REQUIRED_FINGERPRINT_DEPENDENCIES = [
  'materials.public_fields',
  'material_blocks.ordered_payload',
  'sources.resolved_public_fields',
  'media.sha256',
  'media.public_metadata',
  'medical_notices.payload',
];

const BLOCK_PAYLOAD_COLLECTIONS = [
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
  block_parent_missing: 'блок должен явно ссылаться на родительский материал для фильтрации прав',
  duplicate_collection: 'имя коллекции должно быть уникальным',
  duplicate_field: 'имя поля внутри коллекции должно быть уникальным',
  enum_contract_changed: 'перечень значений перечисления не соответствует утверждённому контракту',
  enum_missing: 'для enum-поля отсутствует объявленное перечисление',
  fingerprint_dependency_missing: 'из отпечатка медицинской проверки исключена обязательная зависимость',
  identity_field_unsafe: 'стабильный идентификатор должен быть обязательным, уникальным и неизменяемым',
  invalid_model: 'корневой объект модели имеет неверную структуру',
  medical_invariant_missing: 'отсутствует запрет публикации материала высокого риска без действующей рецензии',
  medical_risk_config_unsafe: 'настройка обязательной медицинской проверки должна всегда включать высокий риск',
  media_security_missing: 'для публичных медиа обязательна серверная проверка безопасности',
  primary_key_missing: 'коллекция должна иметь обязательный уникальный неизменяемый первичный ключ',
  relation_target_missing: 'связь указывает на неизвестную коллекцию',
  required_collection_missing: 'отсутствует коллекция первой версии',
  schema_version_unsupported: 'поддерживается только schemaVersion=1',
  sha256_storage_unsafe: 'SHA-256 должен храниться как точная строка из 64 символов, а не как поле пароля',
  unsafe_rich_text: 'публичный форматированный текст должен проходить разрешённую санитарную обработку',
};

function addProblem(problems, code, subject, detail) {
  problems.push({ code, subject, detail, message: MESSAGES[code] });
}

function sameValues(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function fieldMap(collection) {
  return new Map((collection.fields ?? []).map((field) => [field.name, field]));
}

function targetsFor(field) {
  const target = field.relation?.target;
  if (Array.isArray(target)) return target;
  return target ? [target] : [];
}

export function validateContentModel(model) {
  const problems = [];
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    addProblem(problems, 'invalid_model', 'root');
    return { problems };
  }
  if (model.schemaVersion !== 1) addProblem(problems, 'schema_version_unsupported', 'schemaVersion');

  const collections = Array.isArray(model.collections) ? model.collections : [];
  const names = collections.map(({ name }) => name);
  const nameSet = new Set(names);

  for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
    addProblem(problems, 'duplicate_collection', name);
  }
  for (const name of REQUIRED_COLLECTIONS) {
    if (!nameSet.has(name)) addProblem(problems, 'required_collection_missing', name);
  }

  const allowedTargets = new Set([
    ...nameSet,
    ...(Array.isArray(model.allowedSystemRelations) ? model.allowedSystemRelations : []),
  ]);

  for (const collection of collections) {
    const fields = Array.isArray(collection.fields) ? collection.fields : [];
    const fieldNames = fields.map(({ name }) => name);
    for (const name of new Set(fieldNames.filter((name, index) => fieldNames.indexOf(name) !== index))) {
      addProblem(problems, 'duplicate_field', `${collection.name}.${name}`);
    }

    const primaryKey = fields.find(({ primaryKey }) => primaryKey === true);
    if (!primaryKey || !primaryKey.required || !primaryKey.unique || !primaryKey.immutable) {
      addProblem(problems, 'primary_key_missing', collection.name);
    }

    for (const field of fields) {
      if (field.type === 'enum' && !Array.isArray(model.enums?.[field.enum])) {
        addProblem(problems, 'enum_missing', `${collection.name}.${field.name}`, field.enum);
      }
      if (field.type === 'relation') {
        for (const target of targetsFor(field)) {
          if (!allowedTargets.has(target)) {
            addProblem(problems, 'relation_target_missing', `${collection.name}.${field.name}`, target);
          }
        }
      }
      if (field.format === 'raw_html') {
        addProblem(problems, 'unsafe_rich_text', `${collection.name}.${field.name}`);
      }
    }
  }

  for (const [name, expected] of REQUIRED_ENUMS) {
    if (!sameValues(model.enums?.[name], expected)) {
      addProblem(problems, 'enum_contract_changed', name);
    }
  }

  const materials = collections.find(({ name }) => name === 'materials');
  if (materials) {
    const fields = fieldMap(materials);
    for (const name of ['content_id', 'slug']) {
      const field = fields.get(name);
      if (!field || !field.required || !field.unique || !field.immutable) {
        addProblem(problems, 'identity_field_unsafe', `materials.${name}`);
      }
    }
  }

  const richText = collections.find(({ name }) => name === 'block_rich_text');
  const richTextContent = richText ? fieldMap(richText).get('content') : undefined;
  if (!richTextContent || richTextContent.format !== 'sanitized_rich_text') {
    addProblem(problems, 'unsafe_rich_text', 'block_rich_text.content');
  }

  for (const collectionName of BLOCK_PAYLOAD_COLLECTIONS) {
    const collection = collections.find(({ name }) => name === collectionName);
    const material = collection ? fieldMap(collection).get('material') : undefined;
    if (!material
      || material.type !== 'relation'
      || !material.required
      || material.relation?.target !== 'materials') {
      addProblem(problems, 'block_parent_missing', `${collectionName}.material`);
    }
  }

  if (!Array.isArray(model.invariants)
    || !model.invariants.some(({ id }) => id === 'high-risk-review-required')) {
    addProblem(problems, 'medical_invariant_missing', 'high-risk-review-required');
  }

  const siteSettings = collections.find(({ name }) => name === 'site_settings');
  const requiredRisks = siteSettings
    ? fieldMap(siteSettings).get('medical_review_required_risks')
    : undefined;
  if (!requiredRisks
    || requiredRisks.type !== 'json'
    || !requiredRisks.required
    || !Array.isArray(requiredRisks.default)
    || !requiredRisks.default.includes('high')) {
    addProblem(
      problems,
      'medical_risk_config_unsafe',
      'site_settings.medical_review_required_risks',
    );
  }

  const fingerprint = new Set(Array.isArray(model.reviewFingerprint) ? model.reviewFingerprint : []);
  for (const dependency of REQUIRED_FINGERPRINT_DEPENDENCIES) {
    if (!fingerprint.has(dependency)) {
      addProblem(problems, 'fingerprint_dependency_missing', dependency);
    }
  }

  const media = collections.find(({ name }) => name === 'media_metadata');
  const securityStatus = media ? fieldMap(media).get('security_status') : undefined;
  const hasMediaInvariant = Array.isArray(model.invariants)
    && model.invariants.some(({ id }) => id === 'media-security-required');
  if (!securityStatus
    || securityStatus.type !== 'enum'
    || securityStatus.enum !== 'media_security_status'
    || securityStatus.default !== 'pending'
    || !hasMediaInvariant) {
    addProblem(problems, 'media_security_missing', 'media_metadata.security_status');
  }

  for (const [collectionName, fieldName] of [
    ['materials', 'review_fingerprint'],
    ['media_metadata', 'sha256'],
    ['medical_reviews', 'fingerprint'],
    ['releases', 'snapshot_sha256'],
    ['releases', 'archive_sha256'],
  ]) {
    const collection = collections.find(({ name }) => name === collectionName);
    const field = collection ? fieldMap(collection).get(fieldName) : undefined;
    if (!field || field.type !== 'string' || field.format !== 'sha256' || field.maxLength !== 64) {
      addProblem(problems, 'sha256_storage_unsafe', `${collectionName}.${fieldName}`);
    }
  }

  return { problems };
}

export function formatModelProblems(problems) {
  return problems.map(({ subject, message, detail }) =>
    `- ${subject}${detail ? ` (${detail})` : ''}: ${message}`).join('\n');
}

async function main() {
  const [modelPath] = process.argv.slice(2);
  if (!modelPath) throw new Error('Укажите путь к content-model.json');
  const model = JSON.parse(await readFile(modelPath, 'utf8'));
  const result = validateContentModel(model);
  if (result.problems.length > 0) {
    console.error('Модель содержимого CMS не прошла проверку:');
    console.error(formatModelProblems(result.problems));
    process.exitCode = 1;
    return;
  }
  console.log('Модель содержимого CMS прошла контрактную проверку.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
