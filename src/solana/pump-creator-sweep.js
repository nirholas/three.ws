// Creator-fee buckets on pump.fun coins, and the sweeps that empty them.
//
// Since the v3 bonding-curve and v2 PumpSwap trade instructions (pump-sdk 4.0,
// October 2026) a trade no longer pays the creator fee into the creator vault.
// It accrues on the bonding curve (`BondingCurve.creatorFee`) or in the
// canonical pool (`Pool.creatorFees`) until the permissionless
// `sweep_creator_fee` of each program moves it into the vault. A vault read or
// a collect alone misses it, and a distribution, CTO or fee-sharing change is
// refused (`CreatorFeesNotSwept`) while a bucket is nonzero.
//
// Chain reads only, no server dependencies: the API (api/_lib/pump-creator-fees.js
// re-exports these) and the browser wallet skills (src/agent-skills-pumpfun.js)
// share this module.
// Docs: https://github.com/pump-fun/pump-public-docs/blob/main/docs/SWEEP_FEES.md

import { PublicKey } from '@solana/web3.js';

// SOL quotes: the wrapped-SOL mint, and the zero key legacy curves store.
const SOL_QUOTES = new Set(['So11111111111111111111111111111111111111112', '11111111111111111111111111111111']);

/**
 * @typedef {object} CreatorFeeBuckets
 * @property {string} mint
 * @property {string} creator     the curve's current `creator` (wallet, sharing config or holder-rewards PDA)
 * @property {string} quoteMint   the curve's quote mint, normalized (wrapped SOL for a SOL curve)
 * @property {boolean} complete   the curve finished (the coin graduated, or is migrating)
 * @property {bigint} curveFee    creator fees v3 trades left on the curve (`BondingCurve.creatorFee`)
 * @property {{ address: string, coinCreator: string, quoteMint: string, fee: bigint } | null} pool
 *   the canonical PumpSwap pool of a complete curve; `fee` is what v2 pool trades
 *   left in it (`Pool.creatorFees`). Null while the curve is live or the pool is missing.
 */

/**
 * Every listed coin's creator-fee buckets. One batched read per 100 curves, then one per 100 pools (complete curves
 * only, at the quote-aware canonical pool). A mint whose curve cannot be read
 * maps to null.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {string[]} mints
 * @returns {Promise<Map<string, CreatorFeeBuckets | null>>}
 */
export async function readCreatorFeeBuckets(connection, mints) {
	const [{ PumpSdk, bondingCurvePda, canonicalPumpPoolPdaWithQuote, normalizeQuoteMint }, { PumpAmmSdk }] =
		await Promise.all([import('@pump-fun/pump-sdk'), import('@pump-fun/pump-swap-sdk')]);
	const offline = new PumpSdk();
	const offlineAmm = new PumpAmmSdk();
	const unique = [...new Set(mints)];
	/** @type {Map<string, CreatorFeeBuckets | null>} */
	const out = new Map();
	for (let i = 0; i < unique.length; i += 100) {
		const chunk = unique.slice(i, i + 100);
		const infos = await connection.getMultipleAccountsInfo(chunk.map((m) => bondingCurvePda(new PublicKey(m))));
		chunk.forEach((mint, j) => {
			const info = infos[j];
			const curve = info ? offline.decodeBondingCurveNullable(info) : null;
			if (!curve) return out.set(mint, null);
			out.set(mint, {
				mint,
				creator: curve.creator.toBase58(),
				quoteMint: normalizeQuoteMint(curve.quoteMint).toBase58(),
				complete: curve.complete === true,
				curveFee: bnToBigInt(curve.creatorFee),
				pool: null,
			});
		});
	}
	const complete = [...out.values()].filter((b) => b?.complete);
	for (let i = 0; i < complete.length; i += 100) {
		const chunk = /** @type {CreatorFeeBuckets[]} */ (complete.slice(i, i + 100));
		const addresses = chunk.map((b) => canonicalPumpPoolPdaWithQuote(new PublicKey(b.mint), new PublicKey(b.quoteMint)));
		const infos = await connection.getMultipleAccountsInfo(addresses);
		chunk.forEach((b, j) => {
			const info = infos[j];
			const pool = info ? offlineAmm.decodePoolNullable(info) : null;
			if (!pool) return;
			b.pool = {
				address: addresses[j].toBase58(),
				coinCreator: pool.coinCreator.toBase58(),
				quoteMint: pool.quoteMint.toBase58(),
				fee: bnToBigInt(pool.creatorFees),
			};
		});
	}
	return out;
}

/** @param {{ toString(): string } | null | undefined} bn */
function bnToBigInt(bn) {
	if (bn == null) return 0n;
	try {
		return BigInt(bn.toString());
	} catch {
		return 0n;
	}
}

/**
 * The unswept fee legs that belong to `creator`: a curve leg when the curve's
 * creator is `creator`, a pool leg when the pool's coin creator is. Largest first.
 *
 * @param {Iterable<CreatorFeeBuckets | null>} buckets
 * @param {string | null} [creator]  null keeps every nonzero leg (a permissionless crank)
 * @returns {Array<{ mint: string, source: 'curve' | 'pool', recipient: string, quoteMint: string, amount: bigint }>}
 */
export function unsweptCreatorFees(buckets, creator = null) {
	const legs = [];
	for (const b of buckets) {
		if (!b) continue;
		if (b.curveFee > 0n && (!creator || b.creator === creator)) {
			legs.push({ mint: b.mint, source: /** @type {const} */ ('curve'), recipient: b.creator, quoteMint: b.quoteMint, amount: b.curveFee });
		}
		if (b.pool && b.pool.fee > 0n && (!creator || b.pool.coinCreator === creator)) {
			legs.push({ mint: b.mint, source: /** @type {const} */ ('pool'), recipient: b.pool.coinCreator, quoteMint: b.pool.quoteMint, amount: b.pool.fee });
		}
	}
	return legs.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

/**
 * Unswept creator fees summed per quote mint, for adding to a vault balance.
 * @param {ReturnType<typeof unsweptCreatorFees>} legs
 * @returns {Map<string, bigint>}
 */
export function sumByQuote(legs) {
	const out = new Map();
	for (const leg of legs) out.set(leg.quoteMint, (out.get(leg.quoteMint) || 0n) + leg.amount);
	return out;
}

/**
 * The quote mints of `creator`'s coins that are not SOL: pass them to
 * `collectCoinCreatorFeeAllQuotesInstructions` / `getCreatorVaultQuoteBalances`
 * as `extraQuoteMints`, so a coin quoted in a de-listed mint or in another pump
 * coin (pump-sdk 4.0 pump-coin pairs, never listed anywhere) is still collected.
 *
 * @param {Iterable<CreatorFeeBuckets | null>} buckets
 * @param {string} creator
 * @returns {PublicKey[]}
 */
export function creatorExtraQuoteMints(buckets, creator) {
	const mints = new Set();
	for (const b of buckets) {
		if (!b) continue;
		if (b.creator === creator && !SOL_QUOTES.has(b.quoteMint)) mints.add(b.quoteMint);
		if (b.pool && b.pool.coinCreator === creator && !SOL_QUOTES.has(b.pool.quoteMint)) mints.add(b.pool.quoteMint);
	}
	return [...mints].map((m) => new PublicKey(m));
}

// Each sweep adds the coin's mint, curve or pool, vault and quote accounts that
// no lookup table covers; four of them plus a collect stay inside one packet.
export const MAX_SWEEPS_PER_TX = 4;

/**
 * Sweep instructions that move unswept creator fees into the creator vaults,
 * to put first in a collect (so it collects them) or in front of a
 * distribution, CTO or fee-sharing change (which the programs refuse with
 * `CreatorFeesNotSwept` while a bucket is nonzero). Permissionless: `payer`
 * signs and covers any vault rent. Largest legs first, capped at `max`.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {object} o
 * @param {ReturnType<typeof unsweptCreatorFees>} o.legs
 * @param {PublicKey} o.payer
 * @param {number} [o.max]
 * @returns {Promise<{ instructions: import('@solana/web3.js').TransactionInstruction[], swept: ReturnType<typeof unsweptCreatorFees>, deferred: number }>}
 */
export async function creatorFeeSweepInstructions(connection, { legs, payer, max = MAX_SWEEPS_PER_TX }) {
	const take = legs.slice(0, Math.max(0, max));
	if (!take.length) return { instructions: [], swept: [], deferred: legs.length };
	const { PumpSdk } = await import('@pump-fun/pump-sdk');
	const sdk = new PumpSdk();
	const tokenQuotes = [...new Set(take.map((l) => l.quoteMint).filter((m) => !SOL_QUOTES.has(m)))];
	/** @type {Map<string, PublicKey>} */
	const programs = new Map();
	if (tokenQuotes.length) {
		const infos = await connection.getMultipleAccountsInfo(tokenQuotes.map((m) => new PublicKey(m)));
		tokenQuotes.forEach((m, i) => {
			if (infos[i]) programs.set(m, infos[i].owner);
		});
	}
	const instructions = [];
	const swept = [];
	for (const leg of take) {
		const quoteMint = new PublicKey(leg.quoteMint);
		const quoteTokenProgram = programs.get(leg.quoteMint);
		if (!SOL_QUOTES.has(leg.quoteMint) && !quoteTokenProgram) continue;
		const mint = new PublicKey(leg.mint);
		const recipient = new PublicKey(leg.recipient);
		instructions.push(
			leg.source === 'curve'
				? await sdk.sweepCreatorFeeInstruction({ payer, mint, creator: recipient, quoteMint, quoteTokenProgram })
				: await sdk.sweepPoolCreatorFeeInstruction({ payer, mint, coinCreator: recipient, quoteMint, quoteTokenProgram }),
		);
		swept.push(leg);
	}
	return { instructions, swept, deferred: legs.length - swept.length };
}
