// Auth primitives: password hashing, JWTs, session cookies, bearer extraction.

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';
import { sql } from './db.js';
import { randomToken, sha256, hmacSha256, constantTimeEquals } from './crypto.js';

const ACCESS_TTL_SEC = 60 * 60; // 1h access tokens
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30d refresh tokens
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30d browser sessions
const SESSION_REFRESH_WINDOW_SEC = 60 * 60 * 24 * 7; // rotate when < 7d remain

// Lazy: env.JWT_SECRET throws if unset, so defer encoding until first use.
let _jwtKey;
function jwtKey() {
	if (!_jwtKey) _jwtKey = new TextEncoder().encode(env.JWT_SECRET);
	return _jwtKey;
}

// ── passwords ────────────────────────────────────────────────────────────────
export async function hashPassword(plain) {
	return bcrypt.hash(plain, env.PASSWORD_ROUNDS);
}
export async function verifyPassword(plain, hash) {
	if (!hash) return false;
	return bcrypt.compare(plain, hash);
}

// ── access tokens (JWT) ──────────────────────────────────────────────────────
export async function mintAccessToken({ userId, clientId, scope, resource, tokenUse = 'access' }) {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({ scope, client_id: clientId, resource, token_use: tokenUse })
		.setProtectedHeader({ alg: 'HS256', kid: env.JWT_KID, typ: 'JWT' })
		.setIssuer(env.ISSUER)
		.setSubject(userId)
		.setAudience(resource || env.MCP_RESOURCE)
		.setIssuedAt(now)
		.setExpirationTime(now + ACCESS_TTL_SEC)
		.setJti(randomToken(16))
		.sign(jwtKey());
}

export async function verifyAccessToken(token, { audience } = {}) {
	// Passing `issuer` to jose.jwtVerify enforces the `iss` claim equals
	// env.ISSUER and throws otherwise — no separate check needed in
	// authenticateBearer(), which treats any throw here as auth failure.
	const { payload } = await jwtVerify(token, jwtKey(), {
		issuer: env.ISSUER,
		audience: audience || env.MCP_RESOURCE,
		algorithms: ['HS256'],
	});
	return payload;
}

// ── refresh tokens (opaque, hashed at rest) ──────────────────────────────────
export async function issueRefreshToken({ userId, clientId, scope, resource }) {
	const secret = randomToken(32);
	const hash = await sha256(secret);
	const [row] = await sql`
		insert into oauth_refresh_tokens (token_hash, client_id, user_id, scope, resource, expires_at)
		values (${hash}, ${clientId}, ${userId}, ${scope}, ${resource ?? null}, now() + ${`${REFRESH_TTL_SEC} seconds`}::interval)
		returning id
	`;
	return { token: secret, id: row.id };
}

export async function rotateRefreshToken({ oldSecret, clientId, narrowScope }) {
	const hash = await sha256(oldSecret);
	// Atomic claim: revoke the row only if it is currently active. With two
	// concurrent rotations this lets exactly one request take the row; the
	// other gets an empty result and falls into the diagnostic branch below.
	// Without this guard, both requests could read revoked_at IS NULL and
	// then each issue a new refresh token off the same consumed secret.
	const claimed = await sql`
		update oauth_refresh_tokens
		set revoked_at = now(), last_used_at = now()
		where token_hash = ${hash} and client_id = ${clientId}
		  and revoked_at is null and expires_at > now()
		returning id, user_id, scope, resource
	`;
	const row = claimed[0];
	if (!row) {
		// Diagnose why the claim failed: missing, already revoked, or expired.
		const [diag] = await sql`
			select revoked_at, expires_at
			from oauth_refresh_tokens
			where token_hash = ${hash} and client_id = ${clientId}
			limit 1
		`;
		if (!diag) throw Object.assign(new Error('invalid_grant'), { status: 400 });
		if (diag.revoked_at) {
			// Treat as reuse — revoke whole chain for this user+client. A request
			// that lost a concurrent-rotation race lands here too; the cost is
			// re-authentication, never silent token duplication.
			const [user] = await sql`
				select user_id from oauth_refresh_tokens
				where token_hash = ${hash} and client_id = ${clientId}
				limit 1
			`;
			if (user) {
				await sql`update oauth_refresh_tokens set revoked_at = now()
				          where user_id = ${user.user_id} and client_id = ${clientId} and revoked_at is null`;
			}
			throw Object.assign(new Error('invalid_grant'), {
				status: 400,
				code: 'refresh_reuse_detected',
			});
		}
		throw Object.assign(new Error('invalid_grant'), { status: 400, code: 'refresh_expired' });
	}
	// Bind the rotated refresh token to the narrowed scope (RFC 6749 §6 allows a
	// subset). Without this, a caller could re-widen back to the full scope on
	// the next rotation by omitting `scope`.
	const effectiveScope = typeof narrowScope === 'function' ? narrowScope(row.scope) : row.scope;
	const next = await issueRefreshToken({
		userId: row.user_id,
		clientId,
		scope: effectiveScope,
		resource: row.resource,
	});
	await sql`update oauth_refresh_tokens set replaced_by = ${next.id} where id = ${row.id}`;
	return { next, userId: row.user_id, scope: effectiveScope, resource: row.resource };
}

export async function revokeRefreshToken(secret, clientId) {
	const hash = await sha256(secret);
	await sql`update oauth_refresh_tokens set revoked_at = now()
	          where token_hash = ${hash} and client_id = ${clientId} and revoked_at is null`;
}

// ── browser sessions (cookie auth for the site itself) ──────────────────────
// __Host- prefix requires Path=/; Secure; no Domain — browser enforces cookie
// can't be set by any subdomain, eliminating subdomain cookie injection.
const SESSION_COOKIE = '__Host-sid';
// Tolerate cookies from the legacy name for a single deploy cycle so existing
// sessions survive the cutover. Read-only — never re-issue under this name.
const LEGACY_COOKIE = 'sid';

function readSessionCookie(req) {
	const cookie = req.headers.cookie || '';
	const m = cookie.match(/(?:^|;\s*)__Host-sid=([^;]+)/) || cookie.match(/(?:^|;\s*)sid=([^;]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Issue a new session and revoke the old one. Returns the new plaintext token.
 * @param {{ currentSid: string, userId: string, userAgent: string|null, ip: string|null }} opts
 */
export async function rotateSession({ currentSid, userId, userAgent, ip }) {
	const newSecret = await createSession({ userId, userAgent, ip });
	await sql`update sessions set revoked_at = now() where id = ${currentSid}`;
	return newSecret;
}

export async function createSession({ userId, userAgent, ip }) {
	const secret = randomToken(32);
	const hash = await sha256(secret);
	await sql`
		insert into sessions (user_id, token_hash, user_agent, ip, expires_at)
		values (${userId}, ${hash}, ${userAgent ?? null}, ${ip ?? null}, now() + ${`${SESSION_TTL_SEC} seconds`}::interval)
	`;
	return secret;
}

export function sessionCookie(token, { clear = false } = {}) {
	if (clear) {
		// Clear both the current and legacy cookie names so logout fully drops session.
		return [
			`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
			`${LEGACY_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
		];
	}
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

/**
 * Resolve the session user from the request cookie.
 * When `res` is provided, silently rotates the session cookie if it is within
 * the refresh window (last seen > 1 day ago and expiring within 7 days).
 * Returns the user object including `sid` (session UUID) for callers that need it.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} [res]
 */
export async function getSessionUser(req, res) {
	const token = readSessionCookie(req);
	if (!token) return null;
	const hash = await sha256(token);
	const rows = await sql`
		select s.id as sid, s.last_seen_at, s.expires_at,
		       u.id, u.email, u.display_name, u.username, u.plan, u.avatar_url, u.wallet_address
		from sessions s join users u on u.id = s.user_id
		where s.token_hash = ${hash}
		  and s.revoked_at is null
		  and s.expires_at > now()
		  and u.deleted_at is null
		limit 1
	`;
	if (!rows[0]) return null;

	const { last_seen_at, expires_at, ...userFields } = rows[0];

	// Touch last_seen best-effort; don't block the request on a write.
	sql`update sessions set last_seen_at = now() where id = ${userFields.sid}`.catch(() => {});

	// Rolling refresh: rotate if last seen > 1 day ago and expiring within 7 days.
	if (res) {
		const seenMs = last_seen_at ? new Date(last_seen_at).getTime() : 0;
		const expiresMs = expires_at ? new Date(expires_at).getTime() : 0;
		const nowMs = Date.now();
		if (nowMs - seenMs > 86_400_000 && expiresMs - nowMs < SESSION_REFRESH_WINDOW_SEC * 1000) {
			const ua = req.headers['user-agent'] || null;
			const ip =
				req.headers['x-vercel-forwarded-for']?.split(',')[0]?.trim() ||
				req.headers['x-real-ip'] ||
				req.socket?.remoteAddress ||
				null;
			rotateSession({ currentSid: userFields.sid, userId: userFields.id, userAgent: ua, ip })
				.then((newToken) => {
					try {
						const existing = res.getHeader('set-cookie') || [];
						const arr = Array.isArray(existing) ? existing : [existing];
						res.setHeader('set-cookie', [...arr, sessionCookie(newToken)]);
					} catch {
						// header already sent — rotation missed this request, next one will retry
					}
				})
				.catch(() => {});
		}
	}

	return userFields; // includes sid alongside u.id, email, display_name, plan, avatar_url
}

export async function destroySession(req) {
	const token = readSessionCookie(req);
	if (!token) return;
	const hash = await sha256(token);
	await sql`update sessions set revoked_at = now() where token_hash = ${hash}`;
}

// CSRF token bound to the session cookie value. Because the cookie is HttpOnly,
// an attacker's JS can't read it and therefore can't forge a matching token.
export async function csrfTokenFor(req) {
	const token = readSessionCookie(req);
	if (!token) return null;
	return hmacSha256(env.JWT_SECRET, `csrf:${token}`);
}

export async function verifyCsrfToken(req, submitted) {
	if (!submitted) return false;
	const expected = await csrfTokenFor(req);
	if (!expected) return false;
	return constantTimeEquals(expected, String(submitted));
}

// Reject cross-site POSTs by requiring Origin (preferred) or Referer to match
// the configured APP_ORIGIN. Call before honoring state-changing form posts.
export function isSameSiteOrigin(req) {
	const origin = req.headers.origin;
	if (origin) return origin === env.APP_ORIGIN;
	const referer = req.headers.referer;
	if (!referer) return false;
	try {
		return new URL(referer).origin === env.APP_ORIGIN;
	} catch {
		return false;
	}
}

// ── bearer extraction (OAuth access tokens OR API keys) ─────────────────────
export function extractBearer(req) {
	const h = req.headers.authorization || '';
	if (!h.toLowerCase().startsWith('bearer ')) return null;
	return h.slice(7).trim();
}

// Returns { userId, scope, source: 'oauth'|'apikey', clientId?, apiKeyId? } or null.
export async function authenticateBearer(token, { audience } = {}) {
	if (!token) return null;
	// API keys are prefixed with `sk_live_` (or `sk_test_`) — short-circuit.
	if (token.startsWith('sk_live_') || token.startsWith('sk_test_')) {
		const hash = await sha256(token);
		const rows = await sql`
			select id, user_id, scope, expires_at, revoked_at
			from api_keys where token_hash = ${hash} limit 1
		`;
		const row = rows[0];
		if (!row || row.revoked_at) return null;
		if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
		await sql`update api_keys set last_used_at = now() where id = ${row.id}`;
		return { userId: row.user_id, scope: row.scope, source: 'apikey', apiKeyId: row.id };
	}
	// Otherwise treat as JWT access token.
	try {
		const payload = await verifyAccessToken(token, { audience });
		return {
			userId: payload.sub,
			scope: payload.scope || '',
			source: 'oauth',
			clientId: payload.client_id,
		};
	} catch {
		return null;
	}
}

export function hasScope(granted, required) {
	const g = new Set((granted || '').split(/\s+/).filter(Boolean));
	return required.split(/\s+/).every((s) => g.has(s));
}
