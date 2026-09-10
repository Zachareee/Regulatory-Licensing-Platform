import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  STATUS_LABELS,
  assertValidTransition,
  isTerminal,
  mapStatusForRole,
} from '../../src/domain/statusMachine';
import { InternalStatus } from '../../src/domain/types';

describe('status label mapping', () => {
  it('every internal status has both an officer and operator label', () => {
    const statuses = Object.keys(STATUS_LABELS) as InternalStatus[];
    expect(statuses.length).toBe(12);
    for (const s of statuses) {
      expect(STATUS_LABELS[s].officer).toBeTruthy();
      expect(STATUS_LABELS[s].operator).toBeTruthy();
    }
  });

  it('never leaks the internal officer-only "Route to Approval" label to operators', () => {
    expect(mapStatusForRole('PENDING_APPROVAL', 'OPERATOR')).toBe('Pending Approval');
    expect(mapStatusForRole('PENDING_APPROVAL', 'OFFICER')).toBe('Route to Approval');
  });

  it('maps APPLICATION_RECEIVED differently per role per spec', () => {
    expect(mapStatusForRole('APPLICATION_RECEIVED', 'OFFICER')).toBe('Application Received');
    expect(mapStatusForRole('APPLICATION_RECEIVED', 'OPERATOR')).toBe('Submitted');
  });
});

describe('transition table', () => {
  it('allows the documented happy path end to end', () => {
    const happyPath: InternalStatus[] = [
      'APPLICATION_RECEIVED',
      'UNDER_REVIEW',
      'SITE_VISIT_SCHEDULED',
      'SITE_VISIT_DONE',
      'PENDING_APPROVAL',
      'APPROVED',
    ];
    for (let i = 0; i < happyPath.length - 1; i++) {
      expect(() => assertValidTransition(happyPath[i], happyPath[i + 1])).not.toThrow();
    }
  });

  it('supports unlimited pre-site resubmission rounds via a loop through UNDER_REVIEW', () => {
    expect(() => assertValidTransition('UNDER_REVIEW', 'PENDING_PRE_SITE_RESUBMISSION')).not.toThrow();
    expect(() => assertValidTransition('PENDING_PRE_SITE_RESUBMISSION', 'PRE_SITE_RESUBMITTED')).not.toThrow();
    expect(() => assertValidTransition('PRE_SITE_RESUBMITTED', 'UNDER_REVIEW')).not.toThrow();
    // and it can loop again indefinitely
    expect(() => assertValidTransition('UNDER_REVIEW', 'PENDING_PRE_SITE_RESUBMISSION')).not.toThrow();
  });

  it('rejects a transition that skips states', () => {
    expect(() => assertValidTransition('APPLICATION_RECEIVED', 'APPROVED')).toThrow(
      InvalidTransitionError,
    );
  });

  it('rejects transitions out of terminal states', () => {
    expect(() => assertValidTransition('APPROVED', 'UNDER_REVIEW')).toThrow(InvalidTransitionError);
    expect(() => assertValidTransition('REJECTED', 'PENDING_APPROVAL')).toThrow(
      InvalidTransitionError,
    );
  });

  it('allows the site-visit-done-with-no-flags shortcut straight to approval', () => {
    expect(() => assertValidTransition('SITE_VISIT_DONE', 'PENDING_APPROVAL')).not.toThrow();
  });

  it('supports the post-site clarification loop', () => {
    expect(() =>
      assertValidTransition('AWAITING_POST_SITE_CLARIFICATION', 'POST_SITE_CLARIFICATION_RESUBMITTED'),
    ).not.toThrow();
    expect(() =>
      assertValidTransition('POST_SITE_CLARIFICATION_RESUBMITTED', 'PENDING_POST_SITE_RESUBMISSION'),
    ).not.toThrow();
    expect(() =>
      assertValidTransition('PENDING_POST_SITE_RESUBMISSION', 'POST_SITE_CLARIFICATION_RESUBMITTED'),
    ).not.toThrow();
    expect(() =>
      assertValidTransition('POST_SITE_CLARIFICATION_RESUBMITTED', 'PENDING_APPROVAL'),
    ).not.toThrow();
  });

  it('marks APPROVED and REJECTED as terminal with no outbound transitions', () => {
    expect(isTerminal('APPROVED')).toBe(true);
    expect(isTerminal('REJECTED')).toBe(true);
    expect(ALLOWED_TRANSITIONS.APPROVED).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.REJECTED).toHaveLength(0);
  });

  it('rejects UNDER_REVIEW jumping directly to PENDING_APPROVAL (must go through site visit or resubmission)', () => {
    expect(() => assertValidTransition('UNDER_REVIEW', 'PENDING_APPROVAL')).toThrow(
      InvalidTransitionError,
    );
  });
});
