// Batched curve and buyback-vault read for the run-buyback sweep.
//
// The sweep used to resolve each coin's quote currency with one getAccountInfo on
// its bonding curve, then read all three of its vaults with getTokenAccountBalance,
// one coin at a time. Measured 2026-11-13: 45,290 RPC calls in 24h across 2,333
// runs that all ended "skipped" because the vault was empty. This module reads
// every curve, then every buyback vault, in getMultipleAccounts batches, so a sweep
// of up to 200 coins costs about four calls to rule out the empty ones.
//
// The prefetch is only a filter. A coin whose vault reads as funded is re-read
// fresh by the sweep before anything is built or signed, so a balance that moves
// during the sweep never sizes a swap or a burn.

import { PublicKey } from '@solana/web3.js';
import { SOLANA_USDC_MINT, SOLANA_USDC_MINT_DEVNET } from '../payments/_config.js';

/** getMultipleAccounts accepts at most 100 keys per call. */
export const PREFETCH_BATCH = 100;

// SPL token account layout: mint (32) + owner (32) + amount (u64 LE).
const TOKEN_AMOUNT_OFFSET = 64;
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * The amount held by an SPL token account, or null when the account is not a
 * classic token account (the sweep then reads that coin on its own).
 * @param {{ data: Uint8Array, owner: PublicKey | string } | null} info
 * @returns {bigint | null}
 */
export function decodeTokenAmount(info) {
	if (!info?.data) return null;
	const owner = typeof info.owner === 'string' ? info.owner : info.owner?.toBase58?.();
	if (owner !== TOKEN_PROGRAM) return null;
	const data = Buffer.from(info.data);
	if (data.length < TOKEN_AMOUNT_OFFSET + 8) return null;
	return data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
}

/**
 * Quote currency from a bonding-curve account: the curve's own quote mint when it
 * decodes, else the recorded database hint, else USDC (the agent earn currency),
 * so a curve that cannot be read never moves a USDC coin onto the SOL vault.
 * @returns {Promise<{ currencyStr: string, quoteSymbol: string, source: 'chain'|'db'|'fallback' }>}
 */
export async function quoteFromCurveInfo(info, { network, dbQuoteMint = null }) {
	const { resolveCustodialQuote } = await import('./pump-trade-args.js');
	if (info) {
		try {
			const { PUMP_SDK } = await import('@pump-fun/pump-sdk');
			const bc = PUMP_SDK.decodeBondingCurve(info);
			const q = resolveCustodialQuote(bc.quoteMint, network);
			return { currencyStr: q.quoteMint, quoteSymbol: q.quoteSymbol, source: 'chain' };
		} catch {
			// An account that does not decode as a curve falls through to the hints.
		}
	}
	if (dbQuoteMint) {
		const q = resolveCustodialQuote(dbQuoteMint, network);
		return { currencyStr: q.quoteMint, quoteSymbol: q.quoteSymbol, source: 'db' };
	}
	const usdc = network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT;
	return { currencyStr: usdc, quoteSymbol: 'USDC', source: 'fallback' };
}

/**
 * Account infos for `keys`, in order. A missing account is null; every key of a
 * batch that failed to read is undefined, so callers can tell "absent" from
 * "unknown".
 */
async function readAccounts(connection, keys) {
	const out = new Array(keys.length);
	for (let start = 0; start < keys.length; start += PREFETCH_BATCH) {
		const chunk = keys.slice(start, start + PREFETCH_BATCH);
		try {
			const infos = await connection.getMultipleAccountsInfo(chunk, 'confirmed');
			for (let i = 0; i < chunk.length; i++) out[start + i] = infos?.[i] ?? null;
		} catch (err) {
			console.warn(`[run-buyback] batched account read failed for ${chunk.length} key(s): ${err?.message || err}`);
		}
	}
	return out;
}

/**
 * Quote currency and buyback-vault balance for every coin of one network.
 *
 * Returns a Map keyed by coin id. A coin whose curve batch failed is absent (the
 * sweep resolves and reads it on its own). `buyback` is the vault balance as a
 * bigint (0n when the vault account does not exist yet, matching what
 * PumpAgent.getBalances reports) or null when the vault batch failed or the
 * account is not a classic token account.
 *
 * @param {{ connection: object, network: string, coins: Array<{ id: unknown, mint: string, quote_mint?: string|null }> }} args
 * @returns {Promise<Map<unknown, { quote: { currencyStr: string, quoteSymbol: string, source: string }, buyback: bigint|null }>>}
 */
export async function prefetchBuybackState({ connection, network, coins }) {
	const out = new Map();
	if (!coins.length) return out;
	const [{ bondingCurvePda }, { getBuybackAuthorityPDA }, { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID }] =
		await Promise.all([import('@pump-fun/pump-sdk'), import('@three-ws/agent-payments'), import('@solana/spl-token')]);

	const mints = coins.map((c) => new PublicKey(c.mint));
	const curves = await readAccounts(connection, mints.map((m) => bondingCurvePda(m)));

	const resolved = [];
	for (let i = 0; i < coins.length; i++) {
		if (curves[i] === undefined) continue;
		const quote = await quoteFromCurveInfo(curves[i], { network, dbQuoteMint: coins[i].quote_mint ?? null });
		const [authority] = getBuybackAuthorityPDA(mints[i]);
		const vault = getAssociatedTokenAddressSync(new PublicKey(quote.currencyStr), authority, true, TOKEN_PROGRAM_ID);
		resolved.push({ coin: coins[i], quote, vault });
	}

	const vaults = await readAccounts(connection, resolved.map((r) => r.vault));
	resolved.forEach((r, j) => {
		const info = vaults[j];
		const buyback = info === undefined ? null : info === null ? 0n : decodeTokenAmount(info);
		out.set(r.coin.id, { quote: r.quote, buyback });
	});
	return out;
}
