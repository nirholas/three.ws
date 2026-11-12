// The live review workspace for sign packs that are not native.
//
// Reviewers are granted per pack by an admin (sign_reviewers). Each verdict is
// recorded against the exact content hash the reviewer watched (sign_reviews),
// so an edit to a sign silently retires every verdict on the old content.
//
// What is SERVED never reads these tables: /api/sign, the MCP tools and the
// browser serve from the ledger committed in the pack
// (src/sign-packs/reviews/<id>.js, written from these rows by
// scripts/export-sign-reviews.mjs). That keeps serving pure, deterministic and
// identical everywhere, and makes every approval that goes live a reviewed,
// committed diff. The same approval rule (src/sign-packs/review.js) runs over
// both, so the counts shown here and the counts served always agree.

import { sql } from './db.js';
import { listPacks, servablePack } from '../../src/sign-packs/index.js';
import { packReview, signReviewState } from '../../src/sign-packs/review.js';
import { signContentHash } from '../../src/sign-packs/hash.js';
import FIXTURE from '../../src/sign-packs/review-fixture.js';

export const VERDICTS = Object.freeze(['approve', 'reject', 'needs_change']);

const IS_PROD = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

export class SignReviewError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

/**
 * Packs that take reviews: every registered pack that is not native, plus the
 * review-flow fixture outside production when SIGN_REVIEW_FIXTURE=1.
 */
export function reviewablePacks() {
	const packs = listPacks().filter((p) => p.status !== 'native');
	if (!IS_PROD && process.env.SIGN_REVIEW_FIXTURE === '1') packs.push(FIXTURE);
	return packs;
}

export function getReviewPack(id) {
	const want = String(id ?? '').trim().toLowerCase();
	if (!want) return null;
	return reviewablePacks().find((p) => p.id === want || p.bcp47.toLowerCase() === want) ?? null;
}

function requirePack(id) {
	const pack = getReviewPack(id);
	if (!pack) throw new SignReviewError(404, 'unknown_pack', `no sign pack under review is called "${id ?? ''}"`);
	return pack;
}

/** A pack summary that is safe to show anyone. */
export function packSummary(pack) {
	return {
		id: pack.id,
		name: pack.name,
		bcp47: pack.bcp47,
		required_approvals: pack.requiredApprovals,
		total: Object.keys(pack.signs).length,
		served: servablePack(pack).review.approved,
	};
}

export async function isReviewer(userId, packId) {
	if (!userId) return false;
	const [row] = await sql`
		select 1 from sign_reviewers
		where user_id = ${userId} and pack = ${packId} and revoked_at is null
		limit 1
	`;
	return Boolean(row);
}

/** The packs a user may review, as ids. */
export async function grantsFor(userId) {
	if (!userId) return [];
	const rows = await sql`
		select pack from sign_reviewers where user_id = ${userId} and revoked_at is null order by pack
	`;
	return rows.map((r) => r.pack);
}

/**
 * Every verdict that counts for a pack: verdicts by reviewers whose grant is
 * still active. Revoking a reviewer keeps their rows (the audit trail) but stops
 * them counting, here and in the exported ledger.
 */
export async function reviewRows(packId) {
	return sql`
		select r.sign_key, r.content_hash, r.reviewer_id, r.verdict, r.note, r.updated_at, g.display_name
		from sign_reviews r
		join sign_reviewers g on g.user_id = r.reviewer_id and g.pack = r.pack and g.revoked_at is null
		where r.pack = ${packId}
		order by r.updated_at asc, r.id asc
	`;
}

/**
 * What a reviewer still has to look at: every sign that is not yet approved on
 * its current content and that this reviewer has not given a verdict on in its
 * current form. Signs another reviewer rejected stay in the queue, so a second
 * opinion is always possible.
 */
export async function reviewQueue(packId, reviewerId) {
	const pack = requirePack(packId);
	const rows = await reviewRows(pack.id);
	const review = packReview(pack, rows);
	const mine = new Set(
		rows.filter((r) => String(r.reviewer_id) === String(reviewerId)).map((r) => `${r.sign_key}:${r.content_hash}`),
	);
	const items = [];
	for (const [key, sign] of Object.entries(pack.signs)) {
		const state = review.signs[key];
		if (state.state === 'approved') continue;
		if (mine.has(`${key}:${state.hash}`)) continue;
		items.push({
			key,
			gloss: sign.gloss,
			// The exact content the hash covers, so the page performs precisely
			// what the reviewer's verdict will be recorded against.
			sign,
			hash: state.hash,
			state: state.state,
			approvals: state.approvals,
			required: review.required,
		});
	}
	return { pack: packSummary(pack), items };
}

/**
 * Record one verdict. The hash the reviewer watched must still be the sign's
 * hash: if the sign changed while the page was open, the verdict would be about
 * content that no longer exists, so it is refused with sign_changed.
 */
export async function recordReview({ pack: packId, sign, hash, reviewerId, verdict, note }) {
	const pack = requirePack(packId);
	const key = String(sign ?? '').toUpperCase();
	const entry = pack.signs[key];
	if (!entry) throw new SignReviewError(404, 'unknown_sign', `"${sign}" is not a sign in ${pack.name}`);
	if (!VERDICTS.includes(verdict)) {
		throw new SignReviewError(400, 'invalid_verdict', `verdict must be one of ${VERDICTS.join(', ')}`);
	}
	const text = typeof note === 'string' ? note.trim() : '';
	if (text.length > 2000) throw new SignReviewError(400, 'note_too_long', 'notes are limited to 2000 characters');
	if (verdict !== 'approve' && !text) {
		throw new SignReviewError(400, 'note_required', 'say what is wrong so the sign can be fixed');
	}
	const current = signContentHash(entry);
	if (hash !== current) {
		throw new SignReviewError(409, 'sign_changed', 'this sign was edited since you loaded it; reload to review the current version');
	}
	await sql`
		insert into sign_reviews (pack, sign_key, content_hash, reviewer_id, verdict, note)
		values (${pack.id}, ${key}, ${current}, ${reviewerId}, ${verdict}, ${text || null})
		on conflict (pack, sign_key, content_hash, reviewer_id)
		do update set verdict = excluded.verdict, note = excluded.note, updated_at = now()
	`;
	const rows = (await reviewRows(pack.id)).filter((r) => r.sign_key === key);
	const state = signReviewState(rows, current, pack.requiredApprovals);
	return { sign: key, hash: current, verdict, ...state, required: pack.requiredApprovals };
}

/** Public aggregate counts: live workspace states plus what is actually served. */
export async function packStatus(packId) {
	const pack = requirePack(packId);
	const rows = await reviewRows(pack.id);
	const review = packReview(pack, rows);
	const counts = { approved: 0, in_review: 0, needs_change: 0, rejected: 0, unreviewed: 0 };
	for (const s of Object.values(review.signs)) counts[s.state]++;
	const [reviewers] = await sql`
		select count(*)::int as n from sign_reviewers where pack = ${pack.id} and revoked_at is null
	`;
	return { pack: packSummary(pack), counts, reviewers: reviewers?.n ?? 0 };
}

/** Grant (or refresh) a reviewer for a pack. */
export async function grantReviewer({ pack: packId, userId, displayName, credentialNote, grantedBy }) {
	const pack = requirePack(packId);
	const name = String(displayName ?? '').trim();
	if (!name || name.length > 80) throw new SignReviewError(400, 'invalid_display_name', 'display_name is 1 to 80 characters');
	const note = String(credentialNote ?? '').trim();
	if (note.length > 500) throw new SignReviewError(400, 'invalid_credential_note', 'credential_note is at most 500 characters');
	const [row] = await sql`
		insert into sign_reviewers (user_id, pack, display_name, credential_note, granted_by)
		values (${userId}, ${pack.id}, ${name}, ${note || null}, ${grantedBy})
		on conflict (user_id, pack) do update set
			display_name = excluded.display_name,
			credential_note = excluded.credential_note,
			granted_by = excluded.granted_by,
			revoked_at = null
		returning user_id, pack, display_name, credential_note, created_at, revoked_at
	`;
	return row;
}

/** Revoke a reviewer. Their verdicts stay as the audit trail and stop counting (see reviewRows). */
export async function revokeReviewer({ pack: packId, userId }) {
	const pack = requirePack(packId);
	const [row] = await sql`
		update sign_reviewers set revoked_at = now()
		where user_id = ${userId} and pack = ${pack.id} and revoked_at is null
		returning user_id, pack, display_name, revoked_at
	`;
	if (!row) throw new SignReviewError(404, 'not_a_reviewer', 'that user is not an active reviewer for this pack');
	return row;
}

/** Find a user id from an id or an email, for the admin grant form. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveUserId({ userId, email }) {
	if (userId) {
		if (!UUID.test(String(userId))) throw new SignReviewError(400, 'invalid_user_id', 'user_id must be a uuid');
		const [row] = await sql`select id from users where id = ${userId} and deleted_at is null limit 1`;
		if (row) return row.id;
	} else if (email) {
		const [row] = await sql`
			select id from users where lower(email) = ${String(email).trim().toLowerCase()} and deleted_at is null limit 1
		`;
		if (row) return row.id;
	}
	throw new SignReviewError(404, 'unknown_user', 'no account matches that user id or email');
}
