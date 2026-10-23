/**
 * Launch-quality signals for coin intel, read off public chain data:
 *
 *   · gini        how unevenly the top holders split the supply (0 even, 1 one wallet)
 *   · seeding     share of the first buyers whose first funder is one shared wallet
 *   · v1 launch   whether the creation transaction used Solana transaction v1
 *
 * Gini and the seeded share also feed the oracle (conviction.js reads
 * `holder_gini` and `seeded_share` off the launch signals). Funder tracing and
 * the creation lookup are RPC-heavy, so both are bounded and cached per mint and
 * report `partial: true` / `available: false` instead of blocking the read.
 */

import { sql } from '../db.js';
import { cacheGet, cacheSet } from '../cache.js';
import { getConnection } from '../pump.js';
import { connectivityFromFunders, resolveFunder, rpcEndpoint } from '../pump-intel/enrich.js';
import { findCreation } from './creation-tx.js';

export const GINI_TOP_N = 50;
export const SEED_BUYERS = 10;
export const SEED_BUDGET_MS = 7_000;
const SEED_CONCURRENCY = 3;
const SIGNAL_TTL_S = 3_600;
const CREATION_UNAVAILABLE_TTL_S = 600;
const CREATION_BUDGET_MS = 6_000;

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Gini coefficient of non-negative balances (bigint or number). Null when there
 * are fewer than two non-zero balances, where inequality is undefined.
 */
export function giniCoefficient(balances) {
	const xs = balances
		.map((b) => Number(b))
		.filter((n) => Number.isFinite(n) && n > 0)
		.sort((a, b) => a - b);
	const n = xs.length;
	if (n < 2) return null;
	let total = 0;
	let weighted = 0;
	xs.forEach((x, i) => {
		total += x;
		weighted += (i + 1) * x;
	});
	return round4(Math.max(0, Math.min(1, (2 * weighted) / (n * total) - (n + 1) / n)));
}

/**
 * Gini over the largest `topN` holders, bonding curve and AMM pool excluded
 * (program-owned liquidity, not holders). `holders` is sorted largest first.
 */
export function holderGini(holders, { curve, pool, topN = GINI_TOP_N }) {
	const program = new Set([curve, pool].filter(Boolean));
	const people = holders.filter((h) => !program.has(h.wallet)).slice(0, topN);
	const gini = giniCoefficient(people.map((h) => h.units));
	return { gini, gini_n: gini == null ? null : people.length };
}

/** The first `k` distinct buyers by time, creator excluded. Trades may arrive in any order. */
export function firstBuyers(trades, { creator, k = SEED_BUYERS }) {
	const seen = new Set();
	const out = [];
	for (const t of [...trades].sort((a, b) => a.t - b.t)) {
		if (!t.buy || !t.user || t.user === creator || seen.has(t.user)) continue;
		seen.add(t.user);
		out.push(t.user);
		if (out.length >= k) break;
	}
	return out;
}

/**
 * Summarize resolved funders: the share of resolved buyers funded by the single
 * largest shared funder. A funder with one buyer is not a seed, so the share is
 * 0 when no funder reaches two. Null when fewer than three funders are known.
 */
export function seedingSummary(funderByWallet, { sampled, partial }) {
	const c = connectivityFromFunders(funderByWallet);
	const seeded = c.connectivity == null ? null : c.largest_cluster >= 2 ? c.connectivity : 0;
	return {
		available: true,
		sampled,
		resolved: c.known,
		seeded_share: seeded,
		largest_cluster: c.largest_cluster,
		partial,
	};
}

/**
 * Trace the first funders of the first buyers within a wall-clock budget. A
 * wallet not resolved in time is left out and the result is flagged partial.
 * `resolve` is injectable for tests.
 */
export async function traceSeeding(buyers, { endpoint, budgetMs = SEED_BUDGET_MS, resolve = resolveFunder } = {}) {
	const deadline = Date.now() + budgetMs;
	const funders = {};
	let attempted = 0;
	let next = 0;
	const worker = async () => {
		while (next < buyers.length) {
			const wallet = buyers[next++];
			const left = deadline - Date.now();
			if (left <= 0) return;
			attempted++;
			try {
				const r = await Promise.race([
					resolve(wallet, { endpoint }),
					new Promise((_, rej) => setTimeout(() => rej(new Error('budget')), left).unref?.()),
				]);
				if (r?.funder) funders[wallet] = r.funder;
			} catch {
				/* unresolved wallet: counted as not sampled */
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(SEED_CONCURRENCY, buyers.length) }, worker));
	const resolvedAll = Object.keys(funders).length === buyers.length;
	return seedingSummary(funders, { sampled: buyers.length, partial: !resolvedAll });
}

/** Cached funder-seeding read for a mint's first buyers; `{ available: false }` when the trade history cannot name them. */
export async function readSeeding(mint, trades, { creator, network = 'mainnet' } = {}) {
	if (!trades) return { available: false, reason: 'trade history unavailable' };
	const key = `pump:seeding:${mint}`;
	const hit = await cacheGet(key);
	if (hit) return hit;
	const buyers = firstBuyers(trades, { creator });
	if (buyers.length < 3) return { available: false, reason: 'too few early buyers to trace' };
	const out = await traceSeeding(buyers, { endpoint: rpcEndpoint(network) });
	if (out.resolved > 0) cacheSet(key, out, SIGNAL_TTL_S).catch(() => {});
	return out;
}

/** Cached creation-transaction version for a mint, as the "v1 launch" chip reads it. */
export async function readLaunchVersion(mint, { network = 'mainnet' } = {}) {
	const key = `pump:launch-version:${mint}`;
	const hit = await cacheGet(key);
	if (hit) return hit;
	const creation = await Promise.race([
		findCreation(getConnection({ network }), mint),
		new Promise((resolve) => setTimeout(() => resolve({ available: false, reason: 'creation lookup timed out' }), CREATION_BUDGET_MS).unref?.()),
	]);
	const out = creation.available
		? {
				available: true,
				version: creation.version,
				version_label: creation.version_label,
				is_v1: creation.version === 1,
				signature: creation.signature,
			}
		: { available: false, reason: creation.reason };
	cacheSet(key, out, out.available ? 30 * 86_400 : CREATION_UNAVAILABLE_TTL_S).catch(() => {});
	return out;
}

/**
 * Merge the oracle's launch features into the coin's intel row, so the next
 * refit trains on them and live scoring reads them. A coin the radar never
 * observed has no row and is skipped; a value that could not be measured is
 * never written. Never throws.
 */
export async function persistOracleSignals(mint, { gini, seededShare, network = 'mainnet' }) {
	const patch = {
		...(gini != null ? { holder_gini: gini } : {}),
		...(seededShare != null ? { seeded_share: seededShare } : {}),
	};
	if (!Object.keys(patch).length) return;
	try {
		await sql`
			update pump_coin_intel
			set signals = coalesce(signals, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
			where mint = ${mint} and network = ${network}
		`;
	} catch (err) {
		console.warn('[holder-signals] oracle signal write failed:', err?.message || err);
	}
}
