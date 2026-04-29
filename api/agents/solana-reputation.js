/**
 * GET /api/agents/solana-reputation?asset=<pubkey>&network=devnet|mainnet
 *
 * Computed reputation summary for a Solana agent, derived from indexed
 * attestations. Returns:
 *   - total / verified / disputed / revoked counts
 *   - score_avg (1..5) overall and verified-only
 *   - validation pass/fail counts
 *   - recent task acceptances and disputes
 *
 * "Verified" feedback is feedback whose task_id has a matching threews.accept.v1
 * from the agent owner — i.e. the agent confirmed it actually did this work.
 */

import { sql } from '../_lib/db.js';
import { PublicKey } from '@solana/web3.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url     = new URL(req.url, `http://${req.headers.host}`);
	const asset   = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try { new PublicKey(asset); }
	catch { return error(res, 400, 'validation_error', 'invalid asset pubkey'); }

	// One pass: feedback aggregates split by verified-task-acceptance.
	const [fb] = await sql`
		with feedback as (
			select
				f.signature, f.attester, f.disputed, f.revoked,
				(f.payload->>'score')::int as score,
				f.payload->>'task_id' as task_id,
				exists (
					select 1 from solana_attestations a
					where a.agent_asset = f.agent_asset
					  and a.kind = 'threews.accept.v1'
					  and a.payload->>'task_id' = f.payload->>'task_id'
					  and a.verified = true
					  and f.payload->>'task_id' is not null
				) as task_accepted
			from solana_attestations f
			where f.agent_asset = ${asset}
			  and f.network = ${network}
			  and f.kind = 'threews.feedback.v1'
			  and f.revoked = false
		)
		select
			count(*)::int                                         as total,
			count(*) filter (where task_accepted)::int            as verified,
			count(*) filter (where disputed)::int                 as disputed,
			coalesce(avg(score), 0)::float                        as score_avg,
			coalesce(avg(score) filter (where task_accepted), 0)::float as score_avg_verified
		from feedback
	`;

	const [val] = await sql`
		select
			count(*) filter (where (payload->>'passed')::bool)::int   as passed,
			count(*) filter (where not (payload->>'passed')::bool)::int as failed
		from solana_attestations
		where agent_asset = ${asset} and network = ${network}
		  and kind = 'threews.validation.v1' and revoked = false
	`;

	const [counts] = await sql`
		select
			count(*) filter (where kind = 'threews.task.v1')::int    as tasks_offered,
			count(*) filter (where kind = 'threews.accept.v1' and verified)::int as tasks_accepted,
			count(*) filter (where kind = 'threews.dispute.v1' and verified)::int as disputes_filed,
			count(*) filter (where revoked)::int                     as revoked_count
		from solana_attestations
		where agent_asset = ${asset} and network = ${network}
	`;

	const [cursor] = await sql`
		select last_indexed_at from solana_attestations_cursor where agent_asset = ${asset} limit 1
	`;

	return json(res, 200, {
		agent: asset,
		network,
		feedback: {
			total:               fb.total,
			verified:            fb.verified,
			disputed:            fb.disputed,
			score_avg:           Number(fb.score_avg.toFixed(3)),
			score_avg_verified:  Number(fb.score_avg_verified.toFixed(3)),
		},
		validation: {
			passed: val.passed,
			failed: val.failed,
		},
		tasks: {
			offered:  counts.tasks_offered,
			accepted: counts.tasks_accepted,
		},
		disputes_filed: counts.disputes_filed,
		revoked_count:  counts.revoked_count,
		last_indexed_at: cursor?.last_indexed_at || null,
	});
});
