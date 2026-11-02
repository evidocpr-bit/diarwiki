import { CAPABILITIES, type Capability } from './transitions.ts';

export class OwnerGuardError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OwnerGuardError';
    this.code = code;
  }
}

export function assertLastOwnerIsPreserved(input: {
  activeOwnerIds: readonly string[];
  targetUserId: string;
  operation: 'suspend' | 'demote' | 'delete';
}) {
  if (input.activeOwnerIds.includes(input.targetUserId) && input.activeOwnerIds.length <= 1) {
    throw new OwnerGuardError(
      'LAST_OWNER_REQUIRED',
      'Нельзя удалить, заблокировать или лишить прав последнего активного владельца.',
    );
  }
}

export function assertOwnersRemain(input: {
  activeOwnerIds: readonly string[];
  affectedUserIds: readonly string[];
  operation: 'suspend' | 'demote' | 'delete';
}) {
  if (input.activeOwnerIds.length === 0) return;
  const affected = new Set(input.affectedUserIds);
  const remaining = input.activeOwnerIds.filter((id) => !affected.has(id));
  if (remaining.length === 0) {
    throw new OwnerGuardError(
      'LAST_OWNER_REQUIRED',
      'Операция оставит систему без активного владельца.',
    );
  }
}

export function assertNoSelfElevation(input: {
  actorUserId: string | null | undefined;
  targetUserId: string;
  beforePolicyKeys: readonly string[];
  afterPolicyKeys: readonly string[];
  criticalPolicyKeys: readonly string[];
}) {
  if (!input.actorUserId || input.actorUserId !== input.targetUserId) return;
  const previous = new Set(input.beforePolicyKeys);
  const gainedCritical = input.afterPolicyKeys.some((key) =>
    input.criticalPolicyKeys.includes(key) && !previous.has(key));
  if (gainedCritical) {
    throw new OwnerGuardError(
      'SELF_ELEVATION_FORBIDDEN',
      'Нельзя самостоятельно выдать себе административное право или право публикации.',
    );
  }
}

const POLICY_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = Object.freeze({
  'owner-admin': [
    CAPABILITIES.SUBMIT_EDITORIAL,
    CAPABILITIES.EDITORIAL_REVIEW,
    CAPABILITIES.MEDICAL_REVIEW,
    CAPABILITIES.PUBLISH,
    CAPABILITIES.ARCHIVE,
  ],
  'editorial-workflow': [CAPABILITIES.SUBMIT_EDITORIAL, CAPABILITIES.EDITORIAL_REVIEW],
  'medical-review': [CAPABILITIES.MEDICAL_REVIEW],
  'content-publish': [CAPABILITIES.PUBLISH, CAPABILITIES.ARCHIVE],
  'release-service': [CAPABILITIES.SYSTEM],
});

export function capabilitiesFromPolicyKeys(policyKeys: readonly string[]) {
  return [...new Set(policyKeys.flatMap((key) => POLICY_CAPABILITIES[key] ?? []))];
}
