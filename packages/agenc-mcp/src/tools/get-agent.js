// `get_agent` — one AgenC registry entry (ERC-8004-style on-chain identity).
// Read-only.
//
// Wraps GET /api/agenc/get-agent. Address an agent either by its PDA or by
// agentId (0x/64-char hex seed, or a plain label the bridge hashes).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_agent',
	title: 'Get AgenC agent registry entry',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Resolve an agent's on-chain identity in the AgenC registry (ERC-8004-style). Returns the registry entry: authority wallet, status (Inactive, Active, Busy, Suspended), declared capabilities bitmask, service endpoint, metadata URI, stake amount, active task count, reputation, and registration time. Use this to verify another agent before coordinating with it, confirm it is registered, active, and what it claims to do. Address the agent by `agentPda`, or by `agentId` (a 0x/64-char hex seed or a plain text label the bridge hashes to the canonical id). Read-only live on-chain data; returns ok:false with error:\"not_found\" when the agent is not registered. Free, no key required.",
	inputSchema: {
		agentPda: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Base58 PDA of the agent registry entry. Provide this OR agentId.'),
		agentId: z
			.string()
			.min(1)
			.optional()
			.describe('Agent id: a 0x/64-char hex seed, or a plain text label hashed to the canonical 32-byte id.'),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana cluster to query (default mainnet).'),
	},
	async handler(args) {
		const agentPda = args?.agentPda ? String(args.agentPda).trim() : undefined;
		const agentId = args?.agentId ? String(args.agentId).trim() : undefined;
		if (!agentPda && !agentId) {
			throw Object.assign(new Error('provide agentPda or agentId'), { code: 'validation_error' });
		}
		const cluster = args?.cluster === 'devnet' ? 'devnet' : 'mainnet';
		try {
			const data = await apiRequest('/api/agenc/get-agent', { query: { agentPda, agentId, cluster } });
			return {
				ok: true,
				cluster: data?.cluster ?? cluster,
				programId: data?.programId ?? null,
				agentPda: data?.agentPda ?? agentPda ?? null,
				agent: data?.agent ?? null,
				fetchedAt: data?.fetchedAt ?? null,
			};
		} catch (err) {
			if (err?.code === 'upstream_error' && err.status === 404) {
				const body = err.body || {};
				return {
					ok: false,
					error: 'not_found',
					cluster: body.cluster ?? cluster,
					programId: body.programId ?? null,
					agentPda: body.agentPda ?? agentPda ?? null,
				};
			}
			throw err;
		}
	},
};
