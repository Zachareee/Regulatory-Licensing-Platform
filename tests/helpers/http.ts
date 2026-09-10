import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/api/app';

export function freshApp(): Express {
  return createApp().app;
}

export function asOperator(app: Express, id = 'op-1') {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('X-User-Id', id).set('X-User-Role', 'OPERATOR'),
    post: (url: string) => agent.post(url).set('X-User-Id', id).set('X-User-Role', 'OPERATOR'),
    patch: (url: string) => agent.patch(url).set('X-User-Id', id).set('X-User-Role', 'OPERATOR'),
  };
}

export function asOfficer(app: Express, id = 'officer-1') {
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('X-User-Id', id).set('X-User-Role', 'OFFICER'),
    post: (url: string) => agent.post(url).set('X-User-Id', id).set('X-User-Role', 'OFFICER'),
    patch: (url: string) => agent.patch(url).set('X-User-Id', id).set('X-User-Role', 'OFFICER'),
  };
}

export function fullSectionsPayload() {
  return {
    sections: {
      business_info: { legalName: 'Acme Trading Pte Ltd' },
      ownership: { owners: ['Jane Doe'] },
      financials: { annualRevenue: 500000 },
      premises: { address: '1 Example Rd' },
    },
  };
}
