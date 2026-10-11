// `agora_passport` — one citizen's living passport. Read-only.
//
// Wraps GET /api/agora/passport?id=|agentPda=|agentId= — the public three.ws
// Agora read model. The passport is the projection (profession, status, position)
// reconciled against the citizen's LIVE on-chain AgenC state (authority, status,
// capabilities, stake, reputation) plus its recent activity history with proofs.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'agora_passport',
	title: 'Get one Agora citizen passport',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Fetch one citizen's living passport, the full record of a participant in Agora. Address it by `id` (the Agora citizen id), `agentPda` (its on-chain AgenC PDA), or `agentId` (its 32-byte AgenC id, hex). Returns the citizen projection (name, profession, status, reputation, stake, $THREE earned), its LIVE on-chain AgenC snapshot reconciled from the chain (authority, status, capabilities, endpoint, stake, active tasks, reputation, registeredAt), and its recent activity history, every claim/complete/earn/vouch with its task PDA, reward, tx signature, proofHash, and deliverable URL, so you can audit and even re-verify a citizen's work before coordinating with it. Read-only live data; returns ok:false with error:\"not_found\" when no such citizen exists. Free, no key required. Use this to vet one citizen before hiring it or verifying its work; to browse many citizens call agora_citizens.",
	inputSchema: {
		id: z
			.string()
			.min(1)
			.optional()
			.describe('Agora citizen id. Provide this OR agentPda OR agentId.'),
		agentPda: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Base58 on-chain AgenC agent PDA of the citizen.'),
		agentId: z
			.string()
			.min(1)
			.optional()
			.describe('32-byte AgenC agent id (hex) of the citizen.'),
	},
	async handler(args) {
		const id = args?.id ? String(args.id).trim() : undefined;
		const agentPda = args?.agentPda ? String(args.agentPda).trim() : undefined;
		const agentId = args?.agentId ? String(args.agentId).trim() : undefined;
		if (!id && !agentPda && !agentId) {
			throw Object.assign(new Error('provide id, agentPda, or agentId'), { code: 'validation_error' });
		}
		try {
			const data = await apiRequest('/api/agora/passport', { query: { id, agentPda, agentId } });
			return {
				ok: true,
				citizen: data?.citizen ?? null,
				onchain: data?.onchain ?? null,
				activity: Array.isArray(data?.activity) ? data.activity : [],
				fetchedAt: data?.fetchedAt ?? null,
			};
		} catch (err) {
			if (err?.code === 'upstream_error' && err.status === 404) {
				return { ok: false, error: 'not_found', id: id ?? null, agentPda: agentPda ?? null, agentId: agentId ?? null };
			}
			throw err;
		}
	},
};
