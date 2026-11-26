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
//
// A third tier backs both caches: when pump.fun's frontend is unreachable and
// no last-known-good copy survives, `getBondingStatus` reads the bonding-curve
// account straight off Solana RPC via `pump-curve-view.js`'s `getCurveView`,
// the same on-chain source already proven live behind `/api/pump/curve`.
// `mapOnchainCurveView` maps that into the identical status shape, tagged
// `source: 'onchain'` instead of `'pumpfun'`.

import { isGraduated } from './pump-launch-feed.js';
import { fetchPumpCoin as fetchPumpCoinRecord } from './pump-feed-fetch.js';
import { cacheGet, cacheSet } from './cache.js';
import { getCurveView } from './pump-curve-view.js';

export const PUMP_FRONTEND_BASE =
	process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';

const FETCH_TIMEOUT_MS = 6_000;

// Live cache: collapses repeat polls of the same mint (a trading agent watching
// a curve typically re-checks every few seconds) into one upstream fetch.
const LIVE_TTL_S = Number(process.env.PUMP_BONDING_LIVE_TTL_S || 25);
// Last-known-good: survives a Cloudflare challenge/rate-limit window so a mint
// with a prior successful fetch never hard-fails, only goes stale. 6 hours
// matches the documented QUOTA_COOLDOWN_MS RPC-lane cooldown (docs/ops/ISSUES.md), the
// longest recurring outage class this tier is known to face.
const LKG_TTL_S = Number(process.env.PUMP_BONDING_LKG_TTL_S || 21600);
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

/**
 * Map a getCurveView() `{ body }` payload (api/_lib/pump-curve-view.js's
 * on-chain reader) into the same status shape mapBondingStatus produces, for
 * getBondingStatus's true double-miss path: pump.fun's frontend unreachable
 * AND no last-known-good copy survives. Pure; no network.
 *
 * getCurveView's on-chain curve account (sdk-bridge's getBondingCurveState)
 * never carries pump.fun's `raydium_pool` / `pump_swap_pool` fields: those
 * live only on the frontend API's raw coin object. A graduated read taken
 * on-chain therefore cannot tell Raydium from PumpSwap and reports pump.fun's
 * current default venue, the same fallback mapBondingStatus itself uses when
 * neither pool field is present. Likewise getCurveView's on-curve price is
 * SOL-denominated with no USD leg (that conversion only exists in the
 * graduated/Jupiter branch), so `marketCapUsd` stays null for an on-curve
 * on-chain read rather than mixing units.
 *
 * @param {{ curve: object|null, graduated?: boolean, graduatedPrice?: object }} body
 * @returns {object}
 */
export function mapOnchainCurveView(body) {
	if (body?.graduated) {
		return {
			onCurve: false,
			graduated: true,
			migratedTo: 'pumpswap',
			bondingProgressPct: 100,
			solInCurve: null,
			tokensRemaining: null,
			marketCapUsd: body.graduatedPrice?.marketCapUsd ?? null,
			source: 'onchain',
		};
	}

	const realTokenReserves = num(body?.curve?.realTokenReserves);
	const realSolReserves = num(body?.curve?.realSolReserves);
	return {
		onCurve: true,
		graduated: false,
		migratedTo: null,
		bondingProgressPct: bondingProgressPct(realTokenReserves),
		solInCurve: realSolReserves != null ? realSolReserves / 1e9 : null,
		tokensRemaining: realTokenReserves != null ? realTokenReserves / 1e6 : null,
		marketCapUsd: null,
		source: 'onchain',
	};
}

/**
 * Fetch a pump.fun coin object by mint from pump.fun's search route (its
 * /coins/<mint> and /coins-v2/<mint> routes were retired on 2026-11-25; see
 * pump-coin-search.js). Bounded retry on 429/5xx, never throws. Distinguishes
 * "not a pump.fun mint" (no exact match, or an externally indexed token) from
 * "upstream temporarily down" (network / timeout / 5xx) so the endpoint never
 * turns a data-source blip into a 400 or a 500.
 *
 * @param {string} mint
 * @returns {Promise<{ kind: 'ok', coin: object } | { kind: 'not_found' } | { kind: 'upstream_down' }>}
 */
export async function fetchPumpCoin(mint) {
	const { ok, status, body } = await fetchPumpCoinRecord(mint, { timeoutMs: FETCH_TIMEOUT_MS, retries: 1 });
	if (status === 404) return { kind: 'not_found' };
	if (!ok) return { kind: 'upstream_down' };
	if (body && body.mint && isPumpLaunch(body)) return { kind: 'ok', coin: body };
	return { kind: 'not_found' };
}

// pump.fun's search rows carry no curve reserves, so an on-curve coin read
// from it has no progress, SOL-in-curve or tokens-remaining. The bonding-curve
// account on Solana holds exactly those numbers; read it and keep pump.fun's
// market cap (the on-chain on-curve view has no USD leg). Best effort: when
// the chain read has nothing, the pump.fun-only status stands.
async function withOnchainCurve(status, mint) {
	if (!status.onCurve || status.bondingProgressPct != null) return status;
	let view;
	try {
		view = await getCurveView({ mint, network: 'mainnet' });
	} catch {
		return status;
	}
	if (view?.httpStatus !== 200 || !view.body) return status;
	if (view.body.graduated) {
		const onchain = mapOnchainCurveView(view.body);
		return { ...onchain, marketCapUsd: status.marketCapUsd ?? onchain.marketCapUsd, source: status.source };
	}
	if (!view.body.curve) return status;
	const onchain = mapOnchainCurveView(view.body);
	return {
		...status,
		bondingProgressPct: onchain.bondingProgressPct,
		solInCurve: onchain.solInCurve,
		tokensRemaining: onchain.tokensRemaining,
	};
}

/**
 * Resolve the full bonding-curve status for a mint: live cache, then fetch +
 * map, then a last-known-good fallback on upstream failure, then the on-chain
 * reader as a last resort. Mirrors `readThroughFeed` in pump-feed-fetch.js: a
 * live hit answers first; a miss fetches and writes through both tiers; a
 * failed fetch serves the last-known-good copy (flagged `stale`) rather than
 * hard-failing; and only when BOTH pump.fun's frontend and the LKG cache miss
 * does it fall through to api/_lib/pump-curve-view.js's on-chain reader
 * (the same Solana-RPC-backed source /api/pump/curve already serves live).
 * `upstream_down` is now reserved for the case where that on-chain read also
 * comes up empty.
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
		const status = await withOnchainCurve(mapBondingStatus(res.coin, { solPriceUsd: 0 }), mint);
		const entry = { status, coin: res.coin };
		cacheSet(lk, entry, LIVE_TTL_S).catch(() => {});
		cacheSet(bondingLkgKey(mint), entry, LKG_TTL_S).catch(() => {});
		return { kind: 'ok', status, coin: res.coin, stale: false };
	}
	// Not a pump.fun mint is a real, stable answer; never masked by a stale cache.
	if (res.kind === 'not_found') return res;

	const lkg = await cacheGet(bondingLkgKey(mint));
	if (lkg) return { kind: 'ok', status: lkg.status, coin: lkg.coin, stale: true };

	// True double miss: pump.fun's frontend is unreachable (the Cloudflare
	// challenge it now answers every request with) and no cached copy for
	// this mint survives either. Read the bonding-curve account straight off
	// Solana RPC before giving up; it is the same data, proven live.
	const onchain = await getCurveView({ mint, network: 'mainnet' });
	if (onchain.httpStatus === 200 && onchain.body && (onchain.body.curve || onchain.body.graduated)) {
		const status = mapOnchainCurveView(onchain.body);
		// Cached into the LKG tier (never the pump.fun liveKey, which means
		// "pump.fun answered this recently") so a repeat poll within the LKG
		// window doesn't re-hit RPC.
		cacheSet(bondingLkgKey(mint), { status, coin: null }, LKG_TTL_S).catch(() => {});
		return { kind: 'ok', status, coin: null, stale: false };
	}
	// The on-chain reader's not_a_pump_mint is a definitive answer about the mint
	// (no pump.fun shape, no three.ws launch record), not an outage. Reporting it
	// as upstream_down told pollers to retry the same foreign mint every 15s
	// forever. `no_curve` stays an outage: a graduated coin whose Jupiter price
	// read failed lands there too.
	if (onchain.httpStatus === 404 && onchain.body?.error === 'not_a_pump_mint') return { kind: 'not_found' };
	return { kind: 'upstream_down' };
}
