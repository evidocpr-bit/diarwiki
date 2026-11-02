export const CAPABILITIES = Object.freeze({
  SUBMIT_EDITORIAL: 'submit_editorial',
  EDITORIAL_REVIEW: 'editorial_review',
  MEDICAL_REVIEW: 'medical_review',
  PUBLISH: 'publish',
  ARCHIVE: 'archive',
  SYSTEM: 'system_workflow',
} as const);

export type WorkflowStatus =
  | 'draft'
  | 'editorial_review'
  | 'changes_requested'
  | 'medical_review'
  | 'revision_required'
  | 'ready_to_publish'
  | 'published'
  | 'publish_failed'
  | 'archived';

export type RiskLevel = 'low' | 'medium' | 'high';
export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];

export class WorkflowRuleError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkflowRuleError';
    this.code = code;
    this.details = details;
  }
}

type TransitionRule = {
  capability: Capability;
  validReview?: boolean;
};

const TRANSITIONS: Record<WorkflowStatus, Partial<Record<WorkflowStatus, TransitionRule>>> = {
  draft: {
    editorial_review: { capability: CAPABILITIES.SUBMIT_EDITORIAL },
  },
  editorial_review: {
    draft: { capability: CAPABILITIES.EDITORIAL_REVIEW },
    changes_requested: { capability: CAPABILITIES.EDITORIAL_REVIEW },
    medical_review: { capability: CAPABILITIES.EDITORIAL_REVIEW },
    ready_to_publish: { capability: CAPABILITIES.EDITORIAL_REVIEW },
  },
  changes_requested: {
    editorial_review: { capability: CAPABILITIES.SUBMIT_EDITORIAL },
  },
  medical_review: {
    changes_requested: { capability: CAPABILITIES.MEDICAL_REVIEW },
    ready_to_publish: { capability: CAPABILITIES.MEDICAL_REVIEW, validReview: true },
  },
  revision_required: {
    medical_review: { capability: CAPABILITIES.SUBMIT_EDITORIAL },
    archived: { capability: CAPABILITIES.ARCHIVE },
  },
  ready_to_publish: {
    editorial_review: { capability: CAPABILITIES.EDITORIAL_REVIEW },
    published: { capability: CAPABILITIES.SYSTEM },
    publish_failed: { capability: CAPABILITIES.SYSTEM },
  },
  published: {
    revision_required: { capability: CAPABILITIES.SYSTEM },
    archived: { capability: CAPABILITIES.ARCHIVE },
  },
  publish_failed: {
    ready_to_publish: { capability: CAPABILITIES.SYSTEM },
    published: { capability: CAPABILITIES.SYSTEM },
    archived: { capability: CAPABILITIES.ARCHIVE },
  },
  archived: {
    draft: { capability: CAPABILITIES.ARCHIVE },
  },
};

export function requiresMedicalReview(input: {
  risk: RiskLevel;
  projectRequiresMedicalReview?: boolean;
}) {
  return input.risk === 'high' || input.projectRequiresMedicalReview === true;
}

export function assertTransitionAllowed(input: {
  from: WorkflowStatus;
  to: WorkflowStatus;
  capabilities: readonly string[];
  risk: RiskLevel;
  projectRequiresMedicalReview?: boolean;
  currentReviewValid?: boolean;
}) {
  if (input.from === input.to) return;
  const rule = TRANSITIONS[input.from]?.[input.to];
  if (!rule) {
    throw new WorkflowRuleError(
      'TRANSITION_NOT_ALLOWED',
      `Переход ${input.from} → ${input.to} не разрешён.`,
      { from: input.from, to: input.to },
    );
  }
  if (!input.capabilities.includes(rule.capability)) {
    throw new WorkflowRuleError(
      'CAPABILITY_REQUIRED',
      `Для перехода ${input.from} → ${input.to} требуется право ${rule.capability}.`,
      { capability: rule.capability },
    );
  }

  const movingToReady = input.to === 'ready_to_publish';
  if (movingToReady && requiresMedicalReview(input) && !input.currentReviewValid) {
    const code = input.from === 'medical_review'
      ? 'REVIEW_FINGERPRINT_MISMATCH'
      : 'MEDICAL_REVIEW_REQUIRED';
    throw new WorkflowRuleError(
      code,
      'Для этой версии материала требуется действующая медицинская проверка.',
    );
  }
  if (rule.validReview && !input.currentReviewValid) {
    throw new WorkflowRuleError(
      'REVIEW_FINGERPRINT_MISMATCH',
      'Отпечаток одобренной версии не совпадает с текущим содержимым.',
    );
  }
  if (input.to === 'published' && requiresMedicalReview(input) && !input.currentReviewValid) {
    throw new WorkflowRuleError(
      'MEDICAL_REVIEW_REQUIRED',
      'Публикация без действующей медицинской проверки запрещена.',
    );
  }
}

const REVIEWED_STATES = new Set<WorkflowStatus>([
  'medical_review',
  'ready_to_publish',
  'published',
  'publish_failed',
]);

export function deriveReviewInvalidation(input: {
  workflowStatus: WorkflowStatus;
  medicalReviewStatus: 'pending' | 'reviewed' | 'revision_required';
  previousFingerprint: string | null;
  nextFingerprint: string | null;
}) {
  if (input.previousFingerprint === input.nextFingerprint) return null;
  if (input.medicalReviewStatus !== 'reviewed') return null;
  if (!REVIEWED_STATES.has(input.workflowStatus)) return null;
  return {
    workflow_status: 'revision_required' as const,
    medical_review_status: 'revision_required' as const,
    review_fingerprint: null,
  };
}
