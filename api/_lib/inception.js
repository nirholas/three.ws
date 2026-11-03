// NVIDIA Inception member perk: free prepaid generation credits.
//
// Flow: a signed-in Inception member applies (POST /api/inception/apply), a person
// reviews it (scripts/inception-review.mjs), and approval credits the account's
// prepaid wallet with a 'grant' ledger row. Membership cannot be verified by any
// public API, which is why approval is manual and the grant is a bounded amount of
// credit rather than an open-ended comp tier.
//
// The review functions live here (not in the script) so the money path is unit
// tested: the credit is idempotent on `inception:<id>`, so a review that dies
// between the credit and the status update is simply re-run.

import { sql } from './db.js';
import { creditAccount } from './credits.js';

export const DEFAULT_GRANT_USD = 25;
export const MAX_GRANT_USD = 500;

const LIMITS = Object.freeze({ company: 120, website: 300, email: 254, ref: 300, useCase: 1000 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value) {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeWebsite(raw) {
	const value = clean(raw);
	if (!value) return null;
	const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
	try {
		const url = new URL(withScheme);
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

	if (inceptionRef.length > LIMITS.ref)
		errors.inception_ref = `Keep this under ${LIMITS.ref} characters.`;

	if (useCase.length < 20) errors.use_case = 'Tell us in a sentence or two what you will generate (20 characters minimum).';
	else if (useCase.length > LIMITS.useCase) errors.use_case = `Keep this under ${LIMITS.useCase} characters.`;

	if (Object.keys(errors).length) return { errors };
	return {
		value: { company, website, contactEmail, inceptionRef: inceptionRef || null, useCase },
	};
}

function isUniqueViolation(err) {
	return err?.code === '23505' || /duplicate key|unique constraint/i.test(err?.message || '');
}

/** The caller's most recent application, or null. */
export async function latestApplication(userId) {
	const [row] = await sql`
		select id, company, status, grant_usd, reviewer_note, created_at, reviewed_at
		from inception_applications
		where user_id = ${userId}
		order by created_at desc
		limit 1
	`;
	return row || null;
}

/**
 * Insert an application. Throws a 409 `already_applied` when the account already
 * has a pending or approved one (enforced by the partial unique index, so two
 * concurrent submits cannot both land).
 */
export async function submitApplication(userId, value) {
	try {
		const [row] = await sql`
			insert into inception_applications
				(user_id, company, website, contact_email, inception_ref, use_case)
			values
				(${userId}, ${value.company}, ${value.website}, ${value.contactEmail},
				 ${value.inceptionRef}, ${value.useCase})
			returning id, status, created_at
		`;
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw Object.assign(new Error('You already have an Inception application on file.'), {
				status: 409,
				code: 'already_applied',
			});
		}
		throw err;
	}
}

/** Pending applications, oldest first, for the review queue. */
export async function listApplications({ status = 'pending', limit = 50 } = {}) {
	return sql`
		select a.id, a.status, a.company, a.website, a.contact_email, a.inception_ref,
		       a.use_case, a.grant_usd, a.reviewer_note, a.created_at, a.reviewed_at,
		       u.username, u.email as account_email
		from inception_applications a
		join users u on u.id = a.user_id
		where a.status = ${status}
		order by a.created_at asc
		limit ${limit}
	`;
}

/**
 * Approve a pending application: credit the wallet (idempotent), then stamp the
 * row. Crediting first means a crash between the two steps leaves the row pending
 * and the re-run is a ledger replay, never a double grant.
 */
export async function approveApplication({ id, grantUsd = DEFAULT_GRANT_USD, note = null }) {
	const amount = Number(grantUsd);
	if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_GRANT_USD) {
		throw Object.assign(new Error(`grant must be between 0 and ${MAX_GRANT_USD} USD`), {
			status: 400,
			code: 'bad_request',
		});
	}
	const [app] = await sql`
		select id, user_id, status, company from inception_applications where id = ${id} limit 1
	`;
	if (!app) throw Object.assign(new Error('application not found'), { status: 404, code: 'not_found' });
	if (app.status !== 'pending') {
		throw Object.assign(new Error(`application is already ${app.status}`), {
			status: 409,
			code: 'not_pending',
		});
	}
	const credit = await creditAccount({
		userId: app.user_id,
		amountUsd: amount,
		kind: 'grant',
		refType: 'inception',
		refId: app.id,
		idempotencyKey: `inception:${app.id}`,
		meta: { program: 'nvidia-inception', company: app.company },
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
	if (!text) {
		throw Object.assign(new Error('a rejection needs a note the applicant can act on'), {
			status: 400,
			code: 'bad_request',
		});
	}
	const rows = await sql`
		update inception_applications
		set status = 'rejected', reviewer_note = ${text}, reviewed_at = now()
		where id = ${id} and status = 'pending'
		returning id
	`;
	if (!rows.length) {
		throw Object.assign(new Error('application not found or not pending'), {
			status: 404,
			code: 'not_pending',
		});
	}
	return { id: rows[0].id };
}
