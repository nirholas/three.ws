// GET /api/agents/solana-price-history?asset=<mint>&network=mainnet|devnet&hours=24
//
// Returns sparkline-friendly price points for an agent's pump.fun mint.

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const hours = Math.max(1, Math.min(720, Number(url.searchParams.get('hours') || 24)));
	if (!asset) return error(res, 400, 'validation_error', 'asset required');

	const [mintRow] = await sql`
		select id from pump_agent_mints where mint=${asset} and network=${network} limit 1
	`;
	if (!mintRow) return error(res, 404, 'not_found', 'mint not tracked');

	const points = await sql`
		select ts, sol_per_token, market_cap_lamports, source
		from pump_agent_price_points
		where mint_id=${mintRow.id} and ts > now() - (${hours} || ' hours')::interval
		order by ts asc
	`;

	return json(
		res,
		200,
		{
			mint: asset,
			network,
			hours,
			point_count: points.length,
			points: points.map((p) => ({
				ts: p.ts,
				sol_per_token: p.sol_per_token,
				market_cap_lamports: p.market_cap_lamports?.toString?.() ?? p.market_cap_lamports,
				source: p.source,
			})),
		},
		{ 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' },
	);
});
