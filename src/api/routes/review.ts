import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, mockAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { COMMENT_TEMPLATES, ReviewService } from '../../services/reviewService';
import { ApplicationService } from '../../services/applicationService';
import { DocumentService } from '../../services/documentService';
import { toApplicationView } from '../../services/viewService';

const requestChangesSchema = z.object({
  items: z
    .array(
      z.object({
        targetType: z.enum(['SECTION', 'DOCUMENT', 'CHECKLIST_ITEM']),
        targetId: z.string().min(1),
        comment: z.string().min(1).optional(),
        templateId: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

const rejectSchema = z.object({ reason: z.string().min(1) });

export function buildReviewRoutes(deps: {
  reviewService: ReviewService;
  applicationService: ApplicationService;
  documentService: DocumentService;
}): Router {
  const router = Router();
  router.use(mockAuth);

  router.get(
    '/comment-templates',
    asyncHandler(async (_req, res) => {
      res.json(COMMENT_TEMPLATES);
    }),
  );

  router.post(
    '/applications/:id/review/start',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const app = deps.reviewService.startReview(req.params.id, req.user!.id);
      res.json(respond(deps, app, req.user!.role));
    }),
  );

  router.post(
    '/applications/:id/review/request-changes',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = requestChangesSchema.parse(req.body);
      const app = deps.reviewService.requestChanges({
        applicationId: req.params.id,
        officerId: req.user!.id,
        items: input.items,
      });
      res.json(respond(deps, app, req.user!.role));
    }),
  );

  router.post(
    '/applications/:id/review/schedule-site-visit',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const app = deps.reviewService.scheduleSiteVisit(req.params.id, req.user!.id);
      res.json(respond(deps, app, req.user!.role));
    }),
  );

  router.post(
    '/applications/:id/review/reject',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const input = rejectSchema.parse(req.body);
      const app = deps.reviewService.reject(req.params.id, req.user!.id, input.reason);
      res.json(respond(deps, app, req.user!.role));
    }),
  );

  router.post(
    '/applications/:id/review/approve',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const app = deps.reviewService.approve(req.params.id, req.user!.id);
      res.json(respond(deps, app, req.user!.role));
    }),
  );

  router.post(
    '/feedback/:feedbackId/resolve',
    requireRole('OFFICER'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const feedback = deps.reviewService.resolveFeedback(req.params.feedbackId, req.user!.id);
      res.json(feedback);
    }),
  );

  function respond(
    d: { applicationService: ApplicationService; documentService: DocumentService; reviewService: ReviewService },
    app: ReturnType<ReviewService['startReview']>,
    role: 'OFFICER' | 'OPERATOR',
  ) {
    const documents = d.documentService.listForApplication(app.id);
    const feedback = d.reviewService.listFeedback(app.id);
    return toApplicationView(app, role, documents, feedback);
  }

  return router;
}
