import { createInMemoryStore, Store } from '../../src/repositories/inMemoryStore';
import { ApplicationService } from '../../src/services/applicationService';
import { DocumentService } from '../../src/services/documentService';
import { ReviewService } from '../../src/services/reviewService';
import { SiteVisitService } from '../../src/services/siteVisitService';
import { SECTION_IDS, SectionData, SectionId } from '../../src/domain/types';

export function fullSections(): Record<SectionId, SectionData> {
  const sections = {} as Record<SectionId, SectionData>;
  for (const id of SECTION_IDS) {
    sections[id] = { note: `initial ${id} data` };
  }
  return sections;
}

export function buildServices(store: Store = createInMemoryStore()) {
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

  return { store, applicationService, documentService, reviewService, siteVisitService };
}
