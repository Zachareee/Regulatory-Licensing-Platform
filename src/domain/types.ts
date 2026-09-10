// Core domain types. Pure data shapes — no I/O, no framework dependencies.
// Keeping this framework-agnostic means the domain model can be unit tested
// without spinning up Express, and reused if a different transport (CLI,
// worker, GraphQL) is added later.

export type Role = 'OPERATOR' | 'OFFICER';

/**
 * The single source of truth for where an application is in its lifecycle.
 * Never expose this enum value directly to an Operator — always pass it
 * through `mapStatusForRole`.
 */
export type InternalStatus =
  | 'APPLICATION_RECEIVED'
  | 'UNDER_REVIEW'
  | 'PENDING_PRE_SITE_RESUBMISSION'
  | 'PRE_SITE_RESUBMITTED'
  | 'SITE_VISIT_SCHEDULED'
  | 'SITE_VISIT_DONE'
  | 'AWAITING_POST_SITE_CLARIFICATION'
  | 'PENDING_POST_SITE_RESUBMISSION'
  | 'POST_SITE_CLARIFICATION_RESUBMITTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

/**
 * Fixed section schema for the MVP (see SCOPE.md assumption #2).
 */
export const SECTION_IDS = [
  'business_info',
  'ownership',
  'financials',
  'premises',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type DocumentVerificationStatus = 'PENDING' | 'VERIFIED' | 'FLAGGED';

export interface DocumentRecord {
  id: string;
  applicationId: string;
  sectionId: SectionId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  verificationStatus: DocumentVerificationStatus;
  verificationNote?: string;
}

export interface SectionData {
  [key: string]: unknown;
}

/**
 * A single immutable snapshot of the application's form data, taken at
 * initial submission and at every resubmission. Revisions are never
 * mutated or deleted — see PRD "No data loss" NFR.
 */
export interface Revision {
  revisionNumber: number;
  sections: Record<SectionId, SectionData>;
  submittedAt: string;
  submittedBy: string;
  /** Sections that changed relative to the previous revision. Empty for revision 1. */
  changedSections: SectionId[];
}

export type FeedbackTargetType = 'SECTION' | 'DOCUMENT' | 'CHECKLIST_ITEM';

export interface Feedback {
  id: string;
  applicationId: string;
  targetType: FeedbackTargetType;
  targetId: string; // sectionId, documentId, or checklistItemId
  round: number;
  comment: string;
  templateId?: string;
  authorId: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface ChecklistItem {
  id: string;
  applicationId: string;
  label: string;
  officerComment: string;
  needsClarification: boolean;
  operatorResponse?: string;
  operatorRespondedAt?: string;
  round: number;
  createdAt: string;
}

export type SiteVisitChecklistState = 'DRAFT' | 'SUBMITTED';

export interface SiteVisitChecklist {
  applicationId: string;
  state: SiteVisitChecklistState;
  items: ChecklistItem[];
  submittedAt?: string;
}

export type AuditAction =
  | 'APPLICATION_CREATED'
  | 'STATUS_CHANGED'
  | 'RESUBMISSION_RECEIVED'
  | 'FEEDBACK_ADDED'
  | 'FEEDBACK_RESOLVED'
  | 'DOCUMENT_UPLOADED'
  | 'CHECKLIST_SAVED_DRAFT'
  | 'CHECKLIST_SUBMITTED'
  | 'CLARIFICATION_RESPONSE_SUBMITTED'
  | 'NOTIFICATION_SENT';

export interface AuditEntry {
  id: string;
  applicationId: string;
  action: AuditAction;
  actorId: string;
  actorRole: Role;
  timestamp: string;
  detail?: Record<string, unknown>;
}

export interface Application {
  id: string;
  operatorId: string;
  status: InternalStatus;
  currentRevision: number;
  revisions: Revision[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationEvent {
  id: string;
  applicationId: string;
  recipientRole: Role;
  recipientId: string;
  message: string;
  createdAt: string;
}
