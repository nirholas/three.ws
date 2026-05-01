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
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { z } from 'zod';

const MAX_BYTES = 16 * 1024;

const prefsBody = z.object({
	prefs: z.record(z.unknown()).refine(
		(v) => JSON.stringify(v).length <= MAX_BYTES,
		{ message: `prefs exceed ${MAX_BYTES} bytes` },
	),
});

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
	const rl = await limits.prefsWrite(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { prefs } = parse(prefsBody, await readJson(req));

	await sql`
		INSERT INTO user_prefs (user_id, prefs, updated_at)
		VALUES (${auth.userId}, ${JSON.stringify(prefs)}::jsonb, now())
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
