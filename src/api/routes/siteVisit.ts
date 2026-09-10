import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, mockAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { SiteVisitService } from '../../services/siteVisitService';
import { toApplicationView } from '../../services/viewService';
import { ApplicationService } from '../../services/applicationService';
import { DocumentService } from '../../services/documentService';
import { ReviewService } from '../../services/reviewService';

const draftSchema = z.object({
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        officerComment: z.string().min(1),
        needsClarification: z.boolean(),
      }),
    )
    .min(1),
});

const respondSchema = z.object({
  itemId: z.string().min(1),
  response: z.string().min(1),
});

const reviewResponsesSchema = z.object({
  stillNeedsClarification: z
    .array(z.object({ itemId: z.string().min(1), newComment: z.string().min(1) }))
    .default([]),
});

export function buildSiteVisitRoutes(deps: {
  siteVisitService: SiteVisitService;
  applicationService: ApplicationService;
  documentService: DocumentService;
  reviewService: ReviewService;
}): Router {
  const router = Router();
  router.use(mockAuth);

  router.post(
    '/applications/:id/site-visit/checklist',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = draftSchema.parse(req.body);
      const checklist = deps.siteVisitService.saveDraft(req.params.id, req.user!.id, input.items);
      res.status(201).json(checklist);
    }),
  );

  router.post(
    '/applications/:id/site-visit/submit',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const app = deps.siteVisitService.submitChecklist(req.params.id, req.user!.id);
      const documents = deps.documentService.listForApplication(app.id);
      const feedback = deps.reviewService.listFeedback(app.id);
      res.json(toApplicationView(app, 'OFFICER', documents, feedback));
    }),
  );

  router.get(
    '/applications/:id/site-visit/flagged-items',
    requireRole('OPERATOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const items = deps.siteVisitService.getFlaggedItemsForOperator(req.params.id, req.user!.id);
      res.json(items);
    }),
  );

  router.post(
    '/applications/:id/site-visit/respond',
    requireRole('OPERATOR'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = respondSchema.parse(req.body);
      const item = deps.siteVisitService.respondToClarification({
        applicationId: req.params.id,
        operatorId: req.user!.id,
        itemId: input.itemId,
        response: input.response,
      });
      res.json(item);
    }),
  );

  router.post(
    '/applications/:id/site-visit/review-responses',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = reviewResponsesSchema.parse(req.body);
      const app = deps.siteVisitService.reviewClarificationResponses(
        req.params.id,
        req.user!.id,
        input.stillNeedsClarification,
      );
      const documents = deps.documentService.listForApplication(app.id);
      const feedback = deps.reviewService.listFeedback(app.id);
      res.json(toApplicationView(app, 'OFFICER', documents, feedback));
    }),
  );

  return router;
}
