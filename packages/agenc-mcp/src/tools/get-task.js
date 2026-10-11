// `get_task` — one AgenC task's full status, optionally with its lifecycle
// timeline. Read-only.
//
// Wraps GET /api/agenc/get-task. Address a task either directly by its PDA, or
// by (creator + taskId) — taskId accepts a 0x/64-char hex seed or a plain label
// the bridge hashes to the canonical 32-byte id.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_task',
	title: 'Get AgenC task detail + lifecycle',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Fetch one AgenC task by its PDA, or by (creator + taskId). Returns the task state (Open, Claimed, Completed, Cancelled, Disputed, Expired), creator, reward amount + mint, deadline, worker counts, completion time, and whether it is private (constraint-gated). Set `lifecycle:true` to also get the full event timeline, every state transition with its timestamp, actor, and tx signature, so an agent can audit how the task progressed before deciding to claim it. `taskId` accepts a 0x-prefixed or bare 64-char hex seed, or a plain text label the bridge hashes to the canonical id. Read-only live on-chain data; returns ok:false with error:"not_found" when the task PDA does not exist. Free, no key required. Use this to inspect one task before claiming or funding it; to list every task a wallet created call list_tasks.',
	inputSchema: {
		taskPda: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Base58 PDA of the task to fetch. Provide this OR (creator + taskId).'),
		creator: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Base58 creator wallet — combine with taskId to derive the task PDA.'),
		taskId: z
			.string()
			.min(1)
			.optional()
			.describe('Task id: a 0x/64-char hex seed, or a plain text label hashed to the canonical 32-byte id. Requires creator.'),
		lifecycle: z
			.boolean()
			.default(false)
			.describe('When true, include the full lifecycle event timeline (state transitions, actors, tx signatures).'),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana cluster to query (default mainnet).'),
	},
	async handler(args) {
		const taskPda = args?.taskPda ? String(args.taskPda).trim() : undefined;
		const creator = args?.creator ? String(args.creator).trim() : undefined;
		const taskId = args?.taskId ? String(args.taskId).trim() : undefined;
		if (!taskPda && !(creator && taskId)) {
			throw Object.assign(new Error('provide taskPda OR (creator + taskId)'), { code: 'validation_error' });
		}
		const cluster = args?.cluster === 'devnet' ? 'devnet' : 'mainnet';
		const lifecycle = args?.lifecycle === true ? '1' : undefined;
		try {
			const data = await apiRequest('/api/agenc/get-task', {
				query: { taskPda, creator, taskId, lifecycle, cluster },
			});
			return {
				ok: true,
				cluster: data?.cluster ?? cluster,
				programId: data?.programId ?? null,
				taskPda: data?.taskPda ?? taskPda ?? null,
				task: data?.task ?? null,
				lifecycle: data?.lifecycle ?? null,
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
					taskPda: body.taskPda ?? taskPda ?? null,
				};
			}
			throw err;
		}
	},
};
