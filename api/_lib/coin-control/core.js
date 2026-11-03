// Coin Control: pure rules for what a coin's fee engine does with its money.
//
// No I/O here, so tests pin every decision: who is eligible for a holder reward,
// how a pro-rata split rounds, how a lottery draw is made reproducible, and how
// many tokens a buyback actually bought (read from the confirmed transaction, not
// from the quote, so a burn never destroys more than the buy delivered).
//
// Callers: api/_lib/coin-control/chain.js (on-chain reads and sends) and
// api/_lib/revenue-reinvest.js (the buyback_burn and holder_rewards legs).

import { createHash } from 'node:crypto';

/**
 * Smallest SOL reward sent to one holder. Above the rent-exempt minimum for a
 * system account (890,880 lamports), so a reward to a wallet that holds no SOL
 * still lands instead of failing the whole transaction.
 */
export const MIN_REWARD_LAMPORTS = 1_000_000n;

/** How many top holders a reward considers before filtering. */
export const HOLDER_POOL_SIZE = 50;

/**
 * Drop holders that must never receive a reward: the agent's own wallet, any
 * platform wallet, and every owner that is a program address (a bonding curve,
 * an AMM pool vault, or a token account whose owner could not be resolved).
 * Rewarding those would either fail or pay a program that redistributes nothing.
 *
 * @param {Array<{ owner: string, amount: number }>} holders  ranked, largest first
 * @param {{ exclude?: Iterable<string>, isWallet: (owner: string) => boolean }} o
 */
export function eligibleHolders(holders, { exclude = [], isWallet }) {
	const skip = new Set([...exclude].filter(Boolean));
	const out = [];
	for (const h of holders || []) {
		if (!h?.owner || !(Number(h.amount) > 0)) continue;
		if (skip.has(h.owner)) continue;
		if (!isWallet(h.owner)) continue;
		out.push({ owner: h.owner, amount: Number(h.amount) });
	}
	return out;
}

function weightOf(amount) {
	// Holder balances are raw base units. Pump supplies (1e15) fit a double exactly,
	// so rounding only guards against a fractional value from a parsed balance.
	return BigInt(Math.max(0, Math.round(Number(amount))));
}

/**
 * Split `totalLamports` across the top `count` eligible holders in proportion to
 * their balances. A share under the minimum is dropped and the pot re-split among
 * the rest, so every payment that goes out is one that lands. Rounding dust goes
 * to the largest holder, so the sum always equals the pot exactly.
 *
 * @returns {Array<{ owner: string, amount: number, lamports: bigint }>}
 */
export function splitProRata(holders, totalLamports, count, minLamports = MIN_REWARD_LAMPORTS) {
	const total = BigInt(totalLamports);
	let pool = holders.slice(0, Math.max(0, count));
	while (pool.length) {
		const sum = pool.reduce((a, h) => a + weightOf(h.amount), 0n);
		if (sum <= 0n) return [];
		const shares = pool.map((h) => ({ ...h, lamports: (total * weightOf(h.amount)) / sum }));
		const tooSmall = shares.filter((s) => s.lamports < minLamports);
		if (!tooSmall.length) {
			const dust = total - shares.reduce((a, s) => a + s.lamports, 0n);
			shares[0].lamports += dust;
			return shares;
		}
		// Drop the smallest holder and try again: its share is the first to fall
		// under the floor, and dropping it raises everyone else's.
		pool = pool.slice(0, -1);
	}
	return [];
}

/** The draw seed: the leg's idempotency key and a recent blockhash, so anyone can recompute it. */
export function lotterySeed(legKey, blockhash) {
	return createHash('sha256').update(`${legKey}|${blockhash}`).digest('hex');
}

function seededIndex(seedHex, round, modulo) {
	const h = createHash('sha256').update(`${seedHex}:${round}`).digest('hex');
	return BigInt(`0x${h}`) % modulo;
}

/**
 * Draw `winners` holders without replacement, each draw weighted by balance,
 * and split the pot equally between them. Deterministic for a given seed, so a
 * published seed lets any holder verify the result. When the pot cannot give
 * every winner the minimum, fewer winners are drawn instead of paying dust.
 *
 * @returns {Array<{ owner: string, amount: number, lamports: bigint }>}
 */
export function drawLottery(holders, totalLamports, winners, seedHex, minLamports = MIN_REWARD_LAMPORTS) {
	const total = BigInt(totalLamports);
	const affordable = Number(total / BigInt(minLamports));
	const n = Math.min(Math.max(0, winners), holders.length, affordable);
	if (n <= 0) return [];
	const pool = holders.map((h) => ({ ...h }));
	const picked = [];
	for (let round = 0; round < n; round++) {
		const sum = pool.reduce((a, h) => a + weightOf(h.amount), 0n);
		if (sum <= 0n) break;
		let ticket = seededIndex(seedHex, round, sum);
		let idx = 0;
		for (; idx < pool.length; idx++) {
			const w = weightOf(pool[idx].amount);
			if (ticket < w) break;
			ticket -= w;
		}
		picked.push(pool.splice(idx, 1)[0]);
	}
	if (!picked.length) return [];
	const each = total / BigInt(picked.length);
	const out = picked.map((p) => ({ ...p, lamports: each }));
	out[0].lamports += total - each * BigInt(picked.length);
	return out;
}

/**
 * How many raw units of `mint` the `owner` gained in a confirmed transaction,
 * from its pre/post token balances. Zero when the owner has no balance change.
 *
 * @param {{ preTokenBalances?: any[], postTokenBalances?: any[] } | null} meta
 */
export function tokenDeltaFromMeta(meta, owner, mint) {
	const sum = (rows) => (rows || [])
		.filter((b) => b?.mint === mint && b?.owner === owner)
		.reduce((a, b) => a + BigInt(b?.uiTokenAmount?.amount ?? '0'), 0n);
	const delta = sum(meta?.postTokenBalances) - sum(meta?.preTokenBalances);
	return delta > 0n ? delta : 0n;
}

/** Lamports to a SOL string with up to 9 decimals and no trailing zeros. */
export function lamportsToSolString(lamports) {
	const v = BigInt(lamports);
	const whole = v / 1_000_000_000n;
	const frac = (v % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Raw token units to a decimal string, exact (no float rounding). */
export function rawToUi(raw, decimals) {
	const v = BigInt(String(raw ?? '0').split('.')[0] || '0');
	const d = Math.max(0, Number(decimals) || 0);
	if (!d) return v.toString();
	const base = 10n ** BigInt(d);
	const frac = (v % base).toString().padStart(d, '0').replace(/0+$/, '');
	return frac ? `${v / base}.${frac}` : `${v / base}`;
}
