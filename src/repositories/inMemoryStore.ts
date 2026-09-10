import {
  Application,
  AuditEntry,
  DocumentRecord,
  Feedback,
  NotificationEvent,
  SiteVisitChecklist,
} from '../domain/types';

/**
 * In-memory repository layer (see SCOPE.md: swappable behind these
 * interfaces for a real DB later). Services depend only on the interfaces
 * below, never on this class directly, so a Postgres-backed implementation
 * is a drop-in replacement with no service-layer changes.
 */

export interface ApplicationRepository {
  create(app: Application): Application;
  findById(id: string): Application | undefined;
  save(app: Application): Application;
  findByOperator(operatorId: string): Application[];
  findAll(): Application[];
}

export interface DocumentRepository {
  add(doc: DocumentRecord): DocumentRecord;
  findByApplication(applicationId: string): DocumentRecord[];
  findById(id: string): DocumentRecord | undefined;
  update(doc: DocumentRecord): DocumentRecord;
}

export interface FeedbackRepository {
  add(feedback: Feedback): Feedback;
  findByApplication(applicationId: string): Feedback[];
  findById(id: string): Feedback | undefined;
  update(feedback: Feedback): Feedback;
}

export interface ChecklistRepository {
  get(applicationId: string): SiteVisitChecklist | undefined;
  save(checklist: SiteVisitChecklist): SiteVisitChecklist;
}

export interface AuditRepository {
  append(entry: AuditEntry): AuditEntry;
  findByApplication(applicationId: string): AuditEntry[];
}

export interface NotificationRepository {
  add(event: NotificationEvent): NotificationEvent;
  findByRecipient(recipientId: string): NotificationEvent[];
}

export class InMemoryApplicationRepository implements ApplicationRepository {
  private store = new Map<string, Application>();

  create(app: Application): Application {
    this.store.set(app.id, app);
    return app;
  }

  findById(id: string): Application | undefined {
    return this.store.get(id);
  }

  save(app: Application): Application {
    this.store.set(app.id, app);
    return app;
  }

  findByOperator(operatorId: string): Application[] {
    return [...this.store.values()].filter((a) => a.operatorId === operatorId);
  }

  findAll(): Application[] {
    return [...this.store.values()];
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  private store = new Map<string, DocumentRecord>();

  add(doc: DocumentRecord): DocumentRecord {
    this.store.set(doc.id, doc);
    return doc;
  }

  findByApplication(applicationId: string): DocumentRecord[] {
    return [...this.store.values()].filter((d) => d.applicationId === applicationId);
  }

  findById(id: string): DocumentRecord | undefined {
    return this.store.get(id);
  }

  update(doc: DocumentRecord): DocumentRecord {
    this.store.set(doc.id, doc);
    return doc;
  }
}

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private store = new Map<string, Feedback>();

  add(feedback: Feedback): Feedback {
    this.store.set(feedback.id, feedback);
    return feedback;
  }

  findByApplication(applicationId: string): Feedback[] {
    return [...this.store.values()].filter((f) => f.applicationId === applicationId);
  }

  findById(id: string): Feedback | undefined {
    return this.store.get(id);
  }

  update(feedback: Feedback): Feedback {
    this.store.set(feedback.id, feedback);
    return feedback;
  }
}

export class InMemoryChecklistRepository implements ChecklistRepository {
  private store = new Map<string, SiteVisitChecklist>();

  get(applicationId: string): SiteVisitChecklist | undefined {
    return this.store.get(applicationId);
  }

  save(checklist: SiteVisitChecklist): SiteVisitChecklist {
    this.store.set(checklist.applicationId, checklist);
    return checklist;
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private entries: AuditEntry[] = [];

  append(entry: AuditEntry): AuditEntry {
    // Append-only by construction: no update/delete method exists on this
    // repository (PRD edge case #10).
    this.entries.push(entry);
    return entry;
  }

  findByApplication(applicationId: string): AuditEntry[] {
    return this.entries.filter((e) => e.applicationId === applicationId);
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private events: NotificationEvent[] = [];

  add(event: NotificationEvent): NotificationEvent {
    this.events.push(event);
    return event;
  }

  findByRecipient(recipientId: string): NotificationEvent[] {
    return this.events.filter((e) => e.recipientId === recipientId);
  }
}

/**
 * Bundles all repositories so services/tests can construct a fresh,
 * isolated in-memory "database" with one call.
 */
export interface Store {
  applications: ApplicationRepository;
  documents: DocumentRepository;
  feedback: FeedbackRepository;
  checklists: ChecklistRepository;
  audit: AuditRepository;
  notifications: NotificationRepository;
}

export function createInMemoryStore(): Store {
  return {
    applications: new InMemoryApplicationRepository(),
    documents: new InMemoryDocumentRepository(),
    feedback: new InMemoryFeedbackRepository(),
    checklists: new InMemoryChecklistRepository(),
    audit: new InMemoryAuditRepository(),
    notifications: new InMemoryNotificationRepository(),
  };
}
