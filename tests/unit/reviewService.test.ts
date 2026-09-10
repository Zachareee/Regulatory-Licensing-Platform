import { buildServices, fullSections } from '../helpers/fixtures';
import { ConflictError, ValidationError } from '../../src/domain/errors';
import { InvalidTransitionError } from '../../src/domain/statusMachine';

function createReviewedApp() {
  const services = buildServices();
  const app = services.applicationService.create({ operatorId: 'op-1', sections: fullSections() });
  services.reviewService.startReview(app.id, 'officer-1');
  return { ...services, app };
}

describe('ReviewService.requestChanges', () => {
  it('creates feedback and moves the application to PENDING_PRE_SITE_RESUBMISSION', () => {
    const { reviewService, app } = createReviewedApp();
    const updated = reviewService.requestChanges({
      applicationId: app.id,
      officerId: 'officer-1',
      items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'Missing figures' }],
    });
    expect(updated.status).toBe('PENDING_PRE_SITE_RESUBMISSION');
    expect(reviewService.listFeedback(app.id)).toHaveLength(1);
  });

  it('rejects feedback that targets a section that does not exist on the application', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() =>
      reviewService.requestChanges({
        applicationId: app.id,
        officerId: 'officer-1',
        items: [{ targetType: 'SECTION', targetId: 'not_a_real_section', comment: 'x' }],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects feedback that targets a document that does not exist', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() =>
      reviewService.requestChanges({
        applicationId: app.id,
        officerId: 'officer-1',
        items: [{ targetType: 'DOCUMENT', targetId: 'no-such-doc', comment: 'x' }],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a feedback item with neither a comment nor a templateId', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() =>
      reviewService.requestChanges({
        applicationId: app.id,
        officerId: 'officer-1',
        items: [{ targetType: 'SECTION', targetId: 'financials' }],
      }),
    ).toThrow(ValidationError);
  });

  it('accepts a feedback item using a predefined template', () => {
    const { reviewService, app } = createReviewedApp();
    const updated = reviewService.requestChanges({
      applicationId: app.id,
      officerId: 'officer-1',
      items: [{ targetType: 'SECTION', targetId: 'financials', templateId: 'info-incomplete' }],
    });
    expect(updated.status).toBe('PENDING_PRE_SITE_RESUBMISSION');
    const [fb] = reviewService.listFeedback(app.id);
    expect(fb.comment).toMatch(/missing required information/i);
  });

  it('rejects an unknown templateId', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() =>
      reviewService.requestChanges({
        applicationId: app.id,
        officerId: 'officer-1',
        items: [{ targetType: 'SECTION', targetId: 'financials', templateId: 'not-a-template' }],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects requesting changes on an application not under review', () => {
    const { applicationService, reviewService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    // still APPLICATION_RECEIVED, never started review
    expect(() =>
      reviewService.requestChanges({
        applicationId: app.id,
        officerId: 'officer-1',
        items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'x' }],
      }),
    ).toThrow(ConflictError);
  });

  it('does not write any feedback if one item in the batch is invalid (all-or-nothing)', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() =>
      reviewService.requestChanges({
        applicationId: app.id,
        officerId: 'officer-1',
        items: [
          { targetType: 'SECTION', targetId: 'financials', comment: 'ok' },
          { targetType: 'SECTION', targetId: 'bogus_section', comment: 'bad' },
        ],
      }),
    ).toThrow(ValidationError);
    expect(reviewService.listFeedback(app.id)).toHaveLength(0);
  });
});

describe('ReviewService status transitions', () => {
  it('schedules a site visit from UNDER_REVIEW', () => {
    const { reviewService, app } = createReviewedApp();
    const updated = reviewService.scheduleSiteVisit(app.id, 'officer-1');
    expect(updated.status).toBe('SITE_VISIT_SCHEDULED');
  });

  it('rejects scheduling a site visit twice', () => {
    const { reviewService, app } = createReviewedApp();
    reviewService.scheduleSiteVisit(app.id, 'officer-1');
    expect(() => reviewService.scheduleSiteVisit(app.id, 'officer-1')).toThrow(ConflictError);
  });

  it('rejects an application without a reason', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() => reviewService.reject(app.id, 'officer-1', '')).toThrow(ValidationError);
  });

  it('rejects an application with a reason, from UNDER_REVIEW', () => {
    const { reviewService, app } = createReviewedApp();
    const updated = reviewService.reject(app.id, 'officer-1', 'Ineligible business type');
    expect(updated.status).toBe('REJECTED');
  });

  it('cannot approve an application that has not reached PENDING_APPROVAL', () => {
    const { reviewService, app } = createReviewedApp();
    expect(() => reviewService.approve(app.id, 'officer-1')).toThrow(InvalidTransitionError);
  });
});

describe('ReviewService.resolveFeedback', () => {
  it('marks feedback resolved and rejects double-resolution', () => {
    const { reviewService, app } = createReviewedApp();
    reviewService.requestChanges({
      applicationId: app.id,
      officerId: 'officer-1',
      items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'fix it' }],
    });
    const [fb] = reviewService.listFeedback(app.id);
    const resolved = reviewService.resolveFeedback(fb.id, 'officer-1');
    expect(resolved.resolved).toBe(true);
    expect(() => reviewService.resolveFeedback(fb.id, 'officer-1')).toThrow(ConflictError);
  });
});

describe('ReviewService.compareRevisions', () => {
  it('reports which sections changed between two revisions', () => {
    const { applicationService, reviewService, app } = createReviewedApp();
    reviewService.requestChanges({
      applicationId: app.id,
      officerId: 'officer-1',
      items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'fix' }],
    });
    applicationService.resubmitSections({
      applicationId: app.id,
      operatorId: 'op-1',
      baseRevision: app.currentRevision,
      sections: { financials: { note: 'new numbers' } },
    });
    const diff = reviewService.compareRevisions(app.id, 1, 2);
    expect(diff.changedSections).toEqual(['financials']);
  });
});
