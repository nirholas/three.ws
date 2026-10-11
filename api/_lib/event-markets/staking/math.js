// Parimutuel arithmetic for staked Event Markets. Integer base units (BigInt)
// only, mirroring contracts/event-markets-stake/src/lib.rs `split_fee` and
// `payout_for` exactly, so the stake preview in the UI equals the on-chain
// payout to the base unit. Guide: docs/event-markets-staking.md.

const BPS = 10_000n;
export const MAX_FEE_BPS = 1_000;

const big = (v, name) => {
	try {
		const b = typeof v === 'bigint' ? v : BigInt(v);
		if (b < 0n) throw new RangeError(`${name} must not be negative`);
		return b;
	} catch (err) {
		if (err instanceof RangeError) throw err;
		throw new RangeError(`${name} must be a whole number of base units`);
	}
};

/** `{ fee, buyback, treasury }` for a pool total. Fee floors; treasury takes the remainder. */
export function splitFee(total, feeBps, buybackShareBps) {
	const t = big(total, 'total');
	const fee = (t * BigInt(feeBps)) / BPS;
	const buyback = (fee * BigInt(buybackShareBps)) / BPS;
	return { fee, buyback, treasury: fee - buyback };
}

/** Winner payout: floor(stake * (total - fee) / winningTotal). */
export function payoutFor(stake, total, fee, winningTotal) {
	const w = big(winningTotal, 'winningTotal');
	if (w === 0n) return 0n;
	return (big(stake, 'stake') * (big(total, 'total') - big(fee, 'fee'))) / w;
}

/**
 * What a pool pays if `outcome` wins, with the stake of `addStake` added to it
 * first (pass 0 to price an existing position). Returns the void reason when the
 * pool would refund instead of pay.
 *
 * @param {{ totals: (bigint|string|number)[], feeBps: number, buybackShareBps: number }} pool
 */
export function previewStake(pool, outcome, addStake, existingStake = 0n) {
	const totals = pool.totals.map((t) => big(t, 'total'));
	const add = big(addStake, 'addStake');
	const stake = big(existingStake, 'existingStake') + add;
	totals[outcome] += add;
	const total = totals.reduce((a, b) => a + b, 0n);
	const winning = totals[outcome];
	if (winning === 0n || winning === total) {
		return { stake, total, fee: 0n, payout: stake, profit: 0n, void_if_wins: true, multiple: 1 };
	}
	const { fee } = splitFee(total, pool.feeBps, pool.buybackShareBps);
	const payout = payoutFor(stake, total, fee, winning);
	return {
		stake,
		total,
		fee,
		payout,
		profit: payout - stake,
		void_if_wins: false,
		multiple: Number(payout) / Number(stake || 1n),
	};
}

/** Share of the pool on each outcome, as a fraction. Even prior when empty. */
export function poolShares(totals) {
	const t = totals.map((v) => big(v, 'total'));
	const sum = t.reduce((a, b) => a + b, 0n);
	if (sum === 0n) return t.map(() => 1 / t.length);
	return t.map((v) => Number((v * 1_000_000n) / sum) / 1_000_000);
}
