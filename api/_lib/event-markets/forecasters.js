// Event Markets: agents as forecasters.
//
// An agent places a pick under its own identity (one live pick per agent per
// market, locked exactly like a human's), may attach a confidence, a short
// rationale and evidence links, and accrues a public track record computed from
// RESOLVED markets only. Free-to-play: points are a forecasting weight, nothing
// here signs, escrows or moves funds.
//
// Trust boundary: a rationale and its evidence links are written by an agent
// (or by whoever prompted it). They are stored and returned as inert text.
// Every renderer escapes them, and no consumer in this repo feeds them to a
// model as instructions. api/_lib/event-markets/forecast-runner.js and
// event_market_analyze deliberately never include another agent's rationale in
// a prompt or a tool result for that reason.
//
// Guide: docs/event-markets.md (section Agents).

import { readFileSync } from 'node:fs';
import { sql } from '../db.js';
import { insertNotification } from '../notify.js';
import { impliedOdds } from './index.js';

export const agentConfig = Object.freeze(
	JSON.parse(readFileSync(new URL('../../../data/event-markets-agents.json', import.meta.url), 'utf8')),
);

export const SOURCE_KINDS = Object.freeze([
	'arena_tournament',
	'event_leaderboard',
	'launch_cohort',
	'build_round',
	'bounty',
	'custom',
]);

export class ForecastError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

// ── Inert text ───────────────────────────────────────────────────────────────

/**
 * Normalise a rationale to plain, bounded text: control characters and
 * zero-width/bidi marks out, whitespace collapsed, capped. Markup is NOT
 * stripped or rewritten: it stays as the literal characters the agent wrote and
 * is shown escaped, so what a reader sees is what was said and nothing in it
 * can execute. Returns null for empty input.
 */
export function cleanRationale(input) {
	if (input == null) return null;
	if (typeof input !== 'string') throw new ForecastError('validation_error', 'rationale must be text');
	const text = input
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (!text) return null;
	if (text.length > agentConfig.rationaleMaxChars) {
		throw new ForecastError('validation_error', `rationale is limited to ${agentConfig.rationaleMaxChars} characters`);
	}
	return text;
}

/** Evidence links: http(s) only, no credentials in the URL, bounded and de-duplicated. */
export function cleanEvidence(input) {
	if (input == null) return [];
	if (!Array.isArray(input)) throw new ForecastError('validation_error', 'evidence must be a list of links');
	if (input.length > agentConfig.evidenceMaxLinks) {
		throw new ForecastError('validation_error', `evidence is limited to ${agentConfig.evidenceMaxLinks} links`);
	}
	const out = [];
	for (const raw of input) {
		if (typeof raw !== 'string' || raw.length > agentConfig.evidenceUrlMaxChars) {
			throw new ForecastError('validation_error', `each evidence link must be a URL of at most ${agentConfig.evidenceUrlMaxChars} characters`);
		}
		let u;
		try {
			u = new URL(raw.trim());
		} catch {
			throw new ForecastError('validation_error', 'each evidence link must be a valid URL');
		}
		if (u.protocol !== 'https:' && u.protocol !== 'http:') {
			throw new ForecastError('validation_error', 'evidence links must be http or https');
		}
		if (u.username || u.password) throw new ForecastError('validation_error', 'evidence links must not contain credentials');
		const href = u.toString();
		if (!out.includes(href)) out.push(href);
	}
	return out;
}

export function cleanConfidence(input, { required = false } = {}) {
	if (input == null) {
		if (required) throw new ForecastError('validation_error', 'confidence is required: a whole number from 1 to 99');
		return null;
	}
	const { confidenceMin: lo, confidenceMax: hi } = agentConfig;
	if (!Number.isInteger(input) || input < lo || input > hi) {
		throw new ForecastError('validation_error', `confidence must be a whole number from ${lo} to ${hi}`);
	}
	return input;
}

// ── Track record math (pure) ─────────────────────────────────────────────────

/** Lower bound of the 95% Wilson interval: a hit rate that is honest about small samples. */
export function wilsonLower(hits, n) {
	if (!n) return 0;
	const z = 1.96;
	const p = hits / n;
	const d = 1 + (z * z) / n;
	const centre = p + (z * z) / (2 * n);
	const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
	return Math.max(0, (centre - margin) / d);
}

/** Calls whose market resolved with a winner. Void and open markets never count. */
export function isResolvedCall(c) {
	return c.market_status === 'resolved' && c.winner_outcome_id != null;
}

/**
 * Confidence versus outcome, bucketed. Only resolved calls that carried a
 * confidence are scored. `has_data` is false when there is nothing to chart, so
 * the UI shows an honest empty state instead of an empty frame.
 */
export function calibration(calls, buckets = agentConfig.calibrationBuckets) {
	const scored = calls.filter((c) => isResolvedCall(c) && c.confidence != null);
	const rows = buckets.map(({ lo, hi }) => {
		const inBucket = scored.filter((c) => c.confidence >= lo && c.confidence <= hi);
		const hits = inBucket.filter((c) => c.outcome_id === c.winner_outcome_id).length;
		const meanConf = inBucket.length ? inBucket.reduce((a, c) => a + c.confidence, 0) / inBucket.length : null;
		return {
			lo,
			hi,
			calls: inBucket.length,
			hits,
			hit_rate: inBucket.length ? hits / inBucket.length : null,
			mean_confidence: meanConf == null ? null : meanConf / 100,
		};
	});
	const brier = scored.length
		? scored.reduce((a, c) => {
				const hit = c.outcome_id === c.winner_outcome_id ? 1 : 0;
				return a + (c.confidence / 100 - hit) ** 2;
			}, 0) / scored.length
		: null;
	return { has_data: scored.length > 0, scored: scored.length, brier, buckets: rows };
}

/** Summary numbers for a set of calls (an agent's, or a human's). */
export function summarizeCalls(calls) {
	const resolved = calls.filter(isResolvedCall);
	const hits = resolved.filter((c) => c.outcome_id === c.winner_outcome_id).length;
	const open = calls.filter((c) => c.market_status === 'open' || c.market_status === 'locked').length;
	return {
		calls: calls.length,
		open,
		resolved: resolved.length,
		hits,
		hit_rate: resolved.length ? hits / resolved.length : null,
		rank_score: wilsonLower(hits, resolved.length),
	};
}

/**
 * Rank forecasters: those with enough resolved calls first, ordered by the
 * Wilson lower bound (so 3 for 3 does not outrank 40 for 50), then the rest as
 * provisional. Ties break on resolved calls, then name.
 */
export function rankForecasters(rows, minResolved = agentConfig.minResolvedCallsToRank) {
	const ranked = rows
		.filter((r) => r.resolved >= minResolved)
		.sort((a, b) => b.rank_score - a.rank_score || b.resolved - a.resolved || String(a.name).localeCompare(String(b.name)));
	const provisional = rows
		.filter((r) => r.resolved < minResolved)
		.sort((a, b) => b.resolved - a.resolved || b.calls - a.calls || String(a.name).localeCompare(String(b.name)));
	return [
		...ranked.map((r, i) => ({ ...r, rank: i + 1, provisional: false })),
		...provisional.map((r) => ({ ...r, rank: null, provisional: true })),
	];
}

/** The agent must exist and belong to this user. Anything else reads as not found, so ids cannot be probed. */
export async function assertAgentOwner(agentId, userId) {
	const agent = await loadAgent(agentId);
	if (!userId || agent.user_id !== userId) throw new ForecastError('not_found', 'agent not found', 404);
	return agent;
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function loadAgent(agentId) {
	if (!isUuid(agentId)) throw new ForecastError('not_found', 'agent not found', 404);
	const [agent] = await sql`
		select id, user_id, name, description, avatar_url, profile_image_url, is_public
		from agent_identities where id = ${agentId} and deleted_at is null limit 1
	`;
	if (!agent) throw new ForecastError('not_found', 'agent not found', 404);
	return agent;
}

const agentCard = (a) => ({
	id: a.id,
	name: a.name,
	image: a.profile_image_url || a.avatar_url || null,
});

/** An agent's calls, newest first, joined to market and outcome. */
async function callsForAgent(agentId, { limit = 500 } = {}) {
	return sql`
		select p.id, p.market_id, p.outcome_id, p.points, p.confidence, p.rationale, p.evidence, p.created_at,
		       m.slug, m.title, m.status as market_status, m.winner_outcome_id, m.locks_at, m.resolves_at,
		       o.label as outcome_label
		from event_market_picks p
		join event_markets m on m.id = p.market_id
		join event_market_outcomes o on o.id = p.outcome_id
		where p.agent_id = ${agentId}
		order by p.created_at desc
		limit ${limit}
	`;
}

/** Final human crowd share for the outcome an agent picked, per call. Agents never move the crowd number. */
async function crowdShares(calls) {
	const marketIds = [...new Set(calls.map((c) => c.market_id))];
	if (!marketIds.length) return new Map();
	const [outcomes, picks] = await Promise.all([
		sql`select id, market_id from event_market_outcomes where market_id = any(${marketIds}::uuid[])`,
		sql`
			select market_id, outcome_id, sum(points)::int as points
			from event_market_picks
			where market_id = any(${marketIds}::uuid[]) and agent_id is null
			group by market_id, outcome_id
		`,
	]);
	const shares = new Map();
	for (const marketId of marketIds) {
		const os = outcomes.filter((o) => o.market_id === marketId);
		const ps = picks.filter((p) => p.market_id === marketId);
		const odds = impliedOdds(os.map((o) => ({ id: o.id, points: ps.filter((p) => p.outcome_id === o.id).reduce((n, p) => n + p.points, 0) })));
		for (const o of odds.outcomes) shares.set(o.outcome_id, o.share);
	}
	return shares;
}

const callView = (c, extra = {}) => ({
	id: c.id,
	market: { id: c.market_id, slug: c.slug, title: c.title, status: c.market_status },
	outcome: { id: c.outcome_id, label: c.outcome_label },
	points: c.points,
	confidence: c.confidence,
	rationale: c.rationale,
	evidence: c.evidence || [],
	placed_at: c.created_at,
	result: isResolvedCall(c) ? (c.outcome_id === c.winner_outcome_id ? 'hit' : 'miss') : c.market_status === 'void' ? 'void' : 'pending',
	...extra,
});

/** The public forecasting record of one agent: summary, calibration, best calls, recent calls. */
export async function agentTrackRecord(agentId, { viewerUserId = null } = {}) {
	const agent = await loadAgent(agentId);
	if (!agent.is_public && agent.user_id !== viewerUserId) throw new ForecastError('not_found', 'agent not found', 404);
	const calls = await callsForAgent(agentId);
	const resolvedHits = calls.filter((c) => isResolvedCall(c) && c.outcome_id === c.winner_outcome_id);
	const shares = await crowdShares(resolvedHits);
	const best = resolvedHits
		.map((c) => ({ c, share: shares.get(c.outcome_id) ?? null }))
		.sort((a, b) => (a.share ?? 1) - (b.share ?? 1) || (b.c.confidence ?? 0) - (a.c.confidence ?? 0))
		.slice(0, agentConfig.bestCallsLimit)
		.map(({ c, share }) => callView(c, { crowd_share: share }));
	const [followers] = await sql`select count(*)::int as n from event_market_agent_follows where agent_id = ${agentId}`;
	const [settings] = await sql`select enabled from event_market_agent_settings where agent_id = ${agentId}`;
	return {
		agent: agentCard(agent),
		autonomous: settings?.enabled === true,
		followers: followers?.n ?? 0,
		summary: summarizeCalls(calls),
		calibration: calibration(calls),
		best_calls: best,
		recent_calls: calls.slice(0, agentConfig.recentCallsLimit).map((c) => callView(c)),
		untrusted_fields: ['recent_calls[].rationale', 'recent_calls[].evidence', 'best_calls[].rationale', 'best_calls[].evidence'],
	};
}

/** "What agents think": every public agent's live call on a market, with its hit rate so far. */
export async function marketAgentCalls(marketId) {
	if (!isUuid(marketId)) throw new ForecastError('not_found', 'market not found', 404);
	const rows = await sql`
		select p.id, p.agent_id, p.outcome_id, p.points, p.confidence, p.rationale, p.evidence, p.created_at,
		       o.label as outcome_label,
		       a.name, a.avatar_url, a.profile_image_url,
		       coalesce(r.resolved, 0)::int as resolved, coalesce(r.hits, 0)::int as hits
		from event_market_picks p
		join agent_identities a on a.id = p.agent_id and a.deleted_at is null and a.is_public
		join event_market_outcomes o on o.id = p.outcome_id
		left join lateral (
			select count(*) as resolved, count(*) filter (where q.outcome_id = m.winner_outcome_id) as hits
			from event_market_picks q join event_markets m on m.id = q.market_id
			where q.agent_id = p.agent_id and m.status = 'resolved' and m.winner_outcome_id is not null
		) r on true
		where p.market_id = ${marketId} and p.agent_id is not null
		order by p.created_at desc
		limit 200
	`;
	const byOutcome = new Map();
	const calls = rows.map((r) => {
		byOutcome.set(r.outcome_id, (byOutcome.get(r.outcome_id) || 0) + 1);
		return {
			id: r.id,
			actor_kind: 'agent',
			agent: { id: r.agent_id, name: r.name, image: r.profile_image_url || r.avatar_url || null },
			outcome: { id: r.outcome_id, label: r.outcome_label },
			points: r.points,
			confidence: r.confidence,
			rationale: r.rationale,
			evidence: r.evidence || [],
			placed_at: r.created_at,
			record: { resolved: r.resolved, hits: r.hits, hit_rate: r.resolved ? r.hits / r.resolved : null },
		};
	});
	return {
		calls,
		by_outcome: [...byOutcome].map(([outcome_id, agents]) => ({ outcome_id, agents })),
		untrusted_fields: ['calls[].rationale', 'calls[].evidence'],
	};
}

/**
 * The forecaster board. `kind` is 'all' (agents and humans) or 'agent'. Ranked on
 * resolved markets only; anyone under the resolved-call floor is listed as
 * provisional rather than hidden or ranked on a lucky streak.
 */
export async function forecasterBoard({ kind = 'all', limit = agentConfig.leaderboardLimit } = {}) {
	if (kind !== 'all' && kind !== 'agent') throw new ForecastError('validation_error', "kind must be 'all' or 'agent'");
	const cap = Math.min(Math.max(1, Number(limit) || agentConfig.leaderboardLimit), agentConfig.leaderboardLimit);
	const rows = await sql`
		select coalesce(p.agent_id::text, p.account_id::text) as actor_id,
		       p.actor_kind,
		       count(*)::int as calls,
		       count(*) filter (where m.status in ('open','locked'))::int as open,
		       count(*) filter (where m.status = 'resolved' and m.winner_outcome_id is not null)::int as resolved,
		       count(*) filter (where m.status = 'resolved' and p.outcome_id = m.winner_outcome_id)::int as hits
		from event_market_picks p
		join event_markets m on m.id = p.market_id
		where m.status in ('open','locked','resolved')
		  and (${kind}::text = 'all' or p.agent_id is not null)
		group by 1, 2
	`;
	const agentIds = rows.filter((r) => r.actor_kind === 'agent').map((r) => r.actor_id);
	const humanIds = rows.filter((r) => r.actor_kind === 'human').map((r) => r.actor_id);
	const [agents, humans] = await Promise.all([
		agentIds.length
			? sql`select id, name, avatar_url, profile_image_url from agent_identities
			      where id = any(${agentIds}::uuid[]) and deleted_at is null and is_public`
			: [],
		humanIds.length
			? sql`select id, username, display_name, avatar_url from users
			      where id = any(${humanIds}::uuid[]) and deleted_at is null`
			: [],
	]);
	const agentById = new Map(agents.map((a) => [a.id, a]));
	const humanById = new Map(humans.map((u) => [u.id, u]));
	const entries = [];
	for (const r of rows) {
		if (r.actor_kind === 'agent') {
			const a = agentById.get(r.actor_id);
			if (!a) continue;
			entries.push({ ...base(r), actor_kind: 'agent', id: a.id, name: a.name, image: a.profile_image_url || a.avatar_url || null });
		} else {
			const u = humanById.get(r.actor_id);
			if (!u) continue;
			entries.push({ ...base(r), actor_kind: 'human', id: u.id, name: u.display_name || u.username || 'Forecaster', username: u.username || null, image: u.avatar_url || null });
		}
	}
	return rankForecasters(entries).slice(0, cap);

	function base(r) {
		return {
			calls: r.calls,
			open: r.open,
			resolved: r.resolved,
			hits: r.hits,
			hit_rate: r.resolved ? r.hits / r.resolved : null,
			rank_score: wilsonLower(r.hits, r.resolved),
		};
	}
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Place or change an agent's pick. Same rules as a human's: market open, before
 * its lock, an outcome of that market, points inside the budget. The agent is
 * its own actor, so it never collides with its owner's own pick.
 *
 * @param {{agentId:string, marketId:string, outcomeId:string, points:number,
 *   confidence?:number|null, rationale?:string|null, evidence?:string[]|null,
 *   via?:'manual'|'autonomous'|'mcp', now?:Date}} input
 */
export async function placeAgentPick({ agentId, marketId, outcomeId, points, confidence = null, rationale = null, evidence = null, via = 'manual', now = new Date() }) {
	const agent = await loadAgent(agentId);
	if (!isUuid(marketId) || !isUuid(outcomeId)) throw new ForecastError('validation_error', 'marketId and outcomeId must be ids');
	if (!Number.isInteger(points) || points < 1 || points > agentConfig.maxPointsPerPick) {
		throw new ForecastError('validation_error', `points must be a whole number from 1 to ${agentConfig.maxPointsPerPick}`);
	}
	const conf = cleanConfidence(confidence);
	const why = cleanRationale(rationale);
	const links = cleanEvidence(evidence);

	const [market] = await sql`select id, slug, title, status, locks_at from event_markets where id = ${marketId}`;
	if (!market) throw new ForecastError('not_found', 'market not found', 404);
	if (market.status !== 'open' || (market.locks_at && new Date(market.locks_at) <= now)) {
		throw new ForecastError('market_locked', 'this market is locked; picks closed at its lock time', 409);
	}
	const [outcome] = await sql`select id, label from event_market_outcomes where id = ${outcomeId} and market_id = ${marketId}`;
	if (!outcome) throw new ForecastError('validation_error', 'outcome does not belong to this market');

	const [prior] = await sql`select outcome_id from event_market_picks where market_id = ${marketId} and agent_id = ${agentId}`;
	const [pick] = await sql`
		insert into event_market_picks (market_id, outcome_id, account_id, points, actor_kind, agent_id, confidence, rationale, evidence)
		values (${marketId}, ${outcomeId}, ${agent.user_id}, ${points}, 'agent', ${agentId}, ${conf}, ${why}, ${JSON.stringify(links)}::jsonb)
		on conflict (market_id, agent_id) where agent_id is not null
		do update set outcome_id = excluded.outcome_id, points = excluded.points, confidence = excluded.confidence,
		              rationale = excluded.rationale, evidence = excluded.evidence, created_at = now()
		returning *
	`;

	const changed = !prior || prior.outcome_id !== outcomeId;
	await logAgentActivity(agentId, {
		type: 'event_market_pick',
		summary: `${prior ? 'Changed call' : 'Called'} "${outcome.label}" in "${market.title}"${conf != null ? ` at ${conf}% confidence` : ''}`,
		market_slug: market.slug,
		outcome_id: outcomeId,
		confidence: conf,
		via,
	});
	if (changed) await notifyFollowers(agent, market, outcome);
	return { pick, market: { id: market.id, slug: market.slug, title: market.title }, outcome, replaced: Boolean(prior) };
}

/** Withdraw an agent's pick before lock. */
export async function withdrawAgentPick({ agentId, marketId, now = new Date() }) {
	await loadAgent(agentId);
	const [market] = await sql`select id, status, locks_at from event_markets where id = ${marketId}`;
	if (!market) throw new ForecastError('not_found', 'market not found', 404);
	if (market.status !== 'open' || (market.locks_at && new Date(market.locks_at) <= now)) {
		throw new ForecastError('market_locked', 'this market is locked; picks can no longer be withdrawn', 409);
	}
	const gone = await sql`delete from event_market_picks where market_id = ${marketId} and agent_id = ${agentId} returning id`;
	if (!gone.length) throw new ForecastError('not_found', 'this agent has no pick in this market', 404);
	return { withdrawn: true };
}

export async function logAgentActivity(agentId, payload) {
	await sql`
		insert into agent_actions (agent_id, type, payload, source_skill)
		values (${agentId}, ${payload.type}, ${JSON.stringify(payload)}::jsonb, 'event-markets')
	`;
}

async function notifyFollowers(agent, market, outcome) {
	const followers = await sql`
		select user_id from event_market_agent_follows
		where agent_id = ${agent.id} and user_id <> ${agent.user_id}
		limit 1000
	`;
	// The rationale is deliberately absent: a notification is a link to the
	// market, not a channel for free text written by an agent.
	await Promise.all(
		followers.map((f) =>
			insertNotification(f.user_id, 'event_market_agent_pick', {
				agent_id: agent.id,
				agent_name: agent.name,
				market_slug: market.slug,
				market_title: market.title,
				outcome_label: outcome.label,
				link: `/event-markets/${encodeURIComponent(market.slug)}`,
			}),
		),
	);
}

// ── Following ────────────────────────────────────────────────────────────────

export async function followAgent(userId, agentId) {
	const agent = await loadAgent(agentId);
	if (!agent.is_public && agent.user_id !== userId) throw new ForecastError('not_found', 'agent not found', 404);
	await sql`
		insert into event_market_agent_follows (user_id, agent_id) values (${userId}, ${agentId})
		on conflict do nothing
	`;
	return followState(userId, agentId);
}

export async function unfollowAgent(userId, agentId) {
	if (!isUuid(agentId)) throw new ForecastError('not_found', 'agent not found', 404);
	await sql`delete from event_market_agent_follows where user_id = ${userId} and agent_id = ${agentId}`;
	return followState(userId, agentId);
}

export async function followState(userId, agentId) {
	const [row] = await sql`
		select count(*)::int as followers,
		       coalesce(bool_or(user_id = ${userId}), false) as following
		from event_market_agent_follows where agent_id = ${agentId}
	`;
	return { following: row?.following === true, followers: row?.followers ?? 0 };
}

// ── Autonomous settings ──────────────────────────────────────────────────────

export function defaultSettings(agentId) {
	return {
		agent_id: agentId,
		enabled: false,
		categories: [],
		points_per_pick: agentConfig.autonomous.defaultPointsPerPick,
		max_picks_per_day: agentConfig.autonomous.defaultMaxPicksPerDay,
	};
}

export async function getAgentSettings(agentId, ownerUserId) {
	const agent = await loadAgent(agentId);
	if (agent.user_id !== ownerUserId) throw new ForecastError('forbidden', 'only the agent owner can read these settings', 403);
	const [row] = await sql`select * from event_market_agent_settings where agent_id = ${agentId}`;
	return row ? { ...defaultSettings(agentId), ...row } : defaultSettings(agentId);
}

/** Owner-only. Off by default; turning it on needs at least one category. */
export async function saveAgentSettings(agentId, ownerUserId, patch) {
	const agent = await loadAgent(agentId);
	if (agent.user_id !== ownerUserId) throw new ForecastError('forbidden', 'only the agent owner can change these settings', 403);
	const current = await getAgentSettings(agentId, ownerUserId);
	const next = { ...current };
	if ('enabled' in patch) {
		if (typeof patch.enabled !== 'boolean') throw new ForecastError('validation_error', 'enabled must be true or false');
		next.enabled = patch.enabled;
	}
	if ('categories' in patch) {
		if (!Array.isArray(patch.categories) || patch.categories.some((c) => !SOURCE_KINDS.includes(c))) {
			throw new ForecastError('validation_error', `categories must be a list of: ${SOURCE_KINDS.join(', ')}`);
		}
		next.categories = [...new Set(patch.categories)];
	}
	if ('points_per_pick' in patch) {
		if (!Number.isInteger(patch.points_per_pick) || patch.points_per_pick < 1 || patch.points_per_pick > agentConfig.maxPointsPerPick) {
			throw new ForecastError('validation_error', `points_per_pick must be a whole number from 1 to ${agentConfig.maxPointsPerPick}`);
		}
		next.points_per_pick = patch.points_per_pick;
	}
	if ('max_picks_per_day' in patch) {
		const ceiling = agentConfig.autonomous.maxPicksPerDayCeiling;
		if (!Number.isInteger(patch.max_picks_per_day) || patch.max_picks_per_day < 1 || patch.max_picks_per_day > ceiling) {
			throw new ForecastError('validation_error', `max_picks_per_day must be a whole number from 1 to ${ceiling}`);
		}
		next.max_picks_per_day = patch.max_picks_per_day;
	}
	if (next.enabled && next.categories.length === 0) {
		throw new ForecastError('validation_error', 'choose at least one category before turning autonomous forecasting on');
	}
	const [row] = await sql`
		insert into event_market_agent_settings (agent_id, enabled, categories, points_per_pick, max_picks_per_day, updated_by, updated_at)
		values (${agentId}, ${next.enabled}, ${next.categories}::text[], ${next.points_per_pick}, ${next.max_picks_per_day}, ${ownerUserId}, now())
		on conflict (agent_id) do update set enabled = excluded.enabled, categories = excluded.categories,
			points_per_pick = excluded.points_per_pick, max_picks_per_day = excluded.max_picks_per_day,
			updated_by = excluded.updated_by, updated_at = now()
		returning *
	`;
	await logAgentActivity(agentId, {
		type: 'event_market_settings',
		summary: row.enabled
			? `Autonomous forecasting on for ${row.categories.join(', ')} (${row.points_per_pick} points per pick, up to ${row.max_picks_per_day} a day)`
			: 'Autonomous forecasting off',
	});
	return row;
}
