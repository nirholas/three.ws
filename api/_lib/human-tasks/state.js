// The human-task state machine. Pure: no database, no chain. The service and
// the sweep move a task only along an edge listed here, and every write that
// changes status is a compare-and-set on the status it read, so two actors can
// never both win the same edge.
//
//   funding -> open -> accepted -> submitted -> approved -> paid
//                 \          \            \-> disputed -> approved -> paid
//                  \          \                         \-> cancelled (refund)
//                   \          \-> open      (worker unclaimed before the deadline)
//                    \          \-> expired  (deadline passed without proof: refund)
//                     \-> cancelled (poster cancelled before anyone accepted: refund)
//                     \-> expired   (deadline passed unclaimed: refund)
//   funding -> cancelled (the escrow transfer was refused or failed: nothing moved)

export const STATUSES = Object.freeze([
	'funding', 'open', 'accepted', 'submitted', 'approved', 'disputed', 'paid', 'cancelled', 'expired',
]);

export const TRANSITIONS = Object.freeze({
	funding: Object.freeze(['open', 'cancelled']),
	open: Object.freeze(['accepted', 'cancelled', 'expired']),
	accepted: Object.freeze(['submitted', 'open', 'expired']),
	submitted: Object.freeze(['approved', 'disputed']),
	disputed: Object.freeze(['approved', 'cancelled']),
	approved: Object.freeze(['paid']),
	paid: Object.freeze([]),
	cancelled: Object.freeze([]),
	expired: Object.freeze([]),
});

export const TERMINAL = Object.freeze(new Set(['paid', 'cancelled', 'expired']));

export const STATUS_LABELS = Object.freeze({
	funding: 'Funding escrow',
	open: 'Open',
	accepted: 'In progress',
	submitted: 'Proof submitted',
	approved: 'Approved, paying out',
	disputed: 'In dispute',
	paid: 'Paid',
	cancelled: 'Cancelled',
	expired: 'Expired',
});

export class TransitionError extends Error {
	constructor(from, to) {
		super(`A task that is ${STATUS_LABELS[from] || from} cannot move to ${STATUS_LABELS[to] || to}.`);
		this.name = 'TransitionError';
		this.status = 409;
		this.code = 'invalid_transition';
		this.expose = true;
		this.from = from;
		this.to = to;
	}
}

export function canTransition(from, to) {
	return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertTransition(from, to) {
	if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/** Was USDC ever locked in this task's escrow? */
export function wasFunded(task) {
	return Boolean(task?.funded_at || task?.escrow_signature);
}

/**
 * Does the escrow owe the poster its money back? Only a funded task that ended
 * without paying anyone (cancelled before acceptance, expired, or a dispute
 * decided for the poster).
 */
export function refundOwed(task) {
	return wasFunded(task) && (task.status === 'cancelled' || task.status === 'expired');
}

/**
 * The actions the poster (the agent's current owner) can take right now.
 * @param {object} task
 * @param {Date} [now]
 */
export function posterActions(task, now = new Date()) {
	const out = [];
	if (task.status === 'open') out.push('cancel');
	if (task.status === 'submitted') {
		out.push('approve');
		if (!task.review_due_at || new Date(task.review_due_at) > now) out.push('dispute');
	}
	if (canReview(task, 'poster')) out.push('review');
	return out;
}

/**
 * The actions the worker holding the live claim can take right now.
 * @param {object} task
 * @param {object|null} claim  the viewer's claim on this task
 * @param {Date} [now]
 */
export function workerActions(task, claim, now = new Date()) {
	const out = [];
	if (!claim) return out;
	const beforeDeadline = new Date(task.deadline_at) > now;
	if (task.status === 'accepted' && claim.status === 'active') {
		if (beforeDeadline) out.push('submit');
		out.push('unclaim');
	}
	if (task.status === 'disputed' && claim.status === 'submitted') out.push('respond');
	if (canReview(task, 'worker')) out.push('review');
	return out;
}

/** A task can be rated once it paid out, or once a dispute was decided. */
export function canReview(task, role) {
	if (!task?.accepted_claim_id) return false;
	if (task.status === 'paid') return !task.reviewed?.[role];
	if (task.status === 'cancelled' && task.cancel_reason === 'dispute_resolved_for_poster') return !task.reviewed?.[role];
	return false;
}

/** Can someone browsing the board accept this task right now? */
export function isAcceptable(task, now = new Date()) {
	return task.status === 'open' && new Date(task.deadline_at) > now;
}
