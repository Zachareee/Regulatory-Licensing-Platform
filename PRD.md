# PRD — Regulatory & Licensing Platform (MVP)

## 1. Problem Statement

Government licensing offices process operator (business) applications through a
multi-stage lifecycle: document submission, desk review, an on-site inspection,
and final approval. Today this breaks down in three predictable ways:

1. **Operators resubmit blind.** They don't know *which* part of their
   application was wrong, so they resend everything, and reviewers have to
   re-read it all.
2. **Officers repeat themselves.** Without structured, section-linked
   feedback, the same issues get restated across rounds, and nothing tracks
   what's already been resolved.
3. **Site visits generate noise.** A full inspection checklist has 30+ items;
   surfacing all of them back to the operator when only 2 need clarification
   overwhelms them and slows resolution.

The platform's job is to make every round of back-and-forth **targeted,
auditable, and lossless** — no submitted data ever disappears, every status
change is explainable, and each side only sees what's relevant to their role.

## 2. Users

| Role | Goal |
|---|---|
| **Operator** | Submit a licence application, understand exactly what to fix, and track progress without seeing internal review mechanics. |
| **Officer** | Review submissions efficiently, give precise feedback, run a site visit, and drive the case to a decision without losing history. |

## 3. Core Domain Concepts

- **Application** — the case. Has a single **internal status** at all times.
- **Status mapping** — the same internal status renders as a different label
  depending on viewer role (see §6). This is the mechanism that hides the
  internal approval stage from operators and gives officers more granular
  labels than operators need.
- **Form Sections** — an application is decomposed into named sections
  (e.g. `business_info`, `ownership`, `financials`, `premises`). Feedback,
  resubmission, and highlighting all operate at the section level, not the
  whole-application level.
- **Documents** — uploaded files attached to a section, each carrying a
  (mocked) AI verification status: `pending → verified | flagged`.
- **Feedback / Comments** — officer-authored, always linked to a section or a
  document, never a bare free-floating note attached to the whole case.
- **Revisions** — every operator resubmission is stored as an immutable
  snapshot, never overwritten, so history and prior officer comments survive
  indefinitely.
- **Site Visit Checklist** — a set of officer-authored items from an
  inspection; each item can be marked "Needs Clarification." Operators only
  ever see the subset that's flagged.
- **Audit Log** — every status transition and every feedback/response event
  is appended, with actor, timestamp, and reason. Nothing is ever deleted.

## 4. In-Scope Use Cases (see SCOPE.md for the build decision)

### UC1 — Operator Submission & Resubmission
- Create an application with section data.
- Upload documents per section; each gets a mocked AI verification status.
- On resubmission, only flagged sections are editable/required; everything
  else is copied forward unchanged.
- Full revision history + prior officer comments always visible to the
  operator, across unlimited rounds.

### UC2 — Officer Review & Feedback
- Officer sees full form data, documents, AI verification results, and flags.
- Officer can request more information with section/document-linked comments,
  optionally drawn from a predefined template.
- Setting a status automatically determines the next valid state and (stubbed)
  notifies the operator.
- Officer can diff the current revision against the previous one.
- Every flagged issue tracks whether it has since been resolved.

### UC3 — On-Site Assessment & Post-Site Clarification (reduced scope — see SCOPE.md)
- Officer records checklist items with comments and can save as a draft.
- Officer flags specific items as "Needs Further Clarification."
- Submitting the checklist auto-transitions the case.
- Operator sees **only** flagged items (never the full checklist) and can
  respond per item, with supporting documents.
- Multiple clarification rounds per item, each with its own audit trail.

## 5. Non-Functional Requirements

- **No data loss**: resubmission/status changes never overwrite or drop prior
  form data, documents, or comments.
- **Role isolation**: the API layer, not the client, is responsible for
  redacting/relabeling data by role. A client bug must not be able to leak the
  internal approval stage to an operator.
- **Validated state machine**: every status transition is checked against an
  explicit allow-list; illegal transitions are rejected with a clear error,
  never silently coerced.
- **Input validation & error handling** on every mutating endpoint (schema
  validation, 4xx on bad input, no unhandled promise rejections).
- **Auditability**: every mutation is attributable (`actorId`, `role`,
  timestamp).
- **No secrets committed**: config via `.env`, `.env.example` checked in
  instead.

## 6. Status Mapping (authoritative — from assessment spec)

| Internal Status | Officer View | Operator View |
|---|---|---|
| APPLICATION_RECEIVED | Application Received | Submitted |
| UNDER_REVIEW | Under Review | Under Review |
| PENDING_PRE_SITE_RESUBMISSION | Pending Pre-Site Resubmission | Pending Pre-Site Resubmission |
| PRE_SITE_RESUBMITTED | Pre-Site Resubmitted | Pre-Site Resubmitted |
| SITE_VISIT_SCHEDULED | Site Visit Scheduled | Pending Site Visit |
| SITE_VISIT_DONE | Site Visit Done | Pending Post-Site Clarification |
| AWAITING_POST_SITE_CLARIFICATION | Awaiting Post-Site Clarification | Pending Post-Site Clarification |
| PENDING_POST_SITE_RESUBMISSION | Awaiting Post-Site Resubmission | Pending Post-Site Resubmission |
| POST_SITE_CLARIFICATION_RESUBMITTED | Post-Site Clarification Resubmitted | Post-Site Resubmitted |
| PENDING_APPROVAL | Route to Approval | Pending Approval |
| APPROVED | Approved | Approved |
| REJECTED | Rejected | Rejected |

**Hard constraint**: an Operator-facing payload must never contain the
internal status enum value or the officer label "Route to Approval" —
only the mapped operator label.

## 7. Out of Scope for MVP

- Real authentication/authorization (mocked via a trusted header — see SCOPE.md).
- Real file storage (documents are metadata-only records; no binary storage/CDN).
- Real AI document verification (deterministic mock).
- Real notifications (emails/push) — logged as events instead.
- Frontend UI — this MVP is an API + test suite; see SCOPE.md.
- Multi-tenancy, licence-type-specific section schemas, pagination/search at scale.

## 8. Edge Cases the Design Must Handle

1. Resubmitting a section that was **not** flagged → rejected (400), to
   prevent operators from silently changing approved content.
2. Attempting a status transition that skips states (e.g.
   `APPLICATION_RECEIVED → APPROVED`) → rejected.
3. Officer requesting info with a comment that references a section that
   doesn't exist on the application → rejected (404-style validation error).
4. Concurrent resubmission attempts on a stale revision → the service must
   version-check and reject writes based on a stale revision number.
5. An application with **zero** flagged checklist items after a site visit →
   must route straight to `PENDING_APPROVAL`, skipping the clarification loop
   entirely.
6. Operator fetching an application that isn't theirs → 403, not a leak via 404.
7. Officer marks all clarification items resolved, but one new item is flagged
   in the same round → status must reflect "still needs another round," not
   "resolved."
8. Empty/duplicate document uploads, oversized payloads, missing required
   section fields → all rejected with field-level error messages.
9. Every internal status must have both an officer and operator label; a
   missing mapping is a startup-time failure, not a runtime `undefined`.
10. Audit log must be append-only — no endpoint may mutate or delete it.
