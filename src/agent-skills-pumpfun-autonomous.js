/**
 * Pump.fun autonomous skills for Solana agents
 * --------------------------------------------
 * These skills make an agent act with its OWN server-side Solana wallet
 * (provisioned in api/_lib/agent-pumpfun.js). Distinct from
 * agent-skills-pumpfun.js, which signs with the human owner's browser wallet.
 *
 * Use cases:
 *   - Agent pays for its own services / subscriptions on chain
 *   - Agent autonomously launches a follow-up token without user click
 *   - Agent rebalances its treasury (swap)
 *   - Agent withdraws collected payments to its main vault
 *
 * Auth: relies on session cookie or bearer token from the calling environment.
 * The server-side endpoints already verify caller ownership of the agent.
 *
 * No keys touched here. No SDK imports. Pure HTTP fetch.
 */

const ENDPOINT = (id, leaf) =>
	`/api/agents/${encodeURIComponent(id)}/pumpfun/${leaf}`;

async function postJson(url, body) {
	const res = await fetch(url, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body || {}),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = data?.error_description || `${url} returned ${res.status}`;
		const err = new Error(msg);
		err.status = res.status;
		err.code = data?.error;
		throw err;
	}
	return data;
}

function requireAgentId(ctx) {
	const id = ctx?.identity?.id;
	if (!id) throw new Error('No agent identity in context.');
	return id;
}

/**
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerPumpFunAutonomousSkills(skills) {
	// ── pumpfun-self-launch ───────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-self-launch',
		description:
			"Launch a pump.fun token signed by the agent's own Solana wallet (server-side). The agent becomes the creator.",
		instruction:
			'POSTs to /api/agents/:id/pumpfun/launch. The user must own the agent (server enforces).',
		animationHint: 'celebrate',
		voicePattern: 'Launching {{symbol}} from my own wallet…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				symbol: { type: 'string' },
				uri: { type: 'string', description: 'Pre-uploaded metadata URI' },
				solAmount: { type: 'number', description: 'Optional initial dev-buy in SOL' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['symbol', 'uri'],
		},
		handler: async (args, ctx) => {
			const id = requireAgentId(ctx);
			const data = await postJson(ENDPOINT(id, 'launch'), {
				name: args.name || ctx.identity?.name,
				symbol: args.symbol,
				uri: args.uri,
				solAmount: args.solAmount,
				network: args.network,
			});
			return {
				success: true,
				output: `Launched ${data.symbol || args.symbol}. Mint: ${data.mint}`,
				sentiment: 0.9,
				data,
			};
		},
	});

	// ── pumpfun-self-launch-from-identity ─────────────────────────────────────
	skills.register({
		name: 'pumpfun-self-launch-from-identity',
		description:
			'One-shot: agent autonomously launches a token whose metadata is auto-derived from its identity (name, GLB, bio).',
		instruction:
			'Resolves /api/agents/pumpfun-metadata?id=<id>, then calls pumpfun-self-launch.',
		animationHint: 'celebrate',
		voicePattern: 'Minting myself…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				solAmount: { type: 'number' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
		},
		handler: async (args, ctx) => {
			const id = requireAgentId(ctx);
			const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
			const uri = `${origin}/api/agents/pumpfun-metadata?id=${encodeURIComponent(id)}`;
			const symbol =
				args.symbol ||
				(ctx.identity?.name || 'AGENT')
					.toUpperCase()
					.replace(/[^A-Z0-9]/g, '')
					.slice(0, 10) ||
				'AGENT';
			return skills.perform(
				'pumpfun-self-launch',
				{ name: ctx.identity?.name, symbol, uri, solAmount: args.solAmount, network: args.network },
				ctx,
			);
		},
	});

	// ── pumpfun-self-swap ─────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-self-swap',
		description:
			"Buy or sell a pump.fun token from the agent's own wallet. Auto-routes bonding-curve vs AMM by graduation status.",
		instruction:
			'POSTs to /api/agents/:id/pumpfun/swap. Server picks pump-sdk or pump-swap-sdk by curve state.',
		animationHint: 'gesture',
		voicePattern: '{{side}} {{mint}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				side: { type: 'string', enum: ['buy', 'sell'] },
				solAmount: { type: 'number', description: 'For buy: SOL to spend' },
				tokenAmount: { type: 'string', description: 'For sell: tokens (raw units)' },
				slippageBps: { type: 'integer', minimum: 0, maximum: 10000 },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['mint', 'side'],
		},
		handler: async (args, ctx) => {
			const id = requireAgentId(ctx);
			const data = await postJson(ENDPOINT(id, 'swap'), {
				mint: args.mint,
				side: args.side,
				solAmount: args.solAmount,
				tokenAmount: args.tokenAmount,
				slippageBps: args.slippageBps ?? 500,
				network: args.network || 'mainnet',
			});
			return {
				success: true,
				output:
					args.side === 'buy'
						? `Bought ${args.mint.slice(0, 8)}… for ${args.solAmount} SOL.`
						: `Sold ${args.tokenAmount} of ${args.mint.slice(0, 8)}…`,
				sentiment: 0.5,
				data,
			};
		},
	});

	// ── pumpfun-self-pay ──────────────────────────────────────────────────────
	skills.register({
		name: 'pumpfun-self-pay',
		description:
			"Agent-side payment ops: accept (pay an agent), withdraw (pull collected fees), balances (read).",
		instruction: 'POSTs to /api/agents/:id/pumpfun/pay with { action, ... }.',
		animationHint: 'gesture',
		voicePattern: 'Pump payment {{action}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['accept', 'withdraw', 'balances'] },
				tokenMint: { type: 'string' },
				currencyMint: { type: 'string' },
				amount: { type: 'string' },
				memo: { type: 'string' },
				startTime: { type: 'number' },
				endTime: { type: 'number' },
				receiverAta: { type: 'string', description: 'For withdraw' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
			},
			required: ['action'],
		},
		handler: async (args, ctx) => {
			const id = requireAgentId(ctx);
			const data = await postJson(ENDPOINT(id, 'pay'), args);
			let output;
			if (args.action === 'balances') {
				output = `Balances: ${JSON.stringify(data.balances || data)}`;
			} else if (args.action === 'accept') {
				output = `Payment accepted (${args.amount}).`;
			} else {
				output = `Withdraw complete.`;
			}
			return { success: true, output, sentiment: 0.5, data };
		},
	});
}
