import { Express } from 'express';
import { asOfficer, asOperator, freshApp, fullSectionsPayload } from '../helpers/http';

async function createAppAtSiteVisitStage(app: Express) {
  const created = await asOperator(app).post('/applications').send(fullSectionsPayload());
  const id = created.body.id;
  await asOfficer(app).post(`/applications/${id}/review/start`).send({});
  await asOfficer(app).post(`/applications/${id}/review/schedule-site-visit`).send({});
  return id;
}

describe('Site visit routes — role enforcement', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('rejects an operator trying to save a checklist draft', async () => {
    const id = await createAppAtSiteVisitStage(app);
    const res = await asOperator(app)
      .post(`/applications/${id}/site-visit/checklist`)
      .send({ items: [{ label: 'x', officerComment: 'y', needsClarification: false }] });
    expect(res.status).toBe(403);
  });

  it('rejects an officer trying to respond to a clarification item', async () => {
    const id = await createAppAtSiteVisitStage(app);
    await asOfficer(app)
      .post(`/applications/${id}/site-visit/checklist`)
      .send({ items: [{ label: 'x', officerComment: 'y', needsClarification: true }] });
    await asOfficer(app).post(`/applications/${id}/site-visit/submit`).send({});
    const res = await asOfficer(app)
      .post(`/applications/${id}/site-visit/respond`)
      .send({ itemId: 'whatever', response: 'nope, officers cannot do this' });
    expect(res.status).toBe(403);
  });
});

describe('Site visit clarification flow, end to end over HTTP', () => {
  let app: Express;
  beforeEach(() => {
    app = freshApp();
  });

  it('only surfaces flagged items to the operator, and drives the case to approval once resolved', async () => {
    const id = await createAppAtSiteVisitStage(app);

    await asOfficer(app)
      .post(`/applications/${id}/site-visit/checklist`)
      .send({
        items: [
          { label: 'Fire exits clear', officerComment: 'Blocked by boxes', needsClarification: true },
          { label: 'Signage present', officerComment: 'Fine', needsClarification: false },
        ],
      });
    const submitted = await asOfficer(app).post(`/applications/${id}/site-visit/submit`).send({});
    expect(submitted.body.status).toBe('Awaiting Post-Site Clarification');

    const flagged = await asOperator(app).get(`/applications/${id}/site-visit/flagged-items`);
    expect(flagged.status).toBe(200);
    expect(flagged.body).toHaveLength(1);
    expect(flagged.body[0].label).toBe('Fire exits clear');

    const responded = await asOperator(app)
      .post(`/applications/${id}/site-visit/respond`)
      .send({ itemId: flagged.body[0].id, response: 'Boxes removed, exits now clear' });
    expect(responded.status).toBe(200);

    const officerCheck = await asOfficer(app).get(`/applications/${id}`);
    expect(officerCheck.body.status).toBe('Post-Site Clarification Resubmitted');

    const finalDecision = await asOfficer(app)
      .post(`/applications/${id}/site-visit/review-responses`)
      .send({ stillNeedsClarification: [] });
    expect(finalDecision.body.status).toBe('Route to Approval');

    const approved = await asOfficer(app).post(`/applications/${id}/review/approve`).send({});
    expect(approved.body.status).toBe('Approved');
  });

  it('a different operator cannot view or respond to another operator\u2019s flagged items', async () => {
    const id = await createAppAtSiteVisitStage(app);
    await asOfficer(app)
      .post(`/applications/${id}/site-visit/checklist`)
      .send({ items: [{ label: 'x', officerComment: 'y', needsClarification: true }] });
    await asOfficer(app).post(`/applications/${id}/site-visit/submit`).send({});

    const res = await asOperator(app, 'op-intruder').get(`/applications/${id}/site-visit/flagged-items`);
    expect(res.status).toBe(403);
  });

  it('opens a new clarification round when the officer is not satisfied', async () => {
    const id = await createAppAtSiteVisitStage(app);
    await asOfficer(app)
      .post(`/applications/${id}/site-visit/checklist`)
      .send({ items: [{ label: 'Waste disposal', officerComment: 'Needs permit', needsClarification: true }] });
    await asOfficer(app).post(`/applications/${id}/site-visit/submit`).send({});

    const flagged = await asOperator(app).get(`/applications/${id}/site-visit/flagged-items`);
    await asOperator(app)
      .post(`/applications/${id}/site-visit/respond`)
      .send({ itemId: flagged.body[0].id, response: 'Attached permit application receipt' });

    const secondRound = await asOfficer(app)
      .post(`/applications/${id}/site-visit/review-responses`)
      .send({
        stillNeedsClarification: [
          { itemId: flagged.body[0].id, newComment: 'A receipt is not a permit. Please provide the issued permit.' },
        ],
      });
    expect(secondRound.body.status).toBe('Awaiting Post-Site Resubmission');

    const stillFlagged = await asOperator(app).get(`/applications/${id}/site-visit/flagged-items`);
    expect(stillFlagged.body).toHaveLength(1);
    expect(stillFlagged.body[0].round).toBe(2);
  });
});
