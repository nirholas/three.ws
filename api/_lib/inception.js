// Partner startup-program perks: free prepaid generation credits, plus a bonus for
// a public shoutout.
//
// Flow: a signed-in member of a partner's startup program applies
// (POST /api/inception/apply), a person reviews it (scripts/inception-review.mjs),
// and approval credits the account's prepaid wallet with a 'grant' ledger row.
// After approval the member can submit the URL of a public post about three.ws
// (POST /api/inception/shoutout); a reviewer confirms the post is live and public,
// and a second 'grant' row pays the bonus. Membership and posts cannot be verified
// by any public API, which is why both steps are manual and the money is bounded.
//
// The review functions live here (not in the script) so the money path is unit
// tested. Every credit is idempotent on a per-row key, so a review that dies
// between the credit and the status update is simply re-run.

import { sql } from './db.js';
import { creditAccount } from './credits.js';

export const MAX_GRANT_USD = 500;

/**
 * Member programs. `id` is stored on the row. `hashtag` and `label` feed the
 * pre-filled shoutout text. Add a program here and the API, review script and
 * form (data-program attribute) all accept it.
 */
export const PROGRAMS = Object.freeze({
	'nvidia-inception': { label: 'NVIDIA Inception', grantUsd: 25, shoutoutBonusUsd: 10, hashtag: '#NVIDIAInception' },
	'google-for-startups': { label: 'Google for Startups', grantUsd: 25, shoutoutBonusUsd: 10, hashtag: '#GoogleForStartups' },
	'aws-activate': { label: 'AWS Activate', grantUsd: 25, shoutoutBonusUsd: 10, hashtag: '#AWSActivate' },
	'ibm-partner-plus': { label: 'IBM PartnerPlus', grantUsd: 25, shoutoutBonusUsd: 10, hashtag: '#IBMPartner' },
});

export const DEFAULT_PROGRAM = 'nvidia-inception';
export const DEFAULT_GRANT_USD = PROGRAMS[DEFAULT_PROGRAM].grantUsd;

export function resolveProgram(id) {
	const key = typeof id === 'string' && id ? id : DEFAULT_PROGRAM;
	return Object.hasOwn(PROGRAMS, key) ? { id: key, ...PROGRAMS[key] } : null;
}

const LIMITS = Object.freeze({ company: 120, website: 300, email: 254, ref: 300, useCase: 1000 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value) {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function httpError(status, code, message) {
	return Object.assign(new Error(message), { status, code });
}

function normalizeWebsite(raw) {
	const value = clean(raw);
	if (!value) return null;
	const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
	try {
		const url = new URL(withScheme);
		if (!/^https?:$/.test(url.protocol)) return null;
		if (!url.hostname.includes('.')) return null;
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Validate and normalize an application body. Returns { value } or { errors }
 * keyed by field so the form can mark each input.
 */
export function validateApplication(body) {
	const errors = {};
	const company = clean(body?.company);
	const website = normalizeWebsite(body?.website);
	const contactEmail = clean(body?.contact_email).toLowerCase();
	const inceptionRef = clean(body?.inception_ref);
	const useCase = clean(body?.use_case);

	if (!company) errors.company = 'Enter your company name.';
	else if (company.length > LIMITS.company) errors.company = `Keep the company name under ${LIMITS.company} characters.`;

	if (!website) errors.website = 'Enter your company website, for example yourstartup.com.';
	else if (website.length > LIMITS.website) errors.website = 'That website address is too long.';

	if (!EMAIL_RE.test(contactEmail) || contactEmail.length > LIMITS.email)
		errors.contact_email = 'Enter an email address we can reach you at.';

	if (inceptionRef.length > LIMITS.ref) errors.inception_ref = `Keep this under ${LIMITS.ref} characters.`;

	if (useCase.length < 20) errors.use_case = 'Tell us in a sentence or two what you will generate (20 characters minimum).';
	else if (useCase.length > LIMITS.useCase) errors.use_case = `Keep this under ${LIMITS.useCase} characters.`;

	if (Object.keys(errors).length) return { errors };
	return { value: { company, website, contactEmail, inceptionRef: inceptionRef || null, useCase } };
}

/**
 * Normalize a shoutout link. Accepts a public X/Twitter status or a LinkedIn post
 * and returns the canonical URL (no query string, no fragment), or null. The
 * canonical form is what the unique index dedupes on, so the same post cannot be
 * submitted twice by varying tracking parameters.
 */
export function normalizeShoutoutUrl(raw) {
	let url;
	try {
		url = new URL(clean(raw));
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	const host = url.hostname.toLowerCase().replace(/^(www|mobile)\./, '');
	if (host === 'x.com' || host === 'twitter.com') {
		const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})\/?$/);
		return m ? `https://x.com/${m[1].toLowerCase()}/status/${m[2]}` : null;
	}
	if (host === 'linkedin.com') {
		const m = url.pathname.match(/^\/(posts\/[^/]{3,200}|feed\/update\/urn:li:(?:activity|share|ugcPost):\d{5,25})\/?$/);
		return m ? `https://www.linkedin.com/${m[1]}` : null;
	}
	return null;
}

/** Pre-filled post text and compose link for the shoutout card. */
export function shoutoutDraft(programId) {
	const program = resolveProgram(programId);
	const label = program ? program.label : 'my startup program';
	const text = `Just generated a textured 3D model from a text prompt on @trythreews, free through ${label}. ${program ? program.hashtag : ''}`.trim();
	return { text, intent_url: `https://x.com/intent/post?text=${encodeURIComponent(text)}` };
}

function isUniqueViolation(err) {
	return err?.code === '23505' || /duplicate key|unique constraint/i.test(err?.message || '');
}

/** The caller's most recent application for a program, or null. */
export async function latestApplication(userId, program = DEFAULT_PROGRAM) {
	const [row] = await sql`
		select id, program, company, status, grant_usd, reviewer_note, reviewed_at, created_at,
		       shoutout_url, shoutout_status, shoutout_bonus_usd, shoutout_note
		from inception_applications
		where user_id = ${userId} and program = ${program}
		order by created_at desc
		limit 1
	`;
	return row || null;
}

/**
 * Insert an application. Throws a 409 `already_applied` when the account already
 * has a pending or approved one for this program (enforced by the partial unique
 * index, so two concurrent submits cannot both land).
 */
export async function submitApplication(userId, value, program = DEFAULT_PROGRAM) {
	if (!resolveProgram(program)) throw httpError(400, 'unknown_program', 'Unknown program.');
	try {
		const [row] = await sql`
			insert into inception_applications
				(user_id, program, company, website, contact_email, inception_ref, use_case)
			values
				(${userId}, ${program}, ${value.company}, ${value.website}, ${value.contactEmail},
				 ${value.inceptionRef}, ${value.useCase})
			returning id, program, status, created_at
		`;
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw httpError(409, 'already_applied', 'You already have an application on file for this program.');
		}
		throw err;
	}
}

/**
 * Attach a public post to an approved application. 409 when the application is
 * not approved, a bonus was already paid, or the post was used before.
 */
export async function submitShoutout(userId, program, rawUrl) {
	const url = normalizeShoutoutUrl(rawUrl);
	if (!url) throw httpError(422, 'validation_failed', 'Paste the link to your public post on X or LinkedIn.');
	try {
		const rows = await sql`
			update inception_applications
			set shoutout_url = ${url}, shoutout_status = 'submitted', shoutout_note = null,
			    shoutout_at = now()
			where user_id = ${userId} and program = ${program}
			  and status = 'approved' and shoutout_status in ('none', 'rejected')
			returning id, shoutout_url, shoutout_status
		`;
		if (!rows.length) {
			throw httpError(409, 'shoutout_unavailable', 'A shoutout can be submitted once your application is approved, and only until it is paid.');
		}
		return rows[0];
	} catch (err) {
		if (isUniqueViolation(err)) throw httpError(409, 'shoutout_used', 'That post has already been submitted.');
		throw err;
	}
}

/** Applications in a state, oldest first, for the review queue. */
export async function listApplications({ status = 'pending', limit = 50 } = {}) {
	return sql`
		select a.id, a.program, a.status, a.company, a.website, a.contact_email, a.inception_ref,
		       a.use_case, a.grant_usd, a.reviewer_note, a.reviewed_at, a.created_at,
		       a.shoutout_url, a.shoutout_status, a.shoutout_bonus_usd,
		       u.username, u.email as account_email
		from inception_applications a
		join users u on u.id = a.user_id
		where a.status = ${status}
		order by a.created_at asc
		limit ${limit}
	`;
}

/** Shoutouts awaiting a reviewer, oldest first. */
export async function listShoutouts({ limit = 50 } = {}) {
	return sql`
		select a.id, a.program, a.company, a.shoutout_url, a.shoutout_at,
		       u.username, u.email as account_email
		from inception_applications a
		join users u on u.id = a.user_id
		where a.shoutout_status = 'submitted'
		order by a.shoutout_at asc
		limit ${limit}
	`;
}

function checkAmount(amount, fallback) {
	const n = Number(amount ?? fallback);
	if (!Number.isFinite(n) || n <= 0 || n > MAX_GRANT_USD) {
		throw httpError(400, 'bad_request', `amount must be between 0 and ${MAX_GRANT_USD} USD`);
	}
	return n;
}

/**
 * Approve a pending application: credit the wallet (idempotent), then stamp the
 * row. Crediting first means a crash between the two steps leaves the row pending
 * and the re-run is a ledger replay, never a double grant. The default amount is
 * the application's own program grant.
 */
export async function approveApplication({ id, grantUsd, note = null }) {
	if (grantUsd !== undefined) checkAmount(grantUsd);
	const [app] = await sql`
		select id, user_id, program, status, company from inception_applications where id = ${id} limit 1
	`;
	if (!app) throw httpError(404, 'not_found', 'application not found');
	const amount = checkAmount(grantUsd, resolveProgram(app.program)?.grantUsd);
	if (app.status !== 'pending') throw httpError(409, 'not_pending', `application is already ${app.status}`);
	const credit = await creditAccount({
		userId: app.user_id,
		amountUsd: amount,
		kind: 'grant',
		refType: 'inception',
		refId: app.id,
		idempotencyKey: `inception:${app.id}`,
		meta: { program: app.program, company: app.company },
	});
	await sql`
		update inception_applications
		set status = 'approved', grant_usd = ${amount.toFixed(6)}, reviewer_note = ${note},
		    reviewed_at = now()
		where id = ${app.id} and status = 'pending'
	`;
	return { id: app.id, userId: app.user_id, grantUsd: amount, balanceUsd: credit.balanceUsd, replay: credit.replay };
}

/** Reject a pending application. The note is shown to the applicant. */
export async function rejectApplication({ id, note }) {
	const text = clean(note);
	if (!text) throw httpError(400, 'bad_request', 'a rejection needs a note the applicant can act on');
	const rows = await sql`
		update inception_applications
		set status = 'rejected', reviewer_note = ${text}, reviewed_at = now()
		where id = ${id} and status = 'pending'
		returning id
	`;
	if (!rows.length) throw httpError(404, 'not_pending', 'application not found or not pending');
	return { id: rows[0].id };
}

/** Pay the shoutout bonus for a submitted post the reviewer has confirmed is live. */
export async function approveShoutout({ id, bonusUsd, note = null }) {
	if (bonusUsd !== undefined) checkAmount(bonusUsd);
	const [app] = await sql`
		select id, user_id, program, company, shoutout_status
		from inception_applications where id = ${id} limit 1
	`;
	if (!app) throw httpError(404, 'not_found', 'application not found');
	const amount = checkAmount(bonusUsd, resolveProgram(app.program)?.shoutoutBonusUsd);
	if (app.shoutout_status !== 'submitted') {
		throw httpError(409, 'not_submitted', `shoutout is ${app.shoutout_status}, not submitted`);
	}
	const credit = await creditAccount({
		userId: app.user_id,
		amountUsd: amount,
		kind: 'grant',
		refType: 'inception_shoutout',
		refId: app.id,
		idempotencyKey: `inception-shoutout:${app.id}`,
		meta: { program: app.program, company: app.company },
	});
	await sql`
		update inception_applications
		set shoutout_status = 'approved', shoutout_bonus_usd = ${amount.toFixed(6)}, shoutout_note = ${note}
		where id = ${app.id} and shoutout_status = 'submitted'
	`;
	return { id: app.id, bonusUsd: amount, balanceUsd: credit.balanceUsd, replay: credit.replay };
}

/** Reject a submitted shoutout with a note; the member can submit another link. */
export async function rejectShoutout({ id, note }) {
	const text = clean(note);
	if (!text) throw httpError(400, 'bad_request', 'a rejection needs a note the applicant can act on');
	const rows = await sql`
		update inception_applications
		set shoutout_status = 'rejected', shoutout_note = ${text}, shoutout_url = null
		where id = ${id} and shoutout_status = 'submitted'
		returning id
	`;
	if (!rows.length) throw httpError(404, 'not_submitted', 'shoutout not found or not submitted');
	return { id: rows[0].id };
}
