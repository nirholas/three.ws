// The /enterprise contact form, turned into a lead the existing Microsoft
// Marketplace leads pipeline stores, notifies and drafts a reply for.
//
// The form posts plain fields; this module validates them and builds the same
// document shape Partner Center sends (UserDetails, LeadSource, OfferTitle,
// Description), with LeadSource "Website-PLT" so the row is labelled as an
// enterprise page inquiry that asked to be contacted. One table, one admin
// view (/admin/microsoft/leads), one retention job.

import { WEBSITE_LEAD_SOURCE } from './microsoft-leads.js';
import { INTERESTS, TEAM_SIZES } from '../../src/enterprise-model.js';

export { INTERESTS, TEAM_SIZES };

export const ENTERPRISE_OFFER_TITLE = 'three.ws enterprise page';

const LIMITS = { name: 200, email: 320, company: 300, title: 300, country: 100, message: 4000 };
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function field(body, key) {
	const v = body?.[key];
	return typeof v === 'string' ? v.trim() : '';
}

/** Split "Ada Lovelace" into first and last name the way Partner Center sends them. */
export function splitName(full) {
	const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { first: null, last: null };
	if (parts.length === 1) return { first: parts[0], last: null };
	return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * Whether the hidden honeypot field was filled. People never see it, so a
 * value means a form-filling bot; the caller answers 200 and stores nothing.
 */
export function isHoneypotHit(body) {
	return field(body, 'website') !== '';
}

/**
 * Validate the posted form and build the lead document.
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, lead: object } | { ok: false, errors: Record<string, string> }}
 */
export function buildEnterpriseLead(body) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { ok: false, errors: { form: 'Send the form fields as a JSON object.' } };
	}
	const errors = {};
	const name = field(body, 'name');
	const email = field(body, 'email').toLowerCase();
	const company = field(body, 'company');
	const title = field(body, 'title');
	const country = field(body, 'country');
	const message = field(body, 'message');
	const interest = field(body, 'interest') || 'other';
	const teamSize = field(body, 'team_size');

	if (!name) errors.name = 'Enter your name.';
	if (!email) errors.email = 'Enter your work email.';
	else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address, like name@company.com.';
	if (!company) errors.company = 'Enter your company name.';
	if (!Object.hasOwn(INTERESTS, interest)) errors.interest = 'Choose what you need help with.';
	if (teamSize && !TEAM_SIZES.includes(teamSize)) errors.team_size = 'Choose a team size from the list.';
	for (const [key, max] of Object.entries(LIMITS)) {
		const v = key === 'email' ? email : field(body, key);
		if (v.length > max) errors[key] = `Keep this under ${max} characters.`;
	}
	if (Object.keys(errors).length) return { ok: false, errors };

	const { first, last } = splitName(name);
	const description = [
		`Interest: ${INTERESTS[interest]}`,
		teamSize ? `Team size: ${teamSize}` : null,
		message ? `\n${message}` : null,
	]
		.filter(Boolean)
		.join('\n');

	return {
		ok: true,
		lead: {
			LeadSource: WEBSITE_LEAD_SOURCE,
			ActionCode: 'PLT',
			OfferTitle: ENTERPRISE_OFFER_TITLE,
			Description: description,
			UserDetails: {
				FirstName: first,
				LastName: last,
				Email: email,
				Phone: null,
				Country: country || null,
				Company: company,
				Title: title || null,
			},
		},
	};
}
