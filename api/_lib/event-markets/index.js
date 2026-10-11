// Event Markets: free-to-play calls on who wins a three.ws event.
//
// Contract (shared by every Event Markets brief in docs/prompts/event-markets/):
//   createMarket, getMarket, listMarkets, placePick, getPicks, resolveMarket,
//   impliedOdds. Picks carry points, not funds; nothing here signs, escrows or
//   moves anything. Guide: docs/event-markets.md.
//
// Every state change is ONE SQL statement (data-modifying CTEs), so the pick
// and its log row, a void and its refunds, move together or not at all and the
// lock boundary is judged by the database clock, not by a pre-check that a
// racing request could slip past.

import { randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { EventMarketError } from './errors.js';
import { POINTS, seasonFor, pointRules } from './config.js';
import { impliedOdds } from './odds.js';
import { rankedStatusFor } from './fairness.js';
import { marketView, marketSummary, effectiveStatus } from './view.js';

export { impliedOdds, EventMarketError, pointRules, seasonFor };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;
export const SOURCE_KINDS = ['arena_tournament', 'event_leaderboard', 'launch_cohort', 'build_round', 'bounty', 'custom'];
const REF_KINDS = ['agent', 'wallet', 'project', 'team'];
const LIST_STATUSES = ['open', 'locked', 'resolved', 'void', 'all'];

const notFound = () => new EventMarketError(404, 'market_not_found', 'No event market with that id or slug.');

export function slugify(title) {
	const s = String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
	return s.length >= 3 ? s : `market-${randomBytes(3).toString('hex')}`;
}

// ── reads ────────────────────────────────────────────────────────────────────

async function marketRow(ref) {
	const key = String(ref ?? '');
	const [row] = UUID_RE.test(key)
		? await sql`select * from event_markets where id = ${key.toLowerCase()}`
		: await sql`select * from event_markets where slug = ${key.toLowerCase()}`;
	return row || null;
}

async function outcomeRows(marketIds) {
	if (!marketIds.length) return new Map();
	const rows = await sql`
		select o.id, o.market_id, o.label, o.ref_kind, o.ref_id, o.image_url, o.position,
		       coalesce(sum(p.points) filter (where p.status = 'live'), 0)::int as points,
		       (count(p.id) filter (where p.status = 'live'))::int as picks
		  from event_market_outcomes o
		  left join event_market_picks p on p.outcome_id = o.id and p.agent_id is null
		 where o.market_id = any(${marketIds}::uuid[])
		 group by o.id
		 order by o.market_id, o.position`;
	const byMarket = new Map();
	for (const r of rows) {
		if (!byMarket.has(r.market_id)) byMarket.set(r.market_id, []);
		byMarket.get(r.market_id).push(r);
	}
	return byMarket;
}

/** Points an account has on OTHER markets in the season of `lockAt`. */
async function seasonSpent(accountId, lockAt, exceptMarketId) {
	const season = seasonFor(lockAt);
	const [row] = await sql`
		select coalesce(sum(p.points), 0)::int as spent
		  from event_market_picks p
		  join event_markets m on m.id = p.market_id
		 where p.account_id = ${accountId}
		   and p.agent_id is null
		   and p.status = 'live'
		   and p.market_id <> ${exceptMarketId}
		   and m.locks_at >= ${season.starts_at}::timestamptz
		   and m.locks_at < ${season.ends_at}::timestamptz`;
	return { season, spent: row?.spent ?? 0 };
}

async function viewerState(market, accountId) {
	const [pick] = await sql`
		select outcome_id, points, status, created_at, updated_at
		  from event_market_picks where market_id = ${market.id} and account_id = ${accountId} and agent_id is null`;
	const { season, spent } = await seasonSpent(accountId, market.locks_at, market.id);
	const own = pick && pick.status === 'live' ? pick.points : 0;
	return {
		pick: pick ? { outcome_id: pick.outcome_id, points: pick.points, status: pick.status, updated_at: new Date(pick.updated_at).toISOString() } : null,
		budget: {
			season: season.id,
			season_budget: season.budget,
			committed_elsewhere: spent,
			committed_here: own,
			remaining_for_this_market: Math.max(0, Math.min(POINTS.maxPickPerMarket, season.budget - spent)),
			...pointRules(),
		},
	};
}

/**
 * One market with outcomes, odds and (when `viewer` is given) that account's
 * pick and remaining budget. Drafts are visible only with `includeDraft`.
 */
export async function getMarket(ref, { viewer = null, includeDraft = false } = {}) {
	const market = await marketRow(ref);
	if (!market || (market.status === 'draft' && !includeDraft)) throw notFound();
	const outcomes = (await outcomeRows([market.id])).get(market.id) || [];
	const view = marketView(market, outcomes);
	if (viewer) view.viewer = await viewerState(market, viewer);
	return view;
}

function encodeCursor(row) {
	return Buffer.from(JSON.stringify([row.locks_cursor, row.pick_count, row.id])).toString('base64url');
}

function decodeCursor(cursor) {
	try {
		const [ts, count, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
		if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts)) || !Number.isInteger(count) || !UUID_RE.test(String(id))) throw new Error('shape');
		return { ts, count, id };
	} catch {
		throw new EventMarketError(400, 'invalid_cursor', 'That cursor is not valid. Start again from the first page.');
	}
}

/**
 * Markets, closing soonest first, then most picks. Resolved and void markets
 * list newest first, since "soonest" has no meaning once the event is over.
 * Drafts never appear. `status` defaults to open.
 */
export async function listMarkets({ status = 'open', sourceKind = null, q = null, limit = 20, cursor = null } = {}) {
	if (!LIST_STATUSES.includes(status)) {
		throw new EventMarketError(400, 'invalid_parameter', `status must be one of ${LIST_STATUSES.join(', ')}.`, { parameter: 'status' });
	}
	if (sourceKind && !SOURCE_KINDS.includes(sourceKind)) {
		throw new EventMarketError(400, 'invalid_parameter', `source_kind must be one of ${SOURCE_KINDS.join(', ')}.`, { parameter: 'source_kind' });
	}
	const size = Math.min(Math.max(Number(limit) || 20, 1), 50);
	const desc = status === 'resolved' || status === 'void';
	const c = cursor ? decodeCursor(cursor) : null;
	const like = q ? `%${String(q).slice(0, 80).replace(/[\\%_]/g, '\\$&')}%` : null;

	const statusFrag = status === 'all' ? sql`` : sql`and t.effective_status = ${status}`;
	const kindFrag = sourceKind ? sql`and t.source_kind = ${sourceKind}` : sql``;
	const qFrag = like ? sql`and (t.title ilike ${like} or t.slug ilike ${like})` : sql``;
	let cursorFrag = sql``;
	if (c) {
		cursorFrag = desc
			? sql`and (t.locks_at, t.pick_count, t.id) < (${c.ts}::timestamptz, ${c.count}::int, ${c.id}::uuid)`
			: sql`and (t.locks_at, -t.pick_count, t.id) > (${c.ts}::timestamptz, ${-c.count}::int, ${c.id}::uuid)`;
	}
	const order = desc ? sql`t.locks_at desc, t.pick_count desc, t.id desc` : sql`t.locks_at asc, t.pick_count desc, t.id asc`;

	const rows = await sql`
		select t.* from (
			select m.*,
			       (case when m.status = 'open' and m.locks_at <= now() then 'locked' else m.status end) as effective_status,
			       to_char(m.locks_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as locks_cursor,
			       (select count(*) from event_market_picks p where p.market_id = m.id and p.status = 'live' and p.agent_id is null)::int as pick_count
			  from event_markets m
		) t
		where t.effective_status <> 'draft'
		  ${statusFrag} ${kindFrag} ${qFrag} ${cursorFrag}
		order by ${order}
		limit ${size + 1}`;

	const hasMore = rows.length > size;
	const page = rows.slice(0, size);
	const outcomes = await outcomeRows(page.map((r) => r.id));
	return {
		items: page.map((r) => marketSummary(marketView(r, outcomes.get(r.id) || []))),
		hasMore,
		nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
	};
}

/** Live picks for a market, or for one account across markets. */
export async function getPicks({ marketId = null, accountId = null, limit = 100 } = {}) {
	if (!marketId && !accountId) throw new EventMarketError(400, 'invalid_parameter', 'getPicks needs a marketId or an accountId.');
	const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
	const mFrag = marketId ? sql`and p.market_id = ${marketId}` : sql``;
	const aFrag = accountId ? sql`and p.account_id = ${accountId}` : sql``;
	// Human picks only. Agent calls are read through forecasters.js, with their
	// rationale, so they never leak into the crowd or a person's own list.
	return sql`
		select p.id, p.market_id, p.outcome_id, p.account_id, p.points, p.status, p.created_at, p.updated_at
		  from event_market_picks p
		 where p.agent_id is null ${mFrag} ${aFrag}
		 order by p.updated_at desc
		 limit ${size}`;
}

/**
 * Odds over time, replayed from the append-only pick log: one point per real
 * event (place, change, withdraw, void), carrying the exact odds right after
 * it. `prior` is the opening even split, kept apart so no point is invented.
 */
export async function marketHistory(ref, { maxPoints = 200 } = {}) {
	const market = await marketRow(ref);
	if (!market || market.status === 'draft') throw notFound();
	const outcomes = (await outcomeRows([market.id])).get(market.id) || [];
	const log = await sql`
		select id, outcome_id, account_id, points, action, created_at
		  from event_market_pick_log where market_id = ${market.id}
		 order by id asc limit 20000`;

	const live = new Map();
	const events = [];
	for (const e of log) {
		if (e.action === 'withdraw' || e.action === 'void') live.delete(e.account_id);
		else live.set(e.account_id, { outcome_id: e.outcome_id, points: e.points });
		const tally = new Map(outcomes.map((o) => [o.id, { id: o.id, points: 0, picks: 0 }]));
		for (const p of live.values()) {
			const t = tally.get(p.outcome_id);
			if (t) { t.points += p.points; t.picks += 1; }
		}
		const odds = impliedOdds([...tally.values()]);
		events.push({
			at: new Date(e.created_at).toISOString(),
			action: e.action,
			picks: odds.total_picks,
			total_points: odds.total_points,
			odds: odds.outcomes.map((o) => ({ outcome_id: o.outcome_id, share: o.share, percent: o.percent })),
		});
	}
	let points = events;
	if (events.length > maxPoints) {
		const step = events.length / (maxPoints - 1);
		points = Array.from({ length: maxPoints - 1 }, (_, i) => events[Math.floor(i * step)]);
		points.push(events[events.length - 1]);
	}
	const prior = impliedOdds(outcomes.map((o) => ({ id: o.id, points: 0, picks: 0 })));
	return {
		market: { id: market.id, slug: market.slug, status: effectiveStatus(market) },
		outcomes: outcomes.map((o) => ({ id: o.id, label: o.label })),
		prior: { at: new Date(market.opens_at).toISOString(), odds: prior.outcomes.map((o) => ({ outcome_id: o.outcome_id, share: o.share, percent: o.percent })) },
		event_count: events.length,
		points,
	};
}

// ── picks ────────────────────────────────────────────────────────────────────

function assertPickable(market) {
	const status = effectiveStatus(market);
	if (status === 'open') return;
	if (status === 'draft') {
		throw new EventMarketError(409, 'market_not_open', `This market has not opened yet. Picks open at ${new Date(market.opens_at).toISOString()}.`, { opens_at: new Date(market.opens_at).toISOString() });
	}
	if (status === 'locked') {
		throw new EventMarketError(409, 'market_locked', `Picks closed at ${new Date(market.locks_at).toISOString()}. A pick can no longer be placed, changed or withdrawn on this market.`, { locks_at: new Date(market.locks_at).toISOString() });
	}
	throw new EventMarketError(409, 'market_closed', `This market is ${status}, so picks are closed.`, { status });
}

function checkPoints(points) {
	if (!Number.isInteger(points) || points < POINTS.minPick || points > POINTS.maxPickPerMarket) {
		throw new EventMarketError(400, 'invalid_points', `Points must be a whole number from ${POINTS.minPick} to ${POINTS.maxPickPerMarket} per market.`, { min: POINTS.minPick, max: POINTS.maxPickPerMarket });
	}
}

/**
 * Place or change an account's pick. One live pick per account per market;
 * changing replaces it. Rejected at and after locks_at (the database clock
 * decides, inside the same statement that writes).
 */
export async function placePick({ market: ref, accountId, outcomeId, points }) {
	checkPoints(points);
	const market = await marketRow(ref);
	if (!market) throw notFound();
	assertPickable(market);
	if (!UUID_RE.test(String(outcomeId))) {
		throw new EventMarketError(400, 'outcome_not_found', 'outcome_id must be the id of one of this market\'s outcomes.');
	}
	const { season, spent } = await seasonSpent(accountId, market.locks_at, market.id);
	const room = season.budget - spent;
	if (points > room) {
		throw new EventMarketError(409, 'budget_exceeded', `That would put ${spent + points} points on ${season.id} markets, over the ${season.budget}-point season budget. You have ${Math.max(0, room)} points left for this market. Withdraw a pick on another open market to free points.`, { season: season.id, season_budget: season.budget, committed_elsewhere: spent, remaining: Math.max(0, room) });
	}

	// Probability of the picked outcome just before this pick lands, excluding the
	// account's own earlier pick, so scoring rewards calling an upset.
	const tallyRows = (await outcomeRows([market.id])).get(market.id) || [];
	const [own] = await sql`select outcome_id, points from event_market_picks where market_id = ${market.id} and account_id = ${accountId} and agent_id is null and status = 'live'`;
	const before = impliedOdds(tallyRows.map((o) => ({
		id: o.id,
		points: o.points - (own && own.outcome_id === o.id ? own.points : 0),
		picks: o.picks - (own && own.outcome_id === o.id ? 1 : 0),
	})));
	const oddsAtPick = before.outcomes.find((o) => o.outcome_id === outcomeId)?.share ?? null;
	const { ranked } = await rankedStatusFor(accountId);

	const [row] = await sql`
		with prev as (
			select 1 from event_market_picks where market_id = ${market.id} and account_id = ${accountId} and agent_id is null
		), up as (
			insert into event_market_picks (market_id, outcome_id, account_id, points, status, odds_at_pick, ranked)
			select m.id, o.id, ${accountId}::uuid, ${points}::int, 'live', ${oddsAtPick}::numeric, ${ranked}::boolean
			  from event_markets m
			  join event_market_outcomes o on o.market_id = m.id and o.id = ${outcomeId}::uuid
			 where m.id = ${market.id}
			   and m.status = 'open' and m.opens_at <= now() and m.locks_at > now()
			   and ${spent}::int + ${points}::int <= ${season.budget}::int
			on conflict (market_id, account_id) where agent_id is null do update
			   set outcome_id = excluded.outcome_id, points = excluded.points,
			       odds_at_pick = excluded.odds_at_pick, ranked = excluded.ranked,
			       status = 'live', updated_at = now()
			returning market_id, outcome_id, account_id, points, status, created_at, updated_at
		), logged as (
			insert into event_market_pick_log (market_id, outcome_id, account_id, points, action)
			select market_id, outcome_id, account_id, points, case when exists (select 1 from prev) then 'change' else 'place' end
			  from up
		)
		select * from up`;

	if (!row) {
		// The market moved under us (locked, voided) or the outcome is foreign.
		const fresh = await marketRow(market.id);
		if (!fresh) throw notFound();
		assertPickable(fresh);
		throw new EventMarketError(400, 'outcome_not_found', 'outcome_id is not one of this market\'s outcomes.');
	}
	return {
		pick: { market_id: row.market_id, outcome_id: row.outcome_id, points: row.points, updated_at: new Date(row.updated_at).toISOString() },
		market: await getMarket(market.id, { viewer: accountId }),
	};
}

/** Withdraw an account's pick before lock, freeing its points. */
export async function withdrawPick({ market: ref, accountId }) {
	const market = await marketRow(ref);
	if (!market) throw notFound();
	assertPickable(market);
	const [row] = await sql`
		with del as (
			delete from event_market_picks p
			 using event_markets m
			 where p.market_id = ${market.id} and p.account_id = ${accountId} and p.agent_id is null
			   and m.id = p.market_id and m.status = 'open' and m.locks_at > now()
			returning p.market_id, p.outcome_id, p.account_id, p.points
		), logged as (
			insert into event_market_pick_log (market_id, outcome_id, account_id, points, action)
			select market_id, outcome_id, account_id, points, 'withdraw' from del
		)
		select * from del`;
	if (!row) {
		const fresh = await marketRow(market.id);
		if (fresh) assertPickable(fresh);
		throw new EventMarketError(404, 'pick_not_found', 'You have no pick on this market to withdraw.');
	}
	return { withdrawn: { market_id: row.market_id, outcome_id: row.outcome_id, points: row.points }, market: await getMarket(market.id, { viewer: accountId }) };
}

// ── admin writes ─────────────────────────────────────────────────────────────

function cleanOutcomes(outcomes, min = 2) {
	if (!Array.isArray(outcomes) || outcomes.length < min || outcomes.length > 64) {
		throw new EventMarketError(400, 'invalid_outcomes', min >= 2 ? 'A market needs between 2 and 64 outcomes.' : 'Send between 1 and 64 outcomes.');
	}
	const seen = new Set();
	return outcomes.map((o, i) => {
		const label = typeof o?.label === 'string' ? o.label.trim() : '';
		if (!label || label.length > 80) throw new EventMarketError(400, 'invalid_outcomes', `Outcome ${i + 1} needs a label of 1 to 80 characters.`);
		if (seen.has(label.toLowerCase())) throw new EventMarketError(400, 'invalid_outcomes', `Outcome label "${label}" appears twice.`);
		seen.add(label.toLowerCase());
		const refKind = o.ref_kind ?? null;
		const refId = o.ref_id == null ? null : String(o.ref_id);
		if ((refKind == null) !== (refId == null)) throw new EventMarketError(400, 'invalid_outcomes', `Outcome "${label}" needs ref_kind and ref_id together, or neither.`);
		if (refKind != null && !REF_KINDS.includes(refKind)) throw new EventMarketError(400, 'invalid_outcomes', `ref_kind must be one of ${REF_KINDS.join(', ')}.`);
		if (refId != null && refId.length > 128) throw new EventMarketError(400, 'invalid_outcomes', 'ref_id is too long.');
		const image = o.image_url == null ? null : String(o.image_url);
		if (image && (image.length > 500 || !/^https:\/\//i.test(image))) throw new EventMarketError(400, 'invalid_outcomes', `Outcome "${label}": image_url must be an https URL up to 500 characters.`);
		return { label, ref_kind: refKind, ref_id: refId, image_url: image, position: i };
	});
}

function isUniqueViolation(err) {
	return err?.code === '23505';
}

/**
 * Create a market with its outcomes in one statement. `status` is 'open'
 * (default) or 'draft'. With a source_ref the (source_kind, source_ref) pair is
 * unique, so an auto-opener can call this twice safely: it gets a 409 with the
 * existing slug.
 */
export async function createMarket(input) {
	const title = typeof input.title === 'string' ? input.title.trim() : '';
	if (title.length < 3 || title.length > 140) throw new EventMarketError(400, 'invalid_title', 'title must be 3 to 140 characters.');
	if (!SOURCE_KINDS.includes(input.source_kind)) throw new EventMarketError(400, 'invalid_source_kind', `source_kind must be one of ${SOURCE_KINDS.join(', ')}.`);
	const status = input.status ?? 'open';
	if (status !== 'open' && status !== 'draft') throw new EventMarketError(400, 'invalid_status', 'A new market starts as open or draft.');
	const slug = (input.slug ?? slugify(title)).toLowerCase();
	if (!SLUG_RE.test(slug)) throw new EventMarketError(400, 'invalid_slug', 'slug must be 3 to 80 characters of lowercase letters, digits and hyphens.');
	const opens = input.opens_at ? new Date(input.opens_at) : new Date();
	const locks = new Date(input.locks_at);
	const resolves = input.resolves_at ? new Date(input.resolves_at) : null;
	if (Number.isNaN(opens.getTime()) || Number.isNaN(locks.getTime()) || (resolves && Number.isNaN(resolves.getTime()))) {
		throw new EventMarketError(400, 'invalid_time', 'opens_at, locks_at and resolves_at must be ISO 8601 timestamps.');
	}
	if (locks <= opens) throw new EventMarketError(400, 'invalid_time', 'locks_at must be after opens_at.');
	if (locks.getTime() <= Date.now()) throw new EventMarketError(400, 'invalid_time', 'locks_at is already in the past, so nobody could pick.');
	if (resolves && resolves < locks) throw new EventMarketError(400, 'invalid_time', 'resolves_at must not be before locks_at.');
	const rule = input.resolution_rule ?? {};
	if (typeof rule !== 'object' || Array.isArray(rule) || JSON.stringify(rule).length > 4000) {
		throw new EventMarketError(400, 'invalid_resolution_rule', 'resolution_rule must be an object under 4 KB.');
	}
	const outcomes = cleanOutcomes(input.outcomes);

	try {
		const [row] = await sql`
			with m as (
				insert into event_markets (slug, title, description, source_kind, source_ref, status, opens_at, locks_at, resolves_at, resolution_rule, created_by)
				values (${slug}, ${title}, ${input.description ?? null}, ${input.source_kind}, ${input.source_ref ?? null}, ${status},
				        ${opens.toISOString()}::timestamptz, ${locks.toISOString()}::timestamptz, ${resolves ? resolves.toISOString() : null}::timestamptz,
				        ${JSON.stringify(rule)}::jsonb, ${input.created_by ?? null})
				returning id
			), o as (
				insert into event_market_outcomes (market_id, label, ref_kind, ref_id, image_url, position)
				select m.id, x.label, x.ref_kind, x.ref_id, x.image_url, x.position
				  from m, jsonb_to_recordset(${JSON.stringify(outcomes)}::jsonb)
				       as x(label text, ref_kind text, ref_id text, image_url text, position int)
			)
			select id from m`;
		return getMarket(row.id, { includeDraft: true });
	} catch (err) {
		if (isUniqueViolation(err)) {
			if (String(err.constraint || err.message).includes('source')) {
				const [dup] = await sql`select slug from event_markets where source_kind = ${input.source_kind} and source_ref = ${input.source_ref ?? null}`;
				throw new EventMarketError(409, 'market_exists_for_source', 'A market already exists for that source record.', { slug: dup?.slug ?? null });
			}
			throw new EventMarketError(409, 'slug_taken', `The slug "${slug}" is taken. Choose another.`, { slug });
		}
		throw err;
	}
}

/**
 * Edit a draft or open market. Times and text can change; a lock time may move
 * later or earlier but never into the past. Outcomes can be relabelled, added,
 * and (only in draft, with no picks) removed.
 */
export async function updateMarket(ref, patch) {
	const market = await marketRow(ref);
	if (!market) throw notFound();
	if (market.status !== 'draft' && market.status !== 'open') {
		throw new EventMarketError(409, 'market_not_editable', `A ${market.status} market can no longer be edited.`);
	}
	if (market.status === 'open' && new Date(market.locks_at) <= new Date()) {
		throw new EventMarketError(409, 'market_not_editable', 'This market has passed its lock time and can no longer be edited.');
	}
	const next = {
		title: patch.title ?? market.title,
		description: patch.description === undefined ? market.description : patch.description,
		opens_at: patch.opens_at ? new Date(patch.opens_at) : new Date(market.opens_at),
		locks_at: patch.locks_at ? new Date(patch.locks_at) : new Date(market.locks_at),
		resolves_at: patch.resolves_at === undefined ? (market.resolves_at ? new Date(market.resolves_at) : null) : (patch.resolves_at ? new Date(patch.resolves_at) : null),
		resolution_rule: patch.resolution_rule ?? market.resolution_rule,
	};
	if (typeof next.title !== 'string' || next.title.trim().length < 3 || next.title.length > 140) throw new EventMarketError(400, 'invalid_title', 'title must be 3 to 140 characters.');
	for (const k of ['opens_at', 'locks_at']) if (Number.isNaN(next[k].getTime())) throw new EventMarketError(400, 'invalid_time', `${k} must be an ISO 8601 timestamp.`);
	if (next.resolves_at && Number.isNaN(next.resolves_at.getTime())) throw new EventMarketError(400, 'invalid_time', 'resolves_at must be an ISO 8601 timestamp.');
	if (next.locks_at <= next.opens_at) throw new EventMarketError(400, 'invalid_time', 'locks_at must be after opens_at.');
	if (patch.locks_at && next.locks_at.getTime() <= Date.now()) throw new EventMarketError(400, 'invalid_time', 'locks_at is in the past. To close picks now, lock the market instead.');
	if (next.resolves_at && next.resolves_at < next.locks_at) throw new EventMarketError(400, 'invalid_time', 'resolves_at must not be before locks_at.');

	const existing = await outcomeRows([market.id]).then((m) => m.get(market.id) || []);
	const relabel = [];
	const add = [];
	if (Array.isArray(patch.outcomes)) {
		for (const o of patch.outcomes) {
			if (o?.id) {
				if (!existing.some((e) => e.id === o.id)) throw new EventMarketError(400, 'invalid_outcomes', `Outcome ${o.id} is not part of this market.`);
				relabel.push(o);
			} else add.push(o);
		}
	}
	const removeIds = patch.remove_outcome_ids ?? [];
	if (removeIds.length) {
		if (market.status !== 'draft') throw new EventMarketError(409, 'outcome_locked', 'Outcomes can only be removed while the market is a draft.');
		for (const id of removeIds) {
			const e = existing.find((x) => x.id === id);
			if (!e) throw new EventMarketError(400, 'invalid_outcomes', `Outcome ${id} is not part of this market.`);
			if (e.picks > 0) throw new EventMarketError(409, 'outcome_locked', `"${e.label}" already has picks and cannot be removed.`);
		}
		if (existing.length - removeIds.length + add.length < 2) throw new EventMarketError(400, 'invalid_outcomes', 'A market needs at least 2 outcomes.');
	}
	const cleanAdd = add.length ? cleanOutcomes(add, 1) : [];
	if (existing.length - removeIds.length + cleanAdd.length > 64) throw new EventMarketError(400, 'invalid_outcomes', 'A market can have at most 64 outcomes.');
	const labels = new Set(existing.filter((e) => !removeIds.includes(e.id) && !relabel.some((r) => r.id === e.id)).map((e) => e.label.toLowerCase()));
	for (const r of relabel) { if (r.label) labels.add(String(r.label).trim().toLowerCase()); }
	for (const a of cleanAdd) {
		if (labels.has(a.label.toLowerCase())) throw new EventMarketError(400, 'invalid_outcomes', `Outcome label "${a.label}" already exists.`);
		labels.add(a.label.toLowerCase());
	}

	try {
		await sql`
			update event_markets set title = ${next.title.trim()}, description = ${next.description ?? null},
			       opens_at = ${next.opens_at.toISOString()}::timestamptz, locks_at = ${next.locks_at.toISOString()}::timestamptz,
			       resolves_at = ${next.resolves_at ? next.resolves_at.toISOString() : null}::timestamptz,
			       resolution_rule = ${JSON.stringify(next.resolution_rule)}::jsonb, updated_at = now()
			 where id = ${market.id} and status in ('draft','open')`;
		for (const r of relabel) {
			await sql`
				update event_market_outcomes set label = coalesce(${r.label ?? null}, label), image_url = coalesce(${r.image_url ?? null}, image_url)
				 where id = ${r.id} and market_id = ${market.id}`;
		}
		if (removeIds.length) await sql`delete from event_market_outcomes where market_id = ${market.id} and id = any(${removeIds}::uuid[])`;
		if (cleanAdd.length) {
			await sql`
				insert into event_market_outcomes (market_id, label, ref_kind, ref_id, image_url, position)
				select ${market.id}::uuid, x.label, x.ref_kind, x.ref_id, x.image_url,
				       (select coalesce(max(position), -1) + 1 from event_market_outcomes where market_id = ${market.id}) + x.ord - 1
				  from jsonb_to_recordset(${JSON.stringify(cleanAdd.map((a, i) => ({ ...a, ord: i + 1 })))}::jsonb)
				       as x(label text, ref_kind text, ref_id text, image_url text, ord int)`;
		}
		if (patch.status === 'open' && market.status === 'draft') {
			await sql`update event_markets set status = 'open', updated_at = now() where id = ${market.id} and status = 'draft'`;
		}
	} catch (err) {
		if (isUniqueViolation(err)) throw new EventMarketError(409, 'outcome_conflict', 'An outcome label or position collides with an existing one.');
		throw err;
	}
	return getMarket(market.id, { includeDraft: true });
}

/** Close picks now. The market stays unresolved until a winner is called. */
export async function lockMarket(ref) {
	const market = await marketRow(ref);
	if (!market) throw notFound();
	const [row] = await sql`
		update event_markets set status = 'locked', locks_at = greatest(opens_at + interval '1 millisecond', least(locks_at, now())), updated_at = now()
		 where id = ${market.id} and status = 'open' returning id`;
	if (!row) {
		if (market.status === 'locked') return getMarket(market.id, { includeDraft: true });
		throw new EventMarketError(409, 'invalid_transition', `Only an open market can be locked; this one is ${market.status}.`);
	}
	return getMarket(market.id, { includeDraft: true });
}

/**
 * Void a market that has not resolved and refund every live pick: the pick
 * rows are marked refunded (their points stop counting against the season
 * budget) and a void entry per pick lands in the log, in one statement.
 */
export async function voidMarket(ref, reason = null) {
	const market = await marketRow(ref);
	if (!market) throw notFound();
	const note = reason ? String(reason).trim().slice(0, 280) : null;
	const [row] = await sql`
		with m as (
			update event_markets set status = 'void', void_reason = ${note}, resolved_at = now(), updated_at = now()
			 where id = ${market.id} and status in ('draft','open','locked') returning id
		), ref as (
			update event_market_picks p set status = 'refunded', updated_at = now()
			 where p.market_id in (select id from m) and p.status = 'live'
			returning p.market_id, p.outcome_id, p.account_id, p.points, p.agent_id
		), logged as (
			insert into event_market_pick_log (market_id, outcome_id, account_id, points, action)
			select market_id, outcome_id, account_id, points, 'void' from ref where agent_id is null
		)
		select (select count(*) from m)::int as voided,
		       (select count(*) from ref)::int as refunded_picks,
		       (select coalesce(sum(points), 0) from ref)::int as refunded_points`;
	if (!row.voided) throw new EventMarketError(409, 'invalid_transition', `A ${market.status} market cannot be voided.`);
	return { market: await getMarket(market.id, { includeDraft: true }), refunded_picks: row.refunded_picks, refunded_points: row.refunded_points };
}

/**
 * Call the winner. Allowed on an open or locked market (calling it closes
 * picks). Idempotent for the same winner; a different winner after resolution
 * is refused.
 */
export async function resolveMarket(ref, winnerOutcomeId) {
	const market = await marketRow(ref);
	if (!market) throw notFound();
	if (market.status === 'resolved' && market.winner_outcome_id === winnerOutcomeId) return getMarket(market.id, { includeDraft: true });
	if (!UUID_RE.test(String(winnerOutcomeId))) throw new EventMarketError(400, 'outcome_not_found', 'winner_outcome_id must be the id of one of this market\'s outcomes.');
	const [row] = await sql`
		update event_markets m set status = 'resolved', winner_outcome_id = ${winnerOutcomeId}::uuid, resolved_at = now(),
		       locks_at = greatest(m.opens_at + interval '1 millisecond', least(m.locks_at, now())), updated_at = now()
		 where m.id = ${market.id} and m.status in ('open','locked')
		   and exists (select 1 from event_market_outcomes o where o.id = ${winnerOutcomeId}::uuid and o.market_id = m.id)
		returning m.id`;
	if (!row) {
		if (market.status === 'resolved') throw new EventMarketError(409, 'already_resolved', 'This market is already resolved with a different winner.');
		if (market.status === 'draft' || market.status === 'void') throw new EventMarketError(409, 'invalid_transition', `A ${market.status} market cannot be resolved.`);
		throw new EventMarketError(400, 'outcome_not_found', 'winner_outcome_id is not one of this market\'s outcomes.');
	}
	return getMarket(market.id, { includeDraft: true });
}
