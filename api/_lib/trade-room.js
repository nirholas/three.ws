/**
 * Live trade rooms: the read model behind /trade-rooms and /trade-rooms/:id.
 *
 * A trade room is one leader's corner of the world: their 3D body, their real
 * trades landing as they happen, the people watching, and the one-tap paths
 * out (ghost-copy, copy, fork). Every number here comes from the canonical
 * sniper ledger (`agent_sniper_positions`), the same rows /trader/:id and the
 * leaderboard read, so a room can never tell a different story than the
 * profile it links to.
 *
 * Two layers, like trader-stats.js:
 *   - PURE: positionEvents, eventsSince, rankRooms, sanitizeSession,
 *     streamStartCursor, plus roomState, which lives in src/trade-room/model.js
 *     so the page and the API compute liveliness identically. No DB, no
 *     network; the tests pin them.
 *   - LOADERS: loadRoom, listRooms, loadRoomAgent, fetchChangedPositions. They
 *     fetch rows and defer every derivation to the pure layer.
 *
 * Honesty rules:
 *   - A position becomes up to two events: the buy at opened_at and, once it
 *     closes, the sell at closed_at. A failed position (the buy never landed)
 *     is never shown as a trade.
 *   - Paper fills (buy_sig = SIMULATED) are labeled paper, never passed off as
 *     on-chain trades, and carry no Solscan link.
 *   - Private or deleted agents have no room, the same visibility gate
 *     /api/sniper/trader and /api/sniper/receipt apply.
 */

import { sql } from './db.js';
import { thumbnailUrl } from './r2.js';
import { resolveAvatarUrl } from './avatars.js';
import { computeTraderMetrics, fetchTraderPositions, cachedSolUsd, shapeOpen } from './trader-stats.js';
import { exitReasonLabel, solscanTx, SIMULATED_SIG } from './trade-card.js';
import { roomState, LIVE_WINDOW_MS, WARM_WINDOW_MS } from '../../src/trade-room/model.js';

export { roomState, LIVE_WINDOW_MS, WARM_WINDOW_MS };

const LAMPORTS_PER_SOL = 1e9;

/** How far back the lobby looks for leaders worth a room. */
export const LOBBY_LOOKBACK_DAYS = 90;
/** Events a room snapshot carries. */
export const ROOM_EVENT_LIMIT = 30;
/** Window the room's headline stats cover. */
export const ROOM_STATS_WINDOW = '30d';

const LIVE_STATUSES = ['open', 'opening', 'closing'];
const TRADED_STATUSES = ['open', 'closing', 'closed'];

const SESSION_RE = /^[A-Za-z0-9_-]{8,40}$/;
/** Furthest back a stream may start, so a stale tab cannot replay the ledger. */
export const STREAM_SINCE_MAX_AGE_MS = 10 * 60_000;

function lamToSol(v) {
	if (v == null) return null;
	try {
		return Number(BigInt(v)) / LAMPORTS_PER_SOL;
	} catch {
		const n = Number(v);
		return Number.isFinite(n) ? n / LAMPORTS_PER_SOL : null;
	}
}

function num(v) {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function ms(v) {
	if (v == null) return null;
	const t = new Date(v).getTime();
	return Number.isFinite(t) ? t : null;
}

function iso(v) {
	const t = ms(v);
	return t == null ? null : new Date(t).toISOString();
}

/**
 * Validate a client-chosen spectator session id. It is untrusted input that
 * becomes a Redis member, so only a short, plain token is accepted.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeSession(raw) {
	return typeof raw === 'string' && SESSION_RE.test(raw) ? raw : null;
}

/**
 * The stream's starting cursor (ms) from the client's `since`. PURE.
 * Missing or unparseable: now. Future: now. Older than the cap: the cap.
 * @param {unknown} raw ISO timestamp of the newest event the page painted
 * @param {number} [now]
 */
export function streamStartCursor(raw, now = Date.now()) {
	const t = typeof raw === 'string' && raw ? new Date(raw).getTime() : NaN;
	if (!Number.isFinite(t)) return now;
	return Math.min(now, Math.max(now - STREAM_SINCE_MAX_AGE_MS, t));
}

/**
 * Turn position rows into the room's trade events, newest first. PURE.
 *
 * Each traded position yields a buy (at opened_at) and, once closed, a sell
 * (at closed_at). Sizes are the SOL that actually moved: the entry quote for a
 * buy, the exit quote for a sell. Rows that never filled are skipped.
 *
 * @param {object[]} rows agent_sniper_positions rows
 * @param {{network?: string, limit?: number}} [opts]
 * @returns {object[]}
 */
export function positionEvents(rows, { network = 'mainnet', limit = ROOM_EVENT_LIMIT } = {}) {
	const out = [];
	for (const r of rows || []) {
		if (!r || !TRADED_STATUSES.includes(r.status)) continue;
		const openedAt = iso(r.opened_at);
		if (!openedAt) continue;
		const paper = !r.buy_sig || r.buy_sig === SIMULATED_SIG;
		const base = {
			position_id: r.id,
			mint: r.mint,
			symbol: r.symbol || null,
			name: r.name || null,
			paper,
			status: r.status,
			entry_sol: lamToSol(r.entry_quote_lamports),
		};
		out.push({
			...base,
			id: `${r.id}:buy`,
			kind: 'buy',
			at: openedAt,
			size_sol: base.entry_sol,
			tx_url: solscanTx(r.buy_sig, network),
		});
		const closedAt = r.status === 'closed' ? iso(r.closed_at) : null;
		if (closedAt) {
			out.push({
				...base,
				id: `${r.id}:sell`,
				kind: 'sell',
				at: closedAt,
				size_sol: lamToSol(r.exit_quote_lamports),
				pnl_sol: lamToSol(r.realized_pnl_lamports),
				pnl_pct: num(r.realized_pnl_pct),
				exit_reason: r.exit_reason || null,
				exit_label: exitReasonLabel(r.exit_reason),
				hold_seconds: Math.max(0, Math.round((ms(closedAt) - ms(openedAt)) / 1000)),
				tx_url: solscanTx(r.sell_sig, network),
				share_url: `/trade/${r.id}`,
			});
		}
	}
	out.sort((a, b) => ms(b.at) - ms(a.at) || (a.kind === 'sell' ? -1 : 1));
	return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * Everything that happened to a set of changed rows after a cursor, oldest
 * first, for the live stream. PURE.
 *
 * Deriving from timestamps (not from "what changed last") means a position
 * that opens and closes inside one poll interval still emits its buy before
 * its sell, and an open position whose quote moved emits a `quote` update.
 *
 * @param {object[]} rows changed agent_sniper_positions rows
 * @param {number} cursorMs events at or before this instant were already sent
 * @param {{network?: string}} [opts]
 * @returns {{trades: object[], quotes: object[]}}
 */
export function eventsSince(rows, cursorMs, { network = 'mainnet' } = {}) {
	const trades = positionEvents(rows, { network, limit: 0 })
		.filter((e) => ms(e.at) > cursorMs)
		.reverse();
	const quotes = [];
	for (const r of rows || []) {
		if (!LIVE_STATUSES.includes(r.status) || !r.buy_sig) continue;
		const quotedAt = ms(r.last_quoted_at);
		if (quotedAt == null || quotedAt <= cursorMs) continue;
		const shaped = shapeOpen(r, network);
		quotes.push({
			position_id: r.id,
			symbol: shaped.symbol || null,
			current_sol: shaped.current_sol,
			unrealized_pct: shaped.unrealized_pct,
			at: new Date(quotedAt).toISOString(),
		});
	}
	return { trades, quotes };
}

const STATE_RANK = { live: 0, warm: 1, quiet: 2 };

/**
 * Order lobby rooms: live first, then by who is watching, then by recency.
 * PURE; returns a new array.
 * @param {object[]} rooms each with state, spectators, last_trade_at
 */
export function rankRooms(rooms) {
	return [...(rooms || [])].sort(
		(a, b) =>
			(STATE_RANK[a.state] ?? 3) - (STATE_RANK[b.state] ?? 3) ||
			(Number(b.spectators) || 0) - (Number(a.spectators) || 0) ||
			(ms(b.last_trade_at) ?? 0) - (ms(a.last_trade_at) ?? 0),
	);
}

/**
 * The leader's 3D body, only when its avatar is public or unlisted. A private
 * model resolves to null and the room stands the platform default in its place.
 */
async function modelFor(row) {
	if (!row?.avatar_row_id || !row.storage_key) return null;
	if (row.avatar_visibility !== 'public' && row.avatar_visibility !== 'unlisted') return null;
	const { url } = await resolveAvatarUrl({
		id: row.avatar_row_id,
		storage_key: row.storage_key,
		baked_storage_key: row.baked_storage_key,
		appearance_hash: row.appearance_hash,
		appearance: row.appearance,
		visibility: row.avatar_visibility,
	});
	return url || null;
}

function thumbFor(row) {
	if (row.profile_image_url || row.avatar_url) return row.profile_image_url || row.avatar_url;
	const readable = row.avatar_visibility === 'public' || row.avatar_visibility === 'unlisted';
	return readable && row.thumbnail_key ? thumbnailUrl(row.thumbnail_key) : null;
}

/**
 * The public agent behind a room, or null when it is unknown, deleted or
 * private. Shared by the snapshot and the stream so both apply one gate.
 * @param {string} agentId
 */
export async function loadRoomAgent(agentId) {
	const [row] = await sql`
		select i.id, i.user_id, i.name, i.description, i.avatar_url, i.profile_image_url,
		       a.id as avatar_row_id, a.storage_key, a.baked_storage_key, a.appearance_hash,
		       a.appearance, a.visibility as avatar_visibility, a.thumbnail_key
		from agent_identities i
		left join avatars a on a.id = i.avatar_id and a.deleted_at is null
		where i.id = ${agentId} and i.deleted_at is null and i.is_public is not false
		limit 1
	`;
	return row || null;
}

/** Recent traded positions for one leader, newest activity first. */
async function recentPositions(agentId, network, limit) {
	return sql`
		select p.id, p.agent_id, p.wallet, p.mint, p.symbol, p.name, p.status, p.exit_reason,
		       p.entry_quote_lamports, p.exit_quote_lamports, p.last_value_lamports,
		       p.realized_pnl_lamports, p.realized_pnl_pct, p.buy_sig, p.sell_sig,
		       p.opened_at, p.closed_at, p.last_quoted_at
		from agent_sniper_positions p
		where p.agent_id = ${agentId} and p.network = ${network}
		  and p.status in ('open', 'closing', 'closed')
		order by greatest(p.opened_at, coalesce(p.closed_at, p.opened_at)) desc
		limit ${limit}
	`;
}

/** Active copiers for one leader. Best-effort: an unmigrated table reads as 0. */
async function copierCount(agentId, network) {
	try {
		const [row] = await sql`
			select count(*)::int as copiers from copy_subscriptions
			where leader_agent_id = ${agentId} and network = ${network} and status = 'active'
		`;
		return Number(row?.copiers) || 0;
	} catch {
		return 0;
	}
}

/**
 * Full room snapshot for one leader. Returns null when there is no public
 * agent behind the id. A public agent that has never traded still gets a room
 * (an empty floor that says so), never a 404.
 *
 * @param {{agentId: string, network?: string, spectators?: {count: number|null, scope: string}|null, now?: number}} input
 */
export async function loadRoom({ agentId, network = 'mainnet', spectators = null, now = Date.now() }) {
	const agent = await loadRoomAgent(agentId);
	if (!agent) return null;

	const [recent, windowPositions, solUsd, copiers, modelUrl] = await Promise.all([
		recentPositions(agentId, network, ROOM_EVENT_LIMIT),
		fetchTraderPositions({ agentId, network, window: ROOM_STATS_WINDOW, now }),
		cachedSolUsd(),
		copierCount(agentId, network),
		modelFor(agent).catch(() => null),
	]);

	const metrics = computeTraderMetrics(windowPositions, { solUsd });
	const trades = positionEvents(recent, { network });
	const open = windowPositions
		.filter((p) => LIVE_STATUSES.includes(p.status) && p.buy_sig)
		.map((p) => shapeOpen(p, network));
	const lastTradeAt = trades[0]?.at || null;

	return {
		network,
		leader: {
			id: agent.id,
			name: agent.name || 'Unnamed trader',
			description: agent.description || null,
			image: thumbFor(agent),
			model_url: modelUrl,
			wallet: windowPositions[0]?.wallet || recent[0]?.wallet || null,
			copiers,
		},
		room: {
			state: roomState({ lastTradeAt, openCount: open.length, now }),
			last_trade_at: lastTradeAt,
			spectators: spectators ? spectators.count : null,
			presence_scope: spectators ? spectators.scope : null,
		},
		stats: {
			window: ROOM_STATS_WINDOW,
			score: metrics.score,
			verified: metrics.verified,
			closed_count: metrics.closed_count,
			win_rate: metrics.win_rate,
			realized_pnl_sol: metrics.realized_pnl_sol,
			realized_pnl_usd: metrics.realized_pnl_usd,
			best_pnl_pct: metrics.best_pnl_pct,
		},
		open,
		trades,
		sol_usd: solUsd,
		t: now,
	};
}

/**
 * Lobby: every public leader with a trade inside LOBBY_LOOKBACK_DAYS or an
 * open position, with liveliness, spectators, and a 24h activity count.
 *
 * @param {{network?: string, limit?: number, spectatorCounts?: (ids: string[]) => Promise<Map<string, number>>, now?: number}} input
 */
export async function listRooms({ network = 'mainnet', limit = 24, spectatorCounts = null, now = Date.now() } = {}) {
	const since = new Date(now - LOBBY_LOOKBACK_DAYS * 86_400_000).toISOString();
	const dayAgo = new Date(now - 86_400_000).toISOString();
	const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
	const rows = await sql`
		select p.agent_id,
		       i.name, i.avatar_url, i.profile_image_url,
		       a.thumbnail_key, a.visibility as avatar_visibility,
		       count(*) filter (where p.status in ('open', 'opening', 'closing') and p.buy_sig is not null)::int as open_count,
		       (count(*) filter (where p.opened_at > ${dayAgo})
		        + count(*) filter (where p.closed_at > ${dayAgo}))::int as fills_24h,
		       coalesce(sum(p.realized_pnl_lamports) filter (where p.status = 'closed' and p.closed_at > ${weekAgo}), 0) as pnl_7d_lamports,
		       count(*) filter (where p.status = 'closed' and p.closed_at > ${weekAgo})::int as closed_7d,
		       count(*) filter (where p.status = 'closed' and p.closed_at > ${weekAgo} and p.realized_pnl_lamports > 0)::int as wins_7d,
		       max(greatest(p.opened_at, coalesce(p.closed_at, p.opened_at))) as last_trade_at
		from agent_sniper_positions p
		join agent_identities i on i.id = p.agent_id and i.deleted_at is null and i.is_public is not false
		left join avatars a on a.id = i.avatar_id and a.deleted_at is null
		where p.network = ${network}
		  and p.status in ('open', 'closing', 'closed')
		  and (p.status <> 'closed' or greatest(p.opened_at, coalesce(p.closed_at, p.opened_at)) > ${since})
		group by p.agent_id, i.name, i.avatar_url, i.profile_image_url, a.thumbnail_key, a.visibility
		order by last_trade_at desc
		limit 60
	`;
	const ids = rows.map((r) => r.agent_id);
	let counts = new Map();
	if (spectatorCounts && ids.length) {
		try {
			counts = await spectatorCounts(ids);
		} catch {
			counts = new Map();
		}
	}
	const rooms = rows.map((r) => {
		const lastTradeAt = iso(r.last_trade_at);
		return {
			agent_id: r.agent_id,
			name: r.name || 'Unnamed trader',
			image: thumbFor(r),
			state: roomState({ lastTradeAt, openCount: Number(r.open_count) || 0, now }),
			last_trade_at: lastTradeAt,
			open_count: Number(r.open_count) || 0,
			fills_24h: Number(r.fills_24h) || 0,
			pnl_7d_sol: lamToSol(r.pnl_7d_lamports) ?? 0,
			closed_7d: Number(r.closed_7d) || 0,
			win_rate_7d: Number(r.closed_7d) > 0 ? Number(r.wins_7d) / Number(r.closed_7d) : null,
			spectators: counts.get(r.agent_id) ?? 0,
			url: `/trade-rooms/${r.agent_id}`,
		};
	});
	return rankRooms(rooms).slice(0, Math.max(1, Math.min(60, limit)));
}

/**
 * Rows for one leader whose open, close, or quote time moved past a cursor.
 * The stream's only DB read; the derivation lives in eventsSince().
 * @param {{agentId: string, network: string, cursorIso: string}} input
 */
export async function fetchChangedPositions({ agentId, network, cursorIso }) {
	return sql`
		select p.id, p.agent_id, p.mint, p.symbol, p.name, p.status, p.exit_reason,
		       p.entry_quote_lamports, p.exit_quote_lamports, p.last_value_lamports,
		       p.realized_pnl_lamports, p.realized_pnl_pct, p.buy_sig, p.sell_sig,
		       p.opened_at, p.closed_at, p.last_quoted_at,
		       greatest(p.opened_at, coalesce(p.closed_at, p.opened_at),
		                coalesce(p.last_quoted_at, p.opened_at)) as changed_at
		from agent_sniper_positions p
		where p.agent_id = ${agentId} and p.network = ${network}
		  and p.status in ('open', 'opening', 'closing', 'closed')
		  and greatest(p.opened_at, coalesce(p.closed_at, p.opened_at),
		               coalesce(p.last_quoted_at, p.opened_at)) > ${cursorIso}
		order by changed_at asc
		limit 100
	`;
}

