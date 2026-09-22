// CSRF protection — double-submit cookie pattern.
//
// Issue a token via GET /api/csrf-token (also returns it via Set-Cookie). Clients
// must echo the same token in the X-CSRF-Token header on state-changing POSTs.
// Tokens are bound to user_id and expire after 1 hour.

import crypto from 'node:crypto';
import { sql } from './db.js';
import { error } from './http.js';

const TTL_SECONDS = 3600;

export async function issueCsrf(userId) {
	const token = crypto.randomBytes(32).toString('hex');
	await sql`
		INSERT INTO csrf_tokens (token, user_id, expires_at)
		VALUES (${token}, ${userId}, now() + interval '1 hour')
	`;
	return { token, expiresIn: TTL_SECONDS };
}

// Middleware: returns true on success (handler may proceed), or sends a 403
// and returns false. The CSRF_DISABLED=1 escape hatch is honored ONLY outside
// production — a misconfigured env must not silently disable CSRF platform-wide
// on the live site. Machine-to-machine bearer auth is exempted below regardless.
const IS_PROD = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

/**
 * Validate (and consume) the request's CSRF token without writing a response.
 * Callers with their own error envelope (the v1 agents API) use this; everyone
 * else uses requireCsrf below.
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string }>}
 */
export async function checkCsrf(req, userId) {
	if (!IS_PROD && process.env.CSRF_DISABLED === '1') return { ok: true };

	// Bearer-token requests are exempt: the token itself is the proof of intent
	// and bearer tokens aren't auto-attached by browsers like cookies are.
	const authHeader = req.headers?.authorization || '';
	if (authHeader.startsWith('Bearer ')) return { ok: true };

	const sent =
		req.headers['x-csrf-token'] ||
		req.headers['X-CSRF-Token'] ||
		(typeof req.body === 'object' && req.body?._csrf);
	if (!sent || typeof sent !== 'string') {
		return { ok: false, code: 'csrf_missing', message: 'X-CSRF-Token header required' };
	}

	// One-time use, atomically: consume the token in the same statement that
	// validates it. A fire-and-forget DELETE after a SELECT lets two concurrent
	// requests both observe the token before either delete lands — the
	// DELETE … RETURNING makes exactly one request win. The token is valid iff
	// an unexpired row bound to this user came back; a wrong-user token is left
	// in place for its rightful owner.
	const [row] = await sql`
		DELETE FROM csrf_tokens
		WHERE token = ${sent} AND user_id = ${userId} AND expires_at > now()
		RETURNING user_id
	`;
	if (!row) return { ok: false, code: 'csrf_invalid', message: 'CSRF token invalid or expired' };
	return { ok: true };
}

export async function requireCsrf(req, res, userId) {
	const verdict = await checkCsrf(req, userId);
	if (!verdict.ok) {
		error(res, 403, verdict.code, verdict.message);
		return false;
	}
	return true;
}
