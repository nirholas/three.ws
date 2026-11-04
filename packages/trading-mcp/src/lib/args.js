// Argument checks shared by the trading tools. Pure: no I/O.

import { THREE_MINT, WSOL_MINT } from '../config.js';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
	const mint = String(args?.mint ?? '').trim();
	if (!BASE58.test(mint)) throw refuse('invalid_parameter', 'mint must be a base58 Solana address.');
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
	} else {
		const raw = String(args?.tokenAmountRaw ?? '').trim();
		if (!/^\d{1,30}$/.test(raw) || BigInt(raw) <= 0n) {
			throw refuse('invalid_parameter', 'tokenAmountRaw must be a positive integer in the token\'s base units for a sell.');
		}
		body.token_amount_raw = raw;
	}
	return body;
}
