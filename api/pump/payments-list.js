// GET /api/pump/payments-list?mint=<pubkey>&network=...&limit=...
//
// Public read of the local pump_agent_payments index for an agent. The
// on-chain TokenAgentPaymentInCurrency PDAs are the source of truth; this
// endpoint exposes the cached view used by the dashboard / passport / and
// reputation engine. Confirmed payments only by default.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const mint = url.searchParams.get('mint');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const limit = Math.min(Number(url.searchParams.get('limit') || 50), 500);
	const includePending = url.searchParams.get('include_pending') === '1';

	if (!mint) return error(res, 400, 'validation_error', 'mint required');

	const [agent] = await sql`
		select id, mint, network, buyback_bps from pump_agent_mints
		where mint=${mint} and network=${network} limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent mint not registered');

	const rows = includePending
		? await sql`
			select id, payer_wallet, currency_mint, amount_atomics, invoice_id,
			       start_time, end_time, status, skill_id, tool_name,
			       tx_signature, created_at, confirmed_at
			from pump_agent_payments
			where mint_id=${agent.id}
			order by created_at desc limit ${limit}
		`
		: await sql`
			select id, payer_wallet, currency_mint, amount_atomics, invoice_id,
			       start_time, end_time, status, skill_id, tool_name,
			       tx_signature, created_at, confirmed_at
			from pump_agent_payments
			where mint_id=${agent.id} and status='confirmed'
			order by confirmed_at desc nulls last limit ${limit}
		`;

	const [agg] = await sql`
		select
			count(*)::int                                                      as total,
			count(*) filter (where status='confirmed')::int                    as confirmed,
			count(distinct payer_wallet) filter (where status='confirmed')::int as unique_payers,
			coalesce(sum(amount_atomics) filter (where status='confirmed'), 0)::text as total_atomics
		from pump_agent_payments where mint_id=${agent.id}
	`;

	return json(res, 200, {
		mint,
		network,
		buyback_bps: agent.buyback_bps,
		summary: agg,
		data: rows,
	});
});
