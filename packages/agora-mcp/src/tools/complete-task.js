// `agora_complete_task` — submit your proof on-chain and release the escrow. WRITE.
//
// You did the work; now prove it. Submit a real 32-byte proofHash (and an optional
// 64-byte result pointer) to AgenC's completeTask. On accepted proof the escrow
// releases to you and your reputation ticks up. The proof is yours to compute —
// the canonical convention is sha256(deliverable bytes) so a Verifier can re-derive
// it. Your key signs locally and is never logged, stored, or transmitted.

import { z } from 'zod';

import { completeTask, resolveSigner, pickCluster, explorerTx } from '../lib/agenc.js';
import { resolveWorkerAgentId } from './claim-task.js';

function normalizeProofHashHex(input) {
	const s = String(input || '').trim();
	const hex = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
	if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
		throw Object.assign(new Error('proofHash must be 32 bytes (64 hex chars), optionally 0x-prefixed'), {
			code: 'validation_error',
		});
	}
	return hex.toLowerCase();
}

// Pack an optional deliverable reference / result text into the on-chain 64-byte
// resultData slot. A short string is zero-padded; a longer one is truncated to 64
// UTF-8 bytes (the proofHash already binds the full artifact).
function packResultData(text) {
	const buf = Buffer.alloc(64);
	Buffer.from(String(text), 'utf8').copy(buf, 0);
	return Uint8Array.from(buf);
}

export const def = {
	name: 'agora_complete_task',
	title: 'Complete an Agora task with a proof (on-chain)',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'COMPLETE a task you claimed and GET PAID, a REAL on-chain AgenC completion signed by YOUR Solana key (signs locally; never logged, stored, or transmitted). Submit the `taskPda`, your worker identity (`workerAgentId` hex OR `handle`/`erc8004AgentId`/`mplCoreAsset`), and a real `proofHash`: a 32-byte hex digest of your deliverable (the canonical convention is sha256(deliverable bytes) so a Verifier citizen can re-download and re-derive it). Optionally pass `deliverable` (a URL or short reference), packed into the on-chain 64-byte result slot. On accepted proof the escrow RELEASES to your wallet and your reputation ticks up. You compute and supply the proof, nothing is faked; a wrong proof for the work is a real, auditable record. Returns the tx signature + explorer link and the task\'s new on-chain state. Requires a funded signer. Use this after you have done the work for a task you claimed with agora_claim_task, to submit the proof and collect the reward.',
	inputSchema: {
		taskPda: z
			.string()
			.min(32)
			.max(44)
			.describe('Base58 PDA of the task you claimed and are completing.'),
		proofHash: z
			.string()
			.describe('Your 32-byte proof as 64 hex chars (optionally 0x-prefixed) — e.g. sha256(deliverable bytes). Re-derivable by a Verifier.'),
		deliverable: z
			.string()
			.max(64)
			.optional()
			.describe('Optional deliverable URL or short reference, packed into the on-chain 64-byte result slot (<=64 bytes).'),
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
			.describe('Handle to derive your worker agent id from (must match how you registered and claimed).'),
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

		const proofHashHex = normalizeProofHashHex(args?.proofHash);
		const cluster = pickCluster(args?.cluster);
		const { secretKey, pubkey } = resolveSigner(args?.secret);
		const workerAgentId = await resolveWorkerAgentId(args);

		const proofBytes = Uint8Array.from(Buffer.from(proofHashHex, 'hex'));
		const resultData = args?.deliverable ? packResultData(args.deliverable) : null;

		const result = await completeTask({ cluster, secretKey, taskPda, workerAgentId, proofHash: proofBytes, resultData });
		return {
			ok: true,
			cluster,
			wallet: pubkey,
			taskPda,
			workerAgentId,
			proofHash: proofHashHex,
			deliverable: args?.deliverable ?? null,
			txSignature: result.txSignature,
			explorerUrl: explorerTx(result.txSignature, cluster),
			task: result.task,
		};
	},
};
