/**
 * GET /api/agents/solana-reputation-history?asset=<pubkey>&network=devnet|mainnet&days=30
 *
 * Daily reputation buckets for sparkline rendering. Each bucket is the
 * average feedback score for that UTC day. Days with no feedback are
 * elided — the client should render gaps appropriately.
 *
 * Returns the strongest available tier per bucket (credentialed >
 * verified > event-attested > raw) so the line reflects the same trust
 * model as the headline grade on the passport.
 */

import { sql } from '../_lib/db.js';
import { PublicKey } from '@solana/web3.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const MAX_DAYS = 90;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url     = new URL(req.url, `http://${req.headers.host}`);
	const asset   = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';
	const days    = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 1), MAX_DAYS);

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try { new PublicKey(asset); }
	catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	const rows = await sql`
		with feedback as (
			select
				date_trunc('day', f.block_time) as day,
				f.attester,
				(f.payload->>'score')::int as score,
				exists (
					select 1 from solana_attestations a
					where a.agent_asset = f.agent_asset
					  and a.kind = 'threews.accept.v1'
					  and a.payload->>'task_id' = f.payload->>'task_id'
					  and a.verified = true
					  and f.payload->>'task_id' is not null
				) as task_accepted,
				exists (
					select 1 from solana_credentials c
					where c.subject = f.attester
					  and c.network = f.network
					  and c.kind = 'threews.verified-client.v1'
					  and c.closed = false
					  and (c.expiry is null or c.expiry > f.block_time)
				) as credentialed,
				(f.payload->>'source' like 'pumpkit.%') as event_attested
			from solana_attestations f
			where f.agent_asset = ${asset}
			  and f.network = ${network}
			  and f.kind = 'threews.feedback.v1'
			  and f.revoked = false
			  and f.block_time >= now() - (${days} || ' days')::interval
		)
		select
			day,
			count(*)::int                                                                  as n,
			coalesce(avg(score) filter (where credentialed),    0)::float                  as score_credentialed,
			coalesce(avg(score) filter (where task_accepted),   0)::float                  as score_verified,
			coalesce(avg(score) filter (where event_attested),  0)::float                  as score_event,
			coalesce(avg(score),                                0)::float                  as score_raw,
			count(*) filter (where credentialed)::int    as n_credentialed,
			count(*) filter (where task_accepted)::int   as n_verified,
			count(*) filter (where event_attested)::int  as n_event
		from feedback
		group by day
		order by day asc
	`;

	const series = rows.map((r) => {
		const tier =
			r.n_credentialed > 0 ? { tier: 'credentialed', score: r.score_credentialed, n: r.n_credentialed } :
			r.n_verified     > 0 ? { tier: 'verified',     score: r.score_verified,     n: r.n_verified } :
			r.n_event        > 0 ? { tier: 'event',        score: r.score_event,        n: r.n_event } :
			                       { tier: 'community',    score: r.score_raw,          n: r.n };
		return {
			day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
			tier: tier.tier,
			score: Number(tier.score.toFixed(3)),
			n: tier.n,
		};
	});

	return json(res, 200, {
		agent: asset,
		network,
		days,
		series,
	});
});
