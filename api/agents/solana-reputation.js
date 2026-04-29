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

	const url = new URL(req.url, `http://${req.headers.host}`);
	const asset = url.searchParams.get('asset');
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';

	if (!asset) return error(res, 400, 'validation_error', 'asset query param required');
	try {
		new PublicKey(asset);
	} catch {
		return error(res, 400, 'validation_error', 'invalid asset pubkey');
	}

	// One pass: feedback aggregates split by verified-task-acceptance, by
	// SAS credentialing, and by event-attested provenance. Trust layers:
	//   1. Raw — every memo feedback counts equally.
	//   2. Verified — feedback whose task_id has a matching task.accepted.
	//   3. Credentialed — feedback from attesters holding a
	//      threews.verified-client.v1 SAS credential.
	//   4. Event-attested — feedback whose payload.source is a recognised
	//      on-chain event monitor (e.g. "pumpkit.*"). Sybil-resistant via
	//      the underlying on-chain event, not via the attester identity.
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
				) as task_accepted,
				exists (
					select 1 from solana_credentials c
					where c.subject = f.attester
					  and c.network = f.network
					  and c.kind = 'threews.verified-client.v1'
					  and c.closed = false
					  and (c.expiry is null or c.expiry > now())
				) as credentialed,
				(f.payload->>'source' like 'pumpkit.%') as event_attested
			from solana_attestations f
			where f.agent_asset = ${asset}
			  and f.network = ${network}
			  and f.kind = 'threews.feedback.v1'
			  and f.revoked = false
		),
		per_attester as (
			select attester, avg(score)::float as score_avg,
				bool_or(task_accepted)  as any_verified,
				bool_or(credentialed)   as any_credentialed,
				bool_or(event_attested) as any_event_attested
			from feedback group by attester
		)
		select
			(select count(*)::int from feedback)                                as total,
			(select count(*) filter (where task_accepted)::int from feedback)   as verified,
			(select count(*) filter (where credentialed)::int from feedback)    as credentialed,
			(select count(*) filter (where event_attested)::int from feedback)  as event_attested,
			(select count(*) filter (where disputed)::int from feedback)        as disputed,
			(select coalesce(avg(score), 0)::float from feedback)               as score_avg,
			(select coalesce(avg(score) filter (where task_accepted), 0)::float from feedback)  as score_avg_verified,
			(select coalesce(avg(score) filter (where credentialed), 0)::float from feedback)   as score_avg_credentialed,
			(select coalesce(avg(score) filter (where event_attested), 0)::float from feedback) as score_avg_event_attested,
			(select count(*)::int from per_attester)                            as unique_attesters,
			(select count(*) filter (where any_verified)::int from per_attester) as unique_verified_attesters,
			(select count(*) filter (where any_credentialed)::int from per_attester) as unique_credentialed_attesters,
			(select coalesce(avg(score_avg), 0)::float from per_attester)       as score_avg_weighted,
			(select coalesce(avg(score_avg) filter (where any_verified), 0)::float from per_attester) as score_avg_weighted_verified,
			(select coalesce(avg(score_avg) filter (where any_credentialed), 0)::float from per_attester) as score_avg_weighted_credentialed
	`;

	const [val] = await sql`
		select
			count(*) filter (where (payload->>'passed')::bool)::int     as passed,
			count(*) filter (where not (payload->>'passed')::bool)::int as failed,
			count(*) filter (where (payload->>'passed')::bool
				and payload->>'source' like 'pumpkit.%')::int             as event_passed,
			count(*) filter (where not (payload->>'passed')::bool
				and payload->>'source' like 'pumpkit.%')::int             as event_failed
		from solana_attestations
		where agent_asset = ${asset} and network = ${network}
		  and kind = 'threews.validation.v1' and revoked = false
	`;

	// Audited validations from authorized validators (SAS-credentialed).
	const [auditedVal] = await sql`
		select
			count(*) filter (where (data->>'passed')::bool)::int     as passed,
			count(*) filter (where not (data->>'passed')::bool)::int as failed
		from solana_credentials
		where subject = ${asset} and network = ${network}
		  and kind = 'threews.audited-validation.v1'
		  and closed = false and (expiry is null or expiry > now())
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

	// Pump.fun off-chain signals: claim/graduation activity attached to the
	// agent's wallet. Aggregated as a positive/negative weight contribution.
	let pumpfunSignals = { count: 0, weight: 0, by_kind: {} };
	try {
		const rows = await sql`
			select kind, count(*)::int as n, coalesce(sum(weight), 0)::float as w
			from pumpfun_signals
			where agent_asset = ${asset}
			group by kind
		`;
		const byKind = {};
		let total = 0,
			weight = 0;
		for (const r of rows) {
			byKind[r.kind] = { count: r.n, weight: Number(r.w.toFixed(3)) };
			total += r.n;
			weight += r.w;
		}
		pumpfunSignals = { count: total, weight: Number(weight.toFixed(3)), by_kind: byKind };
	} catch {
		// pumpfun_signals table may not exist yet — silently ignore.
	}

	// Pump.fun token activity from indexer snapshot: graduation + recent tx
	// count contribute small positive weights to overall agent reputation.
	let tokenActivity = { graduated: false, recent_tx_count: 0, trade_count: 0, weight: 0 };
	try {
		const [row] = await sql`
			select s.graduated, s.recent_tx_count,
			       (select count(*)::int from pump_agent_trades t where t.mint_id = m.id) as trade_count
			from pump_agent_stats s
			join pump_agent_mints m on m.id = s.mint_id
			where m.mint = ${asset} and m.network = ${network}
			limit 1
		`;
		if (row) {
			const w =
				(row.graduated ? 0.3 : 0) +
				Math.min(0.4, (row.recent_tx_count || 0) * 0.005) +
				Math.min(0.3, (row.trade_count || 0) * 0.01);
			tokenActivity = {
				graduated: !!row.graduated,
				recent_tx_count: row.recent_tx_count || 0,
				trade_count: row.trade_count || 0,
				weight: Number(w.toFixed(3)),
			};
		}
	} catch {
		// tables not present
	}

	// Pump.fun agent-payments signal: confirmed acceptPayment receipts add a
	// volume-weighted, Sybil-resistant reputation lane on top of memo attestations.
	let pumpPayments = { confirmed_count: 0, unique_payers: 0, total_atomics: '0' };
	try {
		const [row] = await sql`
			select
				count(*) filter (where p.status='confirmed')::int                       as confirmed_count,
				count(distinct p.payer_wallet) filter (where p.status='confirmed')::int as unique_payers,
				coalesce(sum(p.amount_atomics) filter (where p.status='confirmed'), 0)::text as total_atomics
			from pump_agent_payments p
			join pump_agent_mints m on m.id = p.mint_id
			join agent_identities a on a.id = m.agent_id
			where (a.meta->>'sol_mint_address') = ${asset} and m.network = ${network}
		`;
		if (row) pumpPayments = row;
	} catch {
		// pump_agent_payments table may not exist yet (migration not applied) — silently ignore.
	}

	return json(res, 200, {
		agent: asset,
		network,
		pump_payments: pumpPayments,
		pumpfun_signals: pumpfunSignals,
		token_activity: tokenActivity,
		feedback: {
			total: fb.total,
			verified: fb.verified,
			credentialed: fb.credentialed,
			event_attested: fb.event_attested,
			disputed: fb.disputed,
			unique_attesters: fb.unique_attesters,
			unique_verified_attesters: fb.unique_verified_attesters,
			unique_credentialed_attesters: fb.unique_credentialed_attesters,
			score_avg: Number(fb.score_avg.toFixed(3)),
			score_avg_verified: Number(fb.score_avg_verified.toFixed(3)),
			score_avg_credentialed: Number(fb.score_avg_credentialed.toFixed(3)),
			score_avg_event_attested: Number(fb.score_avg_event_attested.toFixed(3)),
			score_avg_weighted: Number(fb.score_avg_weighted.toFixed(3)),
			score_avg_weighted_verified: Number(fb.score_avg_weighted_verified.toFixed(3)),
			score_avg_weighted_credentialed: Number(fb.score_avg_weighted_credentialed.toFixed(3)),
		},
		validation: {
			self_passed: val.passed,
			self_failed: val.failed,
			event_passed: val.event_passed,
			event_failed: val.event_failed,
			audited_passed: auditedVal.passed,
			audited_failed: auditedVal.failed,
		},
		tasks: {
			offered: counts.tasks_offered,
			accepted: counts.tasks_accepted,
		},
		disputes_filed: counts.disputes_filed,
		revoked_count: counts.revoked_count,
		last_indexed_at: cursor?.last_indexed_at || null,
	});
});
