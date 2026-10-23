// Oracle — known-wallet prior (cold-start enrichment).
//
// The conviction engine's pedigree pillar is strongest when the data brain has
// already judged a coin's buyers — but that takes outcomes to accumulate, so a
// brand-new deploy reads every wallet as "unproven." This prior fixes the cold
// start: wallets already labeled smart money / sniper by gmgn.ai, so the moment
// one shows up in a launch's order book, Oracle can credit it immediately,
// before its own track record matures. As the brain learns, its computed
// reputation takes over; this is only ever a prior.
//
// The prior lives in the database, not in git: api/cron/gmgn-seed.js keeps
// `wallet_reputation` fresh daily, and this module reads the rows the brain has
// not yet judged itself (coins_traded < 5, the cron's own hand-over threshold).
// Rows are cached in-process and refreshed on a bounded TTL, so a lookup is a
// synchronous Map hit and the database sees at most one read per TTL per
// instance. An empty table serves an empty prior; nothing is fabricated.
//
// Callers `await loadKnownWallets()` once at the top of their async path, then
// call `knownWallet()` synchronously per wallet.
//
// Wallet addresses + labels only — no token mints (the platform references only
// $THREE; the prior never carries a coin).

import { sql } from '../db.js';

const NETWORK = 'mainnet';
const REFRESH_MS = 10 * 60_000;
// Retry sooner after a failed read so a database blip does not freeze a cold
// instance on an empty prior for a full TTL.
const RETRY_MS = 30_000;
const MAX_ROWS = 20_000;
const SOURCE = 'gmgn.ai via wallet_reputation';

// Labels the prior serves. `kol` is carried for rows a seed writes with that
// label; the gmgn cron currently files KOLs as `neutral`, which is no signal.
const PRIOR_LABELS = ['smart_money', 'kol', 'sniper'];

let wallets = new Map();
let nextRefreshAt = 0;
let inflight = null;
let loggedEmpty = false;

/** Attribution + counts for the UI ("seeded with N known wallets"). Live: updated on every refresh. */
export const KNOWN_META = { source: SOURCE, total: 0, counts: {}, refreshed_at: null };

async function refresh() {
	try {
		const rows = await sql`
			select wallet, label, smart_money_score
			from wallet_reputation
			where network = ${NETWORK}
			  and coins_traded < 5
			  and label = any(${PRIOR_LABELS})
			order by smart_money_score desc, wallet
			limit ${MAX_ROWS}
		`;
		const next = new Map();
		const counts = {};
		for (const r of rows) {
			next.set(r.wallet, { label: r.label, score: Number(r.smart_money_score) });
			counts[r.label] = (counts[r.label] || 0) + 1;
		}
		wallets = next;
		KNOWN_META.total = next.size;
		KNOWN_META.counts = counts;
		KNOWN_META.refreshed_at = new Date().toISOString();
		nextRefreshAt = Date.now() + REFRESH_MS;
		if (!next.size && !loggedEmpty) {
			loggedEmpty = true;
			console.warn('[oracle/known-wallets] wallet_reputation holds no seeded prior yet; serving an empty prior until /api/cron/gmgn-seed runs');
		} else if (next.size) {
			loggedEmpty = false;
		}
	} catch (e) {
		// Keep serving the last good rows; the prior degrades, it never throws.
		nextRefreshAt = Date.now() + RETRY_MS;
		console.warn('[oracle/known-wallets] prior refresh failed, keeping last good rows:', e?.message || e);
	}
}

/**
 * Ensure the in-process prior is loaded and no older than the refresh TTL.
 * Single-flight, never rejects. Await it before calling knownWallet().
 * @param {{ force?: boolean }} [opts]
 */
export function loadKnownWallets({ force = false } = {}) {
	if (!force && Date.now() < nextRefreshAt) return Promise.resolve();
	inflight ??= refresh().finally(() => { inflight = null; });
	return inflight;
}

/** Drop the cache so the next loadKnownWallets() reads the table (tests, post-seed). */
export function resetKnownWallets() {
	wallets = new Map();
	nextRefreshAt = 0;
	loggedEmpty = false;
	KNOWN_META.total = 0;
	KNOWN_META.counts = {};
	KNOWN_META.refreshed_at = null;
}

/**
 * Look up a wallet's known label, or null. Returns a notable-ready shape with
 * the seeded score + source tag so callers can fold it straight into pedigree.
 * Synchronous: reads the cache populated by loadKnownWallets().
 * @param {string} address
 */
export function knownWallet(address) {
	const hit = wallets.get(address);
	if (!hit) return null;
	return {
		label: hit.label,
		score: hit.score,
		pnl_30d: null,
		profit_30d_usd: null,
		tag: null,
		source: 'gmgn',
	};
}

/** Whether a (possibly known) label is one Oracle treats as proven-positive. */
export function knownIsProven(label) {
	return label === 'smart_money' || label === 'kol';
}
