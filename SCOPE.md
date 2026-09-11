# SCOPE.md

## What I'm building

All three use cases, at different depths, unified by one real state machine
and one real audit/revision model — because the hardest and most
assessment-relevant part of this brief is the *status machine and role-based
visibility*, and building it once, correctly, with tests, is worth more than
three shallow feature slices:

- **UC1 (Operator submission/resubmission): full.** Section-scoped
  resubmission, document upload with mocked AI verification, immutable
  revision history, unlimited rounds.
- **UC2 (Officer review & feedback): full.** Full-data officer view, comment
  templates, section/document-linked feedback, status transitions, resolved-
  issue tracking, revision diffing.
- **UC3 (Site visit & post-site clarification): reduced.** The status
  transitions and targeted-clarification *mechanics* are fully implemented
  and tested (this is where most of the interesting edge cases live). The
  checklist itself is a flat list of `{itemId, comment, needsClarification}`
  records rather than a templated, licence-type-specific checklist schema.

This is a **backend API + test suite**, not a full-stack app. No frontend UI.

## What I'm explicitly deferring or mocking, and why

| Item | Decision | Why |
|---|---|---|
| Frontend UI | Deferred entirely | Given the time box, a real state machine + role-isolation logic with tests demonstrates more engineering judgment than a UI shell wrapping mock data. The API is designed to be UI-agnostic (clean JSON, role-scoped responses) so a UI is a straightforward follow-on. |
| Authentication | Mocked via `X-User-Id` / `X-User-Role` headers, validated by middleware | Real auth (OAuth/SSO for gov officers) is an integration, not a design problem, for this exercise. The mock still enforces role checks server-side so the *authorization* logic — the actual thing being assessed — is real. |
| File storage | Metadata-only document records (filename, section, mime, size); no binary bytes stored | Uploading to S3/GCS is infra wiring. The verification-status workflow around a document is the part with business logic, and that's fully implemented. |
| AI document verification | Deterministic mock (hash-based pass/flag, tests use fixed content to hit both outcomes) | No real ML model is in scope; what matters is that the "AI verification result visible per document" contract is real and testable. |
| Notifications | Logged as domain events, not emailed/pushed | Same reasoning as auth — the trigger logic is real, the delivery channel isn't. |
| Licence-type-specific checklist/section schemas | Single fixed set of sections/checklist shape | Multi-licence-type schema config is a real feature but orthogonal to the workflow logic being assessed. |
| Persistence | In-memory repositories behind a `Repository` interface | Keeps the submission trivially runnable (`deno install && deno test`, no DB setup) while keeping the seam to swap in Postgres/Prisma clean — the service layer never touches storage directly. |
| Pagination / search / rate limiting | Not implemented | Not core to the workflow being assessed; noted in "What I'd do next." |

## Assumptions made where requirements were ambiguous

1. **Post-site status semantics.** The spec lists four internal post-site
   statuses (`Site Visit Done`, `Awaiting Post-Site Clarification`,
   `Pending Post-Site Resubmission`, `Post-Site Clarification Resubmitted`)
   without spelling out the exact transition order. I assumed a pattern
   symmetric with the pre-site loop: `Awaiting Post-Site Clarification` is
   the *first* round waiting on the operator; `Pending Post-Site
   Resubmission` is used for *subsequent* rounds after the officer reviews a
   response and still needs more on at least one item. This is documented
   in `src/domain/statusMachine.ts` next to the transition table.
2. **Section identifiers are a fixed enum** (`business_info`, `ownership`,
   `financials`, `premises`) rather than a dynamic, licence-type-driven
   schema, since no section schema was provided.
3. **"Officer" is a single role**, not modeled with reviewer assignment /
   seniority tiers, since the brief doesn't require routing between officers.
4. **A flagged document or section stays flagged until explicitly resolved**
   by an officer action, not automatically cleared on resubmission — the
   officer must confirm the fix, per "resolution of previously flagged
   issues is tracked."
5. **Revision numbering is optimistic-concurrency-style**: every resubmission
   must reference the revision it was based on; a stale reference is
   rejected rather than silently merged, to satisfy "no applications are
   lost due to... filtering errors."
6. **One application can have many documents per section** (not one), since
   real filings usually attach multiple files per section.

## Tech stack & architecture (3–5 sentences)

Node.js + TypeScript on Express, chosen for fast iteration and because the
core value being assessed — a correct state machine and strict role-based
data shaping — doesn't benefit from a heavier framework. The code is
layered: `domain` (status machine, types, pure functions, no I/O) →
`repositories` (storage behind interfaces, currently in-memory) →
`services` (business rules: resubmission validation, feedback, transitions)
→ `api` (Express routes, Zod input validation, role middleware, error
handling). Role-based view shaping happens once, centrally, in the domain
layer (`toOfficerView` / `toOperatorView`) rather than being re-implemented
per route, so it can't be forgotten on a new endpoint. Tests are Jest +
Supertest, split into unit tests (domain/service logic, including the edge
cases from the PRD) and integration tests (full HTTP round-trips, including
the role-leak edge cases).
