// GET /api/pump/by-agent?agent_id=<uuid>
// Resolves an agent's pump mint (if launched) for the passport widget.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const agentId = url.searchParams.get('agent_id');
	if (!agentId) return error(res, 400, 'validation_error', 'agent_id required');

	const [row] = await sql`
		select id, mint, network, name, symbol, buyback_bps, agent_authority,
		       metadata_uri, sharing_config, created_at
		from pump_agent_mints
		where agent_id=${agentId}
		order by created_at desc limit 1
	`;
	if (!row) return json(res, 200, { data: null });

	const [stats] = await sql`
		select
			count(*) filter (where status='confirmed')::int                      as confirmed_payments,
			count(distinct payer_wallet) filter (where status='confirmed')::int  as unique_payers,
			coalesce(sum(amount_atomics) filter (where status='confirmed'),0)::text as total_atomics,
			max(confirmed_at) filter (where status='confirmed')                  as last_payment_at
		from pump_agent_payments where mint_id=${row.id}
	`;

	const [burnRow] = await sql`
		select
			count(*) filter (where status='confirmed')::int                       as runs,
			coalesce(sum(burn_amount) filter (where status='confirmed'),0)::text  as total_burned,
			max(created_at)                                                       as last_burn_at
		from pump_buyback_runs where mint_id=${row.id}
	`;

	return json(res, 200, {
		data: {
			...row,
			stats: stats || { confirmed_payments: 0, unique_payers: 0, total_atomics: '0' },
			burns:  burnRow || { runs: 0, total_burned: '0' },
		},
	});
});
