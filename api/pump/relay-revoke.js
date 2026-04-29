// POST /api/pump/relay-revoke
// Marks an active delegation as revoked. Subsequent /api/pump/relay-trade
// calls referencing it will 403.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';

const bodySchema = z.object({
	delegation_id: z.string().uuid(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	const rows = await sql`
		update pump_trade_delegations
		set revoked_at = now()
		where id=${body.delegation_id} and user_id=${user.id} and revoked_at is null
		returning id
	`;
	if (rows.length === 0) return error(res, 404, 'not_found', 'no active delegation found');

	return json(res, 200, { ok: true, delegation_id: body.delegation_id });
});
