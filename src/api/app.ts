import express, { Express } from 'express';
import { createInMemoryStore, Store } from '../repositories/inMemoryStore';
import { ApplicationService } from '../services/applicationService';
import { DocumentService } from '../services/documentService';
import { ReviewService } from '../services/reviewService';
import { SiteVisitService } from '../services/siteVisitService';
import { buildApplicationRoutes } from './routes/applications';
import { buildReviewRoutes } from './routes/review';
import { buildSiteVisitRoutes } from './routes/siteVisit';
import { errorHandler } from './middleware/errorHandler';

export interface AppBundle {
  app: Express;
  store: Store;
}

/**
 * Builds a fully wired Express app plus the underlying store, so tests can
 * spin up an isolated instance per test (no shared in-memory state leaking
 * between test cases) while production uses a single long-lived instance.
 */
export function createApp(store: Store = createInMemoryStore()): AppBundle {
  const applicationService = new ApplicationService(
    store.applications,
    store.feedback,
    store.audit,
    store.notifications,
  );
  const documentService = new DocumentService(store.documents, store.applications);
  const reviewService = new ReviewService(
    store.applications,
    store.feedback,
    store.documents,
    store.audit,
    store.notifications,
  );
  const siteVisitService = new SiteVisitService(store.applications, store.checklists, store.audit);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(
    '/applications',
    buildApplicationRoutes({ applicationService, documentService, reviewService }),
  );
  app.use(buildReviewRoutes({ reviewService, applicationService, documentService }));
  app.use(buildSiteVisitRoutes({ siteVisitService, applicationService, documentService, reviewService }));

  app.use(errorHandler);

  return { app, store };
}
