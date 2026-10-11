// Shared result builders for Event Market resolvers. A resolver returns exactly one of:
//   { winnerOutcomeId, evidence }        the market has a winner
//   { pending: true, reason, evidence? } the source has not produced a result yet
//   { void: true, reason, evidence }     the market cannot be settled by its rule
// Every result carries the inputs the resolver read, so the market page can show
// anyone why it resolved the way it did.

import { createHash } from 'node:crypto';

export function won(outcome, evidence) {
	return { winnerOutcomeId: outcome.id, evidence };
}

export function pending(reason, evidence = {}) {
	return { pending: true, reason, evidence };
}

export function voided(reason, evidence = {}) {
	return { void: true, reason, evidence };
}

/** Short stable fingerprint of an identifier that must not be published verbatim. */
export function refHash(value) {
	return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/** The market outcome whose ref_id equals `refId` under one of `kinds`, or null. */
export function findOutcome(outcomes, kinds, refId) {
	if (refId == null) return null;
	const want = String(refId).toLowerCase();
	return (outcomes || []).find((o) => kinds.includes(o.ref_kind) && String(o.ref_id ?? '').toLowerCase() === want) || null;
}

export function iso(v) {
	return v ? new Date(v).toISOString() : null;
}

export function ruleOf(market) {
	const r = market?.resolution_rule;
	return r && typeof r === 'object' ? r : {};
}
