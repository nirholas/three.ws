// @ts-check
// Creator-fee reads for pump.fun coins: the one client behind the coin page's
// "Creator earned" figure (api/pump/launch-detail.js), the per-agent earnings
// snapshot cron (api/cron/creator-earnings-snapshot.js) and anything else that
// needs to know what a coin's creator has earned.
//
// Where the numbers come from:
//
//   creator      the coin's on-chain fee recipient, read from the bonding curve
//                (or the AMM pool once the coin graduated). pump.fun's coin
//                metadata `creator` field is NOT used: for a gasless launch it
//                names the sponsor that paid the transaction, not the wallet
//                that collects the fees.
//   earned       pump.fun's creator-fee index, GET frontend-api-v3.pump.fun
//                /fees/creator/<wallet>?interval=1d|30m&period=30d|7d: the
//                lifetime figure per quote asset (`earned`) plus a bucketed
//                series. When that read fails, the lifetime figure falls back to
//                swap-api.pump.fun /v2/creators/<wallet>/fees/total. pump.fun
//                retired the /v1/creators routes both used before (404 since
//                early October 2026). The index is keyed by creator WALLET, so
//                one wallet that created several coins reports one combined
//                figure. The fee-sharing totals
//                endpoint the coin page used before answers 0 for every coin
//                that never set up a sharing config, which is every coin
//                three.ws has launched, so the page never showed a real figure.
//   unclaimed    the creator vault balances read straight from the cluster
//                (pump bonding-curve vault plus the PumpSwap coin-creator vault),
//                plus, when the caller names the wallet's coins, the fees v3 and
//                PumpSwap v2 trades left on their curves and pools: the lamports
//                a claim (which sweeps those buckets first) would collect now.
//   claimed      earned minus unclaimed: every lamport the index says was
//                earned and the vault no longer holds was swept by a claim.
//   coin-level   the index above reports one lifetime total per wallet, so a
//                wallet with several coins sees that same figure smeared
//                across all of them. fetchCoinEarnings sums the `distribution`
//                events on ONE coin's own timeline (swap-api
//                /v1/coins/<mint>/timeline) addressed to the wallet, which is
//                the only source that can tell which coin actually paid it.
//                The creator-earnings snapshot stores this per-coin figure
//                alongside the wallet-level one and the delta between them
//                (reconciliation), rather than silently picking one.
//
// Every pump.fun call runs behind the shared 'pumpfun:creator-fees' circuit
// breaker, so a sick upstream costs one timeout per instance, not one per read.
// An unhealthy answer (network error, timeout, non-2xx, unparseable body) throws
// inside the breaker and resolves to a `{ ok: false }` result; a healthy answer
// with no earnings is `{ ok: true }` with zero lamports. Callers keep their last
// good value on `ok: false` and never invent a figure.

import { PublicKey } from '@solana/web3.js';
import { withBreaker } from './resilience.js';
import { pumpFetchJson, PUMP_FRONTEND_BASE, PUMP_SWAP_BASE } from './pump-feed-fetch.js';
import { readCreatorFeeBuckets, sumByQuote, unsweptCreatorFees } from '../../src/solana/pump-creator-sweep.js';

// The bucket reads and sweep builders are chain-only and shared with the
// browser skills, so they live in src/solana/pump-creator-sweep.js.
export {
	MAX_SWEEPS_PER_TX,
	creatorExtraQuoteMints,
	creatorFeeSweepInstructions,
	readCreatorFeeBuckets,
	sumByQuote,
	unsweptCreatorFees,
} from '../../src/solana/pump-creator-sweep.js';

export const CREATOR_FEES_BREAKER = 'pumpfun:creator-fees';
// The fallback rung gets its own breaker so a sick primary cannot open it.
export const CREATOR_FEES_FALLBACK_BREAKER = 'pumpfun:creator-fees-swap-v2';
const BREAKER_OPTS = { threshold: 3, halfOpenAfterMs: 30_000 };
const TIMEOUT_MS = 6000;

/** @param {unknown} v */
function toLamports(v) {
	if (v == null || v === '') return null;
	try {
		const n = BigInt(String(v).split('.')[0]);
		return n < 0n ? 0n : n;
	} catch {
		return null;
	}
}

// pump.fun names the SOL quote by the wrapped-SOL mint on /fees/creator and by
// the system program id on the swap-api totals.
const SOL_QUOTES = new Set(['So11111111111111111111111111111111111111112', '11111111111111111111111111111111']);

/**
 * Run one pump.fun read behind a breaker. `fn` throws on an unhealthy upstream;
 * the breaker turns that (or an open circuit) into `{ ok: false }`.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} [breaker]
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error: string }>}
 */
async function guarded(fn, breaker = CREATOR_FEES_BREAKER) {
	return withBreaker(
		breaker,
		async () => ({ ok: /** @type {const} */ (true), value: await fn() }),
		{
			...BREAKER_OPTS,
			fallback: (err) => ({
				ok: /** @type {const} */ (false),
				error: String(/** @type {any} */ (err)?.message || err || 'pump.fun unavailable').slice(0, 200),
			}),
		},
	);
}

/**
 * GET /fees/creator/<wallet>: lifetime earnings per quote plus one series.
 * Throws on anything but a well-formed answer.
 * @param {string} wallet
 * @param {'1d'|'30m'} interval
 */
async function fetchCreatorEarnings(wallet, interval) {
	const period = interval === '30m' ? '7d' : '30d';
	const r = await pumpFetchJson(
		`${PUMP_FRONTEND_BASE}/fees/creator/${encodeURIComponent(wallet)}?interval=${interval}&period=${period}`,
		{ timeoutMs: TIMEOUT_MS },
	);
	if (!r.ok) throw new Error(`pump.fun creator fees ${r.status}`);
	if (!Array.isArray(r.body?.earned) || !Array.isArray(r.body?.series)) {
		throw new Error('pump.fun creator fees: no earned/series in response');
	}
	return r.body;
}

/**
 * The SOL leg of a list of per-quote amounts, in lamports. No SOL leg means
 * nothing was earned in SOL: zero, not unknown.
 * @param {Array<{ quote?: { address?: string }, amount?: { raw?: string } }>} legs
 */
function solLamports(legs) {
	const leg = legs.find((l) => SOL_QUOTES.has(String(l?.quote?.address || '')));
	if (!leg) return 0n;
	const lamports = toLamports(leg.amount?.raw);
	if (lamports == null) throw new Error('pump.fun creator fees: SOL leg without an amount');
	return lamports;
}

/**
 * Lifetime creator fees earned by one wallet, in lamports, across every coin
 * that wallet created.
 * @param {string} wallet
 */
export async function fetchCreatorFeeTotal(wallet) {
	const primary = await guarded(async () => solLamports((await fetchCreatorEarnings(wallet, '1d')).earned));
	if (primary.ok) return primary;
	const fallback = await guarded(async () => {
		const r = await pumpFetchJson(
			`${PUMP_SWAP_BASE}/v2/creators/${encodeURIComponent(wallet)}/fees/total`,
			{ timeoutMs: TIMEOUT_MS },
		);
		if (!r.ok) throw new Error(`pump.fun creator fee totals ${r.status}`);
		const legs = r.body?.totalFeesByQuoteMint;
		if (!Array.isArray(legs)) throw new Error('pump.fun creator fee totals: no totalFeesByQuoteMint');
		return solLamports(legs.map((l) => ({ quote: { address: l?.quoteMintAddress }, amount: { raw: l?.totalFeesAtomic } })));
	}, CREATOR_FEES_FALLBACK_BREAKER);
	return fallback.ok ? fallback : { ok: false, error: `${primary.error}; fallback: ${fallback.error}` };
}

/**
 * Every coin pump.fun's fee-sharing program says shares fees with `wallet`
 * (swap-api /v1/fee-sharing/account/<wallet>/shares), paged at 100: a creator
 * with more coins than one page used to silently show only the first 20.
 * Used to cross-check that the creator-fee snapshot has not missed a coin.
 * @param {string} wallet
 * @param {{ maxPages?: number }} [opts]
 */
export async function fetchAllShares(wallet, { maxPages = 20 } = {}) {
	return guarded(async () => {
		const items = [];
		let cursor = null;
		for (let page = 0; page < maxPages; page++) {
			const url = new URL(`${PUMP_SWAP_BASE}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/shares`);
			url.searchParams.set('limit', '100');
			if (cursor) url.searchParams.set('cursor', cursor);
			const r = await pumpFetchJson(url.toString(), { timeoutMs: TIMEOUT_MS });
			if (!r.ok) throw new Error(`pump.fun fee-sharing shares ${r.status}`);
			for (const it of r.body?.items || []) {
				if (it?.mint) items.push({ mint: it.mint, bps: typeof it.bps === 'number' ? it.bps : null, is_admin: !!it.isAdmin });
			}
			if (!r.body?.pagination?.hasMore) return { items, truncated: false };
			cursor = r.body.pagination.nextCursor;
		}
		return { items, truncated: true };
	});
}

/**
 * How much `wallet` actually earned from ONE coin: the sum of `distribution`
 * events addressed to it on that coin's own timeline (swap-api
 * /v1/coins/<mint>/timeline), paged at 100. This is the only per-coin figure
 * pump.fun exposes; /fees/creator reports one lifetime total per wallet, which
 * a wallet with several coins can only see smeared equally across all of them.
 * A mint with no timeline (never indexed) resolves to zero distributions, not
 * an error.
 * @param {string} mint
 * @param {string} wallet
 * @param {{ maxPages?: number }} [opts]
 */
export async function fetchCoinEarnings(mint, wallet, { maxPages = 30 } = {}) {
	return guarded(async () => {
		let cursor = null;
		let lamports = 0n;
		let distributions = 0;
		let firstAt = null;
		let lastAt = null;
		for (let page = 0; page < maxPages; page++) {
			const url = new URL(`${PUMP_SWAP_BASE}/v1/coins/${encodeURIComponent(mint)}/timeline`);
			url.searchParams.set('limit', '100');
			if (cursor) url.searchParams.set('cursor', cursor);
			const r = await pumpFetchJson(url.toString(), { timeoutMs: TIMEOUT_MS });
			if (!r.ok) {
				if (r.status === 404) break;
				throw new Error(`pump.fun coin timeline ${r.status}`);
			}
			for (const ev of r.body?.items || []) {
				if (ev?.eventType !== 'distribution') continue;
				for (const rec of ev.recipients || []) {
					if (rec?.address !== wallet) continue;
					const amount = toLamports(rec.amount);
					if (amount == null || amount <= 0n) continue;
					lamports += amount;
					distributions++;
					if (!firstAt || ev.timestamp < firstAt) firstAt = ev.timestamp;
					if (!lastAt || ev.timestamp > lastAt) lastAt = ev.timestamp;
				}
			}
			if (!r.body?.pagination?.hasMore) break;
			cursor = r.body.pagination.nextCursor;
		}
		return { mint, lamports, distributions, first_at: firstAt, last_at: lastAt };
	});
}

/**
 * Bucketed creator fees for one wallet, SOL leg only. pump.fun serves `1d`
 * buckets for the last 30 days and `30m` buckets for the last 7. It no longer
 * reports a trade count per bucket, so `num_trades` is null. Zero buckets are
 * dropped; they add nothing to a windowed sum.
 * @param {string} wallet
 * @param {'1d'|'30m'} interval
 */
export async function fetchCreatorFeeBuckets(wallet, interval) {
	return guarded(async () => {
		const body = await fetchCreatorEarnings(wallet, interval);
		const out = [];
		for (const b of body.series) {
			const at = Number(b?.bucketStart);
			if (!Number.isFinite(at) || !Array.isArray(b?.byQuote)) continue;
			const fee = solLamports(b.byQuote);
			if (fee === 0n) continue;
			out.push({ bucket_start: new Date(at).toISOString(), fee_lamports: fee, num_trades: null });
		}
		return out;
	});
}

/**
 * The on-chain fee recipient of each mint, read from the bonding curve, or from
 * the canonical PumpSwap pool once the coin graduated. A mint whose curve
 * cannot be read maps to null.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string[]} mints
 * @returns {Promise<Map<string, { creator: string, graduated: boolean } | null>>}
 */
export async function resolveCoinCreators(connection, mints) {
	const buckets = await readCreatorFeeBuckets(connection, mints);
	/** @type {Map<string, { creator: string, graduated: boolean } | null>} */
	const out = new Map();
	for (const mint of mints) {
		const b = buckets.get(mint);
		out.set(mint, b ? { creator: b.pool?.coinCreator ?? b.creator, graduated: b.complete } : null);
	}
	return out;
}

/**
 * Lamports sitting unclaimed in a creator's vaults right now (pump bonding-curve
 * vault plus the PumpSwap coin-creator vault), above rent. Null when the cluster
 * could not be read.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} wallet
 * @returns {Promise<bigint | null>}
 */
export async function readUnclaimedLamports(connection, wallet) {
	try {
		const { OnlinePumpSdk } = await import('@pump-fun/pump-sdk');
		const bn = await new OnlinePumpSdk(connection).getCreatorVaultBalanceBothPrograms(new PublicKey(wallet));
		return BigInt(bn.toString());
	} catch {
		return null;
	}
}

/**
 * SOL creator fees still on `wallet`'s coins' curves and pools (not yet swept
 * into the vault), in lamports. Null when the cluster could not be read.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} wallet
 * @param {string[]} mints
 * @returns {Promise<bigint | null>}
 */
export async function readUnsweptLamports(connection, wallet, mints) {
	if (!mints.length) return 0n;
	try {
		const legs = unsweptCreatorFees((await readCreatorFeeBuckets(connection, mints)).values(), wallet);
		const byQuote = sumByQuote(legs);
		let total = 0n;
		for (const [quote, amount] of byQuote) if (SOL_QUOTES.has(quote)) total += amount;
		return total;
	} catch {
		return null;
	}
}

/**
 * One wallet's full creator-fee report: lifetime total, unclaimed, derived
 * claimed. `ok: false` when pump.fun could not answer (the caller keeps its last
 * good figure). `unclaimed_lamports` is null when the cluster read failed; the
 * report is still good, claimed is then unknown.
 *
 * Pass the wallet's coins as `mints` so unclaimed also counts the fees v3 and
 * PumpSwap v2 trades left on their curves and pools: they are earned and not
 * yet collected, and without them every such lamport would read as claimed.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} wallet
 * @param {{ mints?: string[] }} [opts]
 */
export async function readCreatorFeeReport(connection, wallet, { mints = [] } = {}) {
	const [total, vault, unswept] = await Promise.all([
		fetchCreatorFeeTotal(wallet),
		readUnclaimedLamports(connection, wallet),
		readUnsweptLamports(connection, wallet, mints),
	]);
	const unclaimed = vault == null || unswept == null ? null : vault + unswept;
	if (!total.ok) return { ok: false, error: total.error };
	const earned = total.value;
	// The index can lag a fresh trade by a few seconds while the vault is live, so
	// the vault can briefly exceed the indexed total. Earned is never reported
	// below what is provably sitting in the vault.
	const earnedLamports = unclaimed != null && unclaimed > earned ? unclaimed : earned;
	return {
		ok: true,
		earned_lamports: earnedLamports,
		unclaimed_lamports: unclaimed,
		claimed_lamports: unclaimed == null ? null : earnedLamports - unclaimed,
	};
}
