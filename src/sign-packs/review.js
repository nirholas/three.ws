// The approval rule for signs in a pack that is not native.
//
// A sign is live only when at least `required` distinct reviewers approved the
// exact content hash it has now. Reviews of an older hash do not count (the
// sign was edited after they looked at it). One reviewer counts once: their
// latest verdict on a hash is their verdict. A single reject or needs_change on
// the current hash holds the sign back however many approvals it has, because
// a fluent signer saying "this is wrong" outweighs a count.
//
// The same function runs over database rows (the live review workspace,
// api/_lib/sign-review.js) and over a pack's committed ledger (the approvals
// that ship, src/sign-packs/reviews/), so both always agree.

import { signContentHash } from './hash.js';

export const DEFAULT_REQUIRED_APPROVALS = 2;

/** @typedef {'approved'|'rejected'|'needs_change'|'in_review'|'unreviewed'} SignReviewState */

/** Accept both the ledger shape ({ sign, hash, reviewer }) and DB rows. */
function normalize(row) {
	return {
		sign: row.sign ?? row.sign_key,
		hash: row.hash ?? row.content_hash,
		reviewer: String(row.reviewer ?? row.reviewer_id ?? ''),
		verdict: row.verdict,
	};
}

/**
 * The review state of one sign's current content.
 *
 * @param {object[]} rows      reviews of this sign (any hash, any order: oldest first)
 * @param {string} hash        the sign's current content hash
 * @param {number} required    distinct approvals needed
 * @returns {{ state: SignReviewState, approvals: number, rejections: number, changes: number }}
 */
export function signReviewState(rows, hash, required = DEFAULT_REQUIRED_APPROVALS) {
	const latest = new Map();
	for (const raw of rows ?? []) {
		const row = normalize(raw);
		if (row.hash !== hash || !row.reviewer) continue;
		latest.set(row.reviewer, row.verdict);
	}
	let approvals = 0;
	let rejections = 0;
	let changes = 0;
	for (const verdict of latest.values()) {
		if (verdict === 'approve') approvals++;
		else if (verdict === 'reject') rejections++;
		else if (verdict === 'needs_change') changes++;
	}
	const need = Math.max(1, Number(required) || DEFAULT_REQUIRED_APPROVALS);
	let state = 'unreviewed';
	if (rejections) state = 'rejected';
	else if (changes) state = 'needs_change';
	else if (approvals >= need) state = 'approved';
	else if (approvals) state = 'in_review';
	return { state, approvals, rejections, changes };
}

/**
 * Review coverage of a whole pack against a set of review rows.
 *
 * @param {import('./index.js').SignPack} pack
 * @param {object[]} [rows]  defaults to the pack's committed ledger
 * @returns {{ required: number, total: number, approved: string[],
 *             signs: Record<string, { hash: string, state: SignReviewState, approvals: number }> }}
 */
export function packReview(pack, rows = pack.reviews ?? []) {
	const keys = Object.keys(pack.signs);
	if (pack.status === 'native') {
		return {
			required: 0,
			total: keys.length,
			approved: keys,
			signs: Object.fromEntries(keys.map((k) => [k, { hash: null, state: 'approved', approvals: 0 }])),
		};
	}
	const required = pack.requiredApprovals ?? DEFAULT_REQUIRED_APPROVALS;
	const byKey = new Map();
	for (const raw of rows) {
		const key = raw.sign ?? raw.sign_key;
		if (!byKey.has(key)) byKey.set(key, []);
		byKey.get(key).push(raw);
	}
	const signs = {};
	const approved = [];
	for (const key of keys) {
		const hash = signContentHash(pack.signs[key]);
		const verdict = signReviewState(byKey.get(key), hash, required);
		signs[key] = { hash, state: verdict.state, approvals: verdict.approvals };
		if (verdict.state === 'approved') approved.push(key);
	}
	return { required, total: keys.length, approved, signs };
}
