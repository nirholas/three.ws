// Price history for Robinhood Chain portfolios, and the daily snapshot that grows it.
//
// A portfolio product needs to show what a basket would have done, and on this
// chain that is harder than it sounds. There is no OHLC API: DexScreener serves
// only current state, GeckoTerminal does not index chain 4663 at all, and the
// public RPC is pruned, so historical `eth_call` is unavailable.
//
// Reconstructing prices from Uniswap swap logs is the obvious next idea and it
// does not survive contact with the chain's block rate. Robinhood Chain produces
// roughly 864,000 blocks a day at ~100ms each, and the RPC caps a single
// `eth_getLogs` at a 500k-block span or 10,000 results. One month of history for
// ONE token is therefore 50+ archival queries, before any block-timestamp reads.
// That is not something an API request can do, for any number of constituents.
//
// So history comes from the two sources that are actually cheap here:
//
//   1. CHAINLINK ROUND HISTORY, for the 34 registry equities that carry a feed.
//      Rounds are addressed by id and read at head state, so a pruned node
//      serves them fine, and one multicall returns hundreds. Measured
//      2026-09-07: 80 rounds reach back 10 days on NVDA, 54 days on SPY, and
//      67 days on SGOV (its entire life). This is real history available today.
//
//   2. A DAILY SNAPSHOT of the whole universe, written by
//      /api/cron/hood-portfolio-snapshot. This covers every token including the
//      memecoins that have no feed and never will, and its coverage compounds:
//      the chain cannot be asked what a token was worth last month, but it can
//      be asked every day from now on.
//
// Nothing here interpolates a price it does not have. A day with no observation
// is absent from the series, and callers are told which legs they are missing
// rather than being handed a chart with invented points in it.

import { sql } from './db.js';
import { cacheWrap } from './cache.js';
import { feedRoundHistory } from './robinhood.js';

/**
 * How many Chainlink rounds to pull per feed.
 *
 * `feedRoundHistory` batches these into multicalls of 40, which is what makes
 * depth safe here: this RPC silently DROPS calls out of a large multicall rather
 * than failing it, so before chunking, asking for more history returned less of
 * it (NVDA's feed, 2026-09-08: 80 rounds at depth 80, only 8 at depth 120, none
 * at 160). That partial result was the dangerous mode, because it reads as a
 * short-but-successful history rather than an error, and intersecting several of
 * them produced an empty backtest window with nothing to explain it.
 *
 * Chunked, depth is honest and roughly linear: 300 rounds costs about two
 * seconds a feed and reaches ~29 days on a feed as active as NVDA's, more on
 * slower ones (SPY and SGOV update less often, so the same count spans longer).
 * The daily snapshot extends coverage past that, and to the tokens with no feed.
 */
export const FEED_ROUND_DEPTH = 300;

const SNAPSHOT_PREFIX = 'hood_prices:';

/** `hood_prices:YYYY-MM-DD`: one row per day, holding the whole universe. */
export function snapshotKey(date = new Date()) {
	return `${SNAPSHOT_PREFIX}${date.toISOString().slice(0, 10)}`;
}

async function ensureTable() {
	await sql`
		CREATE TABLE IF NOT EXISTS app_settings (
			key text PRIMARY KEY,
			value jsonb NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`;
}

/**
 * Write one day's prices for the whole universe.
 *
 * Stored as a compact { address: [priceUsd, liquidityUsd] } map rather than a
 * row per token: 727 tokens is ~30KB of JSON a day, which is one small row,
 * where a row per token would be 265k rows a year for a chart nobody reads at
 * that granularity.
 *
 * Idempotent by day: running the cron twice in a day overwrites rather than
 * duplicating, so a retry after a partial failure is always safe.
 */
export async function recordDailySnapshot(tokens, { at = new Date() } = {}) {
	await ensureTable();
	const prices = {};
	let recorded = 0;
	for (const t of tokens) {
		if (t.priceUsd == null || !(t.priceUsd > 0)) continue;
		prices[t.address] = [Number(t.priceUsd), Math.round(t.liquidityUsd || 0)];
		recorded++;
	}
	const value = { at: at.toISOString(), count: recorded, prices };
	await sql`
		INSERT INTO app_settings (key, value) VALUES (${snapshotKey(at)}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
	`;
	return { key: snapshotKey(at), recorded };
}

/** Every stored day, newest first, as [{ day, at, prices }]. */
export async function readSnapshots({ days = 90 } = {}) {
	return cacheWrap(`hp:snapshots:${days}`, 300, async () => {
		await ensureTable();
		const rows = await sql`
			SELECT key, value FROM app_settings
			WHERE key LIKE ${`${SNAPSHOT_PREFIX}%`}
			ORDER BY key DESC
			LIMIT ${Math.max(1, Math.min(days, 400))}
		`;
		return rows.map((r) => ({
			day: String(r.key).slice(SNAPSHOT_PREFIX.length),
			at: r.value?.at ?? null,
			prices: r.value?.prices ?? {},
		}));
	});
}

/** Reduce irregular observations to one close per UTC day: the last at or before each day's end. */
export function toDailyCloses(points) {
	const byDay = new Map();
	for (const p of points) {
		if (!(p.priceUsd > 0)) continue;
		const day = new Date(p.t).toISOString().slice(0, 10);
		const prev = byDay.get(day);
		if (!prev || p.t > prev.t) byDay.set(day, p);
	}
	return [...byDay.entries()]
		.map(([day, p]) => ({ day, t: p.t, priceUsd: p.priceUsd }))
		.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Daily close series for one token, from whichever real source it has.
 *
 * A feed-backed equity gets Chainlink rounds, which reach back weeks today. Any
 * other token gets the stored daily snapshots, which start the day the cron
 * first ran. Where both exist the feed wins, because it is the denser series and
 * it is the price the equity is actually marked at.
 */
export async function tokenHistory(token, { days = 30, snapshots = null } = {}) {
	let feedError = null;
	if (token.feed) {
		// Retried, and paced. This RPC drops calls out of a large multicall under
		// load rather than erroring, so a feed read can come back empty or short for
		// no reason but timing. An empty read is treated as a failure to retry, not
		// as a feed with no history: a token that HAS a feed has rounds by
		// definition. Callers must also read feeds one at a time; firing several
		// 80-call multicalls at this RPC concurrently makes most of them fail.
		for (let attempt = 0; attempt < 3; attempt++) {
			if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
			try {
				const rounds = await feedRoundHistory(token.feed, FEED_ROUND_DEPTH);
				const points = (rounds || [])
					.filter((r) => r?.priceUsd > 0)
					.map((r) => ({ t: Number(r.updatedAt) * 1000, priceUsd: Number(r.priceUsd) }));
				const closes = toDailyCloses(points).slice(-days);
				if (closes.length) return { source: 'chainlink', feed: token.feed, closes };
				feedError = 'the feed returned no rounds';
			} catch (err) {
				feedError = String(err?.message || err);
			}
		}
	}

	const snaps = snapshots || (await readSnapshots({ days }));
	const addr = String(token.address).toLowerCase();
	const closes = snaps
		.map((s) => {
			const row = s.prices[addr];
			const price = Array.isArray(row) ? row[0] : row;
			return price > 0 ? { day: s.day, t: Date.parse(s.at || `${s.day}T00:00:00Z`), priceUsd: Number(price) } : null;
		})
		.filter(Boolean)
		.sort((a, b) => (a.day < b.day ? -1 : 1))
		.slice(-days);

	if (closes.length) return { source: 'daily-snapshot', closes };
	return { source: feedError ? 'unavailable' : 'none', closes: [], error: feedError };
}
