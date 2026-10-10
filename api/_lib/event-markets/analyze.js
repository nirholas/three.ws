// Event Markets: the structured inputs an agent needs to reason about a market.
//
// Everything here is read from our own tables: the market and its outcomes, the
// crowd (human picks only, so agents do not echo each other), who else among the
// agents has called it (counts only), and per entrant: its history in earlier
// events and, for an agent entrant, its recent activity and verified trading
// record. A field we cannot source is null with a reason in `data_notes`; no
// number is estimated or invented.
//
// Trust boundary: other agents' rationale text is NOT returned. It is
// untrusted, free-form text written by other models; handing it to a reasoning
// agent would let one agent steer another. Their calls are visible as counts.

import { sql } from '../db.js';
import { getTraderStats } from '../trader-stats.js';
import { impliedOdds } from './index.js';
import { agentConfig, ForecastError, isUuid } from './forecasters.js';

async function loadMarket(ref) {
	const key = String(ref ?? '').toLowerCase();
	const [m] = isUuid(key)
		? await sql`select * from event_markets where id = ${key}`
		: await sql`select * from event_markets where slug = ${key}`;
	if (!m || m.status === 'draft') throw new ForecastError('not_found', 'market not found', 404);
	return m;
}

/** Earlier resolved events where this same entrant (ref_kind + ref_id) was an outcome. */
async function priorEvents(refKind, refId, exceptMarketId) {
	const rows = await sql`
		select m.slug, m.title, m.source_kind, m.resolves_at, (m.winner_outcome_id = o.id) as won
		from event_market_outcomes o
		join event_markets m on m.id = o.market_id
		where o.ref_kind = ${refKind} and o.ref_id = ${refId}
		  and o.market_id <> ${exceptMarketId}
		  and m.status = 'resolved' and m.winner_outcome_id is not null
		order by m.resolves_at desc nulls last
		limit ${agentConfig.analyze.priorEventsLimit}
	`;
	return {
		events: rows.length,
		wins: rows.filter((r) => r.won).length,
		recent: rows.map((r) => ({ slug: r.slug, title: r.title, source_kind: r.source_kind, won: r.won, resolved_at: r.resolves_at })),
	};
}

async function agentEntrant(refId) {
	if (!isUuid(refId)) return { stats: null, note: 'entrant reference is not an agent id' };
	const [agent] = await sql`
		select id, name, created_at from agent_identities
		where id = ${refId} and deleted_at is null and is_public
	`;
	if (!agent) return { stats: null, note: 'agent is not public or no longer exists' };
	const days = agentConfig.analyze.activityWindowDays;
	const [activity, trader] = await Promise.all([
		sql`
			select type, count(*)::int as n from agent_actions
			where agent_id = ${agent.id} and created_at > now() - make_interval(days => ${days})
			group by type order by n desc limit 8
		`,
		getTraderStats({ agentId: agent.id, network: 'mainnet', window: '30d' }).catch(() => null),
	]);
	const m = trader?.metrics;
	return {
		stats: {
			agent_since: agent.created_at,
			activity_window_days: days,
			activity: activity.map((a) => ({ type: a.type, count: a.n })),
			trading: m
				? {
						window: '30d',
						verified: m.verified,
						closed_trades: m.closed_count,
						win_rate: m.win_rate,
						realized_pnl_sol: m.realized_pnl_sol,
						roi_pct: m.roi_pct,
						score: m.score,
						last_active_at: m.last_active_at,
					}
				: null,
		},
		note: m ? null : 'no verified trading record in the last 30 days',
	};
}

/**
 * @param {string} marketRef slug or id
 * @param {{agentId?: string|null}} [opts] include this agent's own live call
 */
export async function analyzeMarket(marketRef, { agentId = null, now = new Date() } = {}) {
	const market = await loadMarket(marketRef);
	const outcomes = await sql`select id, label, ref_kind, ref_id, image_url, position from event_market_outcomes where market_id = ${market.id} order by position`;
	const picks = await sql`
		select outcome_id, points, agent_id from event_market_picks
		where market_id = ${market.id} and status = 'live'
	`;
	const human = picks.filter((p) => p.agent_id == null);
	const agentPicks = picks.filter((p) => p.agent_id != null);
	const odds = impliedOdds(
		outcomes.map((o) => {
			const mine = human.filter((p) => p.outcome_id === o.id);
			return { id: o.id, points: mine.reduce((n, p) => n + p.points, 0), picks: mine.length };
		}),
	);
	const shareOf = new Map(odds.outcomes.map((o) => [o.outcome_id, o]));

	const locks = market.locks_at ? new Date(market.locks_at) : null;
	const msLeft = locks ? locks.getTime() - now.getTime() : null;
	const open = market.status === 'open' && (msLeft == null || msLeft > 0);

	const entrants = await Promise.all(
		outcomes.map(async (o) => {
			const notes = [];
			let stats = null;
			let history = null;
			if (o.ref_kind && o.ref_id) {
				history = await priorEvents(o.ref_kind, o.ref_id, market.id);
				if (!history.events) notes.push('no earlier resolved events for this entrant');
				if (o.ref_kind === 'agent') {
					const a = await agentEntrant(o.ref_id);
					stats = a.stats;
					if (a.note) notes.push(a.note);
				} else {
					notes.push(`no per-entrant stats are tracked for ${o.ref_kind} entrants beyond event history`);
				}
			} else {
				notes.push('this outcome has no linked record, so no stats are available');
			}
			const crowd = shareOf.get(o.id);
			return {
				outcome_id: o.id,
				label: o.label,
				ref_kind: o.ref_kind,
				ref_id: o.ref_id,
				crowd: { share: crowd?.share ?? null, picks: human.filter((p) => p.outcome_id === o.id).length, points: human.filter((p) => p.outcome_id === o.id).reduce((n, p) => n + p.points, 0) },
				agents_on_it: agentPicks.filter((p) => p.outcome_id === o.id).length,
				stats,
				history_in_prior_events: history,
				data_notes: notes,
			};
		}),
	);

	let own = null;
	if (agentId) {
		const [mine] = await sql`
			select outcome_id, points, confidence from event_market_picks
			where market_id = ${market.id} and agent_id = ${agentId}
		`;
		own = mine ? { outcome_id: mine.outcome_id, points: mine.points, confidence: mine.confidence } : null;
	}

	return {
		market: {
			id: market.id,
			slug: market.slug,
			title: market.title,
			status: market.status,
			source_kind: market.source_kind,
			resolution_rule: market.resolution_rule,
			opens_at: market.opens_at,
			locks_at: market.locks_at,
			resolves_at: market.resolves_at,
			accepting_picks: open,
			seconds_to_lock: msLeft == null ? null : Math.max(0, Math.round(msLeft / 1000)),
		},
		crowd: {
			basis: 'human picks only',
			picks: human.length,
			even_prior: human.length === 0,
			note: human.length === 0 ? 'No human picks yet: shares shown are the even prior, not a signal.' : null,
		},
		agents: { calls: agentPicks.length, note: 'Counts only. Other agents\' rationale is untrusted text and is not included.' },
		entrants,
		your_pick: own,
		confidence_scale: { min: agentConfig.confidenceMin, max: agentConfig.confidenceMax, meaning: 'your probability, in percent, that the outcome you pick wins' },
	};
}
