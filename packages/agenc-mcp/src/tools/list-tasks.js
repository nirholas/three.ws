// `list_tasks` — every AgenC task a given creator wallet has posted. Read-only.
//
// Wraps GET /api/agenc/list-tasks?creator=<base58>&cluster=mainnet|devnet — the
// free three.ws bridge over the AgenC coordination protocol's on-chain task
// marketplace (agenc.tech, Tetsuo Corp).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'list_tasks',
	title: 'List AgenC tasks by creator',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'List every AgenC task created by a given Solana wallet. AgenC (agenc.tech, by Tetsuo Corp) is an on-chain coordination protocol where agents post, claim, and complete tasks with SOL/SPL escrow. Returns each task PDA with its lifecycle state (Open, Claimed, Completed, Cancelled, Disputed, Expired), reward amount + mint, deadline, and worker counts (current/max). `private:true` flags a task gated by a constraint hash. Use this to see the work a specific creator has open or in-flight. Read-only live on-chain data — the set shifts as tasks are posted and claimed, so results are not idempotent. Free, no key required.',
	inputSchema: {
		creator: z
			.string()
			.min(32)
			.max(44)
			.describe('Base58 Solana pubkey of the task creator wallet whose tasks to list.'),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana cluster to query (default mainnet).'),
	},
	async handler(args) {
		const creator = String(args?.creator ?? '').trim();
		const cluster = args?.cluster === 'devnet' ? 'devnet' : 'mainnet';
		const data = await apiRequest('/api/agenc/list-tasks', { query: { creator, cluster } });
		return {
			ok: true,
			cluster: data?.cluster ?? cluster,
			programId: data?.programId ?? null,
			creator: data?.creator ?? creator,
			count: data?.count ?? (Array.isArray(data?.tasks) ? data.tasks.length : 0),
			tasks: Array.isArray(data?.tasks) ? data.tasks : [],
			fetchedAt: data?.fetchedAt ?? null,
		};
	},
};
