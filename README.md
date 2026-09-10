# Regulatory & Licensing Platform — MVP

A backend API for the operator/officer application lifecycle described in
the assessment: submission, section-scoped resubmission, officer review
with templated feedback, an on-site inspection checklist, and targeted
post-site clarification — all driven by one validated status state machine
with role-based visibility.

Read **[PRD.md](./PRD.md)** for the product design and **[SCOPE.md](./SCOPE.md)**
for exactly what was built vs. deferred/mocked and why, plus every
assumption made where the brief was ambiguous.

## Quick start

```bash
npm install
npm test              # 84 tests, unit + integration (Jest + Supertest)
npm run test:coverage # coverage report
npm run dev           # runs the API on http://localhost:3000 with hot reload
npm run build && npm start   # production build
```

No database or external services required — everything runs in-memory out
of the box (see "Architecture" below for why, and how it's swappable).

## Trying it against a running server

You have two options:

1. **Postman/Insomnia** (recommended for exploring): import
   `postman/Regulatory-Licensing-Platform.postman_collection.json` — see
   [postman/README.md](./postman/README.md). It runs 43 requests / 74
   assertions covering the full lifecycle and every role-isolation edge
   case, verified to pass 100% via Newman against a live instance.
2. **curl**, using headers for the mocked auth (see SCOPE.md):

```bash
# Operator submits an application
curl -X POST http://localhost:3000/applications \
  -H "Content-Type: application/json" \
  -H "X-User-Id: op-1" -H "X-User-Role: OPERATOR" \
  -d '{"sections":{
        "business_info": {"legalName":"Acme Trading Pte Ltd"},
        "ownership": {"owners":["Jane Doe"]},
        "financials": {"annualRevenue":500000},
        "premises": {"address":"1 Example Rd"}
      }}'

# Officer starts review
curl -X POST http://localhost:3000/applications/<id>/review/start \
  -H "X-User-Id: officer-1" -H "X-User-Role: OFFICER"

# Officer requests changes to one section
curl -X POST http://localhost:3000/applications/<id>/review/request-changes \
  -H "Content-Type: application/json" \
  -H "X-User-Id: officer-1" -H "X-User-Role: OFFICER" \
  -d '{"items":[{"targetType":"SECTION","targetId":"financials","comment":"Add last FY figures"}]}'

# Operator resubmits only the flagged section
curl -X PATCH http://localhost:3000/applications/<id>/sections \
  -H "Content-Type: application/json" \
  -H "X-User-Id: op-1" -H "X-User-Role: OPERATOR" \
  -d '{"baseRevision":1,"sections":{"financials":{"annualRevenue":750000}}}'
```

## API surface

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/applications` | Operator | Submit a new application (all sections required) |
| GET | `/applications` | Both | List applications (operator: own only; officer: all) |
| GET | `/applications/:id` | Both | Fetch one application, role-shaped |
| PATCH | `/applications/:id/sections` | Operator | Resubmit only currently-flagged sections |
| POST | `/applications/:id/documents` | Operator | Upload a document (metadata + mocked AI verification) |
| GET | `/applications/:id/compare?from=&to=` | Officer | Diff two revisions by changed section |
| GET | `/comment-templates` | Both | Predefined feedback templates |
| POST | `/applications/:id/review/start` | Officer | Begin/resume review |
| POST | `/applications/:id/review/request-changes` | Officer | Section/document-linked feedback, moves to resubmission |
| POST | `/applications/:id/review/schedule-site-visit` | Officer | Approve desk review, schedule site visit |
| POST | `/applications/:id/review/reject` | Officer | Reject with a required reason |
| POST | `/applications/:id/review/approve` | Officer | Final approval (only from Pending Approval) |
| POST | `/feedback/:feedbackId/resolve` | Officer | Mark a flagged issue resolved |
| POST | `/applications/:id/site-visit/checklist` | Officer | Save inspection checklist draft |
| POST | `/applications/:id/site-visit/submit` | Officer | Finalize checklist; auto-routes the case |
| GET | `/applications/:id/site-visit/flagged-items` | Operator | **Only** the flagged checklist items |
| POST | `/applications/:id/site-visit/respond` | Operator | Respond to one flagged item |
| POST | `/applications/:id/site-visit/review-responses` | Officer | Accept responses or open another round |

## Architecture

```
src/
  domain/         status machine, role-label mapping, types, errors — pure, no I/O
  repositories/   storage behind interfaces; in-memory impl, DB-swappable
  services/       business rules: submission, review, site-visit, role-based view shaping
  api/            Express routes, Zod validation, mock-auth middleware, error handling
```

Requests flow `route → service → repository`. Two decisions matter most for
correctness here:

1. **The status machine is one file** (`domain/statusMachine.ts`) with an
   explicit transition allow-list. Every state change in every service goes
   through `assertValidTransition`, so an illegal jump (e.g. skipping the
   site visit) fails the same way everywhere, and the full transition graph
   is readable in one place instead of scattered across route handlers.
2. **Role-based redaction happens once** (`services/viewService.ts`), not
   per-route. An operator payload is *constructed* without the internal
   status enum or `operatorId`/`revisionHistory` — it's not that those
   fields are hidden by convention, they're never put on the object for
   that role. This is what makes PRD edge case #6 (no accidental leak via a
   new endpoint) actually hold structurally rather than by discipline.

Auth is a header-based mock (`X-User-Id` / `X-User-Role`) validated by
middleware, but the *authorization* decisions (does this operator own this
application, can only an officer approve) live in the service layer and are
fully real and fully tested — swapping in real SSO later touches only
`api/middleware/auth.ts`.

## Testing

- `tests/unit/` — domain and service logic in isolation, including the PRD's
  10 edge cases (stale revisions, unflagged-section tampering, role leaks,
  zero-flag checklist shortcut, duplicate resolution, illegal transitions,
  etc.)
- `tests/integration/` — full HTTP round trips via Supertest, including a
  complete happy-path lifecycle (submit → review → resubmit → site visit →
  clarification round → approve) and the same role-isolation checks at the
  HTTP layer.

Each test file gets a fresh in-memory store (`createApp()` with no shared
state), so tests never leak into each other.

## What I'd do next (given more time)

- Swap the in-memory repositories for Postgres/Prisma behind the same
  interfaces — no service code would change.
- Real file storage (S3-compatible) for documents instead of metadata-only
  records.
- A minimal operator/officer web UI consuming this API — the response
  shapes were designed to be UI-ready (role-correct labels, no client-side
  filtering required).
- Pagination and filtering on `GET /applications` once case volume matters.
- Configurable, licence-type-specific section and checklist schemas instead
  of the fixed set assumed here.
- Real notification delivery (email/SMS) off the existing `NOTIFICATION_SENT`
  audit events, which already capture the right trigger points.
- Idempotency keys on the mutating endpoints for safe client retries.

## AI Usage

I used Claude (this session) to design and build this submission, working
from the assessment document end to end:

- **PRD & scoping**: I asked for a PRD and a repository with tests; the
  scoping decision in SCOPE.md (all three use cases at different depths,
  backend-only, in-memory storage, mocked auth/AI/notifications) was made
  by the assistant and is disclosed there in full, including every
  assumption made to resolve ambiguity in the status-mapping table (the
  post-site clarification loop's exact transition order is not fully
  specified in the brief; the assumption made and the reasoning are
  documented next to the transition table in `statusMachine.ts`).
- **Implementation**: all code (domain model, services, Express routes,
  and the full Jest/Supertest test suite) was generated by the assistant,
  then compiled, run, and iterated on until `tsc --noEmit` was clean and
  all 84 tests passed against a live server smoke test.
- **What I would double-check by hand before shipping this**: the post-site
  status-loop assumption against whoever owns the actual regulatory
  workflow (it's a guess that fits the given table, not a confirmed
  requirement); the fixed section/checklist schema, which a real system
  would almost certainly need to vary by licence type; and the mocked
  AI-verification and auth boundaries, which are structurally real but
  intentionally not wired to actual services.
