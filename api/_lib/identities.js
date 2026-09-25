// Sign-in identities linked to an account beyond its original method.
//
// Today that is Google (OpenID Connect). An account keeps signing in the way it
// always did (password, wallet, email code) and can ALSO sign in with a linked
// Google account. The table is user_identities (migration
// 20260922190000_account_social_sso.sql); this module is its only writer.
//
// Three flows share one round trip to Google (api/auth/google/[action].js):
//
//   login   no session needed. The Google `sub` must already be linked to an
//           account; an unlinked Google account is never turned into a new
//           account or matched by email, so a Google account can only ever
//           reach the three.ws account that deliberately linked it.
//   link    needs a session. Links the Google account to the signed-in user.
//   reauth  needs a session. Proves the person at the keyboard can sign in to
//           the Google account linked to this user right now (prompt=login,
//           max_age=0), and grants a five-minute re-authentication proof that
//           unlinking honors. A password works as the other proof.
//
// The PKCE verifier, nonce and intent ride in a short-lived HMAC-signed
// __Host- cookie, the same shape api/auth/x uses, so no server-side store is
// needed between the redirect out and the callback.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sql } from './db.js';
import { env } from './env.js';
import { hmacSha256, constantTimeEquals, randomToken, sha256Base64Url } from './crypto.js';
import { fetchUpstream } from './upstream-fetch.js';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = Object.freeze(['https://accounts.google.com', 'accounts.google.com']);

export const FLOW_COOKIE = '__Host-gsi';
export const REAUTH_COOKIE = '__Host-reauth';
export const FLOW_TTL_SEC = 600;
export const REAUTH_TTL_SEC = 300;
export const INTENTS = Object.freeze(['login', 'link', 'reauth']);

/** The identity providers an account can link. Same shape for every future one. */
export const PROVIDERS = Object.freeze([
	{ id: 'google', label: 'Google', start: '/api/auth/google/start' },
]);

export class IdentityError extends Error {
	constructor(code, message, status = 400, extra = undefined) {
		super(message);
		this.code = code;
		this.status = status;
		this.extra = extra;
	}
}

export function googleConfigured() {
	return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function googleRedirectUri() {
	return `${env.APP_ORIGIN}/api/auth/google/callback`;
}

// ── Signed cookies ───────────────────────────────────────────────────────────

async function sign(payload) {
	const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const sig = await hmacSha256(env.JWT_SECRET, `identity:${body}`);
	return `${body}.${sig}`;
}

async function unsign(token) {
	if (typeof token !== 'string') return null;
	const dot = token.lastIndexOf('.');
	if (dot <= 0) return null;
	const body = token.slice(0, dot);
	const expected = await hmacSha256(env.JWT_SECRET, `identity:${body}`);
	if (!constantTimeEquals(token.slice(dot + 1), expected)) return null;
	try {
		const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
		if (!payload || typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return null;
		return payload;
	} catch {
		return null;
	}
}

export function readCookie(req, name) {
	const header = req?.headers?.cookie || '';
	const m = header.match(new RegExp(`(?:^|;\\s*)${name.replace(/[-]/g, '\\-')}=([^;]+)`));
	return m ? decodeURIComponent(m[1]) : null;
}

export function cookie(name, value, maxAge) {
	return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name) {
	return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Start a Google round trip. Returns the URL to send the browser to and the
 * cookie that carries the flow's secrets back to the callback.
 * @param {{ intent: 'login'|'link'|'reauth', userId?: string|null, next?: string|null, loginHint?: string|null }} o
 */
export async function startGoogleFlow({ intent, userId = null, next = null, loginHint = null }) {
	if (!INTENTS.includes(intent)) throw new IdentityError('validation_error', `intent must be one of ${INTENTS.join(', ')}`);
	if (intent !== 'login' && !userId) throw new IdentityError('unauthorized', 'sign in first', 401);
	const state = randomToken(16);
	const nonce = randomToken(16);
	const verifier = randomToken(32);
	const challenge = await sha256Base64Url(verifier);
	const flow = await sign({
		s: state,
		n: nonce,
		v: verifier,
		i: intent,
		u: userId,
		x: next,
		e: Math.floor(Date.now() / 1000) + FLOW_TTL_SEC,
	});
	const url = new URL(GOOGLE_AUTH_URL);
	url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
	url.searchParams.set('redirect_uri', googleRedirectUri());
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', 'openid email profile');
	url.searchParams.set('state', state);
	url.searchParams.set('nonce', nonce);
	url.searchParams.set('code_challenge', challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	if (intent === 'reauth') {
		// Force a fresh credential entry; the callback also checks auth_time.
		url.searchParams.set('prompt', 'login');
		url.searchParams.set('max_age', '0');
	} else {
		url.searchParams.set('prompt', 'select_account');
	}
	if (loginHint) url.searchParams.set('login_hint', loginHint);
	return { url: url.toString(), cookie: cookie(FLOW_COOKIE, flow, FLOW_TTL_SEC) };
}

/** Read and check the flow cookie against the `state` Google sent back. */
export async function readGoogleFlow(req, state) {
	const payload = await unsign(readCookie(req, FLOW_COOKIE));
	if (!payload || typeof state !== 'string' || !constantTimeEquals(payload.s, state)) return null;
	return { nonce: payload.n, verifier: payload.v, intent: payload.i, userId: payload.u || null, next: payload.x || null };
}

// ── Google token exchange and ID token verification ─────────────────────────

let jwks = null;
function googleJwks() {
	if (!jwks) jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
	return jwks;
}

/** Swap an authorization code for Google's ID token. */
export async function exchangeGoogleCode({ code, verifier }) {
	const res = await fetchUpstream(
		GOOGLE_TOKEN_URL,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
			body: new URLSearchParams({
				code,
				client_id: env.GOOGLE_OAUTH_CLIENT_ID,
				client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
				redirect_uri: googleRedirectUri(),
				grant_type: 'authorization_code',
				code_verifier: verifier,
			}).toString(),
		},
		{ name: 'google-oauth', timeoutMs: 10_000, attempts: 1, okWhen: () => true },
	);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.id_token) {
		throw new IdentityError('exchange_failed', body.error_description || body.error || `Google answered ${res.status}`, 502);
	}
	return body.id_token;
}

/**
 * Normalize verified ID token claims. Exported so tests and the verifier agree
 * on exactly which claims are required.
 */
export function claimsFromPayload(payload, { nonce, maxAuthAgeSec = null, now = Date.now() } = {}) {
	if (!payload?.sub || typeof payload.sub !== 'string') throw new IdentityError('invalid_token', 'the Google token has no subject');
	if (nonce && payload.nonce !== nonce) throw new IdentityError('invalid_token', 'the Google token was issued for a different sign-in');
	if (maxAuthAgeSec != null) {
		const authTime = Number(payload.auth_time);
		if (!Number.isFinite(authTime) || now / 1000 - authTime > maxAuthAgeSec) {
			throw new IdentityError('reauth_stale', 'Google did not ask for your password again; try re-authenticating once more', 401);
		}
	}
	return {
		subject: payload.sub,
		email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
		email_verified: payload.email_verified === true || payload.email_verified === 'true',
		display_name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null,
		avatar_url: typeof payload.picture === 'string' && /^https:\/\//.test(payload.picture) ? payload.picture : null,
	};
}

export async function verifyGoogleIdToken(idToken, { nonce, maxAuthAgeSec = null } = {}) {
	let payload;
	try {
		({ payload } = await jwtVerify(idToken, googleJwks(), {
			issuer: [...GOOGLE_ISSUERS],
			audience: env.GOOGLE_OAUTH_CLIENT_ID,
		}));
	} catch (err) {
		throw new IdentityError('invalid_token', `the Google token did not verify: ${err?.code || err?.message}`);
	}
	return claimsFromPayload(payload, { nonce, maxAuthAgeSec });
}

// ── Accounts ─────────────────────────────────────────────────────────────────

/** The live account an identity signs in to, or null. */
export async function findUserByIdentity(provider, subject) {
	const [row] = await sql`
		select u.id, u.deleted_at, i.id as identity_id
		from user_identities i join users u on u.id = i.user_id
		where i.provider = ${provider} and i.subject = ${subject}
		limit 1
	`;
	return row || null;
}

export async function touchIdentity(identityId) {
	await sql`update user_identities set last_used_at = now() where id = ${identityId}`;
}

/**
 * Link an identity to a user. Refuses an identity already linked elsewhere,
 * and a second, different account of the same provider on this user.
 */
export async function linkIdentity({ userId, provider, claims }) {
	const owner = await findUserByIdentity(provider, claims.subject);
	if (owner && owner.id !== userId) {
		throw new IdentityError('identity_in_use', `that ${provider} account is already linked to another three.ws account`, 409);
	}
	const [existing] = await sql`
		select subject from user_identities where user_id = ${userId} and provider = ${provider} limit 1
	`;
	if (existing && existing.subject !== claims.subject) {
		throw new IdentityError('already_linked', `a different ${provider} account is already linked; unlink it first`, 409);
	}
	const [row] = await sql`
		insert into user_identities (user_id, provider, subject, email, email_verified, display_name, avatar_url, last_used_at)
		values (${userId}, ${provider}, ${claims.subject}, ${claims.email}, ${claims.email_verified},
		        ${claims.display_name}, ${claims.avatar_url}, now())
		on conflict (user_id, provider) do update set
			email = excluded.email,
			email_verified = excluded.email_verified,
			display_name = excluded.display_name,
			avatar_url = excluded.avatar_url,
			last_used_at = now()
		returning id, provider, email, linked_at
	`;
	return { ...row, relinked: Boolean(existing) };
}

/**
 * Every way this account can sign in. `count` is what the unlink guards read:
 * an account is never left with zero.
 */
export async function listSignInMethods(userId) {
	const [[user], wallets, identities] = await Promise.all([
		sql`select email, password_hash is not null as has_password, privy_did is not null as has_privy
		    from users where id = ${userId} limit 1`,
		sql`select address, chain_type, is_primary, created_at, last_used_at
		    from user_wallets where user_id = ${userId} order by is_primary desc, created_at asc`,
		sql`select provider, email, email_verified, display_name, linked_at, last_used_at
		    from user_identities where user_id = ${userId} order by linked_at asc`,
	]);
	const password = Boolean(user?.has_password);
	const privy = Boolean(user?.has_privy);
	return {
		password,
		email: user?.email || null,
		email_code: privy,
		wallets: wallets.map((w) => ({
			address: w.address,
			chain: w.chain_type,
			primary: w.is_primary,
			linked_at: w.created_at,
			last_used_at: w.last_used_at,
		})),
		identities: identities.map((i) => ({
			provider: i.provider,
			email: i.email,
			email_verified: i.email_verified,
			display_name: i.display_name,
			linked_at: i.linked_at,
			last_used_at: i.last_used_at,
		})),
		count: (password ? 1 : 0) + (privy ? 1 : 0) + wallets.length + identities.length,
	};
}

// ── Re-authentication ────────────────────────────────────────────────────────

/** Cookie proving this user re-authenticated with a provider just now. */
export async function reauthCookie(userId, provider) {
	const token = await sign({ u: userId, p: provider, e: Math.floor(Date.now() / 1000) + REAUTH_TTL_SEC });
	return cookie(REAUTH_COOKIE, token, REAUTH_TTL_SEC);
}

/** The provider the user re-authenticated with in the last five minutes, or null. */
export async function readReauth(req, userId) {
	const payload = await unsign(readCookie(req, REAUTH_COOKIE));
	return payload && payload.u === userId ? payload.p : null;
}

/**
 * Unlink an identity. `proof` is how the caller re-authenticated ('password'
 * or a provider id); the handler verifies it before calling this.
 */
export async function unlinkIdentity({ userId, provider }) {
	const methods = await listSignInMethods(userId);
	if (!methods.identities.some((i) => i.provider === provider)) {
		throw new IdentityError('not_linked', `no ${provider} account is linked`, 404);
	}
	if (methods.count <= 1) {
		throw new IdentityError(
			'last_sign_in_method',
			`${provider} is the only way into this account. Set a password or link a wallet first`,
			409,
			{ settings_url: '/settings/connections#sign-in' },
		);
	}
	const rows = await sql`
		delete from user_identities where user_id = ${userId} and provider = ${provider} returning id
	`;
	return { unlinked: rows.length > 0, provider, remaining_methods: methods.count - rows.length };
}
