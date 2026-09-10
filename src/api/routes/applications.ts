import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, mockAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { ApplicationService } from '../../services/applicationService';
import { DocumentService } from '../../services/documentService';
import { ReviewService } from '../../services/reviewService';
import { toApplicationView } from '../../services/viewService';
import { SECTION_IDS } from '../../domain/types';
import { ValidationError } from '../../domain/errors';

const sectionDataSchema = z.record(z.string(), z.unknown());

const createApplicationSchema = z.object({
  sections: z.record(z.enum(SECTION_IDS), sectionDataSchema),
});

const resubmitSchema = z.object({
  baseRevision: z.number().int().positive(),
  sections: z.record(z.enum(SECTION_IDS), sectionDataSchema),
});

const uploadDocumentSchema = z.object({
  sectionId: z.enum(SECTION_IDS),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  mockContent: z.string().optional(),
});

export function buildApplicationRoutes(deps: {
  applicationService: ApplicationService;
  documentService: DocumentService;
  reviewService: ReviewService;
}): Router {
  const router = Router();
  router.use(mockAuth);

  router.post(
    '/',
    requireRole('OPERATOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = createApplicationSchema.parse(req.body);
      // Cast is safe: zod's z.enum(SECTION_IDS) record guarantees keys are
      // valid SectionIds; the applicationService still re-validates
      // completeness independently as a defense-in-depth check.
      const app = deps.applicationService.create({
        operatorId: req.user!.id,
        sections: input.sections as never,
      });
      const view = toApplicationView(app, 'OPERATOR', [], []);
      res.status(201).json(view);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req: AuthedRequest, res) => {
      const apps = deps.applicationService.listForRequester(req.user!);
      const views = apps.map((app) => {
        const documents = deps.documentService.listForApplication(app.id);
        const feedback = deps.reviewService.listFeedback(app.id);
        return toApplicationView(app, req.user!.role, documents, feedback);
      });
      res.json(views);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req: AuthedRequest, res) => {
      const app = deps.applicationService.getForRequester(req.params.id, req.user!);
      const documents = deps.documentService.listForApplication(app.id);
      const feedback = deps.reviewService.listFeedback(app.id);
      res.json(toApplicationView(app, req.user!.role, documents, feedback));
    }),
  );

  router.patch(
    '/:id/sections',
    requireRole('OPERATOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = resubmitSchema.parse(req.body);
      const app = deps.applicationService.resubmitSections({
        applicationId: req.params.id,
        operatorId: req.user!.id,
        baseRevision: input.baseRevision,
        sections: input.sections as never,
      });
      const documents = deps.documentService.listForApplication(app.id);
      const feedback = deps.reviewService.listFeedback(app.id);
      res.json(toApplicationView(app, 'OPERATOR', documents, feedback));
    }),
  );

  router.post(
    '/:id/documents',
    requireRole('OPERATOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = uploadDocumentSchema.parse(req.body);
      // Ownership check: operators may only upload to their own application.
      deps.applicationService.getForRequester(req.params.id, req.user!);
      const doc = deps.documentService.upload({
        applicationId: req.params.id,
        ...input,
      });
      res.status(201).json(doc);
    }),
  );

  router.get(
    '/:id/compare',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const from = Number(req.query.from);
      const to = Number(req.query.to);
      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        throw new ValidationError('Query params "from" and "to" must be integers');
      }
      const diff = deps.reviewService.compareRevisions(req.params.id, from, to);
      res.json(diff);
    }),
  );

  return router;
}
