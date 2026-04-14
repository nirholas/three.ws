// Auth primitives: password hashing, JWTs, session cookies, bearer extraction.

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';
import { sql } from './db.js';
import { randomToken, sha256 } from './crypto.js';

const ACCESS_TTL_SEC = 60 * 60;              // 1h access tokens
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;   // 30d refresh tokens
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;   // 30d browser sessions

const jwtKey = new TextEncoder().encode(env.JWT_SECRET);

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
		.sign(jwtKey);
}

export async function verifyAccessToken(token, { audience } = {}) {
	const { payload } = await jwtVerify(token, jwtKey, {
		issuer: env.ISSUER,
		audience: audience || env.MCP_RESOURCE,
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

export async function rotateRefreshToken({ oldSecret, clientId }) {
	const hash = await sha256(oldSecret);
	const rows = await sql`
		select id, user_id, scope, resource, expires_at, revoked_at
		from oauth_refresh_tokens
		where token_hash = ${hash} and client_id = ${clientId}
		limit 1
	`;
	const row = rows[0];
	if (!row) throw Object.assign(new Error('invalid_grant'), { status: 400 });
	if (row.revoked_at) {
		// Reuse detected — revoke whole chain for this user+client.
		await sql`update oauth_refresh_tokens set revoked_at = now()
		          where user_id = ${row.user_id} and client_id = ${clientId} and revoked_at is null`;
		throw Object.assign(new Error('invalid_grant'), { status: 400, code: 'refresh_reuse_detected' });
	}
	if (new Date(row.expires_at) < new Date()) {
		throw Object.assign(new Error('invalid_grant'), { status: 400, code: 'refresh_expired' });
	}
	const next = await issueRefreshToken({ userId: row.user_id, clientId, scope: row.scope, resource: row.resource });
	await sql`update oauth_refresh_tokens set revoked_at = now(), replaced_by = ${next.id}, last_used_at = now()
	          where id = ${row.id}`;
	return { next, userId: row.user_id, scope: row.scope, resource: row.resource };
}

export async function revokeRefreshToken(secret, clientId) {
	const hash = await sha256(secret);
	await sql`update oauth_refresh_tokens set revoked_at = now()
	          where token_hash = ${hash} and client_id = ${clientId} and revoked_at is null`;
}

// ── browser sessions (cookie auth for the site itself) ──────────────────────
const SESSION_COOKIE = 'sid';

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
	if (clear) return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

export async function getSessionUser(req) {
	const cookie = req.headers.cookie || '';
	const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
	if (!m) return null;
	const hash = await sha256(decodeURIComponent(m[1]));
	const rows = await sql`
		select s.id as sid, u.id, u.email, u.display_name, u.plan, u.avatar_url
		from sessions s join users u on u.id = s.user_id
		where s.token_hash = ${hash} and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null
		limit 1
	`;
	if (!rows[0]) return null;
	// Touch last_seen (best-effort, fire-and-forget at the handler level if needed).
	await sql`update sessions set last_seen_at = now() where id = ${rows[0].sid}`;
	const { sid: _sid, ...user } = rows[0];
	return user;
}

export async function destroySession(req) {
	const cookie = req.headers.cookie || '';
	const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
	if (!m) return;
	const hash = await sha256(decodeURIComponent(m[1]));
	await sql`update sessions set revoked_at = now() where token_hash = ${hash}`;
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
