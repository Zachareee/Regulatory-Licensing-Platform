import { InternalStatus, Role } from './types';

export type { InternalStatus };

/**
 * Authoritative status label mapping, transcribed from the assessment spec.
 *
 * Hard rule: an Operator must never receive `status` (the InternalStatus
 * enum value) or the Officer label for PENDING_APPROVAL ("Route to
 * Approval") in any response. Always go through `mapStatusForRole`.
 */
export const STATUS_LABELS: Record<InternalStatus, { officer: string; operator: string }> = {
  APPLICATION_RECEIVED: { officer: 'Application Received', operator: 'Submitted' },
  UNDER_REVIEW: { officer: 'Under Review', operator: 'Under Review' },
  PENDING_PRE_SITE_RESUBMISSION: {
    officer: 'Pending Pre-Site Resubmission',
    operator: 'Pending Pre-Site Resubmission',
  },
  PRE_SITE_RESUBMITTED: {
    officer: 'Pre-Site Resubmitted',
    operator: 'Pre-Site Resubmitted',
  },
  SITE_VISIT_SCHEDULED: {
    officer: 'Site Visit Scheduled',
    operator: 'Pending Site Visit',
  },
  SITE_VISIT_DONE: {
    officer: 'Site Visit Done',
    operator: 'Pending Post-Site Clarification',
  },
  AWAITING_POST_SITE_CLARIFICATION: {
    officer: 'Awaiting Post-Site Clarification',
    operator: 'Pending Post-Site Clarification',
  },
  PENDING_POST_SITE_RESUBMISSION: {
    officer: 'Awaiting Post-Site Resubmission',
    operator: 'Pending Post-Site Resubmission',
  },
  POST_SITE_CLARIFICATION_RESUBMITTED: {
    officer: 'Post-Site Clarification Resubmitted',
    operator: 'Post-Site Resubmitted',
  },
  PENDING_APPROVAL: { officer: 'Route to Approval', operator: 'Pending Approval' },
  APPROVED: { officer: 'Approved', operator: 'Approved' },
  REJECTED: { officer: 'Rejected', operator: 'Rejected' },
};

// Startup-time integrity check (PRD edge case #9): fail fast if a status
// enum value is ever added without a corresponding label mapping.
const ALL_STATUSES: InternalStatus[] = [
  'APPLICATION_RECEIVED',
  'UNDER_REVIEW',
  'PENDING_PRE_SITE_RESUBMISSION',
  'PRE_SITE_RESUBMITTED',
  'SITE_VISIT_SCHEDULED',
  'SITE_VISIT_DONE',
  'AWAITING_POST_SITE_CLARIFICATION',
  'PENDING_POST_SITE_RESUBMISSION',
  'POST_SITE_CLARIFICATION_RESUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
];
for (const status of ALL_STATUSES) {
  if (!STATUS_LABELS[status]) {
    throw new Error(`Missing status label mapping for "${status}"`);
  }
}

export function mapStatusForRole(status: InternalStatus, role: Role): string {
  return role === 'OFFICER' ? STATUS_LABELS[status].officer : STATUS_LABELS[status].operator;
}

/**
 * Transition table. Keys are the current status; values are the set of
 * statuses that may be entered next. Anything not listed is illegal.
 *
 * See SCOPE.md assumption #1 for the reasoning behind the post-site loop
 * (AWAITING_POST_SITE_CLARIFICATION vs PENDING_POST_SITE_RESUBMISSION).
 */
export const ALLOWED_TRANSITIONS: Record<InternalStatus, InternalStatus[]> = {
  APPLICATION_RECEIVED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['PENDING_PRE_SITE_RESUBMISSION', 'SITE_VISIT_SCHEDULED', 'REJECTED'],
  PENDING_PRE_SITE_RESUBMISSION: ['PRE_SITE_RESUBMITTED'],
  // Resubmission always goes back through full review, which then decides
  // whether another round of pre-site feedback is needed (unlimited rounds
  // supported by looping back through UNDER_REVIEW).
  PRE_SITE_RESUBMITTED: ['UNDER_REVIEW'],
  SITE_VISIT_SCHEDULED: ['SITE_VISIT_DONE'],
  // If the checklist has zero flagged items, skip the clarification loop
  // entirely (PRD edge case #5).
  SITE_VISIT_DONE: ['AWAITING_POST_SITE_CLARIFICATION', 'PENDING_APPROVAL'],
  AWAITING_POST_SITE_CLARIFICATION: ['POST_SITE_CLARIFICATION_RESUBMITTED'],
  POST_SITE_CLARIFICATION_RESUBMITTED: ['PENDING_POST_SITE_RESUBMISSION', 'PENDING_APPROVAL'],
  PENDING_POST_SITE_RESUBMISSION: ['POST_SITE_CLARIFICATION_RESUBMITTED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: InternalStatus, to: InternalStatus) {
    super(`Illegal status transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertValidTransition(from: InternalStatus, to: InternalStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: InternalStatus): boolean {
  return status === 'APPROVED' || status === 'REJECTED';
}
