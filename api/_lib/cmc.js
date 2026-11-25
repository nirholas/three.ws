// CoinMarketCap Pro API access.
//
// The platform's key is on the free Basic plan: 15,000 credits a month, 50
// requests a minute, metadata and latest quotes only (no historical OHLCV,
// verified 2026-11-25: /v2/cryptocurrency/ohlcv/historical answers 403 1006).
// Most calls cost 1 credit; a quotes call costs 1 credit per 100 coins.
//
// Production stores the key as CMC_API_KEY (Secret Manager `cmc-api-key`).
// COINMARKETCAP_API_KEY is accepted too, because that is the name the code read
// first and an operator may have set it locally.
//
// Two guards keep one surface from starving the others (the Fear & Greed rung
// and the coin-page fallback share the key):
//   1. A limit rejection (429: per-minute 1008, daily 1009, monthly 1010)
//      benches CMC process-wide, until the window it names has passed.
//   2. Callers that can be driven by crawlers (one call per unknown coin id)
//      spend from a shared daily budget, so a sweep of long-tail pages cannot
//      burn the month in a day.

import { fetchUpstreamJson } from './upstream-fetch.js';
import { cacheGet, cacheSet } from './cache.js';

export const CMC_BASE = 'https://pro-api.coinmarketcap.com';

export function cmcApiKey() {
	return (process.env.CMC_API_KEY || process.env.COINMARKETCAP_API_KEY || '').trim() || null;
}

let _benchedUntil = 0;

export function isCmcBenched(now = Date.now()) {
	return _benchedUntil > now;
}

/** Test-only hook. */
export function resetCmcHealth() {
	_benchedUntil = 0;
}

function nextUtcDay(now) {
	const d = new Date(now);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function nextUtcMonth(now) {
	const d = new Date(now);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** How long a CMC rejection should bench the key, or 0 when it is not a limit. */
export function cmcBenchUntil(status, body, now = Date.now()) {
	if (status !== 429) return 0;
	const code = /"error_code"\s*:\s*"?(\d+)/.exec(String(body || ''))?.[1];
	if (code === '1010') return nextUtcMonth(now);
	if (code === '1009') return nextUtcDay(now);
	return now + 60_000;
}

/**
 * GET a CMC Pro path (must start with '/'). Throws when no key is configured,
 * while benched, or on any upstream failure (the error carries `.status`).
 */
export async function cmcGet(path, { name = 'cmc', timeoutMs = 8_000, attempts = 1 } = {}) {
	const key = cmcApiKey();
	if (!key) throw new Error('CoinMarketCap key not configured');
	if (isCmcBenched()) {
		const err = new Error('CoinMarketCap is benched after a limit rejection');
		err.status = 429;
		throw err;
	}
	try {
		return await fetchUpstreamJson(
			`${CMC_BASE}${path}`,
			{ headers: { 'X-CMC_PRO_API_KEY': key, accept: 'application/json' } },
			{ name, timeoutMs, attempts },
		);
	} catch (err) {
		const until = cmcBenchUntil(err?.status, err?.body);
		if (until) {
			_benchedUntil = until;
			console.warn(`[cmc] ${err.status} limit rejection; benched until ${new Date(until).toISOString()}`);
		}
		throw err;
	}
}

// 15,000 a month is 500 a day. The coin-page fallback gets most of it; the
// Fear & Greed rung costs at most a few credits a day and does not draw here.
export const CMC_DAILY_FALLBACK_CREDITS = 400;
const _localSpend = new Map();

/**
 * Reserve `credits` from today's shared fallback budget. Returns false when the
 * day's budget is spent. The counter lives in the shared cache so the fleet
 * spends one budget; a lost race only lets a request or two through, which the
 * margin under the monthly limit absorbs.
 */
export async function reserveCmcCredits(credits, { dailyCap = CMC_DAILY_FALLBACK_CREDITS, now = Date.now() } = {}) {
	const day = new Date(now).toISOString().slice(0, 10);
	const key = `cmc:credits:${day}`;
	const shared = Number(await cacheGet(key).catch(() => null));
	const local = _localSpend.get(day) || 0;
	const spent = Math.max(Number.isFinite(shared) ? shared : 0, local);
	if (spent + credits > dailyCap) return false;
	const next = spent + credits;
	_localSpend.clear();
	_localSpend.set(day, next);
	await cacheSet(key, next, 2 * 86_400).catch(() => {});
	return true;
}

/** Test-only hook. */
export function resetCmcBudget() {
	_localSpend.clear();
}
