// The quote assets a pump.fun launch can pair with, from live chain state.
//
// GET /api/pump/pairs reads this. A pair is "live" only when the program will
// actually accept a create_v2 against it right now: SOL is native; USDC and
// every other stable or exotic mint has to be admitted through the Global
// whitelist or the QuoteControl PDA. Fee numbers come from the fee program's
// schedule for that quote at a fresh curve's market cap, never from a constant
// written here.
//
// The creator-fee range the platform allows is config: PUMP_CREATOR_FEE_MIN_BPS,
// PUMP_CREATOR_FEE_MAX_BPS and PUMP_CREATOR_FEE_DEFAULT_BPS. The range is then
// intersected with what the program allows (Global.creatorFeeConfigurable and
// Global.maxConfigurableCreatorFeeBps), so a value this module says is allowed
// is one the chain will take.

import { getPumpSdk, solanaPubkey } from './pump.js';
import { WSOL_MINT, usdcMintFor } from './pump-quote.js';
import { QUOTE_MINTS } from './quote-mints.js';
import { env } from './env.js';

const CACHE_TTL_MS = 60_000;
const cache = new Map();

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'USDH', 'PYUSD']);
const DECIMALS = Object.freeze({ SOL: 9, USDC: 6, USDT: 6, USDH: 6, PYUSD: 6 });

function intEnv(name, fallback) {
	const raw = env[name] ?? process.env[name];
	if (raw == null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error(`${name} must be an integer between 0 and 10000, got ${raw}`);
	return n;
}

/**
 * The platform's configured creator-fee range, before the chain's own limits.
 * @returns {{ min_bps: number, max_bps: number, default_bps: number }}
 */
export function configuredCreatorFeeRange() {
	const min = intEnv('PUMP_CREATOR_FEE_MIN_BPS', 0);
	const max = intEnv('PUMP_CREATOR_FEE_MAX_BPS', 1_000);
	if (min > max) throw new Error('PUMP_CREATOR_FEE_MIN_BPS is above PUMP_CREATOR_FEE_MAX_BPS');
	const def = Math.min(max, Math.max(min, intEnv('PUMP_CREATOR_FEE_DEFAULT_BPS', Math.min(max, Math.max(min, 100)))));
	return { min_bps: min, max_bps: max, default_bps: def };
}

/**
 * The creator-fee rule a launch on this quote follows: whether the creator may
 * pick a rate, the range they may pick from, and the schedule rate that applies
 * when they may not.
 */
export function creatorFeeRule({ global, scheduleCreatorBps, admitted }) {
	const configured = configuredCreatorFeeRange();
	const chainOn = Boolean(global?.creatorFeeConfigurable);
	const chainMax = global?.maxConfigurableCreatorFeeBps != null ? Number(global.maxConfigurableCreatorFeeBps.toString()) : 0;
	// The program takes 1..=max when the gate is on, and only on an admitted quote.
	const configurable = chainOn && admitted && chainMax >= 1;
	if (!configurable) {
		return {
			configurable: false,
			min_bps: null,
			max_bps: null,
			default_bps: null,
			fixed_bps: scheduleCreatorBps,
			reason: !chainOn ? 'The program is not accepting per-coin creator fees right now; the schedule rate applies.' : 'This quote pays the schedule rate.',
		};
	}
	const min = Math.max(1, configured.min_bps);
	const max = Math.min(configured.max_bps, chainMax);
	if (min > max) {
		return { configurable: false, min_bps: null, max_bps: null, default_bps: null, fixed_bps: scheduleCreatorBps, reason: 'The configured range does not overlap what the program allows; the schedule rate applies.' };
	}
	return {
		configurable: true,
		min_bps: min,
		max_bps: max,
		default_bps: Math.min(max, Math.max(min, configured.default_bps)),
		fixed_bps: null,
		reason: null,
	};
}

/**
 * Candidate quote assets for a network: SOL, the network's USDC, the SDK's
 * stable list and the registry stables. Order is the order the picker shows.
 */
function candidates({ network, sdkStables }) {
	const list = [{ id: 'sol', symbol: 'SOL', label: 'Solana', mint: WSOL_MINT, kind: 'sol', decimals: 9 }];
	const seen = new Set([WSOL_MINT]);
	const push = (mint, symbol) => {
		if (!mint || seen.has(mint)) return;
		seen.add(mint);
		const sym = symbol || 'TOKEN';
		list.push({
			id: sym.toLowerCase(),
			symbol: sym,
			label: sym === 'USDC' ? 'USD Coin' : sym,
			mint,
			kind: STABLE_SYMBOLS.has(sym) ? 'stable' : 'exotic',
			decimals: DECIMALS[sym] ?? 6,
		});
	};
	push(usdcMintFor(network), 'USDC');
	// The SDK's stable list and the registry are mainnet addresses. On devnet the
	// only stable that exists is the devnet USDC above, so a mainnet mint there
	// would just be a second, dead `usdc` entry.
	if (network === 'mainnet') {
		for (const pk of sdkStables) push(pk.toBase58(), QUOTE_MINTS[pk.toBase58()] || 'USDC');
		for (const [mint, symbol] of Object.entries(QUOTE_MINTS)) {
			if (STABLE_SYMBOLS.has(symbol)) push(mint, symbol);
		}
	}
	return list;
}

function feeScheduleFor({ pumpSdk, feeConfig, quotePk, marketCap }) {
	if (!feeConfig) return null;
	const fees = pumpSdk.selectCurveFeeSchedule({ feeConfig, quoteMint: quotePk, marketCap });
	const n = (v) => Number(v.toString());
	return { lp_bps: n(fees.lpFeeBps), protocol_bps: n(fees.protocolFeeBps), creator_bps: n(fees.creatorFeeBps) };
}

async function readPairs(network) {
	const pumpSdk = await import('@pump-fun/pump-sdk');
	const { online, BN } = await getPumpSdk({ network });
	const [global, feeConfig, supported] = await Promise.all([
		online.fetchGlobal(),
		online.fetchFeeConfig().catch(() => null),
		online.fetchSupportedQuoteMints().catch(() => null),
	]);
	const admittedBy = new Map();
	for (const s of supported || []) admittedBy.set(s.mint.toBase58(), s);
	const createEnabled = global.createV2Enabled !== false;

	const pairs = candidates({ network, sdkStables: pumpSdk.STABLE_QUOTE_MINTS }).map((c) => {
		const quotePk = solanaPubkey(c.mint);
		const supportedEntry = c.kind === 'sol' ? { source: 'sol', initialVirtualQuoteReserves: global.initialVirtualQuoteReserves } : admittedBy.get(c.mint) || null;
		const admitted = Boolean(supportedEntry);
		const reserves = supportedEntry?.initialVirtualQuoteReserves || null;
		// A fresh curve's market cap in quote base units: the initial virtual
		// quote reserves against the full initial virtual token supply.
		const marketCap = reserves ? new BN(reserves.toString()) : new BN(0);
		let schedule = null;
		try {
			schedule = feeScheduleFor({ pumpSdk, feeConfig, quotePk, marketCap });
		} catch {
			schedule = null;
		}
		const creator = creatorFeeRule({ global, scheduleCreatorBps: schedule?.creator_bps ?? null, admitted });
		const status = !createEnabled ? 'create_disabled' : admitted ? 'live' : 'not_admitted';
		return {
			...c,
			mint: c.kind === 'sol' ? null : c.mint,
			wrapped_mint: c.kind === 'sol' ? WSOL_MINT : null,
			status,
			admission: c.kind === 'sol' ? 'native' : supportedEntry ? String(supportedEntry.source) : 'none',
			initial_virtual_quote_reserves: reserves ? reserves.toString() : null,
			fees: schedule,
			creator_fee: creator,
		};
	});

	return {
		network,
		status: 'ok',
		create_enabled: createEnabled,
		creator_fee_configurable: Boolean(global.creatorFeeConfigurable),
		configured_range: configuredCreatorFeeRange(),
		pairs,
		read_at: new Date().toISOString(),
	};
}

/**
 * The supported quote assets with live status and the allowed creator-fee range.
 * Cached for a minute per network. An RPC failure returns the configured range
 * with every pair marked `unknown` and `status: 'degraded'`, never a throw, so
 * the picker can still render and say what it could not verify.
 */
export async function listLaunchPairs({ network = 'mainnet', fresh = false } = {}) {
	const key = network;
	const hit = cache.get(key);
	if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
	try {
		const value = await readPairs(network);
		cache.set(key, { at: Date.now(), value });
		return value;
	} catch (err) {
		if (hit) return { ...hit.value, status: 'stale', stale_reason: String(err?.message || err).slice(0, 160) };
		const pumpSdk = await import('@pump-fun/pump-sdk');
		return {
			network,
			status: 'degraded',
			degraded_reason: String(err?.message || err).slice(0, 160),
			create_enabled: null,
			creator_fee_configurable: null,
			configured_range: configuredCreatorFeeRange(),
			pairs: candidates({ network, sdkStables: pumpSdk.STABLE_QUOTE_MINTS }).map((c) => ({
				...c,
				mint: c.kind === 'sol' ? null : c.mint,
				wrapped_mint: c.kind === 'sol' ? WSOL_MINT : null,
				status: 'unknown',
				admission: c.kind === 'sol' ? 'native' : 'unknown',
				initial_virtual_quote_reserves: null,
				fees: null,
				creator_fee: { configurable: null, ...configuredCreatorFeeRange(), fixed_bps: null, reason: 'Chain state could not be read; the range shown is the platform config only.' },
			})),
			read_at: new Date().toISOString(),
		};
	}
}

/** One pair by id ('sol', 'usdc', ...) or by mint. Null when not a candidate. */
export async function findLaunchPair({ network = 'mainnet', idOrMint }) {
	const listing = await listLaunchPairs({ network });
	const needle = String(idOrMint || 'sol').trim();
	const lower = needle.toLowerCase();
	return listing.pairs.find((p) => p.id === lower || p.symbol === needle.toUpperCase() || (p.mint && p.mint === needle) || (p.wrapped_mint && p.wrapped_mint === needle)) || null;
}

// Volume scenarios the earnings projection is shown against. Expressed in the
// quote asset so a USDC pair projects in USDC and a SOL pair in SOL.
const VOLUME_SCENARIOS = Object.freeze({
	SOL: [10, 100, 1_000, 10_000],
	STABLE: [1_000, 10_000, 100_000, 1_000_000],
});

/**
 * What a creator-fee rate does to earnings: the creator's cut of each traded
 * unit and the take at a few volume scenarios. Pure arithmetic, no chain.
 *
 * @param {{ bps: number, quoteSymbol: string, kind?: 'sol'|'stable'|'exotic' }} o
 */
export function earningsProjection({ bps, quoteSymbol, kind = 'sol' }) {
	const rate = Math.max(0, Number(bps) || 0) / 10_000;
	const scenarios = kind === 'sol' ? VOLUME_SCENARIOS.SOL : VOLUME_SCENARIOS.STABLE;
	return {
		bps: Math.round(rate * 10_000),
		percent: Number((rate * 100).toFixed(2)),
		per_unit: `${rate.toFixed(4)} ${quoteSymbol} earned per 1 ${quoteSymbol} traded`,
		scenarios: scenarios.map((volume) => ({
			volume,
			earnings: Number((volume * rate).toFixed(kind === 'sol' ? 4 : 2)),
			quote: quoteSymbol,
		})),
	};
}

/** Test seam: drop the cache. */
export function resetLaunchPairsCache() {
	cache.clear();
}
