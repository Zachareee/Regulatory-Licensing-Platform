import { Express } from 'express';
import { asOfficer, asOperator, freshApp, fullSectionsPayload } from '../helpers/http';

describe('POST /applications', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('requires auth headers', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/applications').send(fullSectionsPayload());
    expect(res.status).toBe(401);
  });

  it('rejects an officer trying to create an application', async () => {
    const res = await asOfficer(app).post('/applications').send(fullSectionsPayload());
    expect(res.status).toBe(403);
  });

  it('creates an application and shows the operator label "Submitted", never the internal enum', async () => {
    const res = await asOperator(app).post('/applications').send(fullSectionsPayload());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Submitted');
    expect(JSON.stringify(res.body)).not.toContain('APPLICATION_RECEIVED');
  });

  it('rejects an incomplete submission with a 400 and field detail', async () => {
    const payload = fullSectionsPayload();
    delete (payload.sections as Record<string, unknown>).premises;
    const res = await asOperator(app).post('/applications').send(payload);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown section key via schema validation', async () => {
    const payload = fullSectionsPayload();
    (payload.sections as Record<string, unknown>).not_a_real_section = { x: 1 };
    const res = await asOperator(app).post('/applications').send(payload);
    expect(res.status).toBe(400);
  });
});

describe('GET /applications/:id — role isolation', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('a different operator gets 403, not the data, not a silent 404 that could be probed', async () => {
    const created = await asOperator(app, 'op-1').post('/applications').send(fullSectionsPayload());
    const res = await asOperator(app, 'op-2').get(`/applications/${created.body.id}`);
    expect(res.status).toBe(403);
  });

  it('an officer can view any application and sees the internal-flavored officer label', async () => {
    const created = await asOperator(app, 'op-1').post('/applications').send(fullSectionsPayload());
    const res = await asOfficer(app).get(`/applications/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Application Received');
    expect(res.body.operatorId).toBe('op-1');
  });

  it('the operator view never includes operatorId or revisionHistory (officer-only fields)', async () => {
    const created = await asOperator(app, 'op-1').post('/applications').send(fullSectionsPayload());
    const res = await asOperator(app, 'op-1').get(`/applications/${created.body.id}`);
    expect(res.body.operatorId).toBeUndefined();
    expect(res.body.revisionHistory).toBeUndefined();
  });

  it('returns 404 for a genuinely non-existent application id', async () => {
    const res = await asOfficer(app).get('/applications/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('Full pre-site resubmission round trip via HTTP', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('never exposes "Route to Approval" to the operator, and hides unflagged-section edits', async () => {
    const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
    const id = created.body.id;

    await asOfficer(app).post(`/applications/${id}/review/start`).send({});
    const afterFeedback = await asOfficer(app)
      .post(`/applications/${id}/review/request-changes`)
      .send({ items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'Add last FY figures' }] });
    expect(afterFeedback.body.status).toBe('Pending Pre-Site Resubmission');

    // Attempting to sneak in a change to an unflagged section is rejected.
    const badResubmit = await asOperator(app)
      .patch(`/applications/${id}/sections`)
      .send({ baseRevision: 1, sections: { ownership: { owners: ['New Owner'] } } });
    expect(badResubmit.status).toBe(400);

    const resubmit = await asOperator(app)
      .patch(`/applications/${id}/sections`)
      .send({ baseRevision: 1, sections: { financials: { annualRevenue: 750000 } } });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.status).toBe('Pre-Site Resubmitted');
    expect(resubmit.body.sections.business_info).toEqual({ legalName: 'Acme Trading Pte Ltd' });

    const officerView = await asOfficer(app).get(`/applications/${id}`);
    expect(JSON.stringify(officerView.body)).not.toContain('Route to Approval');
  });
});

describe('Document upload', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('uploads a document and reports a mocked AI verification status', async () => {
    const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
    const res = await asOperator(app)
      .post(`/applications/${created.body.id}/documents`)
      .send({
        sectionId: 'financials',
        filename: 'statement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });
    expect(res.status).toBe(201);
    expect(res.body.verificationStatus).toBe('VERIFIED');
  });

  it('rejects a document upload to an application owned by someone else', async () => {
    const created = await asOperator(app, 'op-1').post('/applications').send(fullSectionsPayload());
    const res = await asOperator(app, 'op-2')
      .post(`/applications/${created.body.id}/documents`)
      .send({
        sectionId: 'financials',
        filename: 'statement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      });
    expect(res.status).toBe(403);
  });
});
