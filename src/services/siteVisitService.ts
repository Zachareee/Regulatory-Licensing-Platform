import { randomUUID } from 'node:crypto';
import { Application, AuditEntry, ChecklistItem, Role, SiteVisitChecklist } from '../domain/types';
import { assertValidTransition, InternalStatus } from '../domain/statusMachine';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors';
import { ApplicationRepository, AuditRepository, ChecklistRepository } from '../repositories/inMemoryStore';

export interface ChecklistItemInput {
  label: string;
  officerComment: string;
  needsClarification: boolean;
}

export interface RespondToClarificationInput {
  applicationId: string;
  operatorId: string;
  itemId: string;
  response: string;
}

export class SiteVisitService {
  constructor(
    private applications: ApplicationRepository,
    private checklists: ChecklistRepository,
    private audit: AuditRepository,
  ) {}

  /**
   * Officer captures/updates checklist items and saves as a draft — e.g.
   * while working through the inspection on an iPad. Does not change the
   * application status. Safe to call repeatedly.
   */
  saveDraft(applicationId: string, officerId: string, items: ChecklistItemInput[]): SiteVisitChecklist {
    const app = this.getApp(applicationId);
    if (app.status !== 'SITE_VISIT_SCHEDULED') {
      throw new ConflictError(
        `Cannot record checklist items while application is in status ${app.status}`,
      );
    }
    if (items.length === 0) {
      throw new ValidationError('At least one checklist item is required');
    }

    const now = new Date().toISOString();
    const checklist: SiteVisitChecklist = {
      applicationId,
      state: 'DRAFT',
      items: items.map((i) => ({
        id: randomUUID(),
        applicationId,
        label: i.label,
        officerComment: i.officerComment,
        needsClarification: i.needsClarification,
        round: 1,
        createdAt: now,
      })),
    };
    this.checklists.save(checklist);
    this.recordAudit(applicationId, 'CHECKLIST_SAVED_DRAFT', officerId, 'OFFICER', {
      itemCount: items.length,
    });
    return checklist;
  }

  /**
   * Finalizes the checklist. If any item is flagged "Needs Further
   * Clarification," the case enters the post-site clarification loop;
   * otherwise it routes straight to approval (PRD edge case #5).
   */
  submitChecklist(applicationId: string, officerId: string): Application {
    const app = this.getApp(applicationId);
    const checklist = this.checklists.get(applicationId);
    if (!checklist) {
      throw new ConflictError('No checklist draft exists for this application');
    }
    if (checklist.state === 'SUBMITTED') {
      throw new ConflictError('Checklist has already been submitted');
    }

    checklist.state = 'SUBMITTED';
    checklist.submittedAt = new Date().toISOString();
    this.checklists.save(checklist);
    this.recordAudit(applicationId, 'CHECKLIST_SUBMITTED', officerId, 'OFFICER');

    this.transition(app, 'SITE_VISIT_DONE', officerId, 'OFFICER');

    const hasFlagged = checklist.items.some((i) => i.needsClarification && !i.operatorResponse);
    const next: InternalStatus = hasFlagged ? 'AWAITING_POST_SITE_CLARIFICATION' : 'PENDING_APPROVAL';
    return this.transition(app, next, officerId, 'OFFICER');
  }

  /**
   * Operator-facing checklist view: only flagged items are returned, never
   * the full checklist (UC3 hard constraint).
   */
  getFlaggedItemsForOperator(applicationId: string, operatorId: string): ChecklistItem[] {
    const app = this.getApp(applicationId);
    if (app.operatorId !== operatorId) {
      throw new ForbiddenError('You do not have access to this application');
    }
    const checklist = this.checklists.get(applicationId);
    if (!checklist) return [];
    return checklist.items.filter((i) => i.needsClarification && !i.operatorResponse);
  }

  respondToClarification(input: RespondToClarificationInput): ChecklistItem {
    const app = this.getApp(input.applicationId);
    if (app.operatorId !== input.operatorId) {
      throw new ForbiddenError('You do not have access to this application');
    }
    if (app.status !== 'AWAITING_POST_SITE_CLARIFICATION' && app.status !== 'PENDING_POST_SITE_RESUBMISSION') {
      throw new ConflictError(`Cannot respond to clarification while status is ${app.status}`);
    }
    const checklist = this.checklists.get(input.applicationId);
    if (!checklist) throw new NotFoundError('Checklist', input.applicationId);

    const item = checklist.items.find((i) => i.id === input.itemId);
    if (!item) throw new NotFoundError('ChecklistItem', input.itemId);
    if (!item.needsClarification) {
      throw new ValidationError('This item was not flagged for clarification');
    }
    if (item.operatorResponse) {
      throw new ConflictError('This item has already received a response for this round');
    }
    if (!input.response || input.response.trim().length === 0) {
      throw new ValidationError('response is required');
    }

    item.operatorResponse = input.response;
    item.operatorRespondedAt = new Date().toISOString();
    this.checklists.save(checklist);
    this.recordAudit(input.applicationId, 'CLARIFICATION_RESPONSE_SUBMITTED', input.operatorId, 'OPERATOR', {
      itemId: item.id,
    });

    const stillOutstanding = checklist.items.some((i) => i.needsClarification && !i.operatorResponse);
    if (!stillOutstanding) {
      this.transition(app, 'POST_SITE_CLARIFICATION_RESUBMITTED', input.operatorId, 'OPERATOR');
    }
    return item;
  }

  /**
   * Officer reviews the operator's responses. For each item still deemed
   * unsatisfactory, a new clarification round is opened (fresh comment,
   * incremented round, response cleared) — this is what drives
   * PENDING_POST_SITE_RESUBMISSION (see SCOPE.md assumption #1). If
   * nothing remains outstanding, the case proceeds to approval routing.
   */
  reviewClarificationResponses(
    applicationId: string,
    officerId: string,
    stillNeedsClarification: { itemId: string; newComment: string }[],
  ): Application {
    const app = this.getApp(applicationId);
    if (app.status !== 'POST_SITE_CLARIFICATION_RESUBMITTED') {
      throw new ConflictError(`Cannot review clarification responses while status is ${app.status}`);
    }
    const checklist = this.checklists.get(applicationId);
    if (!checklist) throw new NotFoundError('Checklist', applicationId);

    for (const entry of stillNeedsClarification) {
      const item = checklist.items.find((i) => i.id === entry.itemId);
      if (!item) throw new ValidationError(`Unknown checklist item: ${entry.itemId}`);
      item.needsClarification = true;
      item.officerComment = entry.newComment;
      item.operatorResponse = undefined;
      item.operatorRespondedAt = undefined;
      item.round += 1;
    }
    this.checklists.save(checklist);

    const next: InternalStatus =
      stillNeedsClarification.length > 0 ? 'PENDING_POST_SITE_RESUBMISSION' : 'PENDING_APPROVAL';
    return this.transition(app, next, officerId, 'OFFICER');
  }

  private getApp(applicationId: string): Application {
    const app = this.applications.findById(applicationId);
    if (!app) throw new NotFoundError('Application', applicationId);
    return app;
  }

  private transition(app: Application, to: InternalStatus, actorId: string, actorRole: Role): Application {
    const from = app.status;
    assertValidTransition(from, to);
    app.status = to;
    app.updatedAt = new Date().toISOString();
    this.applications.save(app);
    this.recordAudit(app.id, 'STATUS_CHANGED', actorId, actorRole, { from, to });
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
}
