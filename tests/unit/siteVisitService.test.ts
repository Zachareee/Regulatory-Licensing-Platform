import { buildServices, fullSections } from '../helpers/fixtures';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/domain/errors';

function createSiteVisitReadyApp() {
  const services = buildServices();
  const app = services.applicationService.create({ operatorId: 'op-1', sections: fullSections() });
  services.reviewService.startReview(app.id, 'officer-1');
  services.reviewService.scheduleSiteVisit(app.id, 'officer-1');
  return { ...services, app };
}

describe('SiteVisitService.saveDraft + submitChecklist', () => {
  it('routes straight to PENDING_APPROVAL when nothing is flagged (edge case #5)', () => {
    const { siteVisitService, app } = createSiteVisitReadyApp();
    siteVisitService.saveDraft(app.id, 'officer-1', [
      { label: 'Fire exits clear', officerComment: 'Looks good', needsClarification: false },
      { label: 'Signage present', officerComment: 'Looks good', needsClarification: false },
    ]);
    const updated = siteVisitService.submitChecklist(app.id, 'officer-1');
    expect(updated.status).toBe('PENDING_APPROVAL');
  });

  it('routes to AWAITING_POST_SITE_CLARIFICATION when at least one item is flagged', () => {
    const { siteVisitService, app } = createSiteVisitReadyApp();
    siteVisitService.saveDraft(app.id, 'officer-1', [
      { label: 'Fire exits clear', officerComment: 'Blocked by boxes', needsClarification: true },
      { label: 'Signage present', officerComment: 'Fine', needsClarification: false },
    ]);
    const updated = siteVisitService.submitChecklist(app.id, 'officer-1');
    expect(updated.status).toBe('AWAITING_POST_SITE_CLARIFICATION');
  });

  it('rejects saving a checklist before a site visit is scheduled', () => {
    const services = buildServices();
    const app = services.applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    expect(() =>
      services.siteVisitService.saveDraft(app.id, 'officer-1', [
        { label: 'x', officerComment: 'y', needsClarification: false },
      ]),
    ).toThrow(ConflictError);
  });

  it('rejects submitting a checklist twice', () => {
    const { siteVisitService, app } = createSiteVisitReadyApp();
    siteVisitService.saveDraft(app.id, 'officer-1', [
      { label: 'x', officerComment: 'y', needsClarification: false },
    ]);
    siteVisitService.submitChecklist(app.id, 'officer-1');
    expect(() => siteVisitService.submitChecklist(app.id, 'officer-1')).toThrow(ConflictError);
  });

  it('rejects submitting with no draft at all', () => {
    const { siteVisitService, app } = createSiteVisitReadyApp();
    expect(() => siteVisitService.submitChecklist(app.id, 'officer-1')).toThrow(ConflictError);
  });
});

describe('Operator visibility of the checklist (UC3 hard constraint)', () => {
  it('only returns flagged items to the operator, never the full checklist', () => {
    const { siteVisitService, app } = createSiteVisitReadyApp();
    siteVisitService.saveDraft(app.id, 'officer-1', [
      { label: 'Fire exits clear', officerComment: 'Blocked', needsClarification: true },
      { label: 'Signage present', officerComment: 'Fine', needsClarification: false },
      { label: 'Ventilation adequate', officerComment: 'Needs proof of servicing', needsClarification: true },
    ]);
    siteVisitService.submitChecklist(app.id, 'officer-1');

    const visible = siteVisitService.getFlaggedItemsForOperator(app.id, 'op-1');
    expect(visible).toHaveLength(2);
    expect(visible.every((i) => i.needsClarification)).toBe(true);
    expect(visible.find((i) => i.label === 'Signage present')).toBeUndefined();
  });

  it('forbids a different operator from viewing flagged items', () => {
    const { siteVisitService, app } = createSiteVisitReadyApp();
    siteVisitService.saveDraft(app.id, 'officer-1', [
      { label: 'x', officerComment: 'y', needsClarification: true },
    ]);
    siteVisitService.submitChecklist(app.id, 'officer-1');
    expect(() => siteVisitService.getFlaggedItemsForOperator(app.id, 'op-2')).toThrow(ForbiddenError);
  });
});

describe('Operator response + officer re-review loop', () => {
  function submitWithTwoFlags() {
    const ctx = createSiteVisitReadyApp();
    ctx.siteVisitService.saveDraft(ctx.app.id, 'officer-1', [
      { label: 'Item A', officerComment: 'fix A', needsClarification: true },
      { label: 'Item B', officerComment: 'fix B', needsClarification: true },
    ]);
    ctx.siteVisitService.submitChecklist(ctx.app.id, 'officer-1');
    const items = ctx.siteVisitService.getFlaggedItemsForOperator(ctx.app.id, 'op-1');
    return { ...ctx, items };
  }

  it('stays in the clarification stage until every flagged item has a response', () => {
    const { siteVisitService, app, items } = submitWithTwoFlags();
    const afterFirst = siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[0].id,
      response: 'Fixed A',
    });
    expect(afterFirst.operatorResponse).toBe('Fixed A');

    const stillAwaiting = siteVisitService.getFlaggedItemsForOperator(app.id, 'op-1');
    expect(stillAwaiting).toHaveLength(1); // item A now has a response, so it's excluded (edge case #7 partial-resolution)
  });

  it('transitions to POST_SITE_CLARIFICATION_RESUBMITTED once all flagged items are answered', () => {
    const { siteVisitService, applicationService, app, items } = submitWithTwoFlags();
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[0].id,
      response: 'Fixed A',
    });
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[1].id,
      response: 'Fixed B',
    });
    const updated = applicationService.getForRequester(app.id, { id: 'officer-1', role: 'OFFICER' });
    expect(updated.status).toBe('POST_SITE_CLARIFICATION_RESUBMITTED');
  });

  it('rejects a duplicate response to the same item in the same round', () => {
    const { siteVisitService, app, items } = submitWithTwoFlags();
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[0].id,
      response: 'Fixed A',
    });
    expect(() =>
      siteVisitService.respondToClarification({
        applicationId: app.id,
        operatorId: 'op-1',
        itemId: items[0].id,
        response: 'Fixed A again',
      }),
    ).toThrow(ConflictError);
  });

  it('rejects responding to an item that was never flagged', () => {
    const { siteVisitService, store, app } = createSiteVisitReadyApp();
    siteVisitService.saveDraft(app.id, 'officer-1', [
      { label: 'Item A', officerComment: 'flagged', needsClarification: true },
      { label: 'Item B', officerComment: 'fine', needsClarification: false },
    ]);
    siteVisitService.submitChecklist(app.id, 'officer-1');

    // The operator-facing endpoint would never surface Item B's id, but a
    // malicious or buggy client could still try to POST it directly —
    // the service layer must reject it independently of what the UI shows.
    const fullChecklist = store.checklists.get(app.id)!;
    const nonFlaggedItem = fullChecklist.items.find((i) => !i.needsClarification)!;

    expect(() =>
      siteVisitService.respondToClarification({
        applicationId: app.id,
        operatorId: 'op-1',
        itemId: nonFlaggedItem.id,
        response: 'trying to respond anyway',
      }),
    ).toThrow(ValidationError);
  });

  it('opens a new round when the officer is not satisfied, driving PENDING_POST_SITE_RESUBMISSION', () => {
    const { siteVisitService, app, items } = submitWithTwoFlags();
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[0].id,
      response: 'Fixed A',
    });
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[1].id,
      response: 'Partially fixed B',
    });

    const updated = siteVisitService.reviewClarificationResponses(app.id, 'officer-1', [
      { itemId: items[1].id, newComment: 'B is still not resolved, please redo' },
    ]);
    expect(updated.status).toBe('PENDING_POST_SITE_RESUBMISSION');

    // Item B should be visible to the operator again in the new round;
    // Item A should not be, since it was resolved.
    const visibleAgain = siteVisitService.getFlaggedItemsForOperator(app.id, 'op-1');
    expect(visibleAgain).toHaveLength(1);
    expect(visibleAgain[0].id).toBe(items[1].id);
    expect(visibleAgain[0].round).toBe(2);
  });

  it('routes to PENDING_APPROVAL when the officer is satisfied with all responses', () => {
    const { siteVisitService, app, items } = submitWithTwoFlags();
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[0].id,
      response: 'Fixed A',
    });
    siteVisitService.respondToClarification({
      applicationId: app.id,
      operatorId: 'op-1',
      itemId: items[1].id,
      response: 'Fixed B',
    });
    const updated = siteVisitService.reviewClarificationResponses(app.id, 'officer-1', []);
    expect(updated.status).toBe('PENDING_APPROVAL');
  });

  it('rejects a response with only whitespace', () => {
    const { siteVisitService, app, items } = submitWithTwoFlags();
    expect(() =>
      siteVisitService.respondToClarification({
        applicationId: app.id,
        operatorId: 'op-1',
        itemId: items[0].id,
        response: '   ',
      }),
    ).toThrow(ValidationError);
  });
});
