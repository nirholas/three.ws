// Resolver: launch_cohort. Winner = the cohort launch with the highest metric
// (volume, holders or market cap) at measure time, read only from three.ws launch
// records. No outside price feed is consulted.
//
// Rule (resolution_rule):
//   metric        'volume' | 'holders' | 'market_cap'   (required)
//   network       'mainnet' | 'devnet'                  (default 'mainnet')
//   window_from   ISO start of the volume window         (default market.opens_at)
//   measure_at    ISO instant the metric is read at      (default market.resolves_at)
// Outcomes: ref_kind 'project' with the launch mint as ref_id, or ref_kind 'agent'
// with the launching agent's id (best launch of that agent counts).

import { pending, voided, won, iso, ruleOf } from './common.js';

export const kind = 'launch_cohort';

export const METRICS = {
	volume: 'SOL traded through three.ws on the coin between the window start and the measure time',
	holders: 'wallets holding a positive balance in the platform holder snapshot',
	market_cap: 'the last recorded market cap at or before the measure time',
};

export function describe(rule = {}) {
	const m = METRICS[rule.metric] ? rule.metric.replace('_', ' ') : 'the chosen metric';
	return `Resolves to the cohort launch with the highest ${m} at the measure time, read only from three.ws launch records (${METRICS[rule.metric] || 'volume, holders or market cap'}). A launch with no record for the metric is left out and listed in the evidence. If no launch has a positive value, or the top two are exactly level, the market is void and picks are refunded.`;
}

async function defaultDeps() {
	const { sql } = await import('../../db.js');
	return {
		async launches({ network, mints, agentIds }) {
			return sql`
				select mint, agent_id, name, symbol, id as mint_id
				from pump_agent_mints
				where network = ${network} and (mint = any(${mints}) or agent_id::text = any(${agentIds}))
			`;
		},
		async volume({ mintIds, from, to }) {
			return sql`
				select mint_id, coalesce(sum(abs(coalesce(quote_amount, sol_amount))), 0)::text as lamports, count(*)::int as trades
				from pump_agent_trades
				where mint_id = any(${mintIds}) and coalesce(quote_symbol, 'SOL') = 'SOL'
				  and created_at >= ${from} and created_at <= ${to}
				group by mint_id
			`;
		},
		async marketCap({ mintIds, to }) {
			return sql`
				select distinct on (mint_id) mint_id, market_cap_lamports::text as lamports, ts
				from pump_agent_price_points
				where mint_id = any(${mintIds}) and ts <= ${to} and market_cap_lamports is not null
				order by mint_id, ts desc
			`;
		},
		async holders({ mints }) {
			return sql`
				select cl.mint, count(*) filter (where ch.balance > 0)::int as holders, max(ch.last_seen) as as_of
				from coin_launches cl join coin_holders ch on ch.coin_id = cl.id
				where cl.mint = any(${mints})
				group by cl.mint
			`;
		},
	};
}

export async function resolve(market, { now = Date.now(), deps } = {}) {
	const d = deps || (await defaultDeps());
	const rule = ruleOf(market);
	if (!METRICS[rule.metric]) return voided('invalid_rule', { rule });
	const network = rule.network === 'devnet' ? 'devnet' : 'mainnet';
	const measureAt = new Date(rule.measure_at || market.resolves_at).getTime();
	if (!Number.isFinite(measureAt)) return voided('no_measure_time', { rule });
	const from = rule.window_from || market.opens_at || new Date(0).toISOString();
	const base = { metric: rule.metric, network, window_from: iso(from), measure_at: iso(measureAt) };
	if (now < measureAt) return pending('cohort_running', base);

	const outcomes = market.outcomes || [];
	const mints = outcomes.filter((o) => o.ref_kind === 'project').map((o) => String(o.ref_id));
	const agentIds = outcomes.filter((o) => o.ref_kind === 'agent').map((o) => String(o.ref_id));
	const launches = await d.launches({ network, mints, agentIds });
	const mintIds = launches.map((l) => l.mint_id);
	if (!launches.length) return voided('no_data', { ...base, launches: 0 });

	const value = new Map(); // mint -> number
	const asOf = new Map();
	if (rule.metric === 'volume') {
		const rows = await d.volume({ mintIds, from: iso(from), to: iso(measureAt) });
		const byId = new Map(rows.map((r) => [r.mint_id, r]));
		for (const l of launches) {
			const r = byId.get(l.mint_id);
			value.set(l.mint, r ? Number(r.lamports) / 1e9 : 0);
			asOf.set(l.mint, { trades: r ? r.trades : 0 });
		}
	} else if (rule.metric === 'market_cap') {
		const rows = await d.marketCap({ mintIds, to: iso(measureAt) });
		const byId = new Map(rows.map((r) => [r.mint_id, r]));
		for (const l of launches) {
			const r = byId.get(l.mint_id);
			if (!r) continue;
			value.set(l.mint, Number(r.lamports) / 1e9);
			asOf.set(l.mint, { sampled_at: iso(r.ts) });
		}
	} else {
		const rows = await d.holders({ mints: launches.map((l) => l.mint) });
		for (const r of rows) {
			value.set(r.mint, Number(r.holders));
			asOf.set(r.mint, { snapshot_at: iso(r.as_of) });
		}
	}

	// Score per outcome: a project outcome is its mint; an agent outcome is its best launch.
	const scored = [];
	const excluded = [];
	for (const o of outcomes) {
		const mine = launches.filter((l) => (o.ref_kind === 'project' ? l.mint === o.ref_id : String(l.agent_id) === String(o.ref_id)));
		const withData = mine.filter((l) => value.has(l.mint));
		if (!withData.length) { excluded.push({ outcome_id: o.id, label: o.label, reason: 'no_record' }); continue; }
		const best = withData.reduce((a, b) => (value.get(b.mint) > value.get(a.mint) ? b : a));
		scored.push({ outcome: o, mint: best.mint, symbol: best.symbol, value: value.get(best.mint), as_of: asOf.get(best.mint) });
	}
	scored.sort((a, b) => b.value - a.value);
	const unit = rule.metric === 'holders' ? 'holders' : 'SOL';
	const evidence = {
		...base,
		unit,
		ranking: scored.slice(0, 10).map((s) => ({ outcome_id: s.outcome.id, label: s.outcome.label, mint: s.mint, symbol: s.symbol, value: s.value, ...s.as_of })),
		excluded,
	};

	if (!scored.length || scored[0].value <= 0) return voided('no_data', evidence);
	if (scored[1] && scored[1].value === scored[0].value) return voided('tie', evidence);
	return won(scored[0].outcome, evidence);
}
