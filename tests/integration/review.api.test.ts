import { Express } from 'express';
import { asOfficer, asOperator, freshApp, fullSectionsPayload } from '../helpers/http';

async function createAndStartReview(app: Express) {
  const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
  const id = created.body.id;
  await asOfficer(app).post(`/applications/${id}/review/start`).send({});
  return id;
}

describe('Review routes — role enforcement', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('rejects an operator trying to start a review', async () => {
    const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
    const res = await asOperator(app).post(`/applications/${created.body.id}/review/start`).send({});
    expect(res.status).toBe(403);
  });

  it('rejects an operator trying to approve an application', async () => {
    const id = await createAndStartReview(app);
    const res = await asOperator(app).post(`/applications/${id}/review/approve`).send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /comment-templates', () => {
  it('is available to any authenticated role', async () => {
    const app = freshApp();
    const res = await asOfficer(app).get('/comment-templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Full lifecycle: review -> site visit -> approval, via HTTP', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('drives an application end-to-end to APPROVED', async () => {
    const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
    const id = created.body.id;

    await asOfficer(app).post(`/applications/${id}/review/start`).send({});
    const scheduled = await asOfficer(app)
      .post(`/applications/${id}/review/schedule-site-visit`)
      .send({});
    expect(scheduled.body.status).toBe('Site Visit Scheduled');

    await asOfficer(app)
      .post(`/applications/${id}/site-visit/checklist`)
      .send({ items: [{ label: 'Fire safety', officerComment: 'All clear', needsClarification: false }] });
    const submitted = await asOfficer(app).post(`/applications/${id}/site-visit/submit`).send({});
    expect(submitted.body.status).toBe('Route to Approval');

    const approved = await asOfficer(app).post(`/applications/${id}/review/approve`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('Approved');

    const operatorFinalView = await asOperator(app).get(`/applications/${id}`);
    expect(operatorFinalView.body.status).toBe('Approved');
  });

  it('rejects an application with a documented reason', async () => {
    const id = await createAndStartReview(app);
    const res = await asOfficer(app)
      .post(`/applications/${id}/review/reject`)
      .send({ reason: 'Business type not eligible for this licence class' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Rejected');
  });

  it('rejects a reject-without-reason with a 400', async () => {
    const id = await createAndStartReview(app);
    const res = await asOfficer(app).post(`/applications/${id}/review/reject`).send({});
    expect(res.status).toBe(400);
  });

  it('compares two revisions and returns changed sections', async () => {
    const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
    const id = created.body.id;
    await asOfficer(app).post(`/applications/${id}/review/start`).send({});
    await asOfficer(app)
      .post(`/applications/${id}/review/request-changes`)
      .send({ items: [{ targetType: 'SECTION', targetId: 'financials', comment: 'fix' }] });
    await asOperator(app)
      .patch(`/applications/${id}/sections`)
      .send({ baseRevision: 1, sections: { financials: { annualRevenue: 999999 } } });

    const diff = await asOfficer(app).get(`/applications/${id}/compare?from=1&to=2`);
    expect(diff.status).toBe(200);
    expect(diff.body.changedSections).toEqual(['financials']);
  });
});
