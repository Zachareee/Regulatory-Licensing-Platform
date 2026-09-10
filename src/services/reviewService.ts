import { randomUUID } from 'crypto';
import {
  Application,
  AuditEntry,
  Feedback,
  FeedbackTargetType,
  Role,
  SectionId,
} from '../domain/types';
import { assertValidTransition, InternalStatus } from '../domain/statusMachine';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors';
import {
  ApplicationRepository,
  AuditRepository,
  DocumentRepository,
  FeedbackRepository,
  NotificationRepository,
} from '../repositories/inMemoryStore';

export interface CommentTemplate {
  id: string;
  label: string;
  text: string;
}

// A small, fixed library of common review comments (UC2 "Predefined comment
// templates available for common issues"). In a real system these would be
// configurable per licensing authority; hardcoding is an explicit MVP cut.
export const COMMENT_TEMPLATES: CommentTemplate[] = [
  { id: 'doc-illegible', label: 'Document illegible', text: 'The uploaded document is not legible. Please re-upload a clearer scan or photo.' },
  { id: 'doc-missing-signature', label: 'Missing signature', text: 'This document is missing a required signature.' },
  { id: 'info-incomplete', label: 'Incomplete information', text: 'This section is missing required information. Please complete all fields.' },
  { id: 'info-mismatch', label: 'Information mismatch', text: 'The information provided does not match supporting documents.' },
  { id: 'doc-expired', label: 'Expired document', text: 'The submitted document has expired. Please provide a current version.' },
];

export interface RequestChangeItem {
  targetType: FeedbackTargetType;
  targetId: string;
  comment?: string;
  templateId?: string;
}

export interface RequestChangesInput {
  applicationId: string;
  officerId: string;
  items: RequestChangeItem[];
}

export interface RevisionDiff {
  fromRevision: number;
  toRevision: number;
  changedSections: SectionId[];
}

export class ReviewService {
  constructor(
    private applications: ApplicationRepository,
    private feedback: FeedbackRepository,
    private documents: DocumentRepository,
    private audit: AuditRepository,
    private notifications: NotificationRepository,
  ) {}

  startReview(applicationId: string, officerId: string): Application {
    const app = this.getApp(applicationId);
    assertValidTransition(app.status, 'UNDER_REVIEW');
    return this.transition(app, 'UNDER_REVIEW', officerId);
  }

  /**
   * Officer requests more information. Validates every target exists on
   * the application before writing anything (all-or-nothing), then creates
   * one Feedback record per item and moves the case to
   * PENDING_PRE_SITE_RESUBMISSION.
   */
  requestChanges(input: RequestChangesInput): Application {
    const app = this.getApp(input.applicationId);
    if (app.status !== 'UNDER_REVIEW') {
      throw new ConflictError(
        `Cannot request changes while application is in status ${app.status}`,
      );
    }
    if (input.items.length === 0) {
      throw new ValidationError('At least one feedback item is required');
    }

    const currentSections = app.revisions[app.revisions.length - 1].sections;
    const appDocuments = this.documents.findByApplication(app.id);

    for (const item of input.items) {
      this.validateTarget(item, currentSections, appDocuments);
      if (!item.comment && !item.templateId) {
        throw new ValidationError('Each feedback item requires a comment or a templateId');
      }
      if (item.templateId && !COMMENT_TEMPLATES.find((t) => t.id === item.templateId)) {
        throw new ValidationError(`Unknown templateId: ${item.templateId}`);
      }
    }

    const round = app.currentRevision;
    for (const item of input.items) {
      const template = item.templateId
        ? COMMENT_TEMPLATES.find((t) => t.id === item.templateId)
        : undefined;
      const record: Feedback = {
        id: randomUUID(),
        applicationId: app.id,
        targetType: item.targetType,
        targetId: item.targetId,
        round,
        comment: item.comment ?? template!.text,
        templateId: item.templateId,
        authorId: input.officerId,
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      this.feedback.add(record);
    }

    this.recordAudit(app.id, 'FEEDBACK_ADDED', input.officerId, 'OFFICER', {
      count: input.items.length,
    });

    return this.transition(app, 'PENDING_PRE_SITE_RESUBMISSION', input.officerId, 'OFFICER');
  }

  scheduleSiteVisit(applicationId: string, officerId: string): Application {
    const app = this.getApp(applicationId);
    if (app.status !== 'UNDER_REVIEW') {
      throw new ConflictError(`Cannot schedule a site visit from status ${app.status}`);
    }
    return this.transition(app, 'SITE_VISIT_SCHEDULED', officerId, 'OFFICER');
  }

  reject(applicationId: string, officerId: string, reason: string): Application {
    const app = this.getApp(applicationId);
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('A rejection reason is required');
    }
    return this.transition(app, 'REJECTED', officerId, 'OFFICER', { reason });
  }

  approve(applicationId: string, officerId: string): Application {
    const app = this.getApp(applicationId);
    return this.transition(app, 'APPROVED', officerId, 'OFFICER');
  }

  resolveFeedback(feedbackId: string, officerId: string): Feedback {
    const item = this.feedback.findById(feedbackId);
    if (!item) throw new NotFoundError('Feedback', feedbackId);
    if (item.resolved) {
      throw new ConflictError('Feedback item is already resolved');
    }
    item.resolved = true;
    item.resolvedAt = new Date().toISOString();
    this.feedback.update(item);
    this.recordAudit(item.applicationId, 'FEEDBACK_RESOLVED', officerId, 'OFFICER', {
      feedbackId,
    });
    return item;
  }

  listFeedback(applicationId: string): Feedback[] {
    return this.feedback.findByApplication(applicationId);
  }

  /**
   * Diff two stored revisions by which sections changed between them,
   * rather than a deep field-level diff — sufficient for an officer to
   * know where to focus, and cheap/robust regardless of section shape.
   */
  compareRevisions(applicationId: string, fromRevision: number, toRevision: number): RevisionDiff {
    const app = this.getApp(applicationId);
    const from = app.revisions.find((r) => r.revisionNumber === fromRevision);
    const to = app.revisions.find((r) => r.revisionNumber === toRevision);
    if (!from) throw new NotFoundError('Revision', String(fromRevision));
    if (!to) throw new NotFoundError('Revision', String(toRevision));

    const changed = new Set<SectionId>();
    for (const key of Object.keys(to.sections) as SectionId[]) {
      if (JSON.stringify(from.sections[key]) !== JSON.stringify(to.sections[key])) {
        changed.add(key);
      }
    }
    return { fromRevision, toRevision, changedSections: [...changed] };
  }

  private validateTarget(
    item: RequestChangeItem,
    currentSections: Record<string, unknown>,
    appDocuments: { id: string }[],
  ): void {
    if (item.targetType === 'SECTION') {
      if (!(item.targetId in currentSections)) {
        throw new ValidationError(`Unknown section: ${item.targetId}`);
      }
    } else if (item.targetType === 'DOCUMENT') {
      if (!appDocuments.find((d) => d.id === item.targetId)) {
        throw new ValidationError(`Unknown document: ${item.targetId}`);
      }
    }
    // CHECKLIST_ITEM targets are validated by siteVisitService, which owns
    // that lifecycle; reviewService only handles SECTION/DOCUMENT feedback
    // for the pre-site flow.
  }

  private getApp(applicationId: string): Application {
    const app = this.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    return app;
  }

  private transition(
    app: Application,
    to: InternalStatus,
    actorId: string,
    actorRole: Role = 'OFFICER',
    detail?: Record<string, unknown>,
  ): Application {
    const from = app.status;
    assertValidTransition(from, to);
    app.status = to;
    app.updatedAt = new Date().toISOString();
    this.applications.save(app);
    this.recordAudit(app.id, 'STATUS_CHANGED', actorId, actorRole, { from, to, ...detail });
    this.notify(app.id, 'OPERATOR', app.operatorId, `Application status changed to ${to}`);
    return app;
  }

  private recordAudit(
    applicationId: string,
    action: AuditEntry['action'],
    actorId: string,
    actorRole: Role,
    detail?: Record<string, unknown>,
  ): void {
    this.audit.append({
      id: randomUUID(),
      applicationId,
      action,
      actorId,
      actorRole,
      timestamp: new Date().toISOString(),
      detail,
    });
  }

  private notify(applicationId: string, recipientRole: Role, recipientId: string, message: string): void {
    this.notifications.add({
      id: randomUUID(),
      applicationId,
      recipientRole,
      recipientId,
      message,
      createdAt: new Date().toISOString(),
    });
  }
}
