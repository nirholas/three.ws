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
//                the exact lamports a claim would sweep right now.
//   claimed      earned minus unclaimed: every lamport the index says was
//                earned and the vault no longer holds was swept by a claim.
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
 * The on-chain fee recipient of each mint. Bonding curves are read in one
 * batched RPC call per 100 mints; a graduated coin's recipient comes from its
 * canonical PumpSwap pool. A mint whose curve cannot be read maps to null.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string[]} mints
 * @returns {Promise<Map<string, { creator: string, graduated: boolean } | null>>}
 */
export async function resolveCoinCreators(connection, mints) {
	const [{ PumpSdk, bondingCurvePda, canonicalPumpPoolPda }, { OnlinePumpAmmSdk }] = await Promise.all([
		import('@pump-fun/pump-sdk'),
		import('@pump-fun/pump-swap-sdk'),
	]);
	const offline = new PumpSdk();
	/** @type {Map<string, { creator: string, graduated: boolean } | null>} */
	const out = new Map();
	for (let i = 0; i < mints.length; i += 100) {
		const chunk = mints.slice(i, i + 100);
		const infos = await connection.getMultipleAccountsInfo(chunk.map((m) => bondingCurvePda(new PublicKey(m))));
		chunk.forEach((mint, j) => {
			const info = infos[j];
			const curve = info ? offline.decodeBondingCurveNullable(info) : null;
			out.set(mint, curve ? { creator: curve.creator.toBase58(), graduated: curve.complete === true } : null);
		});
	}
	const amm = new OnlinePumpAmmSdk(connection);
	for (const [mint, row] of out) {
		if (!row?.graduated) continue;
		const pool = await amm.fetchPool(canonicalPumpPoolPda(new PublicKey(mint))).catch(() => null);
		if (pool?.coinCreator) row.creator = pool.coinCreator.toBase58();
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
 * One wallet's full creator-fee report: lifetime total, unclaimed, derived
 * claimed. `ok: false` when pump.fun could not answer (the caller keeps its last
 * good figure). `unclaimed_lamports` is null when the cluster read failed; the
 * report is still good, claimed is then unknown.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string} wallet
 */
export async function readCreatorFeeReport(connection, wallet) {
	const [total, unclaimed] = await Promise.all([
		fetchCreatorFeeTotal(wallet),
		readUnclaimedLamports(connection, wallet),
	]);
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
