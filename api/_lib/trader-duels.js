// Trader duels: a points-only skill-prediction game on head-to-head trader matchups.
// ---------------------------------------------------------------------------
// Roadmap 917 item 12.6, built free to play. Nobody deposits, stakes or wins
// anything of value: every user gets a daily allowance of duel points, points
// have no cash value, and they cannot be bought, sold, transferred or redeemed.
// No token, no escrow, no payout rail.
//
// The loop:
//
//   generate  /api/cron/duels-tick asks the rivalry engine (api/_lib/rivalries.js)
//             for the trader pairs that sit next to each other on the 30-day
//             board and opens a duel for each over the NEXT fixed UTC window: a
//             24-hour duel for tomorrow, and from Thursday a week-long duel for
//             the week starting Monday.
//   call      a signed-in user picks a side and stakes 10 to 100 points. One call
//             per user per duel, locked when the window starts, and never on a
//             duel involving an agent the caller owns. The insert itself enforces
//             all three, so a racing request cannot slip past a pre-check.
//   resolve   after the window closes (plus a grace period for late ledger
//             writes) the realized P&L each trader booked inside the window is
//             measured through computeTraderMetrics, the same math /trader/:id
//             shows, and the side that booked more wins.
//   settle    a correct call returns twice its stake and earns XP in the shared
//             quest ledger (trading_quest_completions, code 'duel:<market id>');
//             a wrong call keeps nothing; a void duel refunds every stake.
//
// Void rules (every stake refunded, no XP):
//   trader_unavailable  either trader went private or was deleted, at any point
//                       before the duel resolved
//   no_trades           neither trader closed a trade in the window
//   tie                 both booked exactly the same realized P&L
// A trader who closed nothing while the other did is scored as flat (0 SOL):
// sitting out beats losing, and loses to any profit.

import { sql } from './db.js';
import { getRivalries } from './rivalries.js';
import {
	computeTraderMetrics,
	fetchTraderPositions,
	selfDealMintsForUser,
	cachedSolUsd,
} from './trader-stats.js';
import { unlockBadge, listBadges, BADGES } from './streaks.js';
import { levelFor } from './trading-quests.js';
import { isUuid } from './validate.js';

// ── rules (every number the UI quotes comes from here) ──────────────────────

export const DUEL_RULES = Object.freeze({
	daily_allowance: 100,
	min_stake: 10,
	max_stake: 100,
	win_multiplier: 2,
	xp_per_win: 15,
	board_window: '30d',
	board_min_closed: 3,
	max_per_window: 3,
	resolve_grace_minutes: 15,
	week_open_lead_days: 4,
});

export const NETWORKS = new Set(['mainnet', 'devnet']);
export const PHASES = new Set(['open', 'live', 'settled', 'all']);
export const XP_CODE_PREFIX = 'duel:';

const DAY_MS = 86_400_000;
const GRACE_MS = DUEL_RULES.resolve_grace_minutes * 60_000;
const WEEK_LEAD_MS = DUEL_RULES.week_open_lead_days * DAY_MS;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));

export const DUEL_BADGES = Object.freeze([
	{ code: BADGES.DUEL_FIRST, how: 'Make your first call on a trader duel.' },
	{ code: BADGES.DUEL_HIT, how: 'Call a trader duel correctly.' },
	{ code: BADGES.DUEL_STREAK_3, how: 'Call three decided duels in a row correctly.' },
	{ code: BADGES.DUEL_SHARP, how: 'Be right on at least 70% of ten or more decided duels.' },
]);
const DUEL_BADGE_CODES = new Set(DUEL_BADGES.map((b) => b.code));

// ── windows (pure) ──────────────────────────────────────────────────────────

/** Start of the UTC day containing `now`, in ms. PURE. */
export function utcDayStart(now = Date.now()) {
	return Math.floor(ms(now) / DAY_MS) * DAY_MS;
}

/**
 * The next window of a kind that has not started yet. A day window is the next
 * UTC day; a week window runs Monday 00:00 UTC to the following Monday. PURE.
 * @returns {{start:number, end:number}}
 */
export function nextWindow(kind, now = Date.now()) {
	const today = utcDayStart(now);
	if (kind === 'day') return { start: today + DAY_MS, end: today + 2 * DAY_MS };
	if (kind !== 'week') throw new RangeError(`unknown window kind: ${kind}`);
	const dow = new Date(today).getUTCDay(); // 0 Sunday .. 6 Saturday
	const days = (8 - dow) % 7 || 7;
	const start = today + days * DAY_MS;
	return { start, end: start + 7 * DAY_MS };
}

/**
 * Whether the generator should open duels for a window yet. Day duels open as
 * soon as the previous day starts; week duels open once the week is at most
 * `week_open_lead_days` away, so a call is never parked for two weeks. PURE.
 */
export function windowOpensNow(kind, start, now = Date.now()) {
	const lead = ms(start) - ms(now);
	if (lead <= 0) return false;
	return kind === 'day' ? lead <= DAY_MS : lead <= WEEK_LEAD_MS;
}

/**
 * Where a duel is in its life. open: taking calls. live: window running, calls
 * locked. resolving: window closed, waiting for the grace period and the cron.
 * resolved / void: settled. PURE.
 */
export function duelPhase(market, now = Date.now()) {
	if (market.status === 'void') return 'void';
	if (market.status === 'resolved') return 'resolved';
	const t = ms(now);
	if (t < ms(market.window_start)) return 'open';
	if (t < ms(market.window_end)) return 'live';
	return 'resolving';
}

/** When the cron will resolve a duel, as ISO. PURE. */
export function resolvesAt(market) {
	return iso(ms(market.window_end) + GRACE_MS);
}

// ── market generation (pure) ────────────────────────────────────────────────

function sideSnapshot(t) {
	return {
		agent_id: t.agent_id,
		name: t.name || 'Unnamed trader',
		image: t.image || null,
		rank: t.rank ?? null,
		score: t.score ?? null,
		closed: t.closed ?? null,
		win_rate: t.win_rate ?? null,
		realized_pnl_sol: t.realized_pnl_sol ?? null,
	};
}

/**
 * Turn rivalry-engine matchups into duel specs. Each rivalry is a leader and
 * the trader directly below them on the board, which is the only pairing the
 * next settled trade can flip, so it is the pairing worth calling. Pairs with
 * an unavailable trader are skipped, and a pair is never opened twice. PURE.
 * @param {object[]} rivalries  getRivalries().rivalries
 * @param {{excluded?:Set<string>, max?:number}} [opts]
 */
export function planDuels(rivalries = [], { excluded = new Set(), max = DUEL_RULES.max_per_window } = {}) {
	const seen = new Set();
	const out = [];
	for (const r of rivalries || []) {
		const a = r?.leader;
		const b = r?.chaser;
		if (!a?.agent_id || !b?.agent_id || a.agent_id === b.agent_id) continue;
		if (excluded.has(a.agent_id) || excluded.has(b.agent_id)) continue;
		const key = [a.agent_id, b.agent_id].sort().join(':');
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			a: sideSnapshot(a),
			b: sideSnapshot(b),
			context: {
				headline: r.headline || null,
				subline: r.subline || null,
				rivalry: r.kind || null,
				board_window: r.window || DUEL_RULES.board_window,
				a: sideSnapshot(a),
				b: sideSnapshot(b),
			},
		});
		if (out.length >= max) break;
	}
	return out;
}

// ── resolution + settlement (pure) ──────────────────────────────────────────

function lamports(v) {
	try {
		return BigInt(String(v ?? '0').split('.')[0] || '0');
	} catch {
		return 0n;
	}
}

/**
 * Decide a duel from each side's measured window. PURE.
 * @param {{a:{eligible:boolean, closed:number, pnl_lamports:string|number}, b:{...}}} sides
 * @returns {{status:'resolved'|'void', winner:'a'|'b'|null, void_reason:string|null}}
 */
export function decideDuel({ a, b } = {}) {
	if (!a?.eligible || !b?.eligible) return { status: 'void', winner: null, void_reason: 'trader_unavailable' };
	const ca = n(a.closed);
	const cb = n(b.closed);
	if (ca === 0 && cb === 0) return { status: 'void', winner: null, void_reason: 'no_trades' };
	const pa = ca ? lamports(a.pnl_lamports) : 0n;
	const pb = cb ? lamports(b.pnl_lamports) : 0n;
	if (pa === pb) return { status: 'void', winner: null, void_reason: 'tie' };
	return { status: 'resolved', winner: pa > pb ? 'a' : 'b', void_reason: null };
}

/**
 * What one call is worth once its duel settles. Mirrors the settlement SQL in
 * settleDuelPicks exactly; the tests pin both to the same table. PURE.
 */
export function settleCall(pick, market) {
	const stake = n(pick.stake);
	if (market.status === 'void') return { status: 'refunded', payout: stake };
	if (market.status !== 'resolved') return { status: 'open', payout: 0 };
	if (pick.side === market.winner) return { status: 'won', payout: stake * DUEL_RULES.win_multiplier };
	return { status: 'lost', payout: 0 };
}

/**
 * Validate a call's shape and stake against a balance. PURE.
 * @returns {{ok:true, side:'a'|'b', stake:number} | {ok:false, code:string, message:string}}
 */
export function validateCall({ side, stake, balance = null } = {}) {
	if (side !== 'a' && side !== 'b') return { ok: false, code: 'invalid_side', message: 'side must be "a" or "b".' };
	const s = Number(stake);
	if (!Number.isInteger(s) || s < DUEL_RULES.min_stake || s > DUEL_RULES.max_stake) {
		return {
			ok: false,
			code: 'invalid_stake',
			message: `Stake a whole number of points from ${DUEL_RULES.min_stake} to ${DUEL_RULES.max_stake}.`,
		};
	}
	if (balance != null && s > n(balance)) {
		return { ok: false, code: 'not_enough_points', message: `You have ${n(balance)} points. Your free allowance tops up at 00:00 UTC.` };
	}
	return { ok: true, side, stake: s };
}

/**
 * Which duel badges a call history has earned. Refunds never count toward a
 * streak or accuracy: a void duel was not a call that was right or wrong. PURE.
 * @param {{status:string, settled_at?:string|null, created_at?:string}[]} picks
 */
export function duelBadgesFor(picks = []) {
	const earned = [];
	if (!picks.length) return earned;
	earned.push(BADGES.DUEL_FIRST);
	const decided = picks
		.filter((p) => p.status === 'won' || p.status === 'lost')
		.sort((x, y) => ms(x.settled_at || x.created_at) - ms(y.settled_at || y.created_at));
	const wins = decided.filter((p) => p.status === 'won').length;
	if (wins > 0) earned.push(BADGES.DUEL_HIT);
	let run = 0;
	let best = 0;
	for (const p of decided) {
		run = p.status === 'won' ? run + 1 : 0;
		if (run > best) best = run;
	}
	if (best >= 3) earned.push(BADGES.DUEL_STREAK_3);
	if (decided.length >= 10 && wins / decided.length >= 0.7) earned.push(BADGES.DUEL_SHARP);
	return earned;
}

// ── seasons (pure) ──────────────────────────────────────────────────────────

const SEASON_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A season is a UTC calendar month. PURE. */
export function seasonFor(now = Date.now()) {
	const d = new Date(ms(now));
	return seasonById(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
}

/** Parse 'YYYY-MM' into season bounds, or null. PURE. */
export function seasonById(id) {
	const m = SEASON_RE.exec(String(id || ''));
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]) - 1;
	const start = Date.UTC(y, mo, 1);
	const end = Date.UTC(y, mo + 1, 1);
	const label = new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
	return { id: m[0], label, start: iso(start), end: iso(end) };
}

/** Net points a settled call made or lost. PURE. */
export function callNet(pick) {
	if (pick.status === 'won') return n(pick.payout) - n(pick.stake);
	if (pick.status === 'lost') return -n(pick.stake);
	return 0;
}

// ── points wallet ───────────────────────────────────────────────────────────

/**
 * Credit today's free allowance if it has not been credited yet, in one
 * statement: the grant row and the balance move together or not at all.
 * @returns {Promise<{balance:number, granted:boolean}>}
 */
export async function ensureDailyGrant(userId, now = Date.now()) {
	const day = iso(utcDayStart(now)).slice(0, 10);
	const rows = await sql`
		with g as (
			insert into duel_points_ledger (user_id, kind, amount, day)
			values (${userId}, 'grant', ${DUEL_RULES.daily_allowance}, ${day}::date)
			on conflict do nothing
			returning amount
		)
		insert into duel_wallets (user_id, balance)
		select ${userId}::uuid, amount from g
		on conflict (user_id) do update set balance = duel_wallets.balance + excluded.balance, updated_at = now()
		returning balance
	`;
	if (rows.length) return { balance: n(rows[0].balance), granted: true };
	const [w] = await sql`select balance from duel_wallets where user_id = ${userId}`;
	return { balance: n(w?.balance), granted: false };
}

// ── measuring a window ──────────────────────────────────────────────────────

/** Round-trips an agent closed inside [start, end), from both real ledgers. */
async function closedInWindow(agentId, network, start, end) {
	const [sniper, strategy] = await Promise.all([
		sql`
			select p.id, p.agent_id, p.mint, p.symbol, p.name, p.status,
			       p.entry_quote_lamports, p.exit_quote_lamports, p.last_value_lamports,
			       p.realized_pnl_lamports, p.realized_pnl_pct, p.buy_sig, p.sell_sig,
			       p.opened_at, p.closed_at, p.moonbag_base_amount, p.moonbag_last_value_lamports
			from agent_sniper_positions p
			where p.agent_id = ${agentId} and p.network = ${network} and p.status = 'closed'
			  and p.closed_at >= ${start} and p.closed_at < ${end}
		`,
		sql`
			select s.id, s.agent_id, s.mint, s.symbol, s.name, s.status,
			       s.entry_lamports as entry_quote_lamports, s.exit_lamports as exit_quote_lamports,
			       s.last_value_lamports, s.realized_pnl_lamports, s.realized_pnl_pct,
			       s.entry_sig as buy_sig, s.exit_sig as sell_sig, s.opened_at, s.closed_at
			from agent_strategy_positions s
			where s.agent_id = ${agentId} and s.network = ${network} and s.status = 'closed'
			  and s.closed_at >= ${start} and s.closed_at < ${end}
		`.catch(() => []), // Strategy Objects table not migrated: the sniper ledger stands alone, as on /trader/:id
	]);
	return strategy.length ? [...sniper, ...strategy] : sniper;
}

/**
 * One trader's realized result inside a window, through the same pure
 * computeTraderMetrics the trader card uses, including its exclusion of
 * round-trips on the trader's own coins.
 */
export async function measureWindow({ agentId, ownerUserId, network, start, end }) {
	const [positions, selfDealMints] = await Promise.all([
		closedInWindow(agentId, network, start, end),
		selfDealMintsForUser(ownerUserId, network),
	]);
	const m = computeTraderMetrics(positions, { selfDealMints });
	return {
		closed: m.closed_count,
		wins: m.wins,
		pnl_lamports: m.realized_pnl_lamports,
		pnl_sol: m.realized_pnl_sol,
		self_dealing_count: m.self_dealing_count,
	};
}

/** The 30-day record a duel card shows for each trader, the same numbers /trader/:id shows for 30d. */
async function trailingRecord({ agentId, ownerUserId, network, now }) {
	const [positions, selfDealMints, solUsd] = await Promise.all([
		fetchTraderPositions({ agentId, network, window: DUEL_RULES.board_window, now }),
		selfDealMintsForUser(ownerUserId, network),
		cachedSolUsd(),
	]);
	const m = computeTraderMetrics(positions, { solUsd, selfDealMints });
	return {
		window: DUEL_RULES.board_window,
		closed: m.closed_count,
		wins: m.wins,
		win_rate: m.win_rate,
		realized_pnl_sol: m.realized_pnl_sol,
		realized_pnl_usd: m.realized_pnl_usd,
		score: m.score,
		verified: m.verified,
		open_positions: m.open_count,
		pnl_series: m.pnl_series,
		last_active_at: m.last_active_at,
	};
}

// ── agents ──────────────────────────────────────────────────────────────────

async function agentRows(ids) {
	const list = ids.filter((id) => isUuid(id));
	if (!list.length) return new Map();
	const rows = await sql`
		select id, user_id, name, is_public, deleted_at, profile_image_url, avatar_url
		from agent_identities where id = any(${list}::uuid[])
	`;
	return new Map(rows.map((r) => [r.id, r]));
}

const available = (row) => !!row && row.deleted_at == null && row.is_public !== false;

// ── generation, resolution, settlement (the cron) ───────────────────────────

/** Open duels for every window that should be taking calls and has none yet. */
export async function generateDuels({ network = 'mainnet', now = Date.now() } = {}) {
	const created = [];
	let rivalries = null;
	for (const kind of ['day', 'week']) {
		const w = nextWindow(kind, now);
		if (!windowOpensNow(kind, w.start, now)) continue;
		const [existing] = await sql`
			select count(*)::int as c from duel_markets
			where network = ${network} and window_kind = ${kind} and window_start = ${iso(w.start)}
		`;
		if (n(existing?.c) > 0) continue;
		if (!rivalries) {
			const board = await getRivalries({ network, window: DUEL_RULES.board_window, lookback: '7d', limit: 12, now });
			rivalries = board.rivalries || [];
		}
		const ids = [...new Set(rivalries.flatMap((r) => [r.leader?.agent_id, r.chaser?.agent_id]).filter(Boolean))];
		const agents = await agentRows(ids);
		const excluded = new Set(ids.filter((id) => !available(agents.get(id))));
		for (const p of planDuels(rivalries, { excluded })) {
			const [row] = await sql`
				insert into duel_markets (network, window_kind, window_start, window_end, agent_a, agent_b, agent_a_name, agent_b_name, context)
				values (${network}, ${kind}, ${iso(w.start)}, ${iso(w.end)}, ${p.a.agent_id}, ${p.b.agent_id},
				        ${p.a.name}, ${p.b.name}, ${JSON.stringify(p.context)}::jsonb)
				on conflict do nothing
				returning id
			`;
			if (row) created.push({ id: row.id, kind, a: p.a.name, b: p.b.name });
		}
	}
	return created;
}

/**
 * Settle every open call on a resolved or void duel, in one statement: the
 * pick status, the ledger row and the balance move together. Idempotent: an
 * already-settled pick is skipped, and the ledger's unique index refuses a
 * second payout even if the statement is replayed.
 */
export async function settleDuelPicks(marketId) {
	await sql`
		with m as (
			select id, status, winner from duel_markets where id = ${marketId} and status in ('resolved','void')
		),
		p as (
			update duel_picks k set
				status = case when m.status = 'void' then 'refunded' when k.side = m.winner then 'won' else 'lost' end,
				payout = case when m.status = 'void' then k.stake when k.side = m.winner then k.stake * ${DUEL_RULES.win_multiplier} else 0 end,
				settled_at = now()
			from m
			where k.market_id = m.id and k.status = 'open'
			returning k.user_id, k.status, k.payout, k.market_id
		),
		led as (
			insert into duel_points_ledger (user_id, kind, amount, market_id)
			select user_id, case when status = 'won' then 'payout' else 'refund' end, payout, market_id
			from p where payout > 0
			on conflict do nothing
			returning user_id, amount
		)
		update duel_wallets w set balance = w.balance + led.amount, updated_at = now()
		from led where w.user_id = led.user_id
	`;
	await creditDuelXp([marketId]);
	const winners = await sql`select distinct user_id from duel_picks where market_id = ${marketId} and status in ('won','lost')`;
	for (const w of winners) await refreshDuelBadges(w.user_id);
}

/** XP for correct calls, into the shared quest ledger. Insert-only and idempotent. */
async function creditDuelXp(marketIds) {
	if (!marketIds.length) return;
	await sql`
		insert into trading_quest_completions (user_id, day, code, xp)
		select k.user_id, (m.resolved_at at time zone 'UTC')::date, ${XP_CODE_PREFIX}::text || m.id::text, ${DUEL_RULES.xp_per_win}::int
		from duel_picks k join duel_markets m on m.id = k.market_id
		where k.market_id = any(${marketIds}::uuid[]) and k.status = 'won' and m.status = 'resolved'
		on conflict do nothing
	`;
}

/** Measure, decide, flip the market once, then settle its calls. */
export async function resolveDuel(market, { now = Date.now() } = {}) {
	const agents = await agentRows([market.agent_a, market.agent_b]);
	const ra = agents.get(market.agent_a);
	const rb = agents.get(market.agent_b);
	const eligibleA = available(ra);
	const eligibleB = available(rb);
	const early = ms(now) < ms(market.window_end);

	let result = null;
	let outcome;
	if (!eligibleA || !eligibleB) {
		outcome = decideDuel({ a: { eligible: eligibleA }, b: { eligible: eligibleB } });
		result = { unavailable: [!eligibleA && 'a', !eligibleB && 'b'].filter(Boolean), measured_at: iso(ms(now)) };
	} else {
		if (early) return null; // only an unavailable trader can end a duel before its window closes
		const start = iso(ms(market.window_start));
		const end = iso(ms(market.window_end));
		const [ma, mb] = await Promise.all([
			measureWindow({ agentId: market.agent_a, ownerUserId: ra.user_id, network: market.network, start, end }),
			measureWindow({ agentId: market.agent_b, ownerUserId: rb.user_id, network: market.network, start, end }),
		]);
		outcome = decideDuel({ a: { eligible: true, ...ma }, b: { eligible: true, ...mb } });
		result = { a: ma, b: mb, measured_at: iso(ms(now)) };
	}

	const [flipped] = await sql`
		update duel_markets set
			status = ${outcome.status}, winner = ${outcome.winner}, void_reason = ${outcome.void_reason},
			result = ${JSON.stringify(result)}::jsonb, resolved_at = now()
		where id = ${market.id} and status = 'open'
		returning id
	`;
	if (!flipped) return null; // a concurrent tick got there first
	await settleDuelPicks(market.id);
	return { id: market.id, ...outcome };
}

/**
 * One cron tick: void duels whose trader went private or was deleted, resolve
 * duels whose window closed more than the grace period ago, settle any call a
 * crashed tick left open, then open duels for the next windows.
 */
export async function runDuelsTick({ network = 'mainnet', now = Date.now() } = {}) {
	const unavailable = await sql`
		select m.* from duel_markets m
		where m.status = 'open' and m.network = ${network}
		  and (m.agent_a is null or m.agent_b is null or exists (
		      select 1 from agent_identities a
		      where a.id in (m.agent_a, m.agent_b) and (a.deleted_at is not null or a.is_public = false)
		  ))
		limit 50
	`;
	const voided = [];
	for (const m of unavailable) {
		const r = await resolveDuel(m, { now });
		if (r) voided.push(r);
	}

	const due = await sql`
		select * from duel_markets
		where status = 'open' and network = ${network} and window_end <= ${iso(ms(now) - GRACE_MS)}
		order by window_end asc limit 25
	`;
	const resolved = [];
	for (const m of due) {
		const r = await resolveDuel(m, { now });
		if (r) resolved.push(r);
	}

	const stranded = await sql`
		select distinct k.market_id from duel_picks k join duel_markets m on m.id = k.market_id
		where k.status = 'open' and m.status in ('resolved','void') and m.network = ${network}
		limit 50
	`;
	for (const s of stranded) await settleDuelPicks(s.market_id);
	// A tick that died between the pick settlement and the XP insert is repaired here.
	const recent = await sql`
		select id from duel_markets
		where status = 'resolved' and network = ${network} and resolved_at > ${iso(ms(now) - 3 * DAY_MS)}
	`;
	await creditDuelXp(recent.map((r) => r.id));

	const generated = await generateDuels({ network, now });
	return { network, voided, resolved, repaired: stranded.length, generated };
}

// ── badges ──────────────────────────────────────────────────────────────────

/** Award every duel badge a user's history has earned. Returns the newly unlocked codes. */
export async function refreshDuelBadges(userId) {
	const picks = await sql`
		select status, settled_at, created_at from duel_picks where user_id = ${userId}
	`;
	const fresh = [];
	for (const code of duelBadgesFor(picks)) {
		if (await unlockBadge(userId, code)) fresh.push(code);
	}
	return fresh;
}

// ── reads ───────────────────────────────────────────────────────────────────

function sideView(market, key, agent) {
	const id = market[`agent_${key}`];
	const snap = market.context?.[key] || {};
	return {
		agent_id: id,
		name: agent?.name || market[`agent_${key}_name`],
		image: agent?.profile_image_url || agent?.avatar_url || snap.image || null,
		available: available(agent),
		links: id
			? { trader: `/trader/${id}`, trade_room: `/trade-rooms/${id}` }
			: null,
		board: {
			rank: snap.rank ?? null,
			score: snap.score ?? null,
			closed: snap.closed ?? null,
			win_rate: snap.win_rate ?? null,
			realized_pnl_sol: snap.realized_pnl_sol ?? null,
		},
	};
}

function marketView(row, now, agents) {
	const phase = duelPhase(row, now);
	return {
		id: row.id,
		url: `/duels/${row.id}`,
		network: row.network,
		window_kind: row.window_kind,
		window_start: iso(ms(row.window_start)),
		window_end: iso(ms(row.window_end)),
		resolves_at: resolvesAt(row),
		phase,
		status: row.status,
		winner: row.winner || null,
		void_reason: row.void_reason || null,
		result: row.result || null,
		resolved_at: row.resolved_at ? iso(ms(row.resolved_at)) : null,
		headline: row.context?.headline || null,
		subline: row.context?.subline || null,
		a: sideView(row, 'a', agents.get(row.agent_a)),
		b: sideView(row, 'b', agents.get(row.agent_b)),
		crowd: {
			a: { calls: n(row.calls_a), points: n(row.points_a) },
			b: { calls: n(row.calls_b), points: n(row.points_b) },
		},
		my_call: row.my_side
			? { side: row.my_side, stake: n(row.my_stake), status: row.my_status, payout: n(row.my_payout) }
			: null,
	};
}

/** Count of traders currently eligible to be paired, for the empty state. */
export async function eligibleTraderCount({ network = 'mainnet', now = Date.now() } = {}) {
	const since = iso(ms(now) - 30 * DAY_MS);
	const [row] = await sql`
		select count(*)::int as c from (
			select x.agent_id from (
				select agent_id from agent_sniper_positions
				where network = ${network} and status = 'closed' and closed_at >= ${since}
			) x
			join agent_identities a on a.id = x.agent_id
			where a.is_public is not false and a.deleted_at is null
			group by x.agent_id
			having count(*) >= ${DUEL_RULES.board_min_closed}
		) t
	`;
	return n(row?.c);
}

/**
 * Duels for the board. `phase`: open (taking calls), live (window running or
 * awaiting resolution), settled (resolved or void), all. `agentId` narrows to
 * duels featuring one trader. `userId` attaches the viewer's own call.
 */
export async function listDuels({ network = 'mainnet', phase = 'all', agentId = null, userId = null, limit = 30, now = Date.now() } = {}) {
	const t = iso(ms(now));
	const phaseSql =
		phase === 'open' ? sql`and m.status = 'open' and m.window_start > ${t}`
		: phase === 'live' ? sql`and m.status = 'open' and m.window_start <= ${t}`
		: phase === 'settled' ? sql`and m.status in ('resolved','void')`
		: sql``;
	const agentSql = agentId ? sql`and (m.agent_a = ${agentId} or m.agent_b = ${agentId})` : sql``;
	const orderSql =
		phase === 'settled' ? sql`order by m.resolved_at desc nulls last`
		: phase === 'live' ? sql`order by m.window_end asc`
		: phase === 'open' ? sql`order by m.window_start asc, m.created_at asc`
		: sql`order by (m.status = 'open') desc, m.window_start desc`;
	const rows = await sql`
		select m.*, c.calls_a, c.calls_b, c.points_a, c.points_b,
		       mine.side as my_side, mine.stake as my_stake, mine.status as my_status, mine.payout as my_payout
		from duel_markets m
		left join lateral (
			select count(*) filter (where side = 'a') as calls_a,
			       count(*) filter (where side = 'b') as calls_b,
			       coalesce(sum(stake) filter (where side = 'a'), 0) as points_a,
			       coalesce(sum(stake) filter (where side = 'b'), 0) as points_b
			from duel_picks where market_id = m.id
		) c on true
		left join duel_picks mine on mine.market_id = m.id and mine.user_id = ${userId}
		where m.network = ${network} ${phaseSql} ${agentSql}
		${orderSql}
		limit ${limit}
	`;
	const agents = await agentRows([...new Set(rows.flatMap((r) => [r.agent_a, r.agent_b]).filter(Boolean))]);
	return rows.map((r) => marketView(r, now, agents));
}

/** Tab counts for the board. */
export async function duelCounts({ network = 'mainnet', now = Date.now() } = {}) {
	const t = iso(ms(now));
	const [row] = await sql`
		select count(*) filter (where status = 'open' and window_start > ${t})::int as open,
		       count(*) filter (where status = 'open' and window_start <= ${t})::int as live,
		       count(*) filter (where status in ('resolved','void'))::int as settled
		from duel_markets where network = ${network}
	`;
	return { open: n(row?.open), live: n(row?.live), settled: n(row?.settled) };
}

/**
 * One duel with everything its page needs: both traders' 30-day records, the
 * in-window standing (live while running, final once resolved), the crowd, and
 * whether the viewer can call it.
 */
export async function getDuel(id, { userId = null, now = Date.now() } = {}) {
	if (!isUuid(id)) return null;
	const [market] = await listDuelRows(id, userId);
	if (!market) return null;
	const agents = await agentRows([market.agent_a, market.agent_b].filter(Boolean));
	const view = marketView(market, now, agents);
	const ra = agents.get(market.agent_a);
	const rb = agents.get(market.agent_b);

	const [recA, recB] = await Promise.all([
		available(ra) ? trailingRecord({ agentId: ra.id, ownerUserId: ra.user_id, network: market.network, now }) : null,
		available(rb) ? trailingRecord({ agentId: rb.id, ownerUserId: rb.user_id, network: market.network, now }) : null,
	]);
	view.a.record = recA;
	view.b.record = recB;

	if (view.phase === 'live' || view.phase === 'resolving') {
		const start = view.window_start;
		const end = view.phase === 'live' ? iso(ms(now)) : view.window_end;
		const [sa, sb] = await Promise.all([
			available(ra) ? measureWindow({ agentId: ra.id, ownerUserId: ra.user_id, network: market.network, start, end }) : null,
			available(rb) ? measureWindow({ agentId: rb.id, ownerUserId: rb.user_id, network: market.network, start, end }) : null,
		]);
		const leading = sa && sb ? decideDuel({ a: { eligible: true, ...sa }, b: { eligible: true, ...sb } }) : null;
		view.standing = { a: sa, b: sb, as_of: end, leading: leading?.winner || null, state: leading?.void_reason || null };
	} else if (view.phase === 'resolved' || view.phase === 'void') {
		view.standing = market.result?.a ? { a: market.result.a, b: market.result.b, as_of: view.window_end, final: true } : null;
	} else {
		view.standing = null;
	}

	const owns = userId ? [ra, rb].some((a) => a && a.user_id === userId) : false;
	view.viewer = {
		signed_in: !!userId,
		owns_a_trader: owns,
		can_call: !!userId && view.phase === 'open' && !owns && !view.my_call && view.a.available && view.b.available,
	};
	return view;
}

async function listDuelRows(id, userId) {
	return sql`
		select m.*, c.calls_a, c.calls_b, c.points_a, c.points_b,
		       mine.side as my_side, mine.stake as my_stake, mine.status as my_status, mine.payout as my_payout
		from duel_markets m
		left join lateral (
			select count(*) filter (where side = 'a') as calls_a,
			       count(*) filter (where side = 'b') as calls_b,
			       coalesce(sum(stake) filter (where side = 'a'), 0) as points_a,
			       coalesce(sum(stake) filter (where side = 'b'), 0) as points_b
			from duel_picks where market_id = m.id
		) c on true
		left join duel_picks mine on mine.market_id = m.id and mine.user_id = ${userId}
		where m.id = ${id}
		limit 1
	`;
}

// ── making a call ───────────────────────────────────────────────────────────

const PG_UNIQUE = '23505';
const PG_CHECK = '23514';

/**
 * Place one call. Every rule is checked up front for a clear message, then
 * enforced again inside the single insert statement, so a race can only ever
 * be refused, never slip through: the unique index allows one call per user
 * per duel, the window_start comparison uses the database clock, the owner and
 * availability checks run inside the insert, and the wallet's check
 * constraint refuses an overdraft.
 * @returns {Promise<{ok:true, call:object, balance:number} | {ok:false, status:number, code:string, message:string}>}
 */
export async function placeCall({ userId, marketId, side, stake, now = Date.now() }) {
	const shape = validateCall({ side, stake });
	if (!shape.ok) return { ok: false, status: 400, code: shape.code, message: shape.message };
	if (!isUuid(marketId)) return { ok: false, status: 404, code: 'not_found', message: 'No such duel.' };

	const [market] = await sql`select * from duel_markets where id = ${marketId}`;
	if (!market) return { ok: false, status: 404, code: 'not_found', message: 'No such duel.' };
	if (duelPhase(market, now) !== 'open') {
		return { ok: false, status: 409, code: 'duel_locked', message: 'Calls locked when this duel\'s window started.' };
	}
	const agents = await agentRows([market.agent_a, market.agent_b].filter(Boolean));
	const ra = agents.get(market.agent_a);
	const rb = agents.get(market.agent_b);
	if ((ra && ra.user_id === userId) || (rb && rb.user_id === userId)) {
		return { ok: false, status: 403, code: 'own_agent', message: 'You own one of these traders, so you cannot call this duel.' };
	}
	if (!available(ra) || !available(rb)) {
		return { ok: false, status: 409, code: 'duel_unavailable', message: 'One of these traders is no longer public. This duel will be voided and every call refunded.' };
	}

	const wallet = await ensureDailyGrant(userId, now);
	const funded = validateCall({ side, stake, balance: wallet.balance });
	if (!funded.ok) return { ok: false, status: 409, code: funded.code, message: funded.message };

	let rows;
	try {
		rows = await sql`
			with pick as (
				insert into duel_picks (market_id, user_id, side, stake)
				select m.id, ${userId}::uuid, ${funded.side}::text, ${funded.stake}::int
				from duel_markets m
				join duel_wallets w on w.user_id = ${userId}
				where m.id = ${marketId} and m.status = 'open' and m.window_start > now()
				  and m.agent_a is not null and m.agent_b is not null
				  and not exists (
				      select 1 from agent_identities a
				      where a.id in (m.agent_a, m.agent_b)
				        and (a.user_id = ${userId} or a.deleted_at is not null or a.is_public = false)
				  )
				returning id, market_id, side, stake, created_at
			),
			debit as (
				update duel_wallets w set balance = w.balance - pick.stake, updated_at = now()
				from pick where w.user_id = ${userId}
				returning w.balance
			),
			led as (
				insert into duel_points_ledger (user_id, kind, amount, market_id)
				select ${userId}::uuid, 'stake', -stake, market_id from pick
				returning id
			)
			select pick.id, pick.side, pick.stake, pick.created_at, (select balance from debit) as balance from pick
		`;
	} catch (err) {
		if (err?.code === PG_UNIQUE) return { ok: false, status: 409, code: 'already_called', message: 'You already made your call on this duel.' };
		if (err?.code === PG_CHECK) return { ok: false, status: 409, code: 'not_enough_points', message: 'Not enough points for that stake. Your free allowance tops up at 00:00 UTC.' };
		throw err;
	}
	if (!rows.length) {
		return { ok: false, status: 409, code: 'duel_locked', message: 'This duel is no longer taking calls.' };
	}
	await unlockBadge(userId, BADGES.DUEL_FIRST);
	const row = rows[0];
	return {
		ok: true,
		call: { id: String(row.id), market_id: marketId, side: row.side, stake: n(row.stake), status: 'open', created_at: row.created_at },
		balance: n(row.balance),
	};
}

// ── the predictor ───────────────────────────────────────────────────────────

/** A season's predictor board: net points from decided calls on duels resolved in the season. */
export async function seasonLeaderboard({ season = seasonFor(), limit = 25, userId = null } = {}) {
	const rows = await sql`
		with s as (
			select k.user_id,
			       sum(case when k.status = 'won' then k.payout - k.stake else -k.stake end)::int as net,
			       count(*) filter (where k.status = 'won')::int as wins,
			       count(*)::int as decided
			from duel_picks k join duel_markets m on m.id = k.market_id
			where k.status in ('won','lost') and m.resolved_at >= ${season.start} and m.resolved_at < ${season.end}
			group by k.user_id
		),
		ranked as (
			select s.*, rank() over (order by s.net desc, s.wins desc, s.decided asc) as rank
			from s join users u on u.id = s.user_id
			where u.deleted_at is null
		)
		select r.*, u.username, u.display_name, u.avatar_url
		from ranked r join users u on u.id = r.user_id
		where r.rank <= ${limit} or r.user_id = ${userId}
		order by r.rank asc, r.user_id
	`;
	const shape = (r) => ({
		rank: n(r.rank),
		name: r.display_name || r.username || 'Anonymous predictor',
		username: r.username || null,
		profile: r.username ? `/u/${encodeURIComponent(r.username)}` : null,
		avatar: r.avatar_url || null,
		net: n(r.net),
		wins: n(r.wins),
		decided: n(r.decided),
		accuracy: n(r.decided) ? n(r.wins) / n(r.decided) : null,
		is_me: !!userId && r.user_id === userId,
	});
	const all = rows.map(shape);
	return {
		season,
		leaders: all.filter((r) => r.rank <= limit),
		me: all.find((r) => r.is_me) || null,
	};
}

/**
 * Everything the signed-in predictor sees: today's allowance (credited on this
 * read), balance, XP level, season standing, recent calls, and duel badges.
 */
export async function loadPredictor(userId, { now = Date.now() } = {}) {
	const grant = await ensureDailyGrant(userId, now);
	const freshBadges = await refreshDuelBadges(userId);
	const season = seasonFor(now);
	const [calls, [xp], board, badges] = await Promise.all([
		sql`
			select k.side, k.stake, k.status, k.payout, k.created_at, k.settled_at,
			       m.id as market_id, m.window_kind, m.window_start, m.window_end, m.status as market_status,
			       m.winner, m.void_reason, m.agent_a_name, m.agent_b_name
			from duel_picks k join duel_markets m on m.id = k.market_id
			where k.user_id = ${userId}
			order by k.created_at desc limit 20
		`,
		sql`
			select coalesce(sum(xp), 0)::int as total,
			       coalesce(sum(xp) filter (where code like ${XP_CODE_PREFIX + '%'}), 0)::int as from_duels
			from trading_quest_completions where user_id = ${userId}
		`,
		seasonLeaderboard({ season, limit: 0, userId }),
		listBadges(userId),
	]);
	return {
		wallet: {
			balance: grant.balance,
			granted_now: grant.granted,
			daily_allowance: DUEL_RULES.daily_allowance,
			next_grant_at: iso(utcDayStart(now) + DAY_MS),
		},
		xp: { ...levelFor(xp?.total), from_duels: n(xp?.from_duels) },
		season: { ...season, standing: board.me },
		calls: calls.map((c) => ({
			market_id: c.market_id,
			url: `/duels/${c.market_id}`,
			label: `${c.agent_a_name} vs ${c.agent_b_name}`,
			picked: c.side === 'a' ? c.agent_a_name : c.agent_b_name,
			side: c.side,
			stake: n(c.stake),
			status: c.status,
			payout: n(c.payout),
			net: callNet(c),
			window_kind: c.window_kind,
			window_start: iso(ms(c.window_start)),
			window_end: iso(ms(c.window_end)),
			phase: duelPhase({ status: c.market_status, window_start: c.window_start, window_end: c.window_end }, now),
			void_reason: c.void_reason || null,
		})),
		badges: badges.filter((b) => DUEL_BADGE_CODES.has(b.code)),
		newly_unlocked: freshBadges,
	};
}
