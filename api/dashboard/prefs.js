/**
 * Dashboard Preferences
 * ---------------------
 * GET  /api/dashboard/prefs — returns the signed-in user's prefs JSON
 * POST /api/dashboard/prefs — replaces the user's prefs JSON
 *
 * Backed by the user_prefs table. localStorage remains the primary client
 * store; this endpoint provides a durable backup so prefs follow the user
 * across browsers/devices.
 */

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';

const MAX_BYTES = 16 * 1024; // hard ceiling on prefs blob size

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const [row] = await sql`
			SELECT prefs FROM user_prefs WHERE user_id = ${auth.userId}
		`;
		return json(res, 200, { prefs: row?.prefs || {} });
	}

	// POST — replace prefs
	const body = await readJson(req);
	const prefs = body?.prefs;
	if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
		return error(res, 400, 'validation_error', 'prefs must be an object');
	}

	const serialized = JSON.stringify(prefs);
	if (serialized.length > MAX_BYTES) {
		return error(res, 413, 'payload_too_large', `prefs exceed ${MAX_BYTES} bytes`);
	}

	await sql`
		INSERT INTO user_prefs (user_id, prefs, updated_at)
		VALUES (${auth.userId}, ${serialized}::jsonb, now())
		ON CONFLICT (user_id) DO UPDATE SET
			prefs = EXCLUDED.prefs,
			updated_at = now()
	`;

	return json(res, 200, { ok: true });
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}
