import { createError } from '@directus/errors';
import { defineHook } from '@directus/extensions-sdk';

import {
  assertNoSelfElevation,
  assertOwnersRemain,
  capabilitiesFromPolicyKeys,
  OwnerGuardError,
} from './owner-guard.ts';
import { createReviewFingerprint, type ReviewSet } from './review-fingerprint.ts';
import {
  assertTransitionAllowed,
  CAPABILITIES,
  deriveReviewInvalidation,
  type RiskLevel,
  type WorkflowStatus,
  WorkflowRuleError,
} from './transitions.ts';

type Database = any;
type Accountability = {
  user?: string | null;
  role?: string | null;
  admin?: boolean;
  policies?: string[];
} | null | undefined;
type Logger = { info: (data: unknown, message?: string) => void; warn: (data: unknown, message?: string) => void };
type EventMeta = { collection?: string; key?: string; keys?: string[] };
type Payload = Record<string, any>;

const RuleViolation = createError<{ rule: string; explanation: string }>(
  'DIARWIKI_WORKFLOW_RULE',
  ({ explanation }) => explanation,
  422,
);

const BLOCK_COLLECTIONS: Readonly<Record<string, string>> = Object.freeze({
  rich_text: 'block_rich_text',
  quick_answer: 'block_quick_answer',
  learning_list: 'block_learning_list',
  article_step: 'block_article_step',
  medical_notice: 'block_medical_notice',
  figure: 'block_figure',
  flow_diagram: 'block_flow_diagram',
  source_story: 'block_source_story',
  sources: 'block_sources',
  next_material: 'block_next_material',
  contact_prompt: 'block_contact_prompt',
});

const DEPENDENCY_COLLECTIONS = new Set([
  'material_blocks',
  'material_sources',
  'material_relations',
  'sources',
  'media_metadata',
  ...Object.values(BLOCK_COLLECTIONS),
]);

const PROTECTED_MATERIAL_FIELDS = new Set([
  'medical_review_status',
  'review_fingerprint',
  'published_at',
]);

const CRITICAL_POLICY_KEYS = ['owner-admin', 'content-publish'];

function idsFromMeta(meta: EventMeta) {
  return [...new Set([...(meta.keys ?? []), ...(meta.key ? [meta.key] : [])])];
}

function policyKey(description: unknown) {
  return typeof description === 'string'
    ? description.match(/^\[diarwiki:([a-z\d_-]+)\]/iu)?.[1]
    : undefined;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function throwRule(error: unknown): never {
  if (error instanceof WorkflowRuleError || error instanceof OwnerGuardError) {
    throw new RuleViolation({ rule: error.code, explanation: error.message });
  }
  throw error;
}

async function loadPolicyKeys(database: Database, accountability: Accountability) {
  if (!accountability) return [];
  const explicitPolicyIds = asArray(accountability.policies);
  const rows = await database('directus_access as access')
    .join('directus_policies as policy', 'policy.id', 'access.policy')
    .select('policy.description')
    .where((builder: any) => {
      if (accountability.user) builder.orWhere('access.user', accountability.user);
      if (accountability.role) builder.orWhere('access.role', accountability.role);
      if (explicitPolicyIds.length > 0) builder.orWhereIn('access.policy', explicitPolicyIds);
    });
  return [...new Set(rows.map((row: Payload) => policyKey(row.description)).filter(Boolean))] as string[];
}

async function loadReviewSet(database: Database, materialId: string): Promise<ReviewSet> {
  const material = await database('materials').where({ id: materialId }).first();
  if (!material) throw new WorkflowRuleError('MATERIAL_NOT_FOUND', 'Материал не найден.');

  const links = await database('material_blocks')
    .where({ material: materialId })
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  const blocks: Payload[] = [];
  const mediaIds = new Set<string>();
  const embeddedSourceIds = new Set<string>();

  for (const link of links) {
    const collection = BLOCK_COLLECTIONS[link.block_type];
    if (!collection) throw new WorkflowRuleError('BLOCK_TYPE_UNKNOWN', `Неизвестный тип блока: ${link.block_type}.`);
    const item = await database(collection).where({ id: link.item }).first();
    if (!item) throw new WorkflowRuleError('BLOCK_ITEM_MISSING', `Содержимое блока ${link.id} не найдено.`);
    blocks.push({ id: link.id, sort_order: link.sort_order, block_type: link.block_type, item });
    if (typeof item.media === 'string') mediaIds.add(item.media);
    if (typeof item.source === 'string') embeddedSourceIds.add(item.source);
  }

  const sourceRows = await database('material_sources as link')
    .join('sources as source', 'source.id', 'link.source')
    .select('source.*', 'link.note as usage_note')
    .where('link.material', materialId);
  const presentSources = new Set(sourceRows.map((source: Payload) => source.id));
  const missingEmbedded = [...embeddedSourceIds].filter((id) => !presentSources.has(id));
  if (missingEmbedded.length > 0) {
    sourceRows.push(...await database('sources').whereIn('id', missingEmbedded));
  }

  const related = await database('material_relations as link')
    .join('materials as related', 'related.id', 'link.related_material')
    .select('related.content_id', 'related.title', 'related.slug')
    .where('link.material', materialId);
  const media = mediaIds.size > 0
    ? await database('media_metadata').whereIn('id', [...mediaIds])
    : [];

  return { material, blocks, sources: sourceRows, media, related };
}

async function reviewIsCurrent(database: Database, materialId: string, fingerprint: string) {
  const approved = await database('medical_reviews')
    .where({ material: materialId, fingerprint, decision: 'approved' })
    .orderBy('reviewed_at', 'desc')
    .first();
  return Boolean(approved);
}

async function requiredRiskLevels(database: Database) {
  const settings = await database('site_settings').select('medical_review_required_risks').first();
  const raw = settings?.medical_review_required_risks ?? ['high'];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : ['high'];
    } catch {
      return ['high'];
    }
  }
  return ['high'];
}

async function invalidateMaterial(database: Database, materialId: string, logger: Logger, force = false) {
  const material = await database('materials').where({ id: materialId }).first();
  if (!material || material.medical_review_status !== 'reviewed' || !material.review_fingerprint) return;
  const nextFingerprint = force
    ? `changed:${material.review_fingerprint}`
    : createReviewFingerprint(await loadReviewSet(database, materialId));
  const changes = deriveReviewInvalidation({
    workflowStatus: material.workflow_status,
    medicalReviewStatus: material.medical_review_status,
    previousFingerprint: material.review_fingerprint,
    nextFingerprint,
  });
  if (!changes) return;
  await database('materials').where({ id: materialId }).update(changes);
  logger.info({ event: 'review.invalidated', material: materialId }, 'DiarWiki medical review invalidated');
}

async function materialIdsForDependency(database: Database, collection: string, ids: string[]) {
  if (ids.length === 0) return [];
  if (collection === 'material_blocks' || collection === 'material_sources' || collection === 'material_relations') {
    return database(collection).whereIn('id', ids).pluck('material');
  }
  if (Object.values(BLOCK_COLLECTIONS).includes(collection)) {
    return database(collection).whereIn('id', ids).pluck('material');
  }
  if (collection === 'sources') {
    const [linked, embedded] = await Promise.all([
      database('material_sources').whereIn('source', ids).pluck('material'),
      database('block_source_story').whereIn('source', ids).pluck('material'),
    ]);
    return [...new Set([...linked, ...embedded])];
  }
  if (collection === 'media_metadata') {
    const [figures, steps] = await Promise.all([
      database('block_figure').whereIn('media', ids).pluck('material'),
      database('block_article_step').whereIn('media', ids).pluck('material'),
    ]);
    return [...new Set([...figures, ...steps])];
  }
  return [];
}

async function activeOwnerIds(database: Database, excludedAccessIds: readonly string[] = []) {
  const query = database('directus_users as user')
    .distinct('user.id')
    .join('directus_access as access', function joinAccess(this: any) {
      this.on('access.user', '=', 'user.id').orOn('access.role', '=', 'user.role');
    })
    .join('directus_policies as policy', 'policy.id', 'access.policy')
    .where('user.status', 'active')
    .whereLike('policy.description', '[diarwiki:owner-admin]%');
  if (excludedAccessIds.length > 0) query.whereNotIn('access.id', excludedAccessIds);
  const rows = await query;
  return rows.map((row: Payload) => String(row.id));
}

async function policyKeyById(database: Database, id: string | null | undefined) {
  if (!id) return undefined;
  const row = await database('directus_policies').select('description').where({ id }).first();
  return policyKey(row?.description);
}

async function roleHasOwnerPolicy(database: Database, roleId: string | null | undefined) {
  if (!roleId) return false;
  const row = await database('directus_access as access')
    .join('directus_policies as policy', 'policy.id', 'access.policy')
    .where('access.role', roleId)
    .whereLike('policy.description', '[diarwiki:owner-admin]%')
    .first();
  return Boolean(row);
}

async function policyKeysForRole(database: Database, roleId: string | null | undefined) {
  if (!roleId) return [];
  const rows = await database('directus_access as access')
    .join('directus_policies as policy', 'policy.id', 'access.policy')
    .select('policy.description')
    .where('access.role', roleId);
  return rows.map((row: Payload) => policyKey(row.description)).filter(Boolean) as string[];
}

async function userHasDirectOwnerPolicy(database: Database, userId: string) {
  const row = await database('directus_access as access')
    .join('directus_policies as policy', 'policy.id', 'access.policy')
    .where('access.user', userId)
    .whereLike('policy.description', '[diarwiki:owner-admin]%')
    .first();
  return Boolean(row);
}

async function guardAccessElevation(database: Database, accountability: Accountability, payload: Payload, previous?: Payload) {
  const actor = accountability?.user;
  if (!actor) return;
  const targetUser = payload.user ?? previous?.user;
  const targetRole = payload.role ?? previous?.role;
  const targetIsActor = targetUser === actor || (targetRole && targetRole === accountability?.role);
  if (!targetIsActor) return;
  const addedKey = await policyKeyById(database, payload.policy ?? previous?.policy);
  if (!addedKey) return;
  const before = await loadPolicyKeys(database, accountability);
  try {
    assertNoSelfElevation({
      actorUserId: actor,
      targetUserId: actor,
      beforePolicyKeys: before,
      afterPolicyKeys: [...before, addedKey],
      criticalPolicyKeys: CRITICAL_POLICY_KEYS,
    });
  } catch (error) {
    throwRule(error);
  }
}

export default defineHook(({ filter, action }, { logger }) => {
  filter('items.update', async (payload: Payload, meta: EventMeta, context: { database: Database; accountability: Accountability }) => {
    const { database, accountability } = context;
    const ids = idsFromMeta(meta);

    if (meta.collection === 'materials') {
      if (ids.length !== 1 && ('workflow_status' in payload || [...PROTECTED_MATERIAL_FIELDS].some((key) => key in payload))) {
        throw new RuleViolation({ rule: 'BULK_WORKFLOW_FORBIDDEN', explanation: 'Статусы материалов изменяются по одному.' });
      }
      if (ids.length === 1) {
        const current = await database('materials').where({ id: ids[0] }).first();
        if (!current) throw new RuleViolation({ rule: 'MATERIAL_NOT_FOUND', explanation: 'Материал не найден.' });
        for (const field of ['content_id', 'slug']) {
          if (field in payload && payload[field] !== current[field]) {
            throw new RuleViolation({
              rule: 'IMMUTABLE_IDENTITY',
              explanation: `${field} нельзя изменять обычным редактированием. Для slug нужна отдельная процедура с перенаправлением.`,
            });
          }
        }
        const policyKeys = await loadPolicyKeys(database, accountability);
        const capabilities = capabilitiesFromPolicyKeys(policyKeys);
        const isSystem = capabilities.includes(CAPABILITIES.SYSTEM);
        const protectedWrite = [...PROTECTED_MATERIAL_FIELDS].find((key) => key in payload);
        if (protectedWrite && !isSystem) {
          throw new RuleViolation({
            rule: 'PROTECTED_FIELD_WRITE',
            explanation: `Поле ${protectedWrite} изменяется только проверенным серверным процессом.`,
          });
        }

        const reviewSet = await loadReviewSet(database, ids[0]);
        reviewSet.material = { ...reviewSet.material, ...payload };
        const nextFingerprint = createReviewFingerprint(reviewSet);
        const currentReviewValid = await reviewIsCurrent(database, ids[0], nextFingerprint);
        const nextStatus = (payload.workflow_status ?? current.workflow_status) as WorkflowStatus;
        const nextRisk = (payload.risk ?? current.risk) as RiskLevel;

        if (nextStatus !== current.workflow_status) {
          const requiredRisks = await requiredRiskLevels(database);
          try {
            assertTransitionAllowed({
              from: current.workflow_status,
              to: nextStatus,
              capabilities,
              risk: nextRisk,
              projectRequiresMedicalReview: requiredRisks.includes(nextRisk),
              currentReviewValid,
            });
          } catch (error) {
            throwRule(error);
          }
        }

        const invalidation = deriveReviewInvalidation({
          workflowStatus: current.workflow_status,
          medicalReviewStatus: current.medical_review_status,
          previousFingerprint: current.review_fingerprint,
          nextFingerprint,
        });
        if (invalidation && !isSystem) Object.assign(payload, invalidation);
      }
    }

    if (meta.collection === 'site_settings' && 'medical_review_required_risks' in payload) {
      let risks = payload.medical_review_required_risks;
      if (typeof risks === 'string') {
        try {
          risks = JSON.parse(risks);
        } catch {
          risks = null;
        }
      }
      if (!Array.isArray(risks) || !risks.includes('high')) {
        throw new RuleViolation({
          rule: 'HIGH_RISK_REVIEW_REQUIRED',
          explanation: 'Высокий риск нельзя исключить из обязательной медицинской проверки.',
        });
      }
    }

    if (meta.collection === 'directus_users' && ids.length > 0
      && (payload.status && payload.status !== 'active' || 'role' in payload)) {
      const owners = await activeOwnerIds(database);
      const currentUsers = await database('directus_users').whereIn('id', ids).select('id', 'role', 'status');
      if ('role' in payload && accountability?.user && ids.includes(accountability.user)) {
        const before = await loadPolicyKeys(database, accountability);
        const after = [...before, ...await policyKeysForRole(database, payload.role)];
        try {
          assertNoSelfElevation({
            actorUserId: accountability.user,
            targetUserId: accountability.user,
            beforePolicyKeys: before,
            afterPolicyKeys: after,
            criticalPolicyKeys: CRITICAL_POLICY_KEYS,
          });
        } catch (error) {
          throwRule(error);
        }
      }
      const newRoleKeepsOwner = 'role' in payload
        ? await roleHasOwnerPolicy(database, payload.role)
        : false;
      const affected: string[] = [];
      for (const user of currentUsers) {
        if (!owners.includes(String(user.id))) continue;
        const suspended = payload.status && payload.status !== 'active';
        const roleActuallyChanges = 'role' in payload && payload.role !== user.role;
        const directOwner = roleActuallyChanges
          ? await userHasDirectOwnerPolicy(database, String(user.id))
          : false;
        if (suspended || roleActuallyChanges && !newRoleKeepsOwner && !directOwner) affected.push(String(user.id));
      }
      try {
        assertOwnersRemain({
          activeOwnerIds: owners,
          affectedUserIds: affected,
          operation: payload.status && payload.status !== 'active' ? 'suspend' : 'demote',
        });
      } catch (error) {
        throwRule(error);
      }
    }

    if (meta.collection === 'directus_access' && ids.length === 1) {
      const previous = await database('directus_access').where({ id: ids[0] }).first();
      await guardAccessElevation(database, accountability, payload, previous);
      const previousKey = await policyKeyById(database, previous?.policy);
      const nextKey = await policyKeyById(database, payload.policy ?? previous?.policy);
      const removesOwnerAccess = previousKey === 'owner-admin'
        && (nextKey !== 'owner-admin' || 'role' in payload || 'user' in payload);
      if (removesOwnerAccess) {
        const remaining = await activeOwnerIds(database, ids);
        if (remaining.length === 0) {
          throw new RuleViolation({ rule: 'LAST_OWNER_REQUIRED', explanation: 'Операция оставит систему без активного владельца.' });
        }
      }
    }
    return payload;
  });

  filter('items.create', async (payload: Payload, meta: EventMeta, context: { database: Database; accountability: Accountability }) => {
    const { database, accountability } = context;
    if (meta.collection === 'medical_reviews') {
      const materialId = payload.material;
      const material = await database('materials').where({ id: materialId }).first();
      if (!material || material.workflow_status !== 'medical_review') {
        throw new RuleViolation({ rule: 'REVIEW_STATE_REQUIRED', explanation: 'Материал должен находиться на медицинской проверке.' });
      }
      const policyKeys = await loadPolicyKeys(database, accountability);
      if (!capabilitiesFromPolicyKeys(policyKeys).includes(CAPABILITIES.MEDICAL_REVIEW)) {
        throw new RuleViolation({ rule: 'CAPABILITY_REQUIRED', explanation: 'Нет права медицинского заключения.' });
      }
      const fingerprint = createReviewFingerprint(await loadReviewSet(database, materialId));
      if (payload.fingerprint && payload.fingerprint !== fingerprint) {
        throw new RuleViolation({ rule: 'REVIEW_FINGERPRINT_MISMATCH', explanation: 'Материал изменился после открытия формы проверки.' });
      }
      payload.fingerprint = fingerprint;
      payload.reviewer = accountability?.user;
      payload.reviewed_at = new Date().toISOString();
    }
    if (meta.collection === 'directus_access') {
      await guardAccessElevation(database, accountability, payload);
    }
    return payload;
  });

  filter('items.delete', async (keys: string | string[], meta: EventMeta, context: { database: Database }) => {
    const ids = asArray(keys);
    if (meta.collection === 'directus_users') {
      const owners = await activeOwnerIds(context.database);
      try {
        assertOwnersRemain({ activeOwnerIds: owners, affectedUserIds: ids, operation: 'delete' });
      } catch (error) {
        throwRule(error);
      }
    }
    if (meta.collection === 'directus_access') {
      const remaining = await activeOwnerIds(context.database, ids);
      const current = await activeOwnerIds(context.database);
      if (current.length > 0 && remaining.length === 0) {
        throw new RuleViolation({ rule: 'LAST_OWNER_REQUIRED', explanation: 'Нельзя удалить доступ последнего активного владельца.' });
      }
    }
    if (meta.collection && DEPENDENCY_COLLECTIONS.has(meta.collection)) {
      const materials = await materialIdsForDependency(context.database, meta.collection, ids);
      for (const id of materials) await invalidateMaterial(context.database, id, logger as Logger, true);
    }
    return keys;
  });

  action('items.create', async (meta: EventMeta & Payload, context: { database: Database; accountability: Accountability }) => {
    if (meta.collection === 'medical_reviews' && meta.key) {
      const review = await context.database('medical_reviews').where({ id: meta.key }).first();
      if (review) {
        const changes = review.decision === 'approved'
          ? { workflow_status: 'ready_to_publish', medical_review_status: 'reviewed', review_fingerprint: review.fingerprint }
          : { workflow_status: 'changes_requested', medical_review_status: 'pending', review_fingerprint: null };
        await context.database('materials').where({ id: review.material }).update(changes);
        logger.info({
          event: 'medical_review.recorded',
          material: review.material,
          decision: review.decision,
          actor: context.accountability?.user,
        }, 'DiarWiki medical review recorded');
      }
    }
    if (meta.collection && DEPENDENCY_COLLECTIONS.has(meta.collection)) {
      const materials = await materialIdsForDependency(context.database, meta.collection, idsFromMeta(meta));
      for (const id of materials) await invalidateMaterial(context.database, id, logger as Logger);
    }
    if (['directus_access', 'release_requests', 'releases'].includes(meta.collection ?? '')) {
      logger.info({ event: `${meta.collection}.created`, item: meta.key, actor: context.accountability?.user }, 'DiarWiki critical action');
    }
  });

  action('items.update', async (meta: EventMeta & Payload, context: { database: Database; accountability: Accountability }) => {
    if (meta.collection && DEPENDENCY_COLLECTIONS.has(meta.collection)) {
      const materials = await materialIdsForDependency(context.database, meta.collection, idsFromMeta(meta));
      for (const id of materials) await invalidateMaterial(context.database, id, logger as Logger);
    }
    if (['materials', 'directus_users', 'directus_access', 'release_requests', 'releases'].includes(meta.collection ?? '')) {
      logger.info({ event: `${meta.collection}.updated`, items: idsFromMeta(meta), actor: context.accountability?.user }, 'DiarWiki critical action');
    }
  });

  action('items.delete', (meta: EventMeta & Payload, context: { accountability: Accountability }) => {
    if (['directus_users', 'directus_access', 'releases'].includes(meta.collection ?? '')) {
      logger.info({ event: `${meta.collection}.deleted`, items: idsFromMeta(meta), actor: context.accountability?.user }, 'DiarWiki critical action');
    }
  });
});
