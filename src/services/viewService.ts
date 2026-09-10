import { Application, DocumentRecord, Feedback, Role } from '../domain/types';
import { mapStatusForRole } from '../domain/statusMachine';

/**
 * Single, central place where an Application (+ related records) is
 * shaped into a role-specific JSON payload. This exists so that "operators
 * never see the internal status or the internal approval stage" is
 * enforced once, structurally, instead of being a convention every new
 * route author has to remember (PRD §5 "Role isolation").
 */

export interface ApplicationView {
  id: string;
  status: string; // always the mapped label, never the InternalStatus
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  sections: Record<string, unknown>;
  documents: DocumentView[];
  feedback: FeedbackView[];
  // Only present for the officer view.
  revisionHistory?: { revisionNumber: number; changedSections: string[]; submittedAt: string }[];
  operatorId?: string;
}

export interface DocumentView {
  id: string;
  sectionId: string;
  filename: string;
  verificationStatus: string;
  verificationNote?: string;
  uploadedAt: string;
}

export interface FeedbackView {
  id: string;
  targetType: string;
  targetId: string;
  comment: string;
  round: number;
  resolved: boolean;
  createdAt: string;
}

export function toApplicationView(
  app: Application,
  role: Role,
  documents: DocumentRecord[],
  feedback: Feedback[],
): ApplicationView {
  const latestRevision = app.revisions[app.revisions.length - 1];

  const base: ApplicationView = {
    id: app.id,
    status: mapStatusForRole(app.status, role),
    currentRevision: app.currentRevision,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    sections: latestRevision.sections,
    documents: documents.map((d) => ({
      id: d.id,
      sectionId: d.sectionId,
      filename: d.filename,
      verificationStatus: d.verificationStatus,
      verificationNote: d.verificationNote,
      uploadedAt: d.uploadedAt,
    })),
    feedback: feedback
      .filter((f) => f.targetType !== 'CHECKLIST_ITEM') // checklist feedback is served via the site-visit endpoints, which already enforce the flagged-only rule for operators
      .map((f) => ({
        id: f.id,
        targetType: f.targetType,
        targetId: f.targetId,
        comment: f.comment,
        round: f.round,
        resolved: f.resolved,
        createdAt: f.createdAt,
      })),
  };

  if (role === 'OFFICER') {
    base.operatorId = app.operatorId;
    base.revisionHistory = app.revisions.map((r) => ({
      revisionNumber: r.revisionNumber,
      changedSections: r.changedSections,
      submittedAt: r.submittedAt,
    }));
  }

  return base;
}
