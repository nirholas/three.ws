// `quote_trade`: price a buy or sell from the agent wallet. READ-ONLY.
//
// Wraps POST /api/agents/:id/trade with preview:true. The server runs the full
// guard chain in preview mode and returns the expected output, minimum
// received, price impact, fees and any guard or funds warning. It never touches
// the wallet key and writes no ledger row.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { agentIdArg, tradeBody } from '../lib/args.js';

export const inputSchema = {
	agentId: z.string().min(1).describe('UUID of the agent whose wallet would trade. Must be owned by the credential.'),
	side: z.enum(['buy', 'sell']).describe('buy spends SOL for the token; sell sends the token for SOL.'),
	mint: z.string().min(32).describe('Solana mint of the token. A sell of $THREE is refused.'),
	amountSol: z.number().positive().optional().describe('Buys: SOL to spend.'),
	tokenAmountRaw: z.string().optional().describe('Sells: amount in the token\'s base units (an integer string).'),
	slippageBps: z.number().int().min(1).max(500).optional().describe('Maximum slippage in basis points. Default 100.'),
};

export const def = {
	name: 'quote_trade',
	title: 'Quote a trade from an agent wallet',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Quote a buy or sell from the agent\'s custodial wallet without sending anything. Runs the same guard chain ' +
		'a real fill runs (kill switch, per-trade cap, daily budget, USD ceiling, price-impact breaker, rug firewall, ' +
		'SOL headroom) and returns the venue, expected output, minimum received, price impact, fees, wallet balance ' +
		'and any guard or funds warning. Use this before every execute_trade to show the owner what a fill would do.',
	inputSchema,
	async handler(args) {
		const agentId = agentIdArg(args?.agentId);
		const body = tradeBody(args, { preview: true });
		const data = await apiRequest(`/api/agents/${agentId}/trade`, { method: 'POST', body });
		return { ok: true, agentId, quote: data?.data ?? data };
	},
};
