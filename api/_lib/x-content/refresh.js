// Which approved posts have gone stale before they could go out.
//
// An approved item only publishes while its proof reel, its head, and its
// editorial review are all current (reel.js, formats.js, review.js: each
// expires after 14 days). A queue that sits approved through a quiet stretch,
// or while auto-publish is off, quietly turns into a queue of posts the
// publisher refuses, and nothing said so. `advance --refresh` (the unattended
// refill job, deploy/x-partners/run.sh) takes every approved, unpublished item
// this module names, films it again, rebuilds its head, reviews it again, and
// restores the approval it already had.
//
// Pure apart from reading the proof and review records on disk.

import { approvalProblems } from './review.js';
import { proofProblems } from './reel.js';
import { STANDALONE_HEADS, headProblems } from './formats.js';

// What is stale about one approved item, as the reasons the publisher would
// give. Empty when it can go out as it is.
export function staleReasons(item, root, { now = Date.now(), checks = {} } = {}) {
	const proof = checks.proof || ((row) => proofProblems(row, root));
	const head = checks.head || ((row) => headProblems(row, root));
	const review = checks.review || ((row) => approvalProblems(row, root, now));
	const reasons = [];
	if (item.scenario) reasons.push(...proof(item).map((problem) => `proof: ${problem}`));
	if (STANDALONE_HEADS.includes(item.head?.as)) reasons.push(...head(item).map((problem) => `head: ${problem}`));
	reasons.push(...review(item).map((problem) => `review: ${problem}`));
	return reasons;
}

// Approved items not yet on the publish ledger that the publisher would refuse
// today, each with its reasons.
export function staleApproved(items, root, { published = [], now = Date.now(), checks } = {}) {
	const sent = new Set(published.map((row) => row.id));
	return (items || [])
		.filter((item) => item.status === 'approved' && !sent.has(item.id))
		.map((item) => ({ item, reasons: staleReasons(item, root, { now, checks }) }))
		.filter((row) => row.reasons.length);
}

// The approval an item had before a refresh, so a passing re-review can give
// it back without a fresh embargo: the copy is what was approved, and only the
// evidence was renewed.
export function priorApproval(item) {
	return { approvedBy: item.approvedBy || 'owner', notBefore: item.notBefore };
}

// The approval carries over only when the words are the words that were
// approved. A copy edit since the last review is new copy, and goes through the
// approval policy (and its embargo) like any other.
export function sameCopy(before, after) {
	const texts = (record) => JSON.stringify((record?.texts || []).map((text) => String(text).trim()));
	return Boolean(before?.texts?.length) && texts(before) === texts(after);
}

export function restoreApproval(item, prior, now = Date.now()) {
	item.status = 'approved';
	item.approvedBy = prior.approvedBy;
	// An embargo that already lapsed stays lapsed; one still running is kept.
	if (prior.notBefore) item.notBefore = prior.notBefore;
	else item.notBefore = new Date(now).toISOString();
	return item;
}

// One alert line per item the refresh could not bring back, so a queue that
// cannot refill itself is said out loud instead of going quiet.
export function stuckDigest(rows) {
	if (!rows.length) return null;
	return {
		title: `X content: ${rows.length} approved post${rows.length === 1 ? '' : 's'} could not be refreshed`,
		detail: rows.map((row) => `- ${row.id}: ${row.reason}`).join('\n'),
	};
}
