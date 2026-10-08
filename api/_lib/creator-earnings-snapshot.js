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

import { sql } from './db.js';
import { getConnection } from './pump.js';
import {
	resolveCoinCreators,
	readCreatorFeeReport,
	fetchCreatorFeeBuckets,
} from './pump-creator-fees.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const WALLET_CONCURRENCY = 4;

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

async function recordReport(coin, { creator, walletCoins, walletAgents, report }) {
	await sql`
		insert into agent_coin_earnings
			(mint, network, agent_id, creator, earned_lamports, claimed_lamports, unclaimed_lamports,
			 wallet_coin_count, wallet_agent_count, source, error, refreshed_at, attempted_at)
		values
			(${coin.mint}, 'mainnet', ${coin.agent_id}, ${creator},
			 ${big(report.earned_lamports)}, ${big(report.claimed_lamports)}, ${big(report.unclaimed_lamports)},
			 ${walletCoins}, ${walletAgents}, 'pumpfun_creator_fees', null, now(), now())
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
 * Refresh one creator wallet: its fee report, its buckets, and every coin row
 * that shares it.
 */
async function refreshWallet(connection, creator, coins) {
	const walletCoins = coins.length;
	const walletAgents = new Set(coins.map((c) => c.agent_id).filter(Boolean)).size || 1;
	const [report, days, halfHours] = await Promise.all([
		readCreatorFeeReport(connection, creator),
		fetchCreatorFeeBuckets(creator, '1d'),
		fetchCreatorFeeBuckets(creator, '30m'),
	]);
	if (!report.ok) {
		for (const coin of coins) {
			await recordUnavailable(coin, { creator, walletCoins, walletAgents, reason: report.error });
		}
		return { creator, ok: false, error: report.error, coins: walletCoins };
	}
	for (const coin of coins) {
		await recordReport(coin, { creator, walletCoins, walletAgents, report });
	}
	if (days.ok) await storeBuckets(creator, '1d', days.value);
	if (halfHours.ok) await storeBuckets(creator, '30m', halfHours.value);
	return {
		creator,
		ok: true,
		coins: walletCoins,
		earned_lamports: report.earned_lamports.toString(),
		buckets_ok: days.ok && halfHours.ok,
	};
}

/**
 * One full snapshot pass over every mainnet coin.
 * @returns {Promise<{ coins: number, wallets: number, refreshed: number, upstream_failed: number, skipped: Array<{ mint: string, reason: string }>, wallet_errors: Array<{ creator: string, error: string }> }>}
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
	return {
		coins: coins.length,
		wallets: byCreator.size,
		refreshed,
		upstream_failed: failedCoins,
		skipped,
		wallet_errors: walletErrors,
	};
}
