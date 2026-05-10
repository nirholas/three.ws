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
// and returns false. Skips enforcement if CSRF_DISABLED=1 (escape hatch for
// machine-to-machine bearer auth which can't carry a CSRF token).
export async function requireCsrf(req, res, userId) {
	if (process.env.CSRF_DISABLED === '1') return true;

	// Bearer-token requests are exempt: the token itself is the proof of intent
	// and bearer tokens aren't auto-attached by browsers like cookies are.
	const authHeader = req.headers?.authorization || '';
	if (authHeader.startsWith('Bearer ')) return true;

	const sent =
		req.headers['x-csrf-token'] ||
		req.headers['X-CSRF-Token'] ||
		(typeof req.body === 'object' && req.body?._csrf);
	if (!sent || typeof sent !== 'string') {
		error(res, 403, 'csrf_missing', 'X-CSRF-Token header required');
		return false;
	}

	const [row] = await sql`
		SELECT user_id FROM csrf_tokens
		WHERE token = ${sent} AND expires_at > now()
	`;
	if (!row || row.user_id !== userId) {
		error(res, 403, 'csrf_invalid', 'CSRF token invalid or expired');
		return false;
	}

	// One-time use: best-effort delete (don't fail the request if delete has issues)
	sql`DELETE FROM csrf_tokens WHERE token = ${sent}`.catch(() => {});
	return true;
}
