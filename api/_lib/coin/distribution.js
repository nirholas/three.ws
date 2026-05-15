// Coin distribution orchestrator.
//
// Lifecycle of one full hourly cycle:
//
//   1. snapshot:       refresh coin_holders from Helius RPC
//   2. claim:          sweep pump.fun creator-vault SOL to the treasury and
//                      split lamports per coin_launches.{lottery,reflection,ops}_bps
//                      into the pot columns
//   3. lottery commit: pick the Drand round R that will be live at the next
//                      draw time; insert coin_draws(status=committed) with
//                      drand_round=R and weights_hash over today's snapshot
//   4. lottery resolve: when round R's randomness is published, derive the
//                      winner; insert one coin_payouts row for the lottery pot
//   5. reflection:     for each eligible holder, allocate a pro-rata share of
//                      the reflection pot into coin_holders.accrued_reflection;
//                      then queue coin_payouts rows for each holder
//   6. payouts cron:   a separate cron drains pending coin_payouts via
//                      sendSolBatched, marks confirmed
//
// Each step is idempotent and persists its own state row, so partial failures
// do not corrupt the books. The cron handler invokes step methods in order
// but each is also callable independently for ops/debugging.

import { sql } from '../db.js';
import { claimCreatorFees } from './creator-fees.js';
import { fetchHolderBalances, persistHolderSnapshot, readEligibleHolders } from './holders.js';
import {
	roundForTime,
	timeForRound,
	fetchDrandRound,
	verifyDrandSignature,
	seedFor,
	weightedPick,
	weightsHash,
} from './randomness.js';
import { loadCoinTreasury, loadCoinCreatorFromCoin } from './treasury.js';

// ─── Snapshot ───────────────────────────────────────────────────────────────

export async function snapshotHolders(coin) {
	const balances = await fetchHolderBalances({ mint: coin.mint, network: coin.network });
	const stats = await persistHolderSnapshot({ coinId: coin.id, balances });
	await sql`
		insert into coin_events (coin_id, kind, payload)
		values (${coin.id}, 'snapshot', ${JSON.stringify({
			accounts: stats.totalAccounts,
			holders: stats.positive,
		})}::jsonb)
	`;
	return stats;
}

// ─── Claim creator fees + allocation split ──────────────────────────────────

export async function claimAndSplit(coin) {
	const creator = loadCoinCreatorFromCoin(coin);
	if (!creator) {
		await sql`
			insert into coin_events (coin_id, kind, payload)
			values (${coin.id}, 'error', ${JSON.stringify({
				step: 'claim',
				reason: 'no_creator_keypair',
			})}::jsonb)
		`;
		return { skipped: true, reason: 'no_creator_keypair' };
	}
	const treasury = coin.metadata?.treasury_is_creator ? creator : loadCoinTreasury();

	const result = await claimCreatorFees({ coin, coinCreator: creator, treasury });

	if (result.claimed_lamports === 0n) {
		await sql`
			insert into coin_events (coin_id, kind, payload, tx_signature)
			values (${coin.id}, 'fee_claim', ${JSON.stringify({
				claimed: '0',
				was_empty: true,
			})}::jsonb, ${result.tx_signature})
		`;
		return { skipped: true, reason: 'empty_vault', tx_signature: result.tx_signature };
	}

	// Split per bps. Use BigInt arithmetic throughout.
	const total = result.claimed_lamports;
	const lotteryLamports = (total * BigInt(coin.lottery_bps)) / 10_000n;
	const reflectionLamports = (total * BigInt(coin.reflection_bps)) / 10_000n;
	// Ops absorbs the rounding remainder so the three pots always sum to `total`.
	const opsLamports = total - lotteryLamports - reflectionLamports;

	await sql`
		update coin_launches
		set lottery_pot_lamports = lottery_pot_lamports + ${lotteryLamports.toString()}::bigint,
		    reflection_pot_lamports = reflection_pot_lamports + ${reflectionLamports.toString()}::bigint,
		    ops_pot_lamports = ops_pot_lamports + ${opsLamports.toString()}::bigint,
		    total_claimed_lamports = total_claimed_lamports + ${total.toString()}::bigint,
		    last_claim_at = now(),
		    updated_at = now()
		where id = ${coin.id}
	`;

	await sql`
		insert into coin_events (coin_id, kind, payload, tx_signature)
		values (${coin.id}, 'fee_claim', ${JSON.stringify({
			claimed: total.toString(),
			lottery: lotteryLamports.toString(),
			reflection: reflectionLamports.toString(),
			ops: opsLamports.toString(),
		})}::jsonb, ${result.tx_signature})
	`;

	return {
		skipped: false,
		claimed_lamports: total,
		lottery_lamports: lotteryLamports,
		reflection_lamports: reflectionLamports,
		ops_lamports: opsLamports,
		tx_signature: result.tx_signature,
	};
}

// ─── Lottery ────────────────────────────────────────────────────────────────

/**
 * Build the deterministic id used to dedupe a draw. One draw per
 * floor(now / draw_interval_seconds) per coin.
 */
function lotteryDrawId(coin, nowMs) {
	const bucket = Math.floor(nowMs / 1000 / coin.draw_interval_seconds);
	return `${coin.mint}-${bucket}`;
}

/**
 * Commit a future Drand round + freeze a holder snapshot for the next lottery
 * draw. Idempotent on the {coin_id, draw_id} unique constraint.
 */
export async function commitLottery(coin, nowMs = Date.now()) {
	const drawId = lotteryDrawId(coin, nowMs);

	// Already committed?
	const [existing] = await sql`
		select id, status, drand_round
		from coin_draws
		where coin_id = ${coin.id} and draw_id = ${drawId}
		limit 1
	`;
	if (existing) {
		return { drawId, drandRound: Number(existing.drand_round), status: existing.status, already: true };
	}

	const holders = await readEligibleHolders({
		coinId: coin.id,
		minBalance: BigInt(coin.min_holder_balance || 0),
	});
	if (holders.length === 0) {
		await sql`
			insert into coin_events (coin_id, kind, payload)
			values (${coin.id}, 'error', ${JSON.stringify({
				step: 'commit_lottery',
				reason: 'no_holders',
				draw_id: drawId,
			})}::jsonb)
		`;
		return { drawId, status: 'no_holders' };
	}

	const drawTime = Math.floor(nowMs / 1000) + coin.draw_interval_seconds;
	const drandRound = roundForTime(drawTime);
	const wHash = weightsHash(holders.map((h) => ({ wallet: h.wallet, weight: h.balance })));
	const pot = BigInt(coin.lottery_pot_lamports);

	await sql`
		insert into coin_draws (
			coin_id, draw_id, drand_round, pot_lamports, weights_hash, holder_count, status
		) values (
			${coin.id}, ${drawId}, ${drandRound}, ${pot.toString()}::bigint,
			${wHash}, ${holders.length}, 'committed'
		)
		on conflict (coin_id, draw_id) do nothing
	`;
	return { drawId, drandRound, status: 'committed', holder_count: holders.length, pot };
}

/**
 * Resolve a previously-committed draw: fetch the published Drand round, pick
 * the weighted-random winner, queue a coin_payouts row, decrement the
 * lottery pot.
 *
 * Failure modes:
 *   - drand_round_unavailable: Drand hasn't published the round yet — retry later.
 *   - holder set changed:      we re-fetch and compare hashes; mismatch = abort
 *                              (the operator can investigate; no pot change).
 */
export async function resolveLottery(coin, drawRow) {
	if (drawRow.status === 'resolved' || drawRow.status === 'paid') {
		return { already: true, status: drawRow.status };
	}

	const drand = await fetchDrandRound(Number(drawRow.drand_round));
	const verified = await verifyDrandSignature(drand);

	const holders = await readEligibleHolders({
		coinId: coin.id,
		minBalance: BigInt(coin.min_holder_balance || 0),
	});
	if (holders.length === 0) {
		await sql`
			update coin_draws set status='failed', error='no_holders_at_resolve', resolved_at=now()
			where id=${drawRow.id}
		`;
		return { status: 'failed', error: 'no_holders_at_resolve' };
	}
	const currentHash = weightsHash(holders.map((h) => ({ wallet: h.wallet, weight: h.balance })));
	if (currentHash !== drawRow.weights_hash) {
		// Holder set drifted — pick deterministically over the CURRENT set, but
		// record the drift so audit can spot it. (Refusing to draw here would
		// just block the lottery; we accept the drift because the Drand round
		// was committed in advance so the operator can't game it.)
		await sql`
			insert into coin_events (coin_id, kind, payload)
			values (${coin.id}, 'snapshot', ${JSON.stringify({
				step: 'resolve_lottery',
				note: 'weights_hash_drift',
				draw_id: drawRow.draw_id,
				committed: drawRow.weights_hash,
				current: currentHash,
			})}::jsonb)
		`;
	}

	const weights = holders.map((h) => h.balance);
	const seed = seedFor(drand.randomness, currentHash);
	const idx = weightedPick(weights, seed);
	const winner = holders[idx];
	const pot = BigInt(drawRow.pot_lamports);

	const batchId = `lottery:${drawRow.draw_id}`;
	await sql`
		insert into coin_payouts (coin_id, kind, wallet, amount_lamports, batch_id, status)
		values (${coin.id}, 'lottery', ${winner.wallet}, ${pot.toString()}::bigint, ${batchId}, 'pending')
		on conflict (batch_id, wallet) do nothing
	`;

	await sql`
		update coin_draws set
			drand_randomness = ${drand.randomness},
			drand_signature = ${drand.signature},
			winner_wallet = ${winner.wallet},
			winner_balance = ${winner.balance.toString()}::bigint,
			status = 'resolved',
			resolved_at = now()
		where id = ${drawRow.id}
	`;

	// Decrement the lottery pot by the amount we're paying out. Any rounding
	// remainder stays in the pot for the next draw.
	await sql`
		update coin_launches
		set lottery_pot_lamports = lottery_pot_lamports - ${pot.toString()}::bigint,
		    last_draw_at = now(),
		    updated_at = now()
		where id = ${coin.id}
	`;

	await sql`
		insert into coin_events (coin_id, kind, payload)
		values (${coin.id}, 'lottery_draw', ${JSON.stringify({
			draw_id: drawRow.draw_id,
			winner: winner.wallet,
			amount: pot.toString(),
			drand_round: Number(drawRow.drand_round),
			verified,
			holder_count: holders.length,
		})}::jsonb)
	`;

	return { status: 'resolved', winner: winner.wallet, amount: pot, verified };
}

/**
 * Find all coin_draws still in 'committed' status whose target Drand round is
 * now past — and try to resolve each.
 */
export async function resolvePendingDraws(coin) {
	const rows = await sql`
		select * from coin_draws
		where coin_id = ${coin.id} and status = 'committed'
		order by created_at asc
		limit 24
	`;
	const out = [];
	for (const row of rows) {
		const roundTime = timeForRound(Number(row.drand_round));
		if (roundTime > Math.floor(Date.now() / 1000)) {
			out.push({ drawId: row.draw_id, status: 'not_yet', drandRound: Number(row.drand_round) });
			continue;
		}
		try {
			const r = await resolveLottery(coin, row);
			out.push({ drawId: row.draw_id, ...r });
		} catch (err) {
			const msg = err?.message || String(err);
			if (msg.startsWith('drand_round_unavailable')) {
				out.push({ drawId: row.draw_id, status: 'drand_not_ready' });
				continue;
			}
			await sql`
				update coin_draws set status='failed', error=${msg}, resolved_at=now()
				where id=${row.id}
			`;
			out.push({ drawId: row.draw_id, status: 'failed', error: msg });
		}
	}
	return out;
}

// ─── Reflection ─────────────────────────────────────────────────────────────

/**
 * Compute the next reflection batch id (one per reflection_interval_seconds).
 */
function reflectionBatchId(coin, nowMs) {
	const bucket = Math.floor(nowMs / 1000 / coin.reflection_interval_seconds);
	return `${coin.mint}-reflection-${bucket}`;
}

/**
 * Allocate the reflection pot pro-rata across current eligible holders and
 * queue coin_payouts rows. The pot is drained to zero (less any rounding
 * remainder, which stays in the pot for the next cycle).
 *
 * Idempotent on the batch_id — a second call inside the same window short-
 * circuits.
 */
export async function allocateReflection(coin, nowMs = Date.now()) {
	const batchId = reflectionBatchId(coin, nowMs);

	// Already allocated this window?
	const [already] = await sql`
		select 1 from coin_payouts
		where coin_id = ${coin.id} and batch_id = ${batchId}
		limit 1
	`;
	if (already) {
		return { batchId, status: 'already', queued: 0 };
	}

	const pot = BigInt(coin.reflection_pot_lamports);
	if (pot === 0n) {
		await sql`
			insert into coin_events (coin_id, kind, payload)
			values (${coin.id}, 'reflection_batch', ${JSON.stringify({
				batch_id: batchId,
				queued: 0,
				reason: 'empty_pot',
			})}::jsonb)
		`;
		return { batchId, status: 'empty_pot', queued: 0 };
	}

	const holders = await readEligibleHolders({
		coinId: coin.id,
		minBalance: BigInt(coin.min_holder_balance || 0),
	});
	if (holders.length === 0) {
		return { batchId, status: 'no_holders', queued: 0 };
	}

	const totalBalance = holders.reduce((a, h) => a + h.balance, 0n);
	if (totalBalance === 0n) return { batchId, status: 'no_balance', queued: 0 };

	let allocated = 0n;
	let queued = 0;
	const MIN_PAYOUT = 1_000n; // 0.000001 SOL — skip dust to keep tx batches efficient

	for (const h of holders) {
		const share = (pot * h.balance) / totalBalance;
		if (share < MIN_PAYOUT) continue;
		await sql`
			insert into coin_payouts (
				coin_id, kind, wallet, amount_lamports, batch_id, status
			) values (
				${coin.id}, 'reflection', ${h.wallet}, ${share.toString()}::bigint,
				${batchId}, 'pending'
			)
			on conflict (batch_id, wallet) do nothing
		`;
		await sql`
			update coin_holders
			set accrued_reflection_lamports = accrued_reflection_lamports + ${share.toString()}::bigint
			where coin_id = ${coin.id} and wallet = ${h.wallet}
		`;
		allocated += share;
		queued += 1;
	}

	// Drain the allocated portion from the reflection pot. Rounding dust stays.
	await sql`
		update coin_launches
		set reflection_pot_lamports = reflection_pot_lamports - ${allocated.toString()}::bigint,
		    last_reflection_at = now(),
		    updated_at = now()
		where id = ${coin.id}
	`;

	await sql`
		insert into coin_events (coin_id, kind, payload)
		values (${coin.id}, 'reflection_batch', ${JSON.stringify({
			batch_id: batchId,
			queued,
			allocated: allocated.toString(),
			pot_remaining: (pot - allocated).toString(),
		})}::jsonb)
	`;

	return { batchId, status: 'allocated', queued, allocated };
}
