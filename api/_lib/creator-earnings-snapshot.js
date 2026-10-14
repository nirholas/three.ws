// @ts-check
// The creator-fee earnings snapshot: walks every mainnet coin in
// pump_agent_mints, resolves each coin's on-chain fee recipient, reads that
// wallet's creator fees from pump.fun's index (plus its unclaimed vault balance
// from the cluster), and stores the result in agent_coin_earnings and
// creator_fee_buckets (migration 20260930121000_agent_coin_earnings.sql).
//
// Run by api/cron/creator-earnings-snapshot.js on Cloud Scheduler. Devnet coins
// are excluded: devnet trades carry no real value and pump.fun does not index
// them. When pump.fun or the RPC cannot answer, a coin keeps its last good
// figures (refreshed_at stays at the last success) and the failure is recorded
// in `error`; a coin that never had a good read is stored as 'unavailable'.
//
// Each coin also gets a second, independent figure: coin_earned_lamports,
// summed straight off that coin's own distribution timeline
// (pump-creator-fees.js's fetchCoinEarnings), instead of the wallet-level
// earned_lamports above, which is one lifetime total smeared across every
// coin the same wallet created. reconciliation_delta_lamports is the gap
// between the sum of those per-coin figures and the wallet's claimed total;
// a nonzero delta is stored and shown, never hidden.

import { sql } from './db.js';
import { getConnection } from './pump.js';
import {
	resolveCoinCreators,
	readCreatorFeeReport,
	fetchCreatorFeeBuckets,
	fetchCoinEarnings,
	fetchAllShares,
} from './pump-creator-fees.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const WALLET_CONCURRENCY = 4;
const COIN_CONCURRENCY = 4;

/** @param {bigint | null | undefined} v */
const big = (v) => (v == null ? null : v.toString());

/**
 * Map over `items` with at most `limit` in flight.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/**
 * Record a coin that has no figure this run. An existing row keeps its last good
 * figures and source; only the error and attempt time move.
 */
async function recordUnavailable(coin, { creator = null, walletCoins = 1, walletAgents = 1, reason }) {
	await sql`
		insert into agent_coin_earnings
			(mint, network, agent_id, creator, wallet_coin_count, wallet_agent_count, source, error, attempted_at)
		values
			(${coin.mint}, 'mainnet', ${coin.agent_id}, ${creator}, ${walletCoins}, ${walletAgents}, 'unavailable', ${reason}, now())
		on conflict (mint, network) do update set
			agent_id = excluded.agent_id,
			creator = coalesce(excluded.creator, agent_coin_earnings.creator),
			wallet_coin_count = excluded.wallet_coin_count,
			wallet_agent_count = excluded.wallet_agent_count,
			error = excluded.error,
			attempted_at = now()
	`;
}

async function recordReport(coin, { creator, walletCoins, walletAgents, report, coinEarnings, reconciliation }) {
	await sql`
		insert into agent_coin_earnings
			(mint, network, agent_id, creator, earned_lamports, claimed_lamports, unclaimed_lamports,
			 wallet_coin_count, wallet_agent_count, source, error,
			 coin_earned_lamports, coin_distributions, coin_earnings_source,
			 reconciliation_delta_lamports, reconciliation_pct, refreshed_at, attempted_at)
		values
			(${coin.mint}, 'mainnet', ${coin.agent_id}, ${creator},
			 ${big(report.earned_lamports)}, ${big(report.claimed_lamports)}, ${big(report.unclaimed_lamports)},
			 ${walletCoins}, ${walletAgents}, 'pumpfun_creator_fees', null,
			 ${coinEarnings ? big(coinEarnings.lamports) : null}, ${coinEarnings ? coinEarnings.distributions : null},
			 ${coinEarnings ? 'timeline' : null},
			 ${reconciliation ? big(reconciliation.delta_lamports) : null}, ${reconciliation ? reconciliation.delta_pct : null},
			 now(), now())
		on conflict (mint, network) do update set
			agent_id = excluded.agent_id,
			creator = excluded.creator,
			earned_lamports = excluded.earned_lamports,
			claimed_lamports = coalesce(excluded.claimed_lamports, agent_coin_earnings.claimed_lamports),
			unclaimed_lamports = coalesce(excluded.unclaimed_lamports, agent_coin_earnings.unclaimed_lamports),
			wallet_coin_count = excluded.wallet_coin_count,
			wallet_agent_count = excluded.wallet_agent_count,
			source = excluded.source,
			error = null,
			coin_earned_lamports = coalesce(excluded.coin_earned_lamports, agent_coin_earnings.coin_earned_lamports),
			coin_distributions = coalesce(excluded.coin_distributions, agent_coin_earnings.coin_distributions),
			coin_earnings_source = coalesce(excluded.coin_earnings_source, agent_coin_earnings.coin_earnings_source),
			reconciliation_delta_lamports = coalesce(excluded.reconciliation_delta_lamports, agent_coin_earnings.reconciliation_delta_lamports),
			reconciliation_pct = coalesce(excluded.reconciliation_pct, agent_coin_earnings.reconciliation_pct),
			refreshed_at = now(),
			attempted_at = now()
	`;
}

async function storeBuckets(creator, interval, buckets) {
	for (const b of buckets) {
		await sql`
			insert into creator_fee_buckets (creator, bucket_interval, bucket_start, fee_lamports, num_trades, refreshed_at)
			values (${creator}, ${interval}, ${b.bucket_start}, ${big(b.fee_lamports)}, ${b.num_trades ?? 0}, now())
			on conflict (creator, bucket_interval, bucket_start) do update set
				fee_lamports = excluded.fee_lamports,
				-- pump.fun stopped reporting trade counts; keep a count it gave earlier.
				num_trades = coalesce(${b.num_trades}, creator_fee_buckets.num_trades),
				refreshed_at = now()
		`;
	}
}

/**
 * Each coin's own distribution-timeline earnings for `creator`, plus the
 * wallet-level reconciliation: the sum of those per-coin figures against the
 * wallet's claimed_lamports (a second, independent source for the same
 * number). `ok: false` entries (a sick or 404 timeline) are excluded from the
 * sum rather than treated as zero, so a transient failure cannot manufacture
 * a false mismatch.
 * @param {string} creator
 * @param {Array<{ mint: string }>} coins
 * @param {bigint | null} claimedLamports
 */
async function reconcileCoinEarnings(creator, coins, claimedLamports) {
	const results = await mapLimit(coins, COIN_CONCURRENCY, (coin) => fetchCoinEarnings(coin.mint, creator));
	const byMint = new Map(coins.map((coin, i) => [coin.mint, results[i]]));
	const anyOk = results.some((r) => r.ok);
	let reconciliation = null;
	if (anyOk && claimedLamports != null) {
		const distributed = results.reduce((sum, r) => (r.ok ? sum + r.value.lamports : sum), 0n);
		const delta = distributed - claimedLamports;
		reconciliation = {
			delta_lamports: delta,
			delta_pct: claimedLamports > 0n ? (Number(delta) / Number(claimedLamports)) * 100 : 0,
		};
	}
	return { byMint, reconciliation };
}

/**
 * Refresh one creator wallet: its fee report, its buckets, and every coin row
 * that shares it.
 */
async function refreshWallet(connection, creator, coins) {
	const walletCoins = coins.length;
	const walletAgents = new Set(coins.map((c) => c.agent_id).filter(Boolean)).size || 1;
	const [report, days, halfHours] = await Promise.all([
		readCreatorFeeReport(connection, creator, { mints: coins.map((c) => c.mint) }),
		fetchCreatorFeeBuckets(creator, '1d'),
		fetchCreatorFeeBuckets(creator, '30m'),
	]);
	if (!report.ok) {
		for (const coin of coins) {
			await recordUnavailable(coin, { creator, walletCoins, walletAgents, reason: report.error });
		}
		return { creator, ok: false, error: report.error, coins: walletCoins };
	}
	// Per-coin reconciliation: a stronger source than the wallet-level total
	// above, which this same figure gets smeared across every coin of the
	// wallet. Best-effort: a failed timeline read keeps the wallet-level
	// figure for that coin rather than failing the whole wallet.
	const { byMint, reconciliation } = await reconcileCoinEarnings(creator, coins, report.claimed_lamports);
	for (const coin of coins) {
		const timeline = byMint.get(coin.mint);
		await recordReport(coin, {
			creator,
			walletCoins,
			walletAgents,
			report,
			coinEarnings: timeline?.ok ? timeline.value : null,
			reconciliation,
		});
	}
	if (days.ok) await storeBuckets(creator, '1d', days.value);
	if (halfHours.ok) await storeBuckets(creator, '30m', halfHours.value);

	// Cross-check: coins pump.fun's fee-sharing program says this wallet shares
	// with that our own registry does not have on file. Visibility only (the
	// registry is owned by the launcher, not this snapshot), so a coin launched
	// outside three.ws, or one the registry missed, is surfaced instead of
	// silently absent from this wallet's figures.
	const shares = await fetchAllShares(creator);
	let sharesGap = null;
	if (shares.ok) {
		const dbMints = new Set(coins.map((c) => c.mint));
		const missing = shares.value.items.map((s) => s.mint).filter((mint) => !dbMints.has(mint));
		if (missing.length || shares.value.truncated) {
			sharesGap = { missing_mints: missing, truncated: shares.value.truncated };
		}
	}

	return {
		creator,
		ok: true,
		coins: walletCoins,
		earned_lamports: report.earned_lamports.toString(),
		buckets_ok: days.ok && halfHours.ok,
		reconciliation_delta_lamports: reconciliation ? reconciliation.delta_lamports.toString() : null,
		shares_gap: sharesGap,
	};
}

/**
 * One full snapshot pass over every mainnet coin.
 * @returns {Promise<{ coins: number, wallets: number, refreshed: number, upstream_failed: number, skipped: Array<{ mint: string, reason: string }>, wallet_errors: Array<{ creator: string, error: string }>, reconciled: Array<{ creator: string, delta_lamports: string }>, shares_gaps: Array<{ creator: string, missing_mints: string[], truncated: boolean }> }>}
 */
export async function runCreatorEarningsSnapshot() {
	const coins = await sql`
		select mint, agent_id, quote_mint
		from pump_agent_mints
		where network = 'mainnet'
		order by created_at asc
	`;

	// Rows for coins that are no longer on file are regenerable snapshot data.
	await sql`
		delete from agent_coin_earnings e
		where e.network = 'mainnet'
		  and not exists (select 1 from pump_agent_mints p where p.mint = e.mint and p.network = 'mainnet')
	`;

	/** @type {Array<{ mint: string, reason: string }>} */
	const skipped = [];
	const priced = [];
	for (const coin of coins) {
		if (coin.quote_mint && coin.quote_mint !== WSOL) {
			skipped.push({ mint: coin.mint, reason: 'quote is not SOL: pump.fun indexes creator fees in SOL only' });
			await recordUnavailable(coin, { reason: 'quote_not_sol' });
		} else {
			priced.push(coin);
		}
	}

	const connection = getConnection({ network: 'mainnet' });
	/** @type {Map<string, { creator: string, graduated: boolean } | null>} */
	let creators;
	try {
		creators = await resolveCoinCreators(connection, priced.map((c) => c.mint));
	} catch (err) {
		const reason = `rpc: ${String(/** @type {any} */ (err)?.message || err).slice(0, 160)}`;
		for (const coin of priced) {
			skipped.push({ mint: coin.mint, reason });
			await recordUnavailable(coin, { reason });
		}
		return { coins: coins.length, wallets: 0, refreshed: 0, upstream_failed: 0, skipped, wallet_errors: [] };
	}

	/** @type {Map<string, any[]>} */
	const byCreator = new Map();
	for (const coin of priced) {
		const resolved = creators.get(coin.mint);
		if (!resolved) {
			skipped.push({ mint: coin.mint, reason: 'no bonding curve on chain for this mint' });
			await recordUnavailable(coin, { reason: 'curve_unreadable' });
			continue;
		}
		const list = byCreator.get(resolved.creator) || [];
		list.push(coin);
		byCreator.set(resolved.creator, list);
	}

	const results = await mapLimit([...byCreator.entries()], WALLET_CONCURRENCY, ([creator, list]) =>
		refreshWallet(connection, creator, list).catch((err) => ({
			creator,
			ok: false,
			coins: list.length,
			error: String(err?.message || err).slice(0, 200),
		})),
	);

	const walletErrors = results.filter((r) => !r.ok).map((r) => ({ creator: r.creator, error: r.error }));
	const refreshed = results.filter((r) => r.ok).reduce((n, r) => n + r.coins, 0);
	const failedCoins = results.filter((r) => !r.ok).reduce((n, r) => n + r.coins, 0);
	const reconciled = results.filter((r) => r.ok && r.reconciliation_delta_lamports != null).map((r) => ({
		creator: r.creator,
		delta_lamports: r.reconciliation_delta_lamports,
	}));
	const sharesGaps = results
		.filter((r) => r.ok && r.shares_gap)
		.map((r) => ({ creator: r.creator, ...r.shares_gap }));
	return {
		coins: coins.length,
		wallets: byCreator.size,
		refreshed,
		upstream_failed: failedCoins,
		skipped,
		wallet_errors: walletErrors,
		reconciled,
		shares_gaps: sharesGaps,
	};
}
