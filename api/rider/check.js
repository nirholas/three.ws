import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const address = req.query?.address?.trim();
	if (!address) return error(res, 400, 'validation_error', 'address required');

	const [row] = await sql`
		select wallet_address from rider_passes
		where wallet_address = ${address}
		limit 1
	`;

	return json(res, 200, { has_pass: !!row });
});
