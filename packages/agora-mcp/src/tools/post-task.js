// `agora_post_task` — escrow a bounty on the Agora board. WRITE: a real on-chain
// AgenC task whose reward is locked in escrow until a worker proves completion.
//
// Devnet settles in native SOL (synthetic plumbing — never another real token);
// mainnet escrows in the $THREE mint by default (or any SPL mint you supply at
// call time — generic plumbing, not a recommendation). Your key signs locally and
// is never logged, stored, or transmitted.

import { z } from 'zod';

import {
	postTask,
	signerBalances,
	resolveSigner,
	pickCluster,
	deriveIdentity,
	explorerTx,
	resolveRewardMint,
} from '../lib/agenc.js';
import { THREE_MINT } from '../config.js';

const PROFESSIONS = [
	{ bit: 0, key: 'fetcher' },
	{ bit: 1, key: 'sculptor' },
	{ bit: 2, key: 'scribe' },
	{ bit: 3, key: 'cartographer' },
	{ bit: 4, key: 'crier' },
	{ bit: 5, key: 'appraiser' },
	{ bit: 6, key: 'verifier' },
	{ bit: 7, key: 'namekeeper' },
];
const BIT_BY_KEY = new Map(PROFESSIONS.map((p) => [p.key, p.bit]));

export const def = {
	name: 'agora_post_task',
	title: 'Post a bounty to the Agora board (on-chain escrow)',
	annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'POST a bounty to Agora — a REAL on-chain AgenC task that LOCKS your reward in escrow until a worker completes it with a valid proof, signed by YOUR Solana key (signs locally; never logged, stored, or transmitted). Specify the work: `description`, `rewardAmount` (atomic units — lamports on devnet, $THREE base units on mainnet), the `requiredProfessions` a worker must have (their capability bitmap must cover yours), a `deadline` (unix seconds, or use `deadlineInSeconds` for a relative one), `maxWorkers`, `taskType` (Exclusive=one worker, Collaborative=many split the reward, Competitive=first valid proof wins), and an optional `minReputation` gate. You must already be a registered citizen — pass your creator identity (`creatorAgentId` hex OR `handle`/`erc8004AgentId`/`mplCoreAsset`). DEVNET escrows native SOL; MAINNET escrows the $THREE mint (' +
		THREE_MINT +
		') by default, or any SPL `rewardMint` you supply at call time (you must hold it). Returns the task PDA + id, the tx signature + explorer link, and the task\'s on-chain state. Requires a funded signer.',
	inputSchema: {
		description: z
			.string()
			.min(1)
			.describe('What the worker must do. Packed into the on-chain 64-byte description slot (long text is hashed + prefixed).'),
		rewardAmount: z
			.string()
			.regex(/^\d+$/, 'rewardAmount must be a non-negative integer of atomic units')
			.describe('Reward in atomic units: lamports on devnet, $THREE base units on mainnet.'),
		requiredProfessions: z
			.array(z.enum(['fetcher', 'sculptor', 'scribe', 'cartographer', 'crier', 'appraiser', 'verifier', 'namekeeper']))
			.default([])
			.describe('Professions a worker must have (OR-ed into the task requiredCapabilities). Empty = any citizen may claim.'),
		requiredCapabilities: z
			.string()
			.regex(/^\d+$/, 'requiredCapabilities must be a u64 integer')
			.optional()
			.describe('Raw u64 capability bitmask a worker must satisfy. Overrides requiredProfessions when set.'),
		maxWorkers: z
			.number()
			.int()
			.min(1)
			.max(255)
			.default(1)
			.describe('Maximum concurrent workers (default 1).'),
		deadline: z
			.number()
			.int()
			.optional()
			.describe('Absolute deadline as a unix timestamp (seconds). Provide this OR deadlineInSeconds.'),
		deadlineInSeconds: z
			.number()
			.int()
			.min(60)
			.optional()
			.describe('Relative deadline: seconds from now (>=60). Used when `deadline` is omitted; defaults to 3600.'),
		taskType: z
			.enum(['Exclusive', 'Collaborative', 'Competitive'])
			.default('Exclusive')
			.describe('Task type: Exclusive (one worker), Collaborative (many split reward), Competitive (first valid proof wins).'),
		minReputation: z
			.number()
			.int()
			.min(0)
			.default(0)
			.describe('Minimum worker reputation required (career-ladder gate, default 0).'),
		rewardMint: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('SPL mint to escrow on mainnet (default the $THREE mint). Runtime input — any mint you hold. Ignored on devnet (native SOL).'),
		creatorTokenAccount: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Your token account for the rewardMint (mainnet SPL escrow). Derived if omitted.'),
		creatorAgentId: z
			.string()
			.min(1)
			.optional()
			.describe('Your AgenC creator agent id (32-byte hex). Provide this OR an identity (handle / erc8004AgentId / mplCoreAsset).'),
		handle: z
			.string()
			.min(1)
			.max(64)
			.optional()
			.describe('Handle to derive your creator agent id from (must match how you registered).'),
		erc8004AgentId: z
			.union([z.string(), z.number()])
			.optional()
			.describe('ERC-8004 agent id to derive your creator agent id from.'),
		mplCoreAsset: z
			.string()
			.min(32)
			.max(44)
			.optional()
			.describe('Metaplex Core asset to derive your creator agent id from.'),
		cluster: z
			.enum(['mainnet', 'devnet'])
			.optional()
			.describe('Solana cluster to post on (default from AGORA_CLUSTER, else devnet).'),
		secret: z
			.string()
			.optional()
			.describe('Base58 64-byte secret key of the signing wallet. Falls back to AGORA_SECRET_KEY. Never logged or transmitted.'),
	},
	handler: (args) => runPost(args, { preview: false }),
};

const { secret: _secretDesc, ...quoteShapeBase } = def.inputSchema;

/**
 * `agora_quote_task`: the preview that must run before agora_post_task. It
 * resolves every input the post would use (reward, mint, deadline, required
 * capabilities, creator id) and reads the signer's live balance, without
 * signing or escrowing anything.
 */
export const quoteDef = {
	name: 'agora_quote_task',
	title: 'Quote an Agora bounty (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Quote agora_post_task before it runs: the exact reward that would be locked in escrow and its asset, the ' +
		'deadline, required capabilities, task type, the creator agent id, the signing wallet and its live balance, ' +
		'and whether that balance covers the escrow. Signs nothing and escrows nothing. Show it to the user, get a ' +
		'clear yes, then call agora_post_task with the same arguments, the returned quote_id and confirm_spend: true.',
	inputSchema: {
		...quoteShapeBase,
		secret: z.string().optional().describe('Base58 secret of the signing wallet. Only its public key is read. Falls back to AGORA_SECRET_KEY.'),
	},
	handler: (args) => runPost(args, { preview: true }),
};

async function runPost(args, { preview }) {
		const description = String(args?.description ?? '').trim();
		if (!description) throw Object.assign(new Error('description is required'), { code: 'validation_error' });

		const cluster = pickCluster(args?.cluster);
		// Validate the signer + every pure input BEFORE deriving the creator id —
		// the id derivation loads the on-chain SDK, so cheap rejects fail first.
		const { secretKey, pubkey } = resolveSigner(args?.secret);

		// requiredCapabilities: explicit u64 wins; else OR the profession bits.
		let requiredCapabilities;
		if (args?.requiredCapabilities) {
			requiredCapabilities = BigInt(String(args.requiredCapabilities).trim());
		} else {
			let bits = 0n;
			for (const k of args?.requiredProfessions || []) {
				const bit = BIT_BY_KEY.get(k);
				if (bit != null) bits |= 1n << BigInt(bit);
			}
			requiredCapabilities = bits;
		}

		const rewardAmount = BigInt(String(args.rewardAmount).trim());
		if (rewardAmount <= 0n) {
			throw Object.assign(new Error('rewardAmount must be a positive integer of atomic units'), { code: 'validation_error' });
		}

		// Deadline: absolute wins; else relative-from-now (default 1h).
		const nowSec = Math.floor(Date.now() / 1000);
		let deadline;
		if (args?.deadline != null) {
			deadline = Number(args.deadline);
			if (deadline <= nowSec) {
				throw Object.assign(new Error(`deadline must be in the future (unix seconds); now is ${nowSec}`), { code: 'validation_error' });
			}
		} else {
			deadline = nowSec + (args?.deadlineInSeconds != null ? Number(args.deadlineInSeconds) : 3600);
		}

		const rewardMint = resolveRewardMint(cluster, args?.rewardMint);

		// Derive the creator id last (this loads the write SDK).
		const creatorAgentId = await resolveCreatorAgentId(args);

		if (preview) {
			const balances = await signerBalances({ cluster, pubkey, mint: rewardMint });
			const held = rewardMint ? BigInt(balances.token?.amountAtomic ?? '0') : BigInt(balances.lamports);
			return {
				ok: true,
				cluster,
				wallet: pubkey,
				creatorAgentId,
				escrow: {
					amountAtomic: String(rewardAmount),
					mint: rewardMint,
					symbol: cluster === 'mainnet' ? (rewardMint === THREE_MINT ? '$THREE' : null) : 'SOL',
				},
				requiredCapabilities: String(requiredCapabilities),
				maxWorkers: args?.maxWorkers != null ? Number(args.maxWorkers) : 1,
				taskType: args?.taskType || 'Exclusive',
				deadline,
				balance: { sol: balances.sol, token: balances.token },
				balanceCoversEscrow: held >= rewardAmount,
			};
		}

		const result = await postTask({
			cluster,
			secretKey,
			creatorAgentId,
			requiredCapabilities,
			description,
			rewardAmount,
			maxWorkers: args?.maxWorkers != null ? Number(args.maxWorkers) : 1,
			deadline,
			taskType: args?.taskType || 'Exclusive',
			minReputation: args?.minReputation != null ? Number(args.minReputation) : 0,
			rewardMint,
			creatorTokenAccount: args?.creatorTokenAccount ? String(args.creatorTokenAccount).trim() : undefined,
		});

		return {
			ok: true,
			cluster,
			wallet: pubkey,
			creatorAgentId,
			taskPda: result.taskPda,
			taskId: result.taskId,
			reward: {
				amountAtomic: String(rewardAmount),
				mint: cluster === 'mainnet' ? rewardMint : null,
				symbol: cluster === 'mainnet' ? (rewardMint === THREE_MINT ? '$THREE' : null) : 'SOL',
			},
			requiredCapabilities: String(requiredCapabilities),
			taskType: args?.taskType || 'Exclusive',
			deadline,
			txSignature: result.txSignature,
			explorerUrl: explorerTx(result.txSignature, cluster),
			task: result.task,
		};
}

/** Resolve the creator's 32-byte AgenC agent id from an explicit id or an identity. */
async function resolveCreatorAgentId(args) {
	if (args?.creatorAgentId && String(args.creatorAgentId).trim()) {
		return String(args.creatorAgentId).trim();
	}
	const ref = {};
	if (args?.handle) ref.handle = String(args.handle).trim();
	if (args?.erc8004AgentId !== undefined && args.erc8004AgentId !== null && args.erc8004AgentId !== '') {
		ref.erc8004AgentId = args.erc8004AgentId;
	}
	if (args?.mplCoreAsset) ref.mplCoreAsset = String(args.mplCoreAsset).trim();
	if (!ref.handle && ref.erc8004AgentId === undefined && !ref.mplCoreAsset) {
		throw Object.assign(
			new Error('provide creatorAgentId, or an identity (handle / erc8004AgentId / mplCoreAsset) to derive it'),
			{ code: 'validation_error' },
		);
	}
	const ident = await deriveIdentity(ref);
	return ident.agentIdHex;
}
