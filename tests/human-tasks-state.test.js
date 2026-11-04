import { describe, it, expect } from 'vitest';
import {
	STATUSES, TRANSITIONS, TERMINAL, TransitionError, canTransition, assertTransition,
	wasFunded, refundOwed, posterActions, workerActions, canReview, isAcceptable,
} from '../api/_lib/human-tasks/state.js';

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();
const base = (over = {}) => ({ status: 'open', deadline_at: FUTURE, accepted_claim_id: null, ...over });

describe('human-task state machine', () => {
	it('lists every status and gives each a transition row', () => {
		for (const s of STATUSES) expect(TRANSITIONS[s], s).toBeDefined();
	});

	it('terminal states have no outgoing edges', () => {
		for (const s of TERMINAL) expect(TRANSITIONS[s]).toEqual([]);
	});

	it('allows the happy path funding to paid', () => {
		const path = ['funding', 'open', 'accepted', 'submitted', 'approved', 'paid'];
		for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
	});

	it('refuses skipping steps and going backwards', () => {
		expect(canTransition('open', 'paid')).toBe(false);
		expect(canTransition('funding', 'accepted')).toBe(false);
		expect(canTransition('paid', 'open')).toBe(false);
		expect(canTransition('submitted', 'accepted')).toBe(false);
		expect(canTransition('cancelled', 'open')).toBe(false);
	});

	it('a dispute can only resolve to approved (worker) or cancelled (poster)', () => {
		expect(TRANSITIONS.disputed).toEqual(['approved', 'cancelled']);
		expect(canTransition('disputed', 'paid')).toBe(false);
		expect(canTransition('disputed', 'expired')).toBe(false);
	});

	it('assertTransition throws a 409 TransitionError naming both states', () => {
		expect(() => assertTransition('open', 'paid')).toThrow(TransitionError);
		try {
			assertTransition('paid', 'open');
		} catch (e) {
			expect(e.status).toBe(409);
			expect(e.code).toBe('invalid_transition');
			expect(e.message).toMatch(/Paid/);
		}
		expect(() => assertTransition('open', 'accepted')).not.toThrow();
	});

	it('a submission after the deadline is not offered to the worker', () => {
		const claim = { status: 'active' };
		expect(workerActions(base({ status: 'accepted' }), claim)).toContain('submit');
		const late = workerActions(base({ status: 'accepted', deadline_at: PAST }), claim);
		expect(late).not.toContain('submit');
		expect(late).toContain('unclaim');
	});

	it('only an open, unexpired task is acceptable', () => {
		expect(isAcceptable(base())).toBe(true);
		expect(isAcceptable(base({ deadline_at: PAST }))).toBe(false);
		expect(isAcceptable(base({ status: 'accepted' }))).toBe(false);
		expect(isAcceptable(base({ status: 'funding' }))).toBe(false);
	});

	it('poster can cancel only an open task and approve or dispute only a submitted one', () => {
		expect(posterActions(base())).toEqual(['cancel']);
		expect(posterActions(base({ status: 'accepted' }))).toEqual([]);
		expect(posterActions(base({ status: 'submitted' }))).toEqual(['approve', 'dispute']);
	});

	it('the dispute window closes at review_due_at', () => {
		const task = base({ status: 'submitted', review_due_at: PAST });
		expect(posterActions(task)).toEqual(['approve']);
	});

	it('a disputed task offers the poster nothing to release', () => {
		expect(posterActions(base({ status: 'disputed' }))).toEqual([]);
	});

	it('a worker can respond to a dispute only while their claim is submitted', () => {
		expect(workerActions(base({ status: 'disputed' }), { status: 'submitted' })).toEqual(['respond']);
		expect(workerActions(base({ status: 'disputed' }), { status: 'lost' })).toEqual([]);
		expect(workerActions(base({ status: 'accepted' }), null)).toEqual([]);
	});

	it('a refund is owed only to a funded task that ended unpaid', () => {
		expect(refundOwed({ status: 'cancelled', funded_at: new Date().toISOString() })).toBe(true);
		expect(refundOwed({ status: 'expired', escrow_signature: 'sig' })).toBe(true);
		expect(refundOwed({ status: 'cancelled' })).toBe(false);
		expect(refundOwed({ status: 'paid', funded_at: 'x' })).toBe(false);
		expect(wasFunded({ funded_at: 'x' })).toBe(true);
		expect(wasFunded({})).toBe(false);
	});

	it('reviews open after payment or a dispute decided for the poster, once per role', () => {
		const paid = { status: 'paid', accepted_claim_id: 'c1', reviewed: {} };
		expect(canReview(paid, 'poster')).toBe(true);
		expect(canReview({ ...paid, reviewed: { poster: true } }, 'poster')).toBe(false);
		expect(canReview({ ...paid, reviewed: { poster: true } }, 'worker')).toBe(true);
		expect(canReview({ ...paid, status: 'approved' }, 'poster')).toBe(false);
		expect(canReview({ ...paid, accepted_claim_id: null }, 'poster')).toBe(false);
		expect(canReview({ ...paid, status: 'cancelled', cancel_reason: 'dispute_resolved_for_poster' }, 'worker')).toBe(true);
		expect(canReview({ ...paid, status: 'cancelled', cancel_reason: 'poster_cancelled' }, 'worker')).toBe(false);
	});
});
