// Announcement drafter for Event Markets. Reads live market data and writes
// DRAFTS into event_market_announcements. It never posts: the only sender is
// poster.js, and it refuses anything not approved. Guide: docs/event-markets.md.
//
// Rules the text obeys (enforced by `lint`, not by hope):
//   - positive framing, no price promises, no other-coin mentions
//   - an entrant is tagged only with an X handle the entrant linked to their own
//     profile (agent_x_connections, or the owner's social_connections for a
//     wallet entrant). A handle is never scraped, guessed or typed in by us.
//     An entrant with no linked handle is named, not tagged.
//   - one announcement per kind per market (a table-level unique key)

import { sql } from '../db.js';
import { env } from '../env.js';
import { readFileSync } from 'node:fs';
import { languageProblems } from '../x-content/editorial.js';
import { weightedLength } from '../x-content/quality.js';
import { getMarket } from './index.js';
import { taggableEntrants } from './entrants.js';

export const CONFIG = JSON.parse(readFileSync(new URL('../../../data/event-markets-announcements.json', import.meta.url), 'utf8'));

/** The outcome ahead (by crowd share), or null on a dead heat, including no picks at all. */
export function leaderOf(market) {
	const sorted = [...market.outcomes].sort((x, y) => y.share - x.share);
	if (!sorted.length) return null;
	if (sorted.length > 1 && Math.abs(sorted[0].share - sorted[1].share) < 1e-9) return null;
	return sorted[0];
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const MAX_TAGS = 3;
const MAX_LEN = 280;

const origin = () => (env.PUBLIC_APP_ORIGIN || 'https://three.ws').replace(/\/$/, '');
export const marketUrl = (slug) => `${origin()}/event-markets/${slug}`;
export const cardUrl = (slug) => `${origin()}/api/event-market-og?slug=${encodeURIComponent(slug)}`;

const pct = (share) => `${Math.round(share * 100)}%`;
const hoursUntil = (iso, now) => Math.max(0, Math.round((new Date(iso) - now) / 3_600_000));

/**
 * Linked X handles for a market's outcomes, keyed by outcome id. Only a handle
 * the entrant connected to their own account through X OAuth qualifies: an
 * agent's own connection first, else its owner's. Entrants who opted out of
 * being tagged (event_market_entrant_prefs) are excluded by taggableEntrants.
 */
export async function linkedHandles(market) {
	const entrants = await taggableEntrants(market);
	const handles = new Map();
	for (const { outcome, accountId } of entrants) {
		let row;
		if (outcome.ref_kind === 'agent') {
			[row] = await sql`
				select username from agent_x_connections
				where agent_id::text = ${outcome.ref_id} and user_id = ${accountId} and disconnected_at is null limit 1
			`;
		}
		if (!row) {
			[row] = await sql`
				select username from social_connections
				where user_id = ${accountId} and provider = 'x' and disconnected_at is null limit 1
			`;
		}
		const handle = row?.username?.replace(/^@/, '');
		if (handle && HANDLE.test(handle)) handles.set(outcome.id, handle);
	}
	return handles;
}

const nameOf = (outcome, handles) => (handles.get(outcome.id) ? `@${handles.get(outcome.id)}` : outcome.label);

function entrantList(outcomes, handles, { limit = MAX_TAGS } = {}) {
	const tagged = outcomes.filter((o) => handles.has(o.id)).slice(0, limit);
	const taggedIds = new Set(tagged.map((o) => o.id));
	const untagged = outcomes.filter((o) => !taggedIds.has(o.id));
	return { tagged, untagged };
}

function join(names) {
	if (names.length <= 1) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Pure: build the text for one kind from already-loaded data. Tags are dropped
 * one at a time (last first) until the post fits, and the entrants named without
 * a tag fall back to a count, so a long field never overflows.
 *
 * ctx: { market (the getMarket view), handles:Map, now, baseline?, forecasters?:[] }
 */
export function buildDraft(kind, ctx) {
	const { market, handles, now = new Date() } = ctx;
	const outcomes = market.outcomes;
	const url = marketUrl(market.slug);
	const byId = new Map(outcomes.map((o) => [o.id, o]));
	const shareOf = (id) => byId.get(id)?.share ?? 0;

	const compose = (tagLimit) => {
		let text;
		let tags = [];
		if (kind === 'opened') {
			const { tagged, untagged } = entrantList(outcomes, handles, { limit: tagLimit });
			tags = tagged.map((o) => handles.get(o.id));
			const names = [...tagged.map((o) => nameOf(o, handles)), ...untagged.slice(0, 2).map((o) => o.label)];
			const more = outcomes.length - names.length;
			const field = more > 0 ? `${join(names)} and ${more} more` : join(names);
			text = `Picks are open on ${market.title}. ${field} ${outcomes.length === 2 ? 'are' : 'are all in the field'}. Free to play: back your call with points before it locks.\n${url}`;
		} else if (kind === 'locking_soon') {
			const lead = leaderOf(market);
			const hours = market.locks_at ? hoursUntil(market.locks_at, now) : null;
			const when = hours === null ? 'soon' : hours <= 1 ? 'within the hour' : `in ${hours} hours`;
			const leadTag = lead && handles.has(lead.id) && tagLimit > 0;
			if (leadTag) tags = [handles.get(lead.id)];
			const state = market.odds.even_prior
				? 'No picks have landed yet, so the field is an even split.'
				: lead
					? `${nameOf(byId.get(lead.id), leadTag ? handles : new Map())} leads at ${pct(lead.share)} of the crowd's points.`
					: 'The crowd is split evenly across the front of the field.';
			text = `Picks on ${market.title} lock ${when}. ${state} Make or change yours while it is open.\n${url}`;
		} else if (kind === 'odds_shift') {
			const lead = leaderOf(market);
			const leadO = lead && byId.get(lead.id);
			const leadTag = leadO && handles.has(leadO.id) && tagLimit > 0;
			if (leadTag) tags = [handles.get(leadO.id)];
			const from = ctx.baseline?.leader_id && ctx.baseline.leader_id !== lead?.id
				? ` after ${byId.get(ctx.baseline.leader_id)?.label ?? 'the previous favourite'} held the top spot`
				: '';
			text = `The crowd moved on ${market.title}. ${leadO ? `${nameOf(leadO, leadTag ? handles : new Map())} now leads at ${pct(lead.share)}` : 'The field is level'}${from}, from ${market.pick_count} picks so far. Still open.\n${url}`;
		} else if (kind === 'resolved') {
			const winner = byId.get(market.winner?.outcome_id);
			if (!winner) return null;
			const win = handles.has(winner.id) && tagLimit > 0;
			if (win) tags = [handles.get(winner.id)];
			const called = ctx.forecasters?.length ? ` First to call it: ${join(ctx.forecasters)}.` : '';
			text = `${win ? `@${handles.get(winner.id)}` : winner.label} won ${market.title}, ${pct(shareOf(winner.id))} of the crowd's points had it.${called} The result and its evidence are on the market page.\n${url}`;
		} else {
			throw new Error(`unknown announcement kind: ${kind}`);
		}
		return { text, tags };
	};

	for (let limit = MAX_TAGS; limit >= 0; limit--) {
		const out = compose(limit);
		if (!out) return null;
		if (weightedLength(out.text) <= MAX_LEN) return { ...out, card_url: cardUrl(market.slug) };
		if (limit === 0) {
			const short = out.text.replace(/ Free to play: back your call with points before it locks\./, '');
			if (weightedLength(short) <= MAX_LEN) return { text: short, tags: [], card_url: cardUrl(market.slug) };
			return null;
		}
	}
	return null;
}

/** House voice and compliance gate. Mention-count is waived: tagging is the point and a person approves it. */
export function lint(text) {
	return languageProblems(text).filter((p) => p.severity === 'blocking' && p.rule !== 'mentions');
}

/** Has the crowd moved enough since the market opened to be worth a post? */
export function oddsShifted(market, baseline, cfg = CONFIG) {
	if (market.pick_count < cfg.minPicksForOddsShift) return false;
	const lead = leaderOf(market);
	if (!lead) return false;
	if (baseline?.leader_id && baseline.leader_id !== lead.id) return true;
	const before = baseline?.shares?.[lead.id] ?? 1 / market.outcomes.length;
	return (lead.share - before) * 100 >= cfg.oddsShiftPoints;
}

async function loadMarketCtx(row) {
	const market = await getMarket(row.id);
	return { market, handles: await linkedHandles(market) };
}

const snapshot = (market) => ({
	leader_id: leaderOf(market)?.id ?? null,
	shares: Object.fromEntries(market.outcomes.map((o) => [o.id, o.share])),
});

async function topForecasters(market, n) {
	if (!market.winner?.outcome_id) return [];
	const rows = await sql`
		select coalesce(u.display_name, u.username) as name
		from event_market_picks p join users u on u.id = p.account_id
		where p.market_id = ${market.id} and p.outcome_id = ${market.winner?.outcome_id} and p.agent_id is null
		order by p.created_at asc, p.points desc limit ${n}
	`;
	return rows.map((r) => r.name).filter(Boolean);
}

/**
 * Scan lifecycle state and write a draft for every kind that is due and has no
 * announcement yet. Idempotent: the (market_id, kind) unique key makes a second
 * run a no-op. Returns what it wrote and what it skipped, with reasons.
 */
export async function draftPending({ now = new Date() } = {}) {
	const cfg = CONFIG;
	const markets = await sql`
		select m.* from event_markets m
		where m.status in ('open','locked','resolved')
		  and not (select count(*) = 4 from event_market_announcements a where a.market_id = m.id)
		order by m.created_at desc limit 200
	`;
	const written = [];
	const skipped = [];
	for (const m of markets) {
		const have = new Map((await sql`select kind, baseline from event_market_announcements where market_id = ${m.id}`).map((r) => [r.kind, r]));
		const due = [];
		if (m.status === 'open' || m.status === 'locked') if (!have.has('opened')) due.push('opened');
		if (m.status === 'open' && m.locks_at && !have.has('locking_soon')) {
			const ms = new Date(m.locks_at) - now;
			if (ms > 0 && ms <= cfg.lockingSoonHours * 3_600_000) due.push('locking_soon');
		}
		if (m.status === 'open' && have.has('opened') && !have.has('odds_shift')) due.push('odds_shift');
		if (m.status === 'resolved' && m.winner_outcome_id && !have.has('resolved')) due.push('resolved');
		if (!due.length) continue;

		const ctx = await loadMarketCtx(m);
		if (due.includes('resolved')) ctx.forecasters = await topForecasters(ctx.market, cfg.topForecasters);
		for (const kind of due) {
			ctx.baseline = have.get('opened')?.baseline;
			if (kind === 'odds_shift' && !oddsShifted(ctx.market, ctx.baseline, cfg)) continue;
			const draft = buildDraft(kind, { ...ctx, now });
			if (!draft) {
				skipped.push({ slug: m.slug, kind, reason: 'does not fit in one post' });
				continue;
			}
			const problems = lint(draft.text);
			if (problems.length) {
				skipped.push({ slug: m.slug, kind, reason: problems.map((p) => p.message).join('; ') });
				continue;
			}
			const rows = await sql`
				insert into event_market_announcements (market_id, kind, draft_text, card_url, tags, baseline)
				values (${m.id}, ${kind}, ${draft.text}, ${draft.card_url}, ${draft.tags}, ${JSON.stringify(snapshot(ctx.market))}::jsonb)
				on conflict (market_id, kind) do nothing returning id
			`;
			if (rows.length) written.push({ slug: m.slug, kind, id: rows[0].id, tags: draft.tags });
		}
	}
	return { written, skipped };
}
