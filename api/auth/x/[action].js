// X (Twitter) OAuth 2.0 PKCE flow. Dispatches on ?action=connect|callback|login.
// Env required: X_OAUTH_CLIENT_ID, X_OAUTH_CLIENT_SECRET
// If unset, /connect and /login return 501 not_configured.
//
// /connect takes an optional ?scope=read|full (default full, see
// api/_lib/x-scopes.js). The memory-seeding card asks for `read` so an owner who
// only wants their agent to sound like them never has to grant permission to
// post as them; the posting surfaces ask for `full`.
//
// /login is a separate, session-free round trip through the same client:
// "Sign in with X" on /login (api/config.js xLoginEnabled). An X account
// already linked (user_identities, api/_lib/identities.js) signs straight in;
// an X account already connected for posting (social_connections, this file's
// own connect flow) links and signs in rather than creating a duplicate; a
// genuinely new X account gets a passwordless three.ws account, since X's
// OAuth2 profile never carries a verified email to match against one.
//
// PKCE state ({code_verifier, user_id, agent_id}) is carried in a short-lived,
// HMAC-signed httpOnly cookie keyed by the OAuth `state` param. No external
// store needed; the cookie is sent back on the top-level redirect from x.com
// thanks to SameSite=Lax.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { sql } from '../../_lib/db.js';
import { getSessionUser, createSession, sessionCookie } from '../../_lib/auth.js';
import {
	sha256Base64Url,
	randomToken,
	hmacSha256,
	constantTimeEquals,
} from '../../_lib/crypto.js';
import { cors, method, wrap, error, redirect, rateLimited, wantsHtmlNavigation } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { logAudit } from '../../_lib/audit.js';
import { seedDefaultAgent } from '../../_lib/seed-default-agent.js';
import { safeNext } from '../../../src/safe-next.js';
import { revokeAllSeedConsentsForUser } from '../../_lib/x-seed-consent.js';
import { resolveScopeSet } from '../../_lib/x-scopes.js';
import { findUserByIdentity, touchIdentity, linkIdentity, IdentityError } from '../../_lib/identities.js';
import { findUserByXId } from '../../_lib/x-identity.js';

import { fetchUpstream } from '../../_lib/upstream-fetch.js';
import { isUuid } from '../../_lib/validate.js';
// ── Signed-cookie PKCE state ─────────────────────────────────────────────────

const STATE_COOKIE = '__Host-xoa';
const STATE_TTL_SEC = 600;

function b64urlEncode(str) {
	return Buffer.from(str, 'utf8').toString('base64url');
}
function b64urlDecode(s) {
	return Buffer.from(s, 'base64url').toString('utf8');
}

async function signState({
	state, codeVerifier, userId = null, agentId = null, scopeSet, returnTo = null, target = 'owner',
	purpose = 'connect', next = null,
}) {
	const payload = {
		s: state,
		v: codeVerifier,
		u: userId,
		a: agentId,
		k: scopeSet,
		r: returnTo || null,
		t: target === 'agent' ? 'agent' : 'owner',
		p: purpose === 'login' ? 'login' : 'connect',
		n: typeof next === 'string' ? next : null,
		e: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
	};
	const body = b64urlEncode(JSON.stringify(payload));
	const sig = await hmacSha256(env.JWT_SECRET, body);
	return `${body}.${sig}`;
}

async function verifyState(token, expectedState) {
	if (!token || typeof token !== 'string') return null;
	const dot = token.indexOf('.');
	if (dot < 1) return null;
	const body = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expected = await hmacSha256(env.JWT_SECRET, body);
	if (!constantTimeEquals(sig, expected)) return null;
	let payload;
	try {
		payload = JSON.parse(b64urlDecode(body));
	} catch {
		return null;
	}
	if (!payload || payload.s !== expectedState) return null;
	if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return null;
	return {
		codeVerifier: payload.v,
		userId: payload.u,
		agentId: payload.a,
		scopeSet: resolveScopeSet(payload.k).name,
		returnTo: resolveReturnTo(payload.r),
		target: payload.t === 'agent' ? 'agent' : 'owner',
		purpose: payload.p === 'login' ? 'login' : 'connect',
		next: payload.n || null,
	};
}

function readStateCookie(req) {
	const cookie = req.headers.cookie || '';
	const m = cookie.match(/(?:^|;\s*)__Host-xoa=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

function stateCookie(value, { clear = false } = {}) {
	if (clear) {
		return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
	}
	return `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_TTL_SEC}`;
}

// ── Token encryption (AES-256-GCM, key from JWT_SECRET via HKDF) ─────────────

function _deriveKey() {
	return hkdfSync('sha256', Buffer.from(env.JWT_SECRET), '', 'x-token', 32);
}

export function encryptToken(plaintext) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', _deriveKey(), iv);
	const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptToken(ciphertext) {
	const parts = ciphertext.split('.');
	if (parts.length !== 3) throw new Error('malformed ciphertext');
	const [ivB64, encB64, tagB64] = parts;
	const decipher = createDecipheriv(
		'aes-256-gcm',
		_deriveKey(),
		Buffer.from(ivB64, 'base64url'),
	);
	decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
	return Buffer.concat([
		decipher.update(Buffer.from(encB64, 'base64url')),
		decipher.final(),
	]).toString('utf8');
}

// ── Where a finished or refused connect sends the browser back to ────────────

// A read-only connect can only have come from the memory-seeding card, so it
// goes back to Settings (with the agent it targets) rather than to the agent
// editor's posting tab, which is about the write access that grant deliberately
// does not carry. The callback and the connect endpoint both route through this
// so a refusal lands on the same surface a success would.
// Surfaces that start a connect for their own flow and want the browser back on
// them. An allowlist, never a raw path, so the parameter cannot become an open
// redirect.
const RETURN_SURFACES = new Set(['/fee-bridge', '/settings/connections']);

function resolveReturnTo(value) {
	return typeof value === 'string' && RETURN_SURFACES.has(value) ? value : null;
}

// Where a failed or successful "sign in with X" lands, mirroring
// api/auth/google/[action].js's loginUrl so /login's error-message map and
// ?next= handling work identically for both providers.
function loginUrl(code, next) {
	const q = new URLSearchParams({ error: code });
	if (next) q.set('next', next);
	return `/login?${q.toString()}`;
}

function connectReturnUrl({ scopeSet, agentId, outcome, returnTo = null, target = 'owner' }) {
	// An agent-owned account is managed on /settings/connections, so a connect
	// made for one agent always lands back on that agent's card there.
	if (target === 'agent' || returnTo === '/settings/connections') {
		const q = new URLSearchParams({ x: outcome });
		if (agentId) q.set('agent', agentId);
		return `/settings/connections?${q.toString()}#x`;
	}
	if (returnTo) return `${returnTo}?x=${outcome}`;
	if (scopeSet === 'read') {
		const q = new URLSearchParams({ tab: 'connected-accounts', x: outcome });
		if (agentId) q.set('agent_id', agentId);
		return `/settings?${q.toString()}`;
	}
	return agentId
		? `/agents/${encodeURIComponent(agentId)}/edit?tab=social&x=${outcome}`
		: `/settings?tab=connected-accounts&x=${outcome}`;
}

// ── GET /api/auth/x/connect ───────────────────────────────────────────────────

async function handleConnect(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, env.APP_ORIGIN);
	const agentId = url.searchParams.get('agent_id') || null;
	const scopeSet = resolveScopeSet(url.searchParams.get('scope'));
	const returnTo = resolveReturnTo(url.searchParams.get('return_to'));
	// target=agent connects an X account to this one agent (it then posts as
	// itself); the default connects the owner's own account.
	const target = url.searchParams.get('target') === 'agent' ? 'agent' : 'owner';
	if (target === 'agent' && !isUuid(agentId)) {
		return error(res, 400, 'validation_error', 'target=agent needs agent_id (a uuid)');
	}

	if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET) {
		// Every Connect X button on the site is an anchor or a location assignment,
		// so an unconfigured deployment used to answer a top-level navigation with a
		// raw JSON body in the address bar. Send the browser back to the surface it
		// came from with an outcome the page explains instead; API and agent callers
		// still get the 501 envelope they parse.
		if (wantsHtmlNavigation(req)) {
			return redirect(
				res,
				connectReturnUrl({ scopeSet: scopeSet.name, agentId, outcome: 'unconfigured', returnTo, target }),
			);
		}
		return error(res, 501, 'not_configured', 'X OAuth is not configured');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (target === 'agent') {
		const [owned] = await sql`
			select 1 from agent_identities where id = ${agentId} and user_id = ${user.id} and deleted_at is null limit 1
		`;
		if (!owned) return error(res, 404, 'not_found', 'agent not found');
	}

	const codeVerifier = randomToken(32); // 43-char base64url
	const codeChallenge = await sha256Base64Url(codeVerifier);
	const state = randomToken(16);

	const signed = await signState({
		state,
		codeVerifier,
		userId: user.id,
		agentId,
		scopeSet: scopeSet.name,
		returnTo,
		target,
	});
	res.setHeader('set-cookie', stateCookie(signed));

	const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', env.X_OAUTH_CLIENT_ID);
	authUrl.searchParams.set('redirect_uri', `${env.APP_ORIGIN}/api/auth/x/callback`);
	// The full set's media.write lets a connected account upload screenshots /
	// walk clips via the v2 media-upload endpoint (see api/share/x.js) before
	// attaching them to a tweet. The read set drops every write scope: it is what
	// memory seeding needs and all it needs.
	authUrl.searchParams.set('scope', scopeSet.value);
	authUrl.searchParams.set('state', state);
	authUrl.searchParams.set('code_challenge', codeChallenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');

	return redirect(res, authUrl.toString());
}

// ── GET /api/auth/x/callback ──────────────────────────────────────────────────

// Swap an authorization code for tokens, then fetch the profile they unlock.
// Shared by the connect callback (writes a posting connection) and the login
// callback (signs the browser in), since both are the same X OAuth2 client.
async function exchangeXCode({ code, codeVerifier }) {
	const creds = Buffer.from(`${env.X_OAUTH_CLIENT_ID}:${env.X_OAUTH_CLIENT_SECRET}`).toString(
		'base64',
	);
	const tokenRes = await fetchUpstream('https://api.twitter.com/2/oauth2/token', {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			authorization: `Basic ${creds}`,
		},
		body: new URLSearchParams({
			code,
			grant_type: 'authorization_code',
			client_id: env.X_OAUTH_CLIENT_ID,
			redirect_uri: `${env.APP_ORIGIN}/api/auth/x/callback`,
			code_verifier: codeVerifier,
		}).toString(),
	}, { name: 'x-api', timeoutMs: 15_000, attempts: 1, okWhen: () => true });

	if (!tokenRes.ok) {
		console.error('[x-oauth] token exchange failed', await tokenRes.text());
		return { ok: false };
	}

	const tokens = await tokenRes.json().catch(() => ({}));
	const { access_token, refresh_token, expires_in } = tokens;
	// X echoes the scopes it actually granted, which can be narrower than what we
	// asked for if the user unticked a permission. Record them: social_connections
	// .scopes is NOT NULL, and the memory-seeding consent screen shows the owner
	// what this connection is allowed to do.
	const grantedScopes = typeof tokens.scope === 'string' ? tokens.scope : '';
	if (!access_token) {
		console.error('[x-oauth] token response carried no access_token');
		return { ok: false };
	}
	const expiresAt = new Date(Date.now() + (expires_in ?? 7200) * 1000).toISOString();

	const profileRes = await fetchUpstream('https://api.twitter.com/2/users/me?user.fields=name,username,description,profile_image_url,public_metrics', { headers: { authorization: `Bearer ${access_token}` } }, { name: 'x-api', timeoutMs: 15_000, attempts: 2, okWhen: () => true });
	if (!profileRes.ok) {
		console.error('[x-oauth] profile fetch failed', await profileRes.text());
		return { ok: false };
	}
	const { data: profile } = await profileRes.json().catch(() => ({}));
	// X answers 200 with an `errors` array (and no `data`) for a suspended or
	// otherwise unreadable account. Treat a profile without an id as a failed
	// exchange rather than a NULL provider_uid insert that 500s on the
	// not-null constraint.
	if (!profile?.id) {
		console.error('[x-oauth] profile response missing data.id');
		return { ok: false };
	}

	return { ok: true, profile, accessToken: access_token, refreshToken: refresh_token || null, expiresAt, grantedScopes };
}

async function handleCallback(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET) {
		return error(res, 501, 'not_configured', 'X OAuth is not configured');
	}

	const url = new URL(req.url, env.APP_ORIGIN);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!state) return error(res, 400, 'validation_error', 'missing state');

	const cookieToken = readStateCookie(req);
	const stateData = await verifyState(cookieToken, state);
	// Burn the cookie regardless of validity so a leaked/replayed token can't be reused.
	res.setHeader('set-cookie', stateCookie('', { clear: true }));
	if (!stateData) return error(res, 400, 'invalid_state', 'OAuth state expired or invalid');

	const { codeVerifier, userId, agentId: stateAgentId, scopeSet, returnTo, target, purpose, next } = stateData;

	if (purpose === 'login') {
		if (url.searchParams.get('error')) return redirect(res, loginUrl('x_cancelled', next));
		if (!code) return redirect(res, loginUrl('x_failed', next));
		const result = await exchangeXCode({ code, codeVerifier });
		if (!result.ok) return redirect(res, loginUrl('x_failed', next));
		return completeXLogin(req, res, { profile: result.profile, next });
	}

	// Return to the surface that started the connect, the same one a refusal at
	// /connect lands on.
	const backTo = (outcome) =>
		connectReturnUrl({ scopeSet, agentId: stateAgentId, outcome, returnTo, target });
	const successRedirect = backTo('connected');
	const errorRedirect = backTo('error');
	const deniedRedirect = backTo('denied');

	if (url.searchParams.get('error')) return redirect(res, deniedRedirect);
	if (!code) return error(res, 400, 'validation_error', 'missing code');

	const result = await exchangeXCode({ code, codeVerifier });
	if (!result.ok) return redirect(res, errorRedirect);
	const { profile, accessToken, refreshToken, expiresAt, grantedScopes } = result;

	const encAccess = encryptToken(accessToken);
	const encRefresh = refreshToken ? encryptToken(refreshToken) : null;

	if (target === 'agent') {
		// Ownership was checked at /connect; re-check here because the agent can
		// change hands (marketplace transfer) inside the ten-minute state window.
		const [owned] = await sql`
			select 1 from agent_identities where id = ${stateAgentId} and user_id = ${userId} and deleted_at is null limit 1
		`;
		if (!owned) return redirect(res, errorRedirect);
		await sql`
			INSERT INTO agent_x_connections
				(agent_id, user_id, provider_uid, username, access_token, refresh_token, expires_at, raw_data, scopes)
			VALUES
				(${stateAgentId}, ${userId}, ${profile.id}, ${profile.username}, ${encAccess}, ${encRefresh}, ${expiresAt}, ${JSON.stringify(profile)}, ${grantedScopes})
			ON CONFLICT (agent_id) DO UPDATE SET
				user_id         = EXCLUDED.user_id,
				provider_uid    = EXCLUDED.provider_uid,
				username        = EXCLUDED.username,
				access_token    = EXCLUDED.access_token,
				refresh_token   = EXCLUDED.refresh_token,
				expires_at      = EXCLUDED.expires_at,
				raw_data        = EXCLUDED.raw_data,
				scopes          = EXCLUDED.scopes,
				disconnected_at = NULL,
				updated_at      = now()
		`;
		return redirect(res, successRedirect);
	}

	// Reconnecting a DIFFERENT X account retires every memory-seeding grant made
	// for the previous one and deletes the memories it produced. Consent was
	// given for that account's posts, and it does not transfer to this one.
	const [prior] = await sql`
		SELECT provider_uid FROM social_connections
		WHERE user_id = ${userId} AND provider = 'x'
		LIMIT 1
	`;
	if (prior?.provider_uid && prior.provider_uid !== profile.id) {
		await revokeAllSeedConsentsForUser(userId, 'x_account_changed');
	}

	// Upsert by (user_id, provider) — uses the existing unique constraint
	await sql`
		INSERT INTO social_connections
			(user_id, provider, provider_uid, username, access_token, refresh_token, expires_at, raw_data, scopes)
		VALUES
			(${userId}, 'x', ${profile.id}, ${profile.username}, ${encAccess}, ${encRefresh}, ${expiresAt}, ${JSON.stringify(profile)}, ${grantedScopes})
		ON CONFLICT (user_id, provider) DO UPDATE SET
			provider_uid    = EXCLUDED.provider_uid,
			username        = EXCLUDED.username,
			access_token    = EXCLUDED.access_token,
			refresh_token   = EXCLUDED.refresh_token,
			expires_at      = EXCLUDED.expires_at,
			raw_data        = EXCLUDED.raw_data,
			scopes          = EXCLUDED.scopes,
			disconnected_at = NULL,
			updated_at      = now()
	`;

	return redirect(res, successRedirect);
}

// ── GET /api/auth/x/login (sign in with X) ────────────────────────────────────

// No session required: this is how a brand-new visitor reaches an account at
// all. Asks for the `read` scope set only, since signing in needs nothing
// more than the profile api/_lib/identities.js's findUserByIdentity keys on.
async function handleLoginStart(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, env.APP_ORIGIN);
	const next = safeNext(url.searchParams.get('next'), '/dashboard');

	if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET) {
		if (wantsHtmlNavigation(req)) return redirect(res, loginUrl('x_unavailable', next));
		return error(res, 501, 'not_configured', 'X sign-in is not configured');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) {
		if (wantsHtmlNavigation(req)) return redirect(res, loginUrl('rate_limited', next));
		return rateLimited(res, rl);
	}

	const codeVerifier = randomToken(32);
	const codeChallenge = await sha256Base64Url(codeVerifier);
	const state = randomToken(16);
	const scopeSet = resolveScopeSet('read');

	const signed = await signState({ state, codeVerifier, scopeSet: scopeSet.name, purpose: 'login', next });
	res.setHeader('set-cookie', stateCookie(signed));

	const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('client_id', env.X_OAUTH_CLIENT_ID);
	authUrl.searchParams.set('redirect_uri', `${env.APP_ORIGIN}/api/auth/x/callback`);
	authUrl.searchParams.set('scope', scopeSet.value);
	authUrl.searchParams.set('state', state);
	authUrl.searchParams.set('code_challenge', codeChallenge);
	authUrl.searchParams.set('code_challenge_method', 'S256');

	return redirect(res, authUrl.toString());
}

function xClaims(profile) {
	return {
		subject: profile.id,
		// X's OAuth2 profile never carries a verified email, so this identity
		// can never be matched to an existing account by email the way Google's
		// can: it is either already linked, already connected for posting
		// (social_connections, checked in completeXLogin), or brand new.
		email: null,
		email_verified: false,
		display_name: typeof profile.name === 'string' ? profile.name.slice(0, 120) : null,
		avatar_url: typeof profile.profile_image_url === 'string' && /^https:\/\//.test(profile.profile_image_url)
			? profile.profile_image_url
			: null,
	};
}

async function signInX(req, res, userId, { isNew = false } = {}) {
	const token = await createSession({ userId, userAgent: req.headers['user-agent'], ip: clientIp(req) });
	res.setHeader('set-cookie', sessionCookie(token));
	logAudit({ userId, action: isNew ? 'register:x' : 'login:x', req });
	if (isNew) queueMicrotask(() => seedDefaultAgent(userId));
}

async function completeXLogin(req, res, { profile, next }) {
	const safeNextPath = safeNext(next, '/dashboard');
	const claims = xClaims(profile);

	const linked = await findUserByIdentity('x', claims.subject);
	if (linked) {
		if (linked.deleted_at) return redirect(res, loginUrl('account_deleted'));
		await touchIdentity(linked.identity_id);
		await signInX(req, res, linked.id);
		return redirect(res, safeNextPath);
	}

	// Not linked yet. An owner who already connected this X account to post as
	// themselves (social_connections, proven by the same OAuth2 client) signs
	// straight into that account instead of getting a second one.
	const already = await findUserByXId(claims.subject);
	if (already) {
		try {
			await linkIdentity({ userId: already.user_id, provider: 'x', claims });
		} catch (err) {
			if (!(err instanceof IdentityError)) throw err;
		}
		await signInX(req, res, already.user_id);
		return redirect(res, safeNextPath);
	}

	// Genuinely new. X does not vouch for an email address, so there is no
	// confirm-by-email step like Google's: the account is born passwordless,
	// the same way a wallet-only signup is, with a synthetic, non-deliverable
	// placeholder email (api/auth/siws/[action].js uses the same @wallet.local
	// convention) that keeps the column's NOT NULL UNIQUE constraint happy.
	let placeholderEmail = `x-${claims.subject}@wallet.local`;
	const [squatted] = await sql`
		select 1 from users where email = ${placeholderEmail} and password_hash is not null limit 1
	`;
	if (squatted) placeholderEmail = `x-${claims.subject}.${randomToken(8).toLowerCase()}@wallet.local`;

	const [user] = await sql`
		insert into users (email, display_name)
		values (${placeholderEmail}, ${claims.display_name || `X user ${claims.subject}`})
		on conflict (email) do update set email = excluded.email
		returning id, (xmax = 0) as inserted
	`;
	await linkIdentity({ userId: user.id, provider: 'x', claims });
	await signInX(req, res, user.id, { isNew: user.inserted });
	return redirect(res, safeNextPath);
}

// ── dispatch ──────────────────────────────────────────────────────────────────

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop();
	if (action === 'connect') return handleConnect(req, res);
	if (action === 'callback') return handleCallback(req, res);
	if (action === 'login') return handleLoginStart(req, res);
	return error(res, 404, 'not_found', 'unknown action');
});
