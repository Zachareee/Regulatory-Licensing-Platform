import { randomUUID } from 'crypto';
import { DocumentRecord, SectionId } from '../domain/types';
import { NotFoundError, ValidationError } from '../domain/errors';
import { DocumentRepository, ApplicationRepository } from '../repositories/inMemoryStore';

export interface UploadDocumentInput {
  applicationId: string;
  sectionId: SectionId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Mock content used only to make AI verification deterministic in tests.
   * A real implementation would never need this — it would call a real
   * verification service asynchronously (see SCOPE.md).
   */
  mockContent?: string;
}

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export class DocumentService {
  constructor(
    private documents: DocumentRepository,
    private applications: ApplicationRepository,
  ) {}

  upload(input: UploadDocumentInput): DocumentRecord {
    const app = this.applications.findById(input.applicationId);
    if (!app) throw new NotFoundError('Application', input.applicationId);

    if (!input.filename || input.filename.trim().length === 0) {
      throw new ValidationError('filename is required', { filename: 'required' });
    }
    if (input.sizeBytes <= 0) {
      throw new ValidationError('sizeBytes must be positive', { sizeBytes: 'must be > 0' });
    }
    if (input.sizeBytes > MAX_SIZE_BYTES) {
      throw new ValidationError('file exceeds maximum size of 25MB', {
        sizeBytes: 'exceeds 25MB limit',
      });
    }
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new ValidationError(`unsupported mime type: ${input.mimeType}`, {
        mimeType: 'unsupported',
      });
    }

    const { status, note } = this.runMockVerification(input);

    const doc: DocumentRecord = {
      id: randomUUID(),
      applicationId: input.applicationId,
      sectionId: input.sectionId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
      verificationStatus: status,
      verificationNote: note,
    };

    return this.documents.add(doc);
  }

  listForApplication(applicationId: string): DocumentRecord[] {
    return this.documents.findByApplication(applicationId);
  }

  /**
   * Deterministic mock "AI verification": flags documents whose mock
   * content contains the literal string "BLURRY" or "MISSING_SIGNATURE",
   * so tests can hit both the VERIFIED and FLAGGED paths reliably rather
   * than relying on randomness. See SCOPE.md — real AI verification is out
   * of scope for this MVP.
   */
  private runMockVerification(
    input: UploadDocumentInput,
  ): { status: DocumentRecord['verificationStatus']; note?: string } {
    const content = input.mockContent ?? input.filename;
    if (content.includes('BLURRY')) {
      return { status: 'FLAGGED', note: 'Document appears blurry or illegible' };
    }
    if (content.includes('MISSING_SIGNATURE')) {
      return { status: 'FLAGGED', note: 'Required signature not detected' };
    }
    return { status: 'VERIFIED' };
  }
}
