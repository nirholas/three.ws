// SAML 2.0 SSO endpoints — three.ws acts as the Service Provider.
// Dispatched by the URL action segment (see vercel.json):
//   GET  /api/auth/saml/metadata → SP metadata XML (give this to the IdP)
//   GET  /api/auth/saml/login    → build AuthnRequest, redirect to the IdP
//   POST /api/auth/saml/acs      → consume the IdP's signed assertion, sign in
//   GET  /api/auth/saml/logout   → clear the local session
//
// The ACS is intentionally NOT behind our CSRF cookie check: it receives a
// top-level form POST from the IdP (HTTP-POST binding). Its integrity comes from
// the assertion's XML signature, the audience/condition checks, and InResponseTo
// replay protection — all enforced by validatePostResponseAsync in node-saml.

import { sql } from '../../_lib/db.js';
import { createSession, sessionCookie, destroySession, getSessionUser } from '../../_lib/auth.js';
import { cors, redirect, error, wrap, readForm } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { logAudit } from '../../_lib/audit.js';
import { seedDefaultAgent } from '../../_lib/seed-default-agent.js';
import { referralCodeCandidates } from '../../_lib/referrals.js';
import {
	getSamlInstance,
	generateSpMetadataXml,
	samlConfigured,
	signRelayState,
	verifyRelayState,
	safeNextPath,
	extractSamlIdentity,
	subjectHash,
} from '../../_lib/saml.js';

const loginUrl = (params) => `${env.APP_ORIGIN}/login${params ? `?${params}` : ''}`;

// ── metadata ────────────────────────────────────────────────────────────────

async function handleMetadata(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	const xml = generateSpMetadataXml();
	res.statusCode = 200;
	res.setHeader('content-type', 'application/samlmetadata+xml; charset=utf-8');
	res.setHeader('content-disposition', 'inline; filename="three-ws-sp-metadata.xml"');
	res.setHeader('cache-control', 'public, max-age=3600');
	res.end(xml);
}

// ── login (SP-initiated) ────────────────────────────────────────────────────

async function handleLogin(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!samlConfigured()) return redirect(res, loginUrl('error=sso_unavailable'));

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return redirect(res, loginUrl('error=rate_limited'));

	const url = new URL(req.url, env.APP_ORIGIN);
	const next = safeNextPath(url.searchParams.get('next'));

	let saml;
	try {
		saml = await getSamlInstance();
	} catch {
		return redirect(res, loginUrl('error=sso_unavailable'));
	}

	const relayState = await signRelayState({ next, ts: Date.now() });
	const authnUrl = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
	return redirect(res, authnUrl);
}

// ── acs (assertion consumer service) ────────────────────────────────────────

async function handleAcs(req, res) {
	// The IdP POSTs here as a top-level navigation; reject anything else.
	if (req.method === 'OPTIONS') {
		res.statusCode = 204;
		res.end();
		return;
	}
	if (req.method !== 'POST') {
		res.setHeader('allow', 'POST');
		return error(res, 405, 'method_not_allowed', 'ACS accepts POST');
	}

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return redirect(res, loginUrl('error=rate_limited'));
	if (!samlConfigured()) return redirect(res, loginUrl('error=sso_unavailable'));

	const form = await readForm(req);
	const SAMLResponse = form.SAMLResponse;
	const RelayState = form.RelayState;
	if (!SAMLResponse) return redirect(res, loginUrl('error=saml_no_response'));

	let saml;
	try {
		saml = await getSamlInstance();
	} catch {
		return redirect(res, loginUrl('error=sso_unavailable'));
	}

	let profile;
	try {
		({ profile } = await saml.validatePostResponseAsync({ SAMLResponse, RelayState }));
	} catch (err) {
		// Signature, audience, condition, clock, or InResponseTo failure. The
		// detail is logged server-side; the user gets a generic, safe message.
		console.error('[saml] response validation failed:', err?.message);
		return redirect(res, loginUrl('error=saml_invalid'));
	}

	const identity = profile ? extractSamlIdentity(profile) : null;
	if (!identity?.nameID) return redirect(res, loginUrl('error=saml_no_subject'));

	const relay = await verifyRelayState(RelayState);
	const next = safeNextPath(relay?.next);

	try {
		const userId = await findOrCreateUser(identity);
		await destroySession(req);
		const token = await createSession({ userId, userAgent: req.headers['user-agent'], ip });
		res.setHeader('set-cookie', sessionCookie(token));
		logAudit({ userId, action: 'login', req, meta: { method: 'saml', issuer: identity.issuer } });
		return redirect(res, `${env.APP_ORIGIN}${next}`);
	} catch (err) {
		if (err?.code === 'account_deleted') return redirect(res, loginUrl('error=account_deleted'));
		console.error('[saml] provisioning failed:', err?.message);
		return redirect(res, loginUrl('error=saml_error'));
	}
}

// ── logout ──────────────────────────────────────────────────────────────────

async function handleLogout(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	const sessionUser = await getSessionUser(req).catch(() => null);
	await destroySession(req);
	res.setHeader('set-cookie', sessionCookie('', { clear: true }));
	if (sessionUser) logAudit({ userId: sessionUser.id, action: 'logout', req, meta: { method: 'saml' } });
	return redirect(res, loginUrl('signed_out=1'));
}

// ── user provisioning ───────────────────────────────────────────────────────

// Resolve the SAML subject to a three.ws user, in priority order:
//   1. Existing SSO link (issuer + NameID).
//   2. Existing account with the same verified email → link SSO to it. (Enterprise
//      IdPs attest the email, so this is safe account-linking, not takeover.)
//   3. Just-in-time provision a new account.
async function findOrCreateUser({ issuer, nameID, email, name }) {
	const issuerKey = issuer || '';

	const [bySaml] = await sql`
		select id, deleted_at from users
		where saml_issuer = ${issuerKey} and saml_name_id = ${nameID}
		limit 1
	`;
	if (bySaml) {
		if (bySaml.deleted_at) throw Object.assign(new Error('account deleted'), { code: 'account_deleted' });
		return bySaml.id;
	}

	let emailHeld = false;
	if (email) {
		const [byEmail] = await sql`select id, deleted_at, email_verified from users where email = ${email} limit 1`;
		// Link only to an account whose email this platform has verified. An
		// unverified row may be somebody who registered the address first to have
		// the real owner's SSO sign-in land in an account they hold the password
		// to. It is left alone, and this identity gets its own account.
		if (byEmail && !byEmail.deleted_at && !byEmail.email_verified) {
			emailHeld = true;
		} else if (byEmail) {
			if (byEmail.deleted_at) {
				throw Object.assign(new Error('account deleted'), { code: 'account_deleted' });
			}
			await sql`
				update users
				set saml_issuer = ${issuerKey}, saml_name_id = ${nameID},
				    email_verified = true, updated_at = now()
				where id = ${byEmail.id}
			`;
			return byEmail.id;
		}
	}

	// Synthetic, non-deliverable address when the IdP releases no email — mirrors
	// the wallet-login convention (…@wallet.local) so downstream code that keys
	// off email still works.
	const userEmail = (!emailHeld && email) || `saml-${await subjectHash(issuer, nameID)}@sso.three.ws.local`;
	const displayName = name || (email ? email.split('@')[0] : 'SSO User');
	const userId = await insertSamlUser({
		email: userEmail,
		displayName,
		issuer: issuerKey,
		nameID,
		emailVerified: Boolean(email) && !emailHeld,
	});
	queueMicrotask(() => seedDefaultAgent(userId));
	return userId;
}

// Bounded retry around the unique referral_code index (mirrors api/auth/[action].js).
// The first candidate is the member's name (default referral code reads like
// them), then name+suffix, then random fallbacks. A 23505 on a non-referral
// constraint means a concurrent ACS won the race for this subject/email —
// re-select and return that user instead of erroring.
async function insertSamlUser({ email, displayName, issuer, nameID, emailVerified }) {
	for (const code of referralCodeCandidates(displayName)) {
		try {
			const [row] = await sql`
				insert into users (email, display_name, referral_code, saml_issuer, saml_name_id, email_verified)
				values (${email}, ${displayName}, ${code}, ${issuer}, ${nameID}, ${emailVerified})
				returning id
			`;
			return row.id;
		} catch (err) {
			if (err?.code === '23505' && /referral_code/.test(err.message || '')) continue;
			if (err?.code === '23505') {
				const [existing] = await sql`
					select id from users
					where (saml_issuer = ${issuer} and saml_name_id = ${nameID}) or email = ${email}
					limit 1
				`;
				if (existing) return existing.id;
			}
			throw err;
		}
	}
	throw new Error('referral_code_generation_exhausted');
}

// ── dispatch ────────────────────────────────────────────────────────────────

const DISPATCH = {
	metadata: handleMetadata,
	login: handleLogin,
	acs: handleAcs,
	logout: handleLogout,
};

export default wrap(async (req, res) => {
	const action =
		req.query?.action ?? new URL(req.url, env.APP_ORIGIN).pathname.split('/').filter(Boolean).pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown saml action: ${action}`);
	return fn(req, res);
});
