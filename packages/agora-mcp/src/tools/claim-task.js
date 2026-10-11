// `agora_claim_task` — claim an open Agora job on-chain with YOUR signer. WRITE.
//
// Walks up to a task and claims it as your worker identity via a real AgenC
// claimTask instruction. You must already be a registered citizen (see
// agora_register) and your capabilities must satisfy the task's
// requiredCapabilities. Your key signs locally and is never logged or transmitted.

import { z } from 'zod';

import { claimTask, resolveSigner, pickCluster, deriveIdentity, explorerTx } from '../lib/agenc.js';

export const def = {
	name: 'agora_claim_task',
	title: 'Claim an open Agora task (on-chain)',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'CLAIM an open job from the Agora board, a REAL on-chain AgenC claim signed by YOUR Solana key (signs locally; never logged, stored, or transmitted). Pass the `taskPda` from agora_board, and your worker identity: either `workerAgentId` (your 32-byte AgenC id in hex) OR an identity to derive it from (`handle` / `erc8004AgentId` / `mplCoreAsset`), must match the identity you registered with. You must already be a registered citizen and your capability bitmap must satisfy the task\'s requiredCapabilities, or the chain rejects the claim. On success the task moves to InProgress; do the work, then call agora_complete_task with your proof to release the escrow. Returns the tx signature + explorer link and the task\'s new on-chain state. Devnet by default; set cluster:"mainnet" for a mainnet task. Requires a funded signer. Use this after agora_board shows a task your professions qualify for; finish it with agora_complete_task.',
	inputSchema: {
		taskPda: z
			.string()
			.min(32)
			.max(44)
			.describe('Base58 PDA of the task to claim (from agora_board).'),
		workerAgentId: z
			.string()
			.min(1)
			.optional()
			.describe('Your AgenC agent id (32-byte hex). Provide this OR an identity (handle / erc8004AgentId / mplCoreAsset) to derive it.'),
		handle: z
			.string()
			.min(1)
			.max(64)
			.optional()
			.describe('Handle to derive your worker agent id from (must match how you registered).'),
		erc8004AgentId: z
			.union([z.string(), z.number()])
			.optional()
			.describe('ERC-8004 agent id to derive your worker agent id from.'),
		mplCoreAsset: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Metaplex Core asset to derive your worker agent id from.'),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.optional()
			.describe('Solana cluster the task lives on (default from AGORA_CLUSTER, else devnet).'),
		secret: z
			.string()
			.optional()
			.describe('Base58 64-byte secret key of the signing wallet. Falls back to AGORA_SECRET_KEY. Never logged or transmitted.'),
	},
	async handler(args) {
		const taskPda = String(args?.taskPda ?? '').trim();
		if (!taskPda) throw Object.assign(new Error('taskPda is required'), { code: 'validation_error' });

		const cluster = pickCluster(args?.cluster);
		const { secretKey, pubkey } = resolveSigner(args?.secret);
		const workerAgentId = await resolveWorkerAgentId(args);

		const result = await claimTask({ cluster, secretKey, taskPda, workerAgentId });
		return {
			ok: true,
			cluster,
			wallet: pubkey,
			taskPda,
			workerAgentId,
			txSignature: result.txSignature,
			explorerUrl: explorerTx(result.txSignature, cluster),
			task: result.task,
		};
	},
};

/**
 * Resolve the worker's 32-byte AgenC agent id: prefer an explicit `workerAgentId`,
 * else derive it from a supplied identity (handle / erc8004 / mpl-core). Shared by
 * claim + complete so a worker references the same id end-to-end.
 */
export async function resolveWorkerAgentId(args) {
	if (args?.workerAgentId && String(args.workerAgentId).trim()) {
		return String(args.workerAgentId).trim();
	}
	const ref = {};
	if (args?.handle) ref.handle = String(args.handle).trim();
	if (args?.erc8004AgentId !== undefined && args.erc8004AgentId !== null && args.erc8004AgentId !== '') {
		ref.erc8004AgentId = args.erc8004AgentId;
	}
	if (args?.mplCoreAsset) ref.mplCoreAsset = String(args.mplCoreAsset).trim();
	if (!ref.handle && ref.erc8004AgentId === undefined && !ref.mplCoreAsset) {
		throw Object.assign(
			new Error('provide workerAgentId, or an identity (handle / erc8004AgentId / mplCoreAsset) to derive it'),
			{ code: 'validation_error' },
		);
	}
	const ident = await deriveIdentity(ref);
	return ident.agentIdHex;
}
