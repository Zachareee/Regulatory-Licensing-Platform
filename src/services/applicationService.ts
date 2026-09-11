import { randomUUID } from 'node:crypto';
import {
  Application,
  AuditEntry,
  Role,
  SECTION_IDS,
  SectionData,
  SectionId,
} from '../domain/types';
import { assertValidTransition } from '../domain/statusMachine';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors';
import {
  ApplicationRepository,
  AuditRepository,
  FeedbackRepository,
  NotificationRepository,
} from '../repositories/inMemoryStore';

export interface CreateApplicationInput {
  operatorId: string;
  sections: Record<SectionId, SectionData>;
}

export interface ResubmitSectionsInput {
  applicationId: string;
  operatorId: string;
  baseRevision: number;
  sections: Partial<Record<SectionId, SectionData>>;
}

export interface Requester {
  id: string;
  role: Role;
}

export class ApplicationService {
  constructor(
    private applications: ApplicationRepository,
    private feedback: FeedbackRepository,
    private audit: AuditRepository,
    private notifications: NotificationRepository,
  ) {}

  create(input: CreateApplicationInput): Application {
    const missing = SECTION_IDS.filter((id) => !input.sections[id]);
    if (missing.length > 0) {
      throw new ValidationError('All sections are required on initial submission', {
        sections: `missing: ${missing.join(', ')}`,
      });
    }
    if (!input.operatorId) {
      throw new ValidationError('operatorId is required', { operatorId: 'required' });
    }

    const now = new Date().toISOString();
    const app: Application = {
      id: randomUUID(),
      operatorId: input.operatorId,
      status: 'APPLICATION_RECEIVED',
      currentRevision: 1,
      revisions: [
        {
          revisionNumber: 1,
          sections: input.sections,
          submittedAt: now,
          submittedBy: input.operatorId,
          changedSections: [],
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.applications.create(app);
    this.recordAudit(app.id, 'APPLICATION_CREATED', input.operatorId, 'OPERATOR');
    return app;
  }

  getForRequester(applicationId: string, requester: Requester): Application {
    const app = this.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    if (requester.role === 'OPERATOR' && app.operatorId !== requester.id) {
      // Deliberately 403, not 404 — PRD edge case #6: don't let a 404
      // silently mask an authorization boundary in a way that's
      // indistinguishable from "doesn't exist" for audit purposes.
      throw new ForbiddenError('You do not have access to this application');
    }
    return app;
  }

  listForRequester(requester: Requester): Application[] {
    if (requester.role === 'OPERATOR') {
      return this.applications.findByOperator(requester.id);
    }
    return this.applications.findAll();
  }

  /**
   * The heart of UC1's resubmission flow: only sections with unresolved,
   * section-targeted feedback may be edited. Anything else in the payload
   * is rejected outright (PRD edge case #1) rather than silently ignored,
   * so the operator gets a clear error instead of a confusing no-op.
   */
  resubmitSections(input: ResubmitSectionsInput): Application {
    const app = this.applications.findById(input.applicationId);
    if (!app) throw new NotFoundError('Application', input.applicationId);
    if (app.operatorId !== input.operatorId) {
      throw new ForbiddenError('You do not have access to this application');
    }
    if (app.status !== 'PENDING_PRE_SITE_RESUBMISSION') {
      throw new ConflictError(
        `Cannot resubmit sections while application is in status ${app.status}`,
      );
    }
    if (input.baseRevision !== app.currentRevision) {
      // PRD edge case #4: reject writes based on a stale revision instead
      // of silently overwriting newer server state.
      throw new ConflictError(
        `Stale revision: application is at revision ${app.currentRevision}, but request was based on revision ${input.baseRevision}`,
      );
    }

    const requestedSections = Object.keys(input.sections) as SectionId[];
    if (requestedSections.length === 0) {
      throw new ValidationError('At least one section must be provided for resubmission');
    }

    const flaggedSectionIds = new Set(
      this.feedback
        .findByApplication(app.id)
        .filter((f) => f.targetType === 'SECTION' && !f.resolved)
        .map((f) => f.targetId as SectionId),
    );

    const invalidSections = requestedSections.filter((s) => !flaggedSectionIds.has(s));
    if (invalidSections.length > 0) {
      throw new ValidationError(
        `Cannot resubmit sections that were not flagged: ${invalidSections.join(', ')}`,
        { sections: 'contains unflagged section(s)' },
      );
    }

    const previousRevision = app.revisions[app.revisions.length - 1];
    const newSections: Record<SectionId, SectionData> = { ...previousRevision.sections };
    for (const sectionId of requestedSections) {
      newSections[sectionId] = input.sections[sectionId] as SectionData;
    }

    const newRevisionNumber = app.currentRevision + 1;
    app.revisions.push({
      revisionNumber: newRevisionNumber,
      sections: newSections,
      submittedAt: new Date().toISOString(),
      submittedBy: input.operatorId,
      changedSections: requestedSections,
    });
    app.currentRevision = newRevisionNumber;

    assertValidTransition(app.status, 'PRE_SITE_RESUBMITTED');
    app.status = 'PRE_SITE_RESUBMITTED';
    app.updatedAt = new Date().toISOString();
    this.applications.save(app);

    this.recordAudit(app.id, 'RESUBMISSION_RECEIVED', input.operatorId, 'OPERATOR', {
      revisionNumber: newRevisionNumber,
      changedSections: requestedSections,
    });
    this.recordAudit(app.id, 'STATUS_CHANGED', input.operatorId, 'OPERATOR', {
      from: 'PENDING_PRE_SITE_RESUBMISSION',
      to: 'PRE_SITE_RESUBMITTED',
    });
    this.notify(app.id, 'OFFICER', 'office', `Application ${app.id} was resubmitted`);

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
    this.recordAudit(applicationId, 'NOTIFICATION_SENT', 'system', recipientRole, { message });
  }
}
