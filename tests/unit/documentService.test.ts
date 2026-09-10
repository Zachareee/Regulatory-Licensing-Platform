import { buildServices, fullSections } from '../helpers/fixtures';
import { NotFoundError, ValidationError } from '../../src/domain/errors';

describe('DocumentService.upload', () => {
  it('uploads a document and marks it VERIFIED by default', () => {
    const { applicationService, documentService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    const doc = documentService.upload({
      applicationId: app.id,
      sectionId: 'financials',
      filename: 'balance-sheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    expect(doc.verificationStatus).toBe('VERIFIED');
  });

  it('flags a document whose mock content signals it is blurry', () => {
    const { applicationService, documentService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    const doc = documentService.upload({
      applicationId: app.id,
      sectionId: 'financials',
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      mockContent: 'BLURRY',
    });
    expect(doc.verificationStatus).toBe('FLAGGED');
    expect(doc.verificationNote).toMatch(/blurry/i);
  });

  it('rejects an upload for a non-existent application', () => {
    const { documentService } = buildServices();
    expect(() =>
      documentService.upload({
        applicationId: 'does-not-exist',
        sectionId: 'financials',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).toThrow(NotFoundError);
  });

  it('rejects a file over the size limit', () => {
    const { applicationService, documentService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    expect(() =>
      documentService.upload({
        applicationId: app.id,
        sectionId: 'financials',
        filename: 'huge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 26 * 1024 * 1024,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects an unsupported mime type', () => {
    const { applicationService, documentService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    expect(() =>
      documentService.upload({
        applicationId: app.id,
        sectionId: 'financials',
        filename: 'malware.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a zero-byte upload', () => {
    const { applicationService, documentService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    expect(() =>
      documentService.upload({
        applicationId: app.id,
        sectionId: 'financials',
        filename: 'empty.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0,
      }),
    ).toThrow(ValidationError);
  });

  it('allows multiple documents to be attached to the same section', () => {
    const { applicationService, documentService } = buildServices();
    const app = applicationService.create({ operatorId: 'op-1', sections: fullSections() });
    documentService.upload({
      applicationId: app.id,
      sectionId: 'financials',
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    documentService.upload({
      applicationId: app.id,
      sectionId: 'financials',
      filename: 'b.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(documentService.listForApplication(app.id)).toHaveLength(2);
  });
});
