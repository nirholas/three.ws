// The venue interface: one shape for every place an agent can price or fill a
// swap, so the trading tools, the arbitrage desk and the EVM leg speak the same
// language regardless of which market sits underneath.
//
// A venue is:
//
//   {
//     id:         stable id used in tool arguments ('auto', 'launchpad', a DEX id, 'evm-aggregator')
//     chain:      'solana' | 'evm'
//     kind:       'aggregate' | 'dex' | 'launchpad' | 'evm-aggregator'
//     name:       display name
//     quote(req): Promise<VenueQuote | null>   null means "this venue cannot fill it"
//     executor:   how an agent wallet fills here (see below), or null when the
//                 venue is priced for comparison only
//   }
//
// VenueQuote (every venue, every chain):
//
//   { venue, chain, input, output, in_amount_raw, out_amount_raw, min_out_raw,
//     price_impact_pct, slippage_bps, route: string[] }
//
// Solana DEX venues are not a fixed list: the arbitrage desk discovers them at
// runtime (api/_lib/trading-tools/arbitrage.js), and any venue label the
// router reports is addressable here as `dex:<label>`.
//
// Solana executors plug into the guarded custodial trade executor in
// api/agents/solana-trade.js (runAgentTrade). That executor owns the whole
// guard chain (kill switch, per-trade cap, daily budget, USD spend ceiling,
// price-impact breaker, rug firewall, SOL headroom), the idempotent custody
// ledger, key recovery and the protected send; a venue only supplies how to
// price and how to build. The launchpad venue is the executor's own default
// (curve, then AMM), so it has no custom executor. Every other Solana venue
// routes through the aggregator, optionally pinned to one DEX, and supplies:
//
//   executor.quote(args)  the same shape quoteTrade() returns
//   executor.build(args)  { instructions, addressLookupTables }
//
// Solana custodial swaps keep SOL on one side, because the guard chain meters
// spend in SOL. Any other pair is quoted, never custodially executed.
//
// The EVM venue wraps the EVM leg's aggregator (api/_lib/evm-leg/swap.js),
// which carries its own per-chain guards and custody rows.

import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

import { jupiterQuote, jupiterSwapTx } from '../token/jupiter.js';
import { launchpadLabels } from './arbitrage.js';
import { ToolInputError, WSOL_MINT, tokenDecimals } from './market.js';

export const SOLANA = 'solana';
export const EVM = 'evm';

const LAMPORTS_PER_SOL = 1_000_000_000;

function fail(status, code, message) {
	return Object.assign(new Error(message), { status, code });
}

const pct = (v) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.max(0, Math.min(100, n * 100)) : 0;
};

// ── Solana aggregator executor ───────────────────────────────────────────────

/**
 * Price one custodial trade on the aggregator, optionally pinned to a single
 * DEX. Returns the exact shape quoteTrade() returns, plus `raw` (the router's
 * quote) so build() fills precisely what was priced.
 */
async function aggregatorQuote(dexLabel, { side, mintStr, network, solAmount, tokenAmountRaw, slippageBps }) {
	if (network !== 'mainnet') throw fail(422, 'venue_mainnet_only', 'this venue routes mainnet liquidity only; use the launchpad venue on devnet');
	const decimals = await tokenDecimals(mintStr).catch(() => null);
	if (decimals == null) throw fail(422, 'unknown_decimals', 'could not read the token decimals for this mint');
	const buy = side === 'buy';
	const amount = buy ? BigInt(Math.floor(Number(solAmount) * LAMPORTS_PER_SOL)) : BigInt(tokenAmountRaw);
	if (amount <= 0n) throw fail(400, 'amount_too_small', 'enter an amount greater than zero');

	let q;
	try {
		q = await jupiterQuote({
			inputMint: buy ? WSOL_MINT : mintStr,
			outputMint: buy ? mintStr : WSOL_MINT,
			amount: amount.toString(),
			slippageBps,
			dexes: dexLabel ? [dexLabel] : null,
			onlyDirectRoutes: Boolean(dexLabel),
		});
	} catch (err) {
		const s = Number(err?.status);
		if (s === 400 || s === 404) throw Object.assign(fail(404, 'pool_not_found', 'this venue has no route for this pair'), { code: 'pool_not_found' });
		throw fail(502, 'quote_failed', 'could not price this trade on this venue right now');
	}
	if (!q?.outAmount) throw Object.assign(fail(404, 'pool_not_found', 'this venue has no route for this pair'), { code: 'pool_not_found' });

	const out = BigInt(q.outAmount);
	const minOut = BigInt(q.otherAmountThreshold ?? q.outAmount);
	const shape = {
		venue: dexLabel ? `dex:${dexLabel}` : 'aggregate',
		graduated: true,
		quoteAsset: 'SOL',
		decimals,
		priceImpactPct: pct(q.priceImpactPct),
		route: (q.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean),
		raw: q,
	};
	if (buy) {
		return {
			...shape,
			inAsset: 'SOL', inAmount: Number(solAmount), inAtomics: amount.toString(),
			outAsset: 'TOKEN', outAtomics: out.toString(), outUi: Number(out) / 10 ** decimals,
			minOutAtomics: minOut.toString(), minOutUi: Number(minOut) / 10 ** decimals,
		};
	}
	return {
		...shape,
		inAsset: 'TOKEN', inAtomics: amount.toString(), inUi: Number(amount) / 10 ** decimals,
		outAsset: 'SOL', outAtomics: out.toString(), outUi: Number(out) / LAMPORTS_PER_SOL,
		minOutAtomics: minOut.toString(), minOutUi: Number(minOut) / LAMPORTS_PER_SOL,
	};
}

/**
 * Build the priced route as plain instructions plus its address lookup
 * tables, so the protected sender sets its own compute budget and priority
 * fee (it strips the router's) and signs with the agent key.
 */
async function aggregatorBuild({ conn, ownerPk, quote }) {
	if (!quote?.raw) throw fail(422, 'build_failed', 'the quote carries no route to build');
	let b64;
	try {
		b64 = await jupiterSwapTx({ quote: quote.raw, userPublicKey: ownerPk.toBase58(), wrapAndUnwrapSol: true });
	} catch {
		throw fail(502, 'build_failed', 'the router could not build this route right now; try again');
	}
	const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
	const lookups = tx.message.addressTableLookups || [];
	const addressLookupTables = [];
	for (const l of lookups) {
		const res = await conn.getAddressLookupTable(new PublicKey(l.accountKey));
		if (!res?.value) throw fail(502, 'build_failed', 'an address lookup table for this route could not be read');
		addressLookupTables.push(res.value);
	}
	const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: addressLookupTables });
	return { instructions: message.instructions, addressLookupTables };
}

function aggregatorExecutor(dexLabel) {
	return {
		id: dexLabel ? `dex:${dexLabel}` : 'aggregate',
		quote: (args) => aggregatorQuote(dexLabel, args),
		build: (args) => aggregatorBuild(args),
	};
}

// ── Solana comparison quote (any pair) ───────────────────────────────────────

async function solanaQuote(dexLabel, { input, output, amountRaw, slippageBps = 50 }) {
	try {
		const q = await jupiterQuote({
			inputMint: input,
			outputMint: output,
			amount: String(amountRaw),
			slippageBps,
			dexes: dexLabel ? [dexLabel] : null,
			onlyDirectRoutes: Boolean(dexLabel),
		});
		if (!q?.outAmount) return null;
		return {
			chain: SOLANA,
			input,
			output,
			in_amount_raw: String(amountRaw),
			out_amount_raw: String(q.outAmount),
			min_out_raw: String(q.otherAmountThreshold ?? q.outAmount),
			price_impact_pct: pct(q.priceImpactPct),
			slippage_bps: slippageBps,
			route: (q.routePlan || []).map((p) => p?.swapInfo?.label).filter(Boolean),
		};
	} catch (err) {
		const s = Number(err?.status);
		if (s === 400 || s === 404) return null;
		throw fail(502, 'venue_unavailable', 'this venue could not be priced right now');
	}
}

// ── registry ─────────────────────────────────────────────────────────────────

const auto = {
	id: 'auto',
	chain: SOLANA,
	kind: 'aggregate',
	name: 'Best route across every Solana venue',
	quote: (req) => solanaQuote(null, req).then((q) => (q ? { venue: 'auto', ...q } : null)),
	executor: aggregatorExecutor(null),
};

const launchpad = {
	id: 'launchpad',
	chain: SOLANA,
	kind: 'launchpad',
	name: 'Launchpad bonding curve and its graduated AMM',
	quote: async (req) => {
		for (const label of await launchpadLabels()) {
			const q = await solanaQuote(label, req).catch(() => null);
			if (q) return { venue: 'launchpad', ...q };
		}
		return null;
	},
	// null: runAgentTrade's own quoteTrade/buildTradeInstructions (curve, then AMM).
	executor: null,
};

// One DEX, addressed by the label the router reports for it (the labels
// arbitragePrices returns). Built on demand because the set is discovered at
// runtime, never listed here.
const DEX_PREFIX = 'dex:';
const LABEL_RE = /^[\w .+()'-]{1,64}$/;

function dexVenue(label) {
	const id = `${DEX_PREFIX}${label}`;
	return {
		id,
		chain: SOLANA,
		kind: 'dex',
		name: label,
		quote: (req) => solanaQuote(label, req).then((q) => (q ? { venue: id, ...q } : null)),
		executor: aggregatorExecutor(label),
	};
}

const evmAggregator = {
	id: 'evm-aggregator',
	chain: EVM,
	kind: 'evm-aggregator',
	name: 'EVM aggregator (Base, Robinhood Chain)',
	quote: async ({ chain, input, output, amountRaw, slippageBps = 50, from = null }) => {
		const { quoteEvmSwap } = await import('../evm-leg/swap.js');
		const q = await quoteEvmSwap({ chain, sellToken: input, buyToken: output, amountRaw: String(amountRaw), fromAddress: from, slippageBps });
		return {
			venue: 'evm-aggregator',
			chain: EVM,
			evm_chain: q.chain,
			input,
			output,
			in_amount_raw: q.amount_in_raw,
			out_amount_raw: q.amount_out_raw,
			min_out_raw: q.min_out_raw,
			price_impact_pct: q.price_impact_pct,
			slippage_bps: slippageBps,
			gas_usd: q.gas_usd,
			route: [q.provider].filter(Boolean),
		};
	},
	// EVM fills go through api/_lib/evm-leg/swap.js executeEvmSwap, which owns
	// the per-chain guards and the custody row.
	executor: null,
};

/** The fixed venues, Solana first. Individual DEXes are `dex:<label>` (see dexVenue). */
export const VENUES = Object.freeze([auto, launchpad, evmAggregator]);
const BY_ID = new Map(VENUES.map((v) => [v.id, v]));

/** Venue by id. Throws a ToolInputError naming the valid ids. */
export function getVenue(id = 'auto') {
	const key = String(id || 'auto');
	const fixed = BY_ID.get(key);
	if (fixed) return fixed;
	if (key.startsWith(DEX_PREFIX) && LABEL_RE.test(key.slice(DEX_PREFIX.length))) return dexVenue(key.slice(DEX_PREFIX.length));
	throw new ToolInputError('invalid_venue', `Unknown venue "${id}". Use one of: ${VENUES.map((x) => x.id).join(', ')}, or dex:<label> with a label arbitrage_prices returned.`);
}

/** Venues on one chain, as plain descriptors for a tool or page. */
export function listVenues({ chain = null } = {}) {
	return VENUES.filter((v) => !chain || v.chain === chain).map((v) => ({
		id: v.id,
		chain: v.chain,
		kind: v.kind,
		name: v.name,
		custodial_pairs: v.chain === SOLANA ? 'SOL on one side' : 'any ERC-20 or the native coin',
	}));
}

/**
 * The runAgentTrade executor for a Solana venue, or null for the executor's
 * own default path (the launchpad venue). Throws for an EVM venue.
 */
export function solanaExecutorFor(id) {
	const v = getVenue(id);
	if (v.chain !== SOLANA) throw new ToolInputError('wrong_chain', `${v.id} is an EVM venue; pass chain to swap on the EVM leg.`);
	return v.executor;
}
