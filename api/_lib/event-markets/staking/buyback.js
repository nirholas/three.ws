// $THREE buyback leg of the staking fee. Half of the 3% pool fee is paid on resolve
// to the buyback owner's USDC token account (config.buyback). This module turns that
// balance into $THREE through the platform's existing Jupiter path
// (api/_lib/vault-jupiter.js) behind hard guards. It never signs or sends; the owner
// CLI (scripts/event-markets-stake-admin.mjs, `buyback`) does that after a
// confirmation table and --yes (plus --confirm-mainnet on mainnet).

import { quoteBuy, buildSwapTx } from '../../vault-jupiter.js';

export const BUYBACK_DEFAULTS = {
	/** Slippage bound the swap is quoted and built with, in basis points (1%). */
	maxSlippageBps: 100,
	/** Refuse when Jupiter reports more price impact than this (percent). */
	maxPriceImpactPct: 2,
};

/**
 * Validate a buyback quote against the owner's bounds and compute the minimum
 * $THREE out that the signed swap will enforce.
 *
 * @param {object} a
 * @param {bigint} a.balance           USDC base units in the buyback wallet
 * @param {bigint|null} a.requested    USDC base units to spend; null spends the whole balance
 * @param {bigint} a.expectedOutRaw    quoted $THREE base units out
 * @param {number} a.priceImpactPct    quoted impact, percent
 * @param {number} a.maxSlippageBps
 * @param {number} a.maxPriceImpactPct
 * @returns {{ ok: boolean, spend: bigint, minOutRaw: bigint, reason: string | null }}
 */
export function planBuyback({ balance, requested, expectedOutRaw, priceImpactPct, maxSlippageBps, maxPriceImpactPct }) {
	const spend = requested ?? balance;
	const fail = (reason) => ({ ok: false, spend, minOutRaw: 0n, reason });
	if (!Number.isInteger(maxSlippageBps) || maxSlippageBps < 1 || maxSlippageBps > 500) return fail('max slippage must be an integer from 1 to 500 basis points');
	if (!(maxPriceImpactPct > 0 && maxPriceImpactPct <= 10)) return fail('max price impact must be above 0 and at most 10 percent');
	if (spend <= 0n) return fail('the buyback wallet holds no USDC to spend');
	if (spend > balance) return fail('requested amount exceeds the buyback wallet USDC balance');
	if (!(expectedOutRaw > 0n)) return fail('the quote returned no $THREE out');
	if (!Number.isFinite(priceImpactPct) || priceImpactPct > maxPriceImpactPct) return fail(`price impact ${priceImpactPct}% exceeds the ${maxPriceImpactPct}% bound`);
	const minOutRaw = (expectedOutRaw * BigInt(10_000 - maxSlippageBps)) / 10_000n;
	return { ok: true, spend, minOutRaw, reason: null };
}

/**
 * Quote spending `spend` USDC on $THREE and return the quote with the guard result.
 * Jupiter only routes mainnet liquidity, so devnet fails here with `no_route`.
 */
export async function quoteBuybackSwap({ network, threeMint, balance, requested, maxSlippageBps, maxPriceImpactPct }) {
	const spend = requested ?? balance;
	const q = await quoteBuy({ network, mint: threeMint, usdcAtomics: spend, slippageBps: maxSlippageBps });
	const plan = planBuyback({ balance, requested, expectedOutRaw: q.expectedOutRaw, priceImpactPct: q.priceImpactPct, maxSlippageBps, maxPriceImpactPct });
	return { quote: q.quote, expectedOutRaw: q.expectedOutRaw, priceImpactPct: q.priceImpactPct, ...plan };
}

/** Build the unsigned swap for a quote the guards accepted. */
export function buildBuybackSwap({ quote, owner }) {
	return buildSwapTx({ quote, userPublicKey: owner });
}
