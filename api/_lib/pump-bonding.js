// Bonding-curve / graduation status for a single pump.fun token.
//
// One question an agent holding or watching a pump.fun coin needs mid-task:
// where is it on the bonding curve — how close to graduation, how much SOL is in
// the curve, and has it already migrated to an AMM (Raydium / PumpSwap)? Timing
// entries and exits around graduation is a core meme-trading move.
//
// This wraps the same public pump.fun frontend feed the rest of the codebase
// uses (PUMP_FRONTEND_BASE — see pump-launch-feed.js / oracle/market.js) and the
// SAME curve math already proven in oracle/market.js. It does NOT reimplement the
// curve: `bondingProgressPct` + `PUMP_CURVE_INITIAL_REAL_TOKENS` are the shared
// source of truth that oracle/market.js now imports from here too, so the free
// /api/crypto/bonding endpoint and the Oracle coin page can never drift.
//
// The pure mapping (`mapBondingStatus`) is separated from the network fetch
// (`fetchPumpCoin`) so the curve math is unit-testable with synthetic fixtures,
// no chain required.

import { isGraduated } from './pump-launch-feed.js';
import { pumpFetchJson } from './pump-feed-fetch.js';
import { cacheGet, cacheSet } from './cache.js';

export const PUMP_FRONTEND_BASE =
	process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';

const FETCH_TIMEOUT_MS = 6_000;

// Live cache: collapses repeat polls of the same mint (a trading agent watching
// a curve typically re-checks every few seconds) into one upstream fetch.
const LIVE_TTL_S = Number(process.env.PUMP_BONDING_LIVE_TTL_S || 25);
// Last-known-good: survives a Cloudflare challenge/rate-limit window so a mint
// with a prior successful fetch never hard-fails, only goes stale.
const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 1800);
const liveKey = (mint) => `pump:bonding:live:${mint}`;
const bondingLkgKey = (mint) => `pump:bonding:lkg:${mint}`;

// pump.fun mints a fixed 1B supply (6 decimals). Of that, 793.1M tokens sit in
// the bonding curve at launch; the coin graduates once the curve's float has been
// bought out. `real_token_reserves` starts at this value and decreases toward the
// graduation floor, so `1 - real/initial` is the share of the curve completed.
export const PUMP_CURVE_INITIAL_REAL_TOKENS = 793_100_000 * 1e6;

const num = (v) => {
	if (v == null) return null;
	const n = typeof v === 'string' ? parseFloat(v) : Number(v);
	return Number.isFinite(n) ? n : null;
};

const clampPct = (n) => (n == null ? null : Math.max(0, Math.min(100, n)));

/**
 * Bonding-curve progress (0–100) from the curve's live real token reserves
 * (atomic, 6-dec units). 0 at launch, 100 when the curve's float is fully bought
 * out. Returns null when reserves are unknown.
 *
 * @param {number|string|null|undefined} realTokenReservesAtomic
 * @returns {number|null}
 */
export function bondingProgressPct(realTokenReservesAtomic) {
	const real = num(realTokenReservesAtomic);
	if (real == null || real < 0) return null;
	return clampPct((1 - real / PUMP_CURVE_INITIAL_REAL_TOKENS) * 100);
}

// USD market cap: prefer pump.fun's own `usd_market_cap`; else derive from the
// SOL-denominated cap and a SOL price when one is supplied.
function pickMarketCapUsd(coin, solPriceUsd) {
	const usd = num(coin?.usd_market_cap);
	if (usd != null) return usd;
	const sol = num(coin?.market_cap);
	if (sol != null && solPriceUsd > 0) return sol * solPriceUsd;
	return null;
}

/**
 * Is this coin object a genuine pump.fun *bonding-curve launch* (as opposed to an
 * external token pump.fun merely indexes)? pump.fun's frontend returns records for
 * well-known non-pump mints too — WSOL, USDC, cross-chain tokens — flagged
 * `indexed_by_pump`; those never had a bonding curve here and must be rejected as
 * "not a pump.fun mint". A native launch carries a bonding-curve account (the field
 * persists post-graduation) or live curve reserves; the `pump` mint suffix is a
 * last-resort corroborator.
 *
 * @param {object} coin
 * @returns {boolean}
 */
export function isPumpLaunch(coin) {
	if (!coin || !coin.mint) return false;
	if (coin.indexed_by_pump) return false;
	return (
		Boolean(coin.bonding_curve || coin.associated_bonding_curve) ||
		coin.real_token_reserves != null ||
		coin.virtual_token_reserves != null ||
		/pump$/i.test(coin.mint)
	);
}

// Which venue a graduated coin migrated to. pump.fun exposes `raydium_pool` for
// coins that graduated to Raydium and `pump_swap_pool` for the PumpSwap AMM
// (pump.fun's current default graduation venue). A `complete` coin with neither
// field surfaced still left the curve for PumpSwap — the default today — so we
// report that rather than null, which is what a trader needs to know.
function migrationVenue(coin) {
	if (coin?.raydium_pool) return 'raydium';
	if (coin?.pump_swap_pool) return 'pumpswap';
	return 'pumpswap';
}

/**
 * Map a raw pump.fun coin object → the bonding-curve status shape. Pure; no
 * network. On-curve coins carry live `solInCurve` / `tokensRemaining` / progress;
 * graduated coins report `graduated:true` + `migratedTo` with the curve fields
 * nulled (final) and progress pinned to 100.
 *
 * @param {object} coin  Raw pump.fun frontend coin object.
 * @param {{ solPriceUsd?: number }} [opts]
 */
export function mapBondingStatus(coin, { solPriceUsd = 0 } = {}) {
	const graduated = isGraduated(coin);
	const marketCapUsd = pickMarketCapUsd(coin, solPriceUsd);

	if (graduated) {
		return {
			onCurve: false,
			graduated: true,
			migratedTo: migrationVenue(coin),
			bondingProgressPct: 100,
			solInCurve: null,
			tokensRemaining: null,
			marketCapUsd,
			source: 'pumpfun',
		};
	}

	const realTokenReserves = num(coin?.real_token_reserves);
	const realSolReserves = num(coin?.real_sol_reserves);
	return {
		onCurve: true,
		graduated: false,
		migratedTo: null,
		bondingProgressPct: bondingProgressPct(realTokenReserves),
		solInCurve: realSolReserves != null ? realSolReserves / 1e9 : null,
		tokensRemaining: realTokenReserves != null ? realTokenReserves / 1e6 : null,
		marketCapUsd,
		source: 'pumpfun',
	};
}

// Bounded retry on 429/5xx (honours Retry-After), never throws: the same
// resilience the sibling pump.fun readers (trending, whales, /api/pump/coin)
// already rely on, so a Cloudflare rate-limit blip recovers inside one request
// instead of being treated as a hard outage on the first non-OK response.
async function fetchOnce(url) {
	const { ok, status, body } = await pumpFetchJson(url, { timeoutMs: FETCH_TIMEOUT_MS, retries: 1 });
	// 404 = this mint isn't a pump.fun-indexed coin; a hard distinction from a
	// transient upstream fault (5xx / network / timeout) so the caller can answer
	// 400 vs 503 correctly.
	if (status === 404) return { kind: 'not_found' };
	if (!ok) return { kind: 'upstream_down' };
	// A returned record that isn't a native bonding-curve launch (an externally
	// indexed token) is "not a pump.fun mint", not a data-source fault.
	if (body && body.mint && isPumpLaunch(body)) return { kind: 'ok', coin: body };
	return { kind: 'not_found' };
}

/**
 * Fetch a pump.fun coin object by mint. Tries the richer `coins-v2/<mint>` route
 * (carries the AMM pool fields) then falls back to `coins/<mint>`. Distinguishes
 * "not a pump.fun mint" (both routes 404 / empty) from "upstream temporarily
 * down" (network / timeout / 5xx) so the endpoint never turns a data-source blip
 * into a 400 or a 500.
 *
 * @param {string} mint
 * @returns {Promise<{ kind: 'ok', coin: object } | { kind: 'not_found' } | { kind: 'upstream_down' }>}
 */
export async function fetchPumpCoin(mint) {
	let sawUpstreamDown = false;
	for (const path of [`coins-v2/${encodeURIComponent(mint)}`, `coins/${encodeURIComponent(mint)}`]) {
		const r = await fetchOnce(`${PUMP_FRONTEND_BASE}/${path}`);
		if (r.kind === 'ok') return r;
		if (r.kind === 'upstream_down') sawUpstreamDown = true;
		// not_found → try the next route before concluding it's not a pump mint.
	}
	return { kind: sawUpstreamDown ? 'upstream_down' : 'not_found' };
}

/**
 * Resolve the full bonding-curve status for a mint: live cache, then fetch +
 * map, then a last-known-good fallback on upstream failure. Mirrors
 * `readThroughFeed` in pump-feed-fetch.js: a live hit answers first; a miss
 * fetches and writes through both tiers; a failed fetch serves the
 * last-known-good copy (flagged `stale`) rather than hard-failing, and only
 * reports `upstream_down` when no cached data exists at all for this mint.
 *
 * @param {string} mint
 * @returns {Promise<{ kind: 'ok', status: object, coin: object, stale: boolean } | { kind: 'not_found' } | { kind: 'upstream_down' }>}
 */
export async function getBondingStatus(mint) {
	const lk = liveKey(mint);
	const live = await cacheGet(lk);
	if (live) return { kind: 'ok', status: live.status, coin: live.coin, stale: false };

	const res = await fetchPumpCoin(mint);
	if (res.kind === 'ok') {
		// pump.fun's coin object already carries `usd_market_cap`, so no extra
		// SOL-price fetch is needed on the hot path; pass 0 and let
		// mapBondingStatus prefer it.
		const status = mapBondingStatus(res.coin, { solPriceUsd: 0 });
		const entry = { status, coin: res.coin };
		cacheSet(lk, entry, LIVE_TTL_S).catch(() => {});
		cacheSet(bondingLkgKey(mint), entry, LKG_TTL_S).catch(() => {});
		return { kind: 'ok', status, coin: res.coin, stale: false };
	}
	// Not a pump.fun mint is a real, stable answer; never masked by a stale cache.
	if (res.kind === 'not_found') return res;

	const lkg = await cacheGet(bondingLkgKey(mint));
	if (lkg) return { kind: 'ok', status: lkg.status, coin: lkg.coin, stale: true };
	return { kind: 'upstream_down' };
}
