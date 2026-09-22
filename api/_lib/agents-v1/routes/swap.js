// v1 swap routes, quote-then-execute, in two custody modes.
//
//   POST /swap/quote     price a swap and return a quoteId valid for five minutes
//   POST /swap/execute   act on a quoteId
//
// Non-custodial (no agentId): priced and built by the Jupiter aggregator for
// any SPL pair. Execute returns an UNSIGNED base64 VersionedTransaction for the
// caller's own wallet to sign and send; nothing moves until they do, and the
// platform never holds their key.
//
// Custodial (agentId given): the agent's own wallet trades through the guarded
// executor in api/agents/solana-trade.js (pump.fun bonding curve and AMM), so
// the kill switch, per-trade cap, daily budget, price-impact breaker, trade
// firewall, real-funds agreement and custody ledger all apply unchanged. One
// side must be SOL. Execute needs `confirm: true` and the wallet:write scope.

import { apiError, requireUuid, strParam, intParam } from '../http.js';
import { forward, forwardData, toApiError } from '../forward.js';
import { issueQuote, verifyQuote, requireConfirm } from '../quote-token.js';
import { hasScope } from '../../auth.js';
import { jupiterQuote, jupiterSwapTx } from '../../token/jupiter.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LAMPORTS_PER_SOL = 1_000_000_000n;

function mintParam(v, name) {
	const s = strParam(v, { name, max: 64, required: true });
	if (s.toUpperCase() === 'SOL') return WSOL_MINT;
	if (!BASE58_RE.test(s)) throw apiError(400, 'invalid_parameter', `${name} must be a base58 mint address or "SOL".`, { parameter: name });
	return s;
}

function atomicParam(v) {
	const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v;
	if (typeof s !== 'string' || !/^\d{1,30}$/.test(s) || BigInt(s) <= 0n) {
		throw apiError(400, 'invalid_parameter', 'amount must be a positive integer in the input mint\'s smallest unit (lamports for SOL).', {
			parameter: 'amount',
		});
	}
	return s;
}

function pubkeyParam(v, name) {
	const s = strParam(v, { name, max: 64 });
	if (s && !BASE58_RE.test(s)) throw apiError(400, 'invalid_parameter', `${name} must be a base58 Solana address.`, { parameter: name });
	return s;
}

async function tradeHandler(agentId) {
	const mod = await import('../../../agents/solana-trade.js');
	return (req, res) => mod.handleTrade(req, res, agentId);
}

/** Custodial swaps map onto the trade executor's buy (SOL in) or sell (SOL out). */
function custodialSide(inputMint, outputMint) {
	if (inputMint === WSOL_MINT && outputMint !== WSOL_MINT) return { side: 'buy', mint: outputMint };
	if (outputMint === WSOL_MINT && inputMint !== WSOL_MINT) return { side: 'sell', mint: inputMint };
	throw apiError(
		422,
		'unsupported_pair',
		'Agent-wallet swaps need SOL on one side. For any other pair, quote without agentId and sign the returned transaction yourself.',
		{ parameter: 'inputMint' },
	);
}

function tradeBody(pinned) {
	const body = { side: pinned.side, mint: pinned.mint, network: 'mainnet', slippage_bps: pinned.slippageBps };
	if (pinned.side === 'buy') {
		// The executor takes whole SOL for a buy; the quote pinned lamports.
		const lamports = BigInt(pinned.amount);
		body.sol_amount = Number(lamports / LAMPORTS_PER_SOL) + Number(lamports % LAMPORTS_PER_SOL) / 1e9;
	} else {
		body.token_amount_raw = pinned.amount;
	}
	return body;
}

function shapeCustodialQuote(d, pinned) {
	return {
		inputMint: pinned.inputMint,
		outputMint: pinned.outputMint,
		inAmount: d.in?.atomics ?? pinned.amount,
		outAmount: d.out?.atomics ?? null,
		minOutAmount: d.min_received?.atomics ?? null,
		priceImpactPct: d.price_impact_pct ?? null,
		slippageBps: d.slippage_bps ?? pinned.slippageBps,
		venue: d.venue ?? null,
		route: [d.venue].filter(Boolean),
		usd: d.usd ?? null,
		platformFeeBps: d.platform_fee_bps ?? null,
		warnings: [d.guard, d.funds].filter(Boolean).map((w) => ({ code: w.code, message: w.message })),
		firewall: d.firewall ?? null,
	};
}

function shapeJupiterQuote(q, pinned) {
	return {
		inputMint: pinned.inputMint,
		outputMint: pinned.outputMint,
		inAmount: String(q.inAmount),
		outAmount: String(q.outAmount),
		minOutAmount: String(q.otherAmountThreshold),
		priceImpactPct: q.priceImpactPct != null ? Number(q.priceImpactPct) * 100 : null,
		slippageBps: q.slippageBps ?? pinned.slippageBps,
		venue: 'jupiter',
		route: (q.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean),
		usd: q.swapUsdValue != null ? Number(q.swapUsdValue) : null,
		platformFeeBps: null,
		warnings: [],
		firewall: null,
	};
}

async function quoteJupiter(pinned) {
	try {
		return await jupiterQuote({
			inputMint: pinned.inputMint,
			outputMint: pinned.outputMint,
			amount: pinned.amount,
			slippageBps: pinned.slippageBps,
		});
	} catch (err) {
		if (Number(err?.status) === 400 || Number(err?.status) === 404) {
			throw apiError(422, 'no_route', 'No swap route exists for this pair and amount.', { inputMint: pinned.inputMint, outputMint: pinned.outputMint });
		}
		throw apiError(502, 'swap_failed', 'The swap could not be priced right now. Retry shortly.', {
			inputMint: pinned.inputMint,
			outputMint: pinned.outputMint,
		});
	}
}

export const ROUTES = [
	{
		method: 'POST',
		path: '/swap/quote',
		name: 'v1.swap.quote',
		auth: 'required',
		scope: 'agents:read',
		// Quoting moves nothing, so a signed-in browser needs no CSRF token.
		csrf: false,
		summary: 'Price a Solana swap. Pass agentId to trade from the agent wallet; omit it to get a transaction for your own wallet.',
		params: {
			inputMint: 'mint to sell, or "SOL" (required)',
			outputMint: 'mint to buy, or "SOL" (required)',
			amount: 'input amount in the smallest unit, as an integer string (required)',
			slippageBps: '0-5000; default 50 (non-custodial) or 300 (agent wallet)',
			agentId: 'swap from this agent\'s custodial wallet',
			userPublicKey: 'your wallet, for a non-custodial swap (can also be passed at execute)',
		},
		handler: async (ctx) => {
			const b = ctx.body;
			const inputMint = mintParam(b.inputMint, 'inputMint');
			const outputMint = mintParam(b.outputMint, 'outputMint');
			if (inputMint === outputMint) throw apiError(400, 'invalid_parameter', 'inputMint and outputMint must differ.', { parameter: 'outputMint' });
			const amount = atomicParam(b.amount);
			const agentId = b.agentId ? requireUuid(b.agentId, 'agent') : null;
			const slippageBps = intParam(b.slippageBps, { name: 'slippageBps', min: 0, max: 5000, fallback: agentId ? 300 : 50 });
			const userPublicKey = pubkeyParam(b.userPublicKey, 'userPublicKey');
			const userId = ctx.principal.userId;

			if (agentId) {
				const { side, mint } = custodialSide(inputMint, outputMint);
				const pinned = { mode: 'custodial', agentId, userId, inputMint, outputMint, amount, slippageBps, side, mint };
				const d = await forwardData(await tradeHandler(agentId), ctx, {
					method: 'POST',
					url: `/api/agents/${agentId}/solana/trade`,
					body: { ...tradeBody(pinned), preview: true },
				});
				const quote = shapeCustodialQuote(d, pinned);
				const { quoteId, expiresAt } = issueQuote('swap', { ...pinned, minOutAmount: quote.minOutAmount });
				return { quoteId, expiresAt, mode: 'custodial', agentId, ...quote };
			}

			const pinned = { mode: 'non_custodial', userId, inputMint, outputMint, amount, slippageBps, userPublicKey };
			const q = await quoteJupiter(pinned);
			const quote = shapeJupiterQuote(q, pinned);
			const { quoteId, expiresAt } = issueQuote('swap', { ...pinned, minOutAmount: quote.minOutAmount });
			return { quoteId, expiresAt, mode: 'non_custodial', agentId: null, ...quote };
		},
	},
	{
		method: 'POST',
		path: '/swap/execute',
		name: 'v1.swap.execute',
		auth: 'required',
		scope: 'agents:read',
		// The custodial path forwards to the trade executor, which enforces CSRF
		// for session callers itself; checking here would burn the token first.
		csrf: false,
		summary:
			'Act on a swap quote. Non-custodial returns an unsigned base64 transaction to sign; agent-wallet swaps need { confirm: true } and sign server-side.',
		params: {
			quoteId: 'from POST /swap/quote (required)',
			confirm: 'must be true for an agent-wallet swap',
			userPublicKey: 'your wallet, if it was not given at quote time (non-custodial)',
		},
		handler: async (ctx) => {
			const { claims: pinned, nonce } = verifyQuote(ctx.body.quoteId, 'swap', { userId: ctx.principal.userId });

			if (pinned.mode === 'custodial') {
				const p = ctx.principal;
				if (p.source !== 'session' && !hasScope(p.scope, 'wallet:write')) {
					throw apiError(403, 'insufficient_scope', 'Swapping from an agent wallet requires the "wallet:write" scope.', {
						required: 'wallet:write',
					});
				}
				requireConfirm(ctx.body, 'swapQuote', 'POST /api/v1/swap/quote');
				const out = await forward(await tradeHandler(pinned.agentId), ctx, {
					method: 'POST',
					url: `/api/agents/${pinned.agentId}/solana/trade`,
					// The quote nonce is the executor's idempotency key, so a quote
					// executes at most once and a repeat replays the first fill.
					body: { ...tradeBody(pinned), idempotency_key: `v1q:${nonce}` },
				});
				if (out.status < 200 || out.status >= 300) throw toApiError(out);
				const d = out.body?.data ?? {};
				return {
					mode: 'custodial',
					agentId: pinned.agentId,
					status: 'confirmed',
					replayed: Boolean(d.replayed),
					signature: d.signature ?? null,
					explorer: d.explorer ?? null,
					...shapeCustodialQuote(d, pinned),
					newBalanceSol: d.new_balance_sol ?? null,
				};
			}

			const userPublicKey = pubkeyParam(ctx.body.userPublicKey, 'userPublicKey') || pinned.userPublicKey;
			if (!userPublicKey) {
				throw apiError(400, 'missing_parameter', 'userPublicKey is required: the wallet that will sign this swap.', { parameter: 'userPublicKey' });
			}
			// Re-price, and refuse if the market moved below what the caller saw.
			const q = await quoteJupiter(pinned);
			if (pinned.minOutAmount && BigInt(q.outAmount) < BigInt(pinned.minOutAmount)) {
				throw apiError(409, 'quote_moved', 'The price moved past your slippage since the quote. Request a new quote.', {
					quotedMinOut: pinned.minOutAmount,
					currentOut: String(q.outAmount),
				});
			}
			let transaction;
			try {
				transaction = await jupiterSwapTx({ quote: q, userPublicKey, wrapAndUnwrapSol: true });
			} catch {
				throw apiError(502, 'swap_failed', 'The swap transaction could not be built right now. Retry shortly.', {
					inputMint: pinned.inputMint,
					outputMint: pinned.outputMint,
				});
			}
			return {
				mode: 'non_custodial',
				agentId: null,
				status: 'unsigned',
				transaction,
				encoding: 'base64',
				signer: userPublicKey,
				...shapeJupiterQuote(q, pinned),
			};
		},
	},
];
