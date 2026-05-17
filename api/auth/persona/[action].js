// /api/auth/persona/<action> — Persona Hub token issuance + verification.
//
// Persona Hub is three.ws's cross-app SSO: a user creates and stores their
// three.ws avatar once, and any tenant site embedding the `<three-ws-signin>`
// widget can request a short-lived token bearing that avatar's URL.
//
// Endpoints
// ─────────
//   POST /api/auth/persona/issue
//     Body: { tenant_origin: string, avatar_id?: string }
//     Auth: three.ws session (user must be signed in to three.ws)
//     Returns: { token, expires_in, avatar: { id, url, thumbnail_url, name } }
//
//     The token is a JWT signed with JWT_SECRET, audience set to the tenant
//     origin so the tenant can call /api/auth/persona/verify with that
//     audience and trust the result. Claims:
//       sub:       three.ws user id
//       aud:       tenant_origin
//       iss:       https://three.ws
//       scope:     "persona:read avatar:read"
//       token_use: "persona"
//       avatar:    { id, url, thumbnail_url, name }
//
//   GET /api/auth/persona/verify?token=…&audience=…
//     Unauthenticated. Verifies signature + issuer + audience + expiry.
//     Returns the claims if valid, 401 otherwise. Tenants call this from
//     their server to confirm the popup-issued token is real.
//
//   GET /api/auth/persona/me
//     Auth: three.ws session.
//     Returns the user's avatar catalog so the consent UI can render a
//     picker without a second round trip.

import { SignJWT, jwtVerify } from 'jose';
import { getSessionUser } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { env } from '../../_lib/env.js';
import { publicUrl } from '../../_lib/r2.js';
import { randomToken } from '../../_lib/crypto.js';
import { cors, json, error, method, readJson, wrap } from '../../_lib/http.js';

const PERSONA_TTL_SEC = 60 * 60 * 24; // 24h

let _jwtKey;
function jwtKey() {
	if (!_jwtKey) _jwtKey = new TextEncoder().encode(env.JWT_SECRET);
	return _jwtKey;
}

// Tenant origin must be a valid https URL on a three.ws subdomain, or a
// localhost dev origin. Anything else is rejected — prevents arbitrary sites
// from minting tokens claiming the user's three.ws avatar.
function validateTenantOrigin(origin) {
	if (typeof origin !== 'string' || origin.length > 256) return null;
	let u;
	try {
		u = new URL(origin);
	} catch (_) {
		return null;
	}
	if (u.pathname !== '/' && u.pathname !== '') return null;
	if (u.search || u.hash) return null;

	const host = u.host.toLowerCase();
	const isHttps = u.protocol === 'https:';
	const isLocalhost = u.protocol === 'http:' && (host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.0.0.1'));
	const isThreeWs = host === 'three.ws' || host.endsWith('.three.ws');

	if (isLocalhost) return `${u.protocol}//${host}`;
	if (isHttps && isThreeWs) return `https://${host}`;
	return null;
}

async function loadAvatarForUser(userId, avatarId) {
	const rows = avatarId
		? await sql`select id, name, storage_key, thumbnail_key from avatars where owner_id = ${userId} and id = ${avatarId} and deleted_at is null limit 1`
		: await sql`select id, name, storage_key, thumbnail_key from avatars where owner_id = ${userId} and deleted_at is null order by created_at desc limit 1`;
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		url: publicUrl(row.storage_key),
		thumbnail_url: row.thumbnail_key ? publicUrl(row.thumbnail_key) : null,
	};
}

async function handleIssue(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to three.ws first');

	const body = await readJson(req);
	const tenantOrigin = validateTenantOrigin(body?.tenant_origin);
	if (!tenantOrigin) {
		return error(res, 400, 'invalid_request', 'tenant_origin must be a https three.ws subdomain or localhost dev origin');
	}

	const avatar = await loadAvatarForUser(user.id, body?.avatar_id);
	if (!avatar) {
		return error(res, 404, 'no_avatar', 'user has no avatar to share — create one at /create first');
	}

	const now = Math.floor(Date.now() / 1000);
	const token = await new SignJWT({
		scope: 'persona:read avatar:read',
		token_use: 'persona',
		avatar,
	})
		.setProtectedHeader({ alg: 'HS256', kid: env.JWT_KID, typ: 'JWT' })
		.setIssuer(env.ISSUER)
		.setSubject(user.id)
		.setAudience(tenantOrigin)
		.setIssuedAt(now)
		.setExpirationTime(now + PERSONA_TTL_SEC)
		.setJti(randomToken(16))
		.sign(jwtKey());

	return json(res, 200, {
		token,
		expires_in: PERSONA_TTL_SEC,
		avatar,
		tenant_origin: tenantOrigin,
	});
}

async function handleVerify(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const token = url.searchParams.get('token');
	const audience = url.searchParams.get('audience');
	if (!token) return error(res, 400, 'invalid_request', 'token query param required');
	if (!audience) return error(res, 400, 'invalid_request', 'audience query param required');

	let payload;
	try {
		({ payload } = await jwtVerify(token, jwtKey(), {
			issuer: env.ISSUER,
			audience,
			algorithms: ['HS256'],
		}));
	} catch (err) {
		return error(res, 401, 'invalid_token', err?.message || 'verification failed');
	}

	if (payload.token_use !== 'persona') {
		return error(res, 401, 'invalid_token', 'token is not a persona token');
	}

	return json(res, 200, {
		ok: true,
		sub: payload.sub,
		aud: payload.aud,
		scope: payload.scope,
		exp: payload.exp,
		avatar: payload.avatar,
	});
}

async function handleMe(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to three.ws first');
	const rows = await sql`
		select id, name, storage_key, thumbnail_key, created_at, visibility
		from avatars
		where owner_id = ${user.id} and deleted_at is null
		order by created_at desc
		limit 50
	`;
	const avatars = rows.map((r) => ({
		id: r.id,
		name: r.name,
		url: publicUrl(r.storage_key),
		thumbnail_url: r.thumbnail_key ? publicUrl(r.thumbnail_key) : null,
		created_at: r.created_at,
		visibility: r.visibility,
	}));
	return json(res, 200, {
		ok: true,
		user: { id: user.id, email: user.email ?? null },
		avatars,
	});
}

export default wrap(async (req, res) => {
	const action = req.query?.action;
	if (action === 'issue') return handleIssue(req, res);
	if (action === 'verify') return handleVerify(req, res);
	if (action === 'me') return handleMe(req, res);
	return error(res, 404, 'not_found', `unknown persona action: ${action}`);
});
