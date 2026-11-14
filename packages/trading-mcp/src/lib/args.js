// Argument checks shared by the trading tools. Pure: no I/O.

import { THREE_MINT, WSOL_MINT } from '../config.js';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// How an owner names the promoted coin instead of its address.
const THREE_ALIAS = /^\$?three$/i;

function refuse(code, message) {
	return Object.assign(new Error(message), { code, status: 400 });
}

export function agentIdArg(v) {
	const id = String(v ?? '').trim();
	if (!UUID.test(id)) throw refuse('invalid_parameter', 'agentId must be the UUID of an agent you own.');
	return id;
}

/**
 * Build the body POST /api/agents/:id/trade expects, refusing what the server
 * would refuse so the request never leaves the process.
 */
export function tradeBody(args, { preview }) {
	const side = args?.side === 'sell' ? 'sell' : args?.side === 'buy' ? 'buy' : null;
	if (!side) throw refuse('invalid_parameter', 'side must be "buy" or "sell".');
	const named = String(args?.mint ?? '').trim();
	const mint = THREE_ALIAS.test(named) ? THREE_MINT : named;
	if (!BASE58.test(mint)) throw refuse('invalid_parameter', 'mint must be a base58 Solana address, or "three" for $THREE.');
	if (mint === WSOL_MINT) throw refuse('invalid_parameter', 'Wrapped SOL is the quote asset, not a token to trade.');
	if (side === 'sell' && mint === THREE_MINT) {
		throw refuse('three_sell_forbidden', 'The agent never sells $THREE: it only accumulates and burns it.');
	}
	let slippage = args?.slippageBps == null ? 100 : Number(args.slippageBps);
	if (!Number.isInteger(slippage) || slippage < 1 || slippage > 500) {
		throw refuse('invalid_parameter', 'slippageBps must be a whole number from 1 to 500.');
	}
	const body = { side, mint, network: 'mainnet', slippage_bps: slippage, preview };
	if (side === 'buy') {
		const sol = Number(args?.amountSol);
		if (!Number.isFinite(sol) || sol <= 0) throw refuse('invalid_parameter', 'amountSol must be greater than zero for a buy.');
		body.sol_amount = sol;
	} else if (args?.amountTokens != null) {
		// Sized in tokens: the server resolves "all" or the amount against the
		// wallet's exact on-chain balance, so a sell never overshoots it.
		if (args?.tokenAmountRaw != null) throw refuse('invalid_parameter', 'Give either amountTokens or tokenAmountRaw for a sell, not both.');
		body.token_amount = amountTokensArg(args.amountTokens);
	} else {
		const raw = String(args?.tokenAmountRaw ?? '').trim();
		if (!/^\d{1,30}$/.test(raw) || BigInt(raw) <= 0n) {
			throw refuse('invalid_parameter', 'A sell needs amountTokens ("all" or a token amount) or tokenAmountRaw (a positive integer in base units).');
		}
		body.token_amount_raw = raw;
	}
	return body;
}

/** "all", or a positive token amount sent as a plain decimal string. */
function amountTokensArg(v) {
	if (typeof v === 'string' && v.trim().toLowerCase() === 'all') return 'all';
	const n = typeof v === 'number' || (typeof v === 'string' && /^\s*\d*\.?\d+\s*$/.test(v)) ? Number(v) : NaN;
	if (!Number.isFinite(n) || n <= 0) throw refuse('invalid_parameter', 'amountTokens must be "all" or a positive token amount.');
	return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}
