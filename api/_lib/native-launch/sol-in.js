// One-click buy from SOL on the native launchpad (mainnet only).
//
// A curve buy is sized in $THREE, but a visitor usually holds SOL. This builds ONE
// unsigned v0 transaction that first swaps SOL to $THREE through Jupiter, then spends
// the swap's guaranteed minimum on the curve:
//
//   [compute budget] [Jupiter setup] [Jupiter swap] [Jupiter cleanup] [DBC swap]
//
// The curve leg is sized from Jupiter's `otherAmountThreshold` (the worst case the
// Jupiter swap can deliver under the slippage bound), so the curve buy can never ask
// for more $THREE than the wallet received. Any surplus stays in the wallet. The
// slippage floor on the tokens out is the curve quote for that worst-case input, which
// is the combined floor the trader is shown.

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getConnection, buildUnsignedTxBase64 } from '../pump.js';
import { quoteMintFor, NATIVE_LANE } from './config.js';
import { buildSwapInstructions } from './dbc.js';

const JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;
const QUOTE_UNIT = 10 ** NATIVE_LANE.quoteDecimals;

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function jupFetch(path, init, ms) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	try {
		return await fetch(`${JUPITER_BASE}${path}`, { ...init, signal: ctrl.signal });
	} catch (e) {
		throw fail(502, 'sol_quote_failed', `Jupiter is unreachable: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
	} finally {
		clearTimeout(timer);
	}
}

// ExactIn SOL -> $THREE quote. A 4xx from Jupiter means there is no route for the
// pair or amount; anything else is an upstream failure.
export async function jupiterSolQuote({ lamports, slippageBps, threeMint }) {
	const qs = new URLSearchParams({
		inputMint: WSOL_MINT,
		outputMint: threeMint,
		amount: String(lamports),
		slippageBps: String(slippageBps),
		swapMode: 'ExactIn',
	});
	const res = await jupFetch(`/quote?${qs}`, {}, 15_000);
	if (res.status >= 400 && res.status < 500) {
		throw fail(422, 'sol_route_unavailable', 'Jupiter has no route from SOL to $THREE for this amount');
	}
	if (!res.ok) throw fail(502, 'sol_quote_failed', `Jupiter quote failed (HTTP ${res.status})`);
	const quote = await res.json();
	if (!quote?.outAmount || !quote?.otherAmountThreshold) {
		throw fail(422, 'sol_route_unavailable', 'Jupiter returned no route from SOL to $THREE');
	}
	return quote;
}

export async function jupiterSwapInstructions({ quote, user }) {
	const res = await jupFetch(
		'/swap-instructions',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
		},
		20_000,
	);
	if (!res.ok) throw fail(502, 'sol_swap_build_failed', `Jupiter swap build failed (HTTP ${res.status})`);
	const body = await res.json();
	if (!body?.swapInstruction) throw fail(502, 'sol_swap_build_failed', 'Jupiter returned no swap instruction');
	return body;
}

function toInstruction(ix) {
	return new TransactionInstruction({
		programId: new PublicKey(ix.programId),
		keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
		data: Buffer.from(ix.data, 'base64'),
	});
}

async function loadLookupTables(network, addresses) {
	const connection = getConnection({ network });
	const found = await Promise.all((addresses ?? []).map((a) => connection.getAddressLookupTable(new PublicKey(a))));
	return found.map((r) => r.value).filter(Boolean);
}

// Jupiter's compute budget replaces any the curve leg carries; two of the same
// instruction would fail the transaction.
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

export async function buildSolBuyTx({ network = 'mainnet', mint, trader, solAmount, slippageBps = 100, referralTokenAccount = null } = {}) {
	if (network !== 'mainnet') {
		throw fail(400, 'sol_swap_unavailable_on_devnet', 'Buying with SOL needs Jupiter and $THREE, which only exist on mainnet. Buy with $THREE on devnet.');
	}
	const threeMint = quoteMintFor('mainnet');
	if (!threeMint) throw fail(503, 'lane_not_configured', 'the $THREE mint is not configured');
	const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
	if (!(lamports > 0)) throw fail(400, 'validation_error', 'sol amount rounds to zero');

	const jupQuote = await jupiterSolQuote({ lamports, slippageBps, threeMint });
	const threeExpected = Number(jupQuote.outAmount) / QUOTE_UNIT;
	const threeFloor = Number(jupQuote.otherAmountThreshold) / QUOTE_UNIT;

	const [jup, curve] = await Promise.all([
		jupiterSwapInstructions({ quote: jupQuote, user: trader }),
		buildSwapInstructions({ network, mint, trader, side: 'buy', amountIn: threeFloor, slippageBps, referralTokenAccount }),
	]);

	const instructions = [
		...(jup.computeBudgetInstructions ?? []).map(toInstruction),
		...(jup.setupInstructions ?? []).map(toInstruction),
		toInstruction(jup.swapInstruction),
		...(jup.cleanupInstruction ? [toInstruction(jup.cleanupInstruction)] : []),
		...curve.instructions.filter((ix) => ix.programId.toBase58() !== COMPUTE_BUDGET),
	];
	const lookupTables = await loadLookupTables(network, jup.addressLookupTableAddresses);
	const txBase64 = await buildUnsignedTxBase64({ network, payer: curve.traderPk, instructions, lookupTables });

	return {
		txBase64,
		pool: curve.summary.pool,
		side: 'buy',
		pay_with: 'sol',
		amount_in: solAmount,
		sol_in: solAmount,
		three_expected: threeExpected,
		three_min: threeFloor,
		jupiter_price_impact_pct: Number(jupQuote.priceImpactPct ?? 0),
		expected_out: curve.summary.expected_out,
		min_out: curve.summary.min_out,
		slippage_bps: slippageBps,
		referral: curve.summary.referral,
	};
}
