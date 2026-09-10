import { buildServices, fullSections } from '../helpers/fixtures';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/domain/errors';

describe('ApplicationService.create', () => {
  it('creates an application in APPLICATION_RECEIVED with revision 1', () => {
    const { applicationService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    expect(app.status).toBe('APPLICATION_RECEIVED');
    expect(app.currentRevision).toBe(1);
    expect(app.revisions).toHaveLength(1);
  });

  it('rejects a submission missing a required section', () => {
    const { applicationService } = buildServices();
    const sections = fullSections();
    delete (sections as Record<string, unknown>).financials;
    expect(() => applicationService.create({ operatorId: 'op-1', sections })).toThrow(
      ValidationError,
    );
  });

  it('rejects a submission with no operatorId', () => {
    const { applicationService } = buildServices();
    expect(() => applicationService.create({ operatorId: '', sections: fullSections() })).toThrow(
      ValidationError,
    );
  });
});

describe('ApplicationService.getForRequester', () => {
  it('allows the owning operator to fetch their application', () => {
    const { applicationService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    const fetched = applicationService.getForRequester(app.id, { id: 'op-1', role: 'OPERATOR' });
    expect(fetched.id).toBe(app.id);
  });

  it('forbids a different operator from fetching another operator application (edge case: 403 not 404)', () => {
    const { applicationService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    expect(() =>
      applicationService.getForRequester(app.id, { id: 'op-2', role: 'OPERATOR' }),
    ).toThrow(ForbiddenError);
  });

  it('allows any officer to fetch any application', () => {
    const { applicationService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    const fetched = applicationService.getForRequester(app.id, { id: 'officer-1', role: 'OFFICER' });
    expect(fetched.id).toBe(app.id);
  });
});

describe('ApplicationService.resubmitSections', () => {
  function setupFlaggedApp() {
    const services = buildServices();
    const { applicationService, reviewService } = services;
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    reviewService.startReview(app.id, 'officer-1');
    reviewService.requestChanges({
      applicationId: app.id,
      officerId: 'officer-1',
      items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'Add last year figures' }],
    });
    return { ...services, app };
  }

  it('allows resubmitting only the flagged section', () => {
    const { applicationService, app } = setupFlaggedApp();
    const baseRevision = app.currentRevision;
    const updated = applicationService.resubmitSections({
      applicationId: app.id,
      operatorId: 'op-1',
      baseRevision,
      sections: { financials: { note: 'updated financials' } },
    });
    expect(updated.status).toBe('PRE_SITE_RESUBMITTED');
    expect(updated.currentRevision).toBe(baseRevision + 1);
    const latest = updated.revisions[updated.revisions.length - 1];
    expect(latest.changedSections).toEqual(['financials']);
    // untouched sections carry forward unchanged (no data loss)
    expect(latest.sections.business_info).toEqual({ note: 'initial business_info data' });
  });

  it('rejects resubmitting a section that was not flagged (edge case #1)', () => {
    const { applicationService, app } = setupFlaggedApp();
    expect(() =>
      applicationService.resubmitSections({
        applicationId: app.id,
        operatorId: 'op-1',
        baseRevision: app.currentRevision,
        sections: { ownership: { note: 'sneaky unrelated change' } },
      }),
    ).toThrow(ValidationError);
  });

  it('rejects resubmission based on a stale revision number (edge case #4)', () => {
    const { applicationService, app } = setupFlaggedApp();
    expect(() =>
      applicationService.resubmitSections({
        applicationId: app.id,
        operatorId: 'op-1',
        baseRevision: app.currentRevision - 1,
        sections: { financials: { note: 'stale write' } },
      }),
    ).toThrow(ConflictError);
  });

  it('rejects resubmission when the application is not awaiting resubmission', () => {
    const { applicationService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    // status is APPLICATION_RECEIVED, not PENDING_PRE_SITE_RESUBMISSION
    expect(() =>
      applicationService.resubmitSections({
        applicationId: app.id,
        operatorId: 'op-1',
        baseRevision: app.currentRevision,
        sections: { financials: { note: 'x' } },
      }),
    ).toThrow(ConflictError);
  });

  it('rejects resubmission by someone other than the owning operator', () => {
    const { applicationService, app } = setupFlaggedApp();
    expect(() =>
      applicationService.resubmitSections({
        applicationId: app.id,
        operatorId: 'op-2',
        baseRevision: app.currentRevision,
        sections: { financials: { note: 'x' } },
      }),
    ).toThrow(ForbiddenError);
  });

  it('rejects an empty sections payload', () => {
    const { applicationService, app } = setupFlaggedApp();
    expect(() =>
      applicationService.resubmitSections({
        applicationId: app.id,
        operatorId: 'op-1',
        baseRevision: app.currentRevision,
        sections: {},
      }),
    ).toThrow(ValidationError);
  });

  it('preserves full revision history across multiple resubmission rounds (no data loss)', () => {
    const { applicationService, reviewService, app } = setupFlaggedApp();
    const r2 = applicationService.resubmitSections({
      applicationId: app.id,
      operatorId: 'op-1',
      baseRevision: app.currentRevision,
      sections: { financials: { note: 'round 2 financials' } },
    });
    reviewService.startReview(app.id, 'officer-1');
    reviewService.requestChanges({
      applicationId: app.id,
      officerId: 'officer-1',
      items: [{ targetType: 'SECTION', targetId: 'premises', comment: 'need floor plan' }],
    });
    const r3 = applicationService.resubmitSections({
      applicationId: app.id,
      operatorId: 'op-1',
      baseRevision: r2.currentRevision,
      sections: { premises: { note: 'round 3 premises' } },
    });

    expect(r3.revisions).toHaveLength(3);
    expect(r3.revisions[0].sections.business_info).toEqual({ note: 'initial business_info data' });
    expect(r3.revisions[1].sections.financials).toEqual({ note: 'round 2 financials' });
    expect(r3.revisions[2].sections.financials).toEqual({ note: 'round 2 financials' }); // carried forward
    expect(r3.revisions[2].sections.premises).toEqual({ note: 'round 3 premises' });
  });
});
