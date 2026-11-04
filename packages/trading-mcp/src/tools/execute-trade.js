// `execute_trade`: fill a buy or sell from the agent wallet. WRITE, IRREVERSIBLE.
//
// Wraps POST /api/agents/:id/trade with preview:false. This moves real funds on
// Solana mainnet. It requires confirm:true, and the server additionally
// requires the wallet:trade grant on the credential, the owner's signed
// real-funds agreement, and every guard in the wallet executor. The
// idempotencyKey makes a retry safe: the same key can fill at most once.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { agentIdArg, tradeBody } from '../lib/args.js';
import { inputSchema as quoteSchema } from './quote-trade.js';

export const def = {
	name: 'execute_trade',
	title: 'Execute a trade (moves real funds)',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
	description:
		'Use this after the owner approved a quoted trade, to FILL a buy or sell from the agent\'s custodial wallet. REAL FUNDS, IRREVERSIBLE: you MUST pass confirm:true, ' +
		'and the owner should have approved the exact side, mint and size first (run quote_trade, show the result, ' +
		'get a yes). The server enforces the per-trade cap, daily budget, USD ceiling, price-impact breaker, rug ' +
		'firewall and kill switch, and requires the wallet:trade grant plus the signed real-funds agreement; a breach ' +
		'is denied with its own code and nothing is sent. Pass a stable idempotencyKey so a retry cannot fill twice. ' +
		'The agent never sells $THREE: that call is refused before it leaves this process.',
	inputSchema: {
		...quoteSchema,
		confirm: z.boolean().describe('Must be literally true. Confirms the owner approved this exact trade.'),
		idempotencyKey: z.string().min(1).max(128).optional().describe('Stable key for this trade. The same key fills at most once.'),
	},
	async handler(args) {
		if (args?.confirm !== true) {
			throw Object.assign(new Error('execute_trade needs confirm:true. Run quote_trade first and get the owner to approve the exact trade.'), {
				code: 'confirmation_required',
				status: 400,
			});
		}
		const agentId = agentIdArg(args?.agentId);
		const body = tradeBody(args, { preview: false });
		if (typeof args?.idempotencyKey === 'string' && args.idempotencyKey.trim()) body.idempotency_key = args.idempotencyKey.trim();
		const data = await apiRequest(`/api/agents/${agentId}/trade`, { method: 'POST', body });
		const fill = data?.data ?? data;
		return {
			ok: true,
			agentId,
			signature: fill?.signature ?? null,
			explorer: fill?.explorer ?? null,
			replayed: fill?.replayed === true,
			fill,
		};
	},
};
