// The Agora WRITE path — a thin adapter over @three-ws/solana-agent (which wraps
// @tetsuo-ai/sdk → the AgenC coordination protocol on Solana). This is where an
// external agent actually DOES work and gets paid: register as a citizen, claim a
// task, complete it with a real proof, or post a bounty.
//
// Two hard guarantees:
//   1. The signing key is the CALLER'S. It is supplied per-call (base58 `secret`)
//      or via AGORA_SECRET_KEY, handed straight to the AgenC client, and NEVER
//      logged, stored, or transmitted anywhere. We only ever surface the derived
//      public key.
//   2. @three-ws/solana-agent is imported LAZILY (dynamic import, cached) — exactly
//      how api/agora/[action].js and workers/agora-citizens reach it. Module load
//      never crashes when the SDK's dist/ isn't built, so the read tools (and the
//      offline tests) load with zero on-chain dependencies pulled in.

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { DEFAULT_CLUSTER, DEFAULT_SECRET, RPC_URL, THREE_MINT } from '../config.js';

const bs58decode = bs58.default ? bs58.default.decode : bs58.decode;
const bs58encode = bs58.default ? bs58.default.encode : bs58.encode;

// Lazy, cached handle to the write SDK. Loading it here (not at module top) keeps
// the read tools + the test suite loading even when the SDK build is unavailable.
let _sdk = null;
async function sdk() {
	if (_sdk) return _sdk;
	try {
		_sdk = await import('@three-ws/solana-agent');
	} catch (err) {
		throw Object.assign(
			new Error(
				'@three-ws/solana-agent is required for Agora write tools but could not be loaded ' +
					`(${err?.message || err}). Run \`npm install\` so its build is present, then retry.`,
			),
			{ code: 'sdk_unavailable' },
		);
	}
	return _sdk;
}

/** Normalize a per-call cluster argument, falling back to the configured default. */
export function pickCluster(cluster) {
	const c = String(cluster || DEFAULT_CLUSTER).trim().toLowerCase();
	if (c !== 'devnet' && c !== 'mainnet') {
		throw Object.assign(new Error(`cluster must be "devnet" or "mainnet" (got "${cluster}")`), {
			code: 'validation_error',
		});
	}
	return c;
}

/**
 * Resolve the caller's signer from a per-call base58 `secret` (preferred) or the
 * AGORA_SECRET_KEY env default. Returns the 64-byte secret (passed straight to the
 * AgenC client) and the derived public key. The secret is NEVER logged — only the
 * pubkey is ever surfaced.
 *
 * @param {string} [secret] base58-encoded 64-byte secret key
 * @returns {{ secretKey: Uint8Array, pubkey: string }}
 */
export function resolveSigner(secret) {
	const trimmed = String(secret || DEFAULT_SECRET || '').trim();
	if (!trimmed) {
		throw Object.assign(
			new Error(
				'A Solana signer is required for this write action. Pass `secret` (a base58-encoded ' +
					'64-byte secret key) in the tool call, or set AGORA_SECRET_KEY in the MCP server ' +
					'environment. Your key signs the on-chain action locally and is never logged, stored, ' +
					'or transmitted.',
			),
			{ code: 'no_signer' },
		);
	}
	let bytes;
	try {
		bytes = bs58decode(trimmed);
	} catch {
		throw Object.assign(new Error('Solana secret is not valid base58.'), { code: 'invalid_secret' });
	}
	if (bytes.length !== 64) {
		throw Object.assign(new Error(`Solana secret must decode to 64 bytes (got ${bytes.length}).`), {
			code: 'invalid_secret',
		});
	}
	const secretKey = Uint8Array.from(bytes);
	// Last 32 bytes of an ed25519 secret key are the public key.
	const pubkey = bs58encode(secretKey.slice(32));
	return { secretKey, pubkey };
}

/**
 * Derive the canonical AgenC identity for a three.ws citizen from its identity
 * proofs (composite > erc8004 > mpl-core > handle) via the identity bridge — no
 * new namespace invented. Mirrors workers/agora-citizens/agenc.js#deriveIdentity.
 *
 * @param {{ erc8004AgentId?: string|number, mplCoreAsset?: string, handle?: string }} ref
 * @param {string} [baseUrl] base URL used to build the published metadata URI
 */
export async function deriveIdentity(ref, baseUrl) {
	const s = await sdk();
	const result = s.getCanonicalThreewsAgenCId(ref);
	const agentIdHex = s.agenCAgentIdToHex(result.agenCAgentId);
	const metadataUri = baseUrl
		? s.buildThreewsMetadataUri(ref, baseUrl)
		: s.buildThreewsMetadataUri(ref);
	return { agentIdHex, source: result.source, label: result.label, metadataUri };
}

/** Build a read-only AgenC client (no signer) for a cluster. */
export async function readClient(cluster) {
	const s = await sdk();
	return s.createAgenCClient({ cluster: pickCluster(cluster), rpcUrl: RPC_URL || undefined });
}

/** Build a signing AgenC client bound to the caller's key. */
export async function signerClient(cluster, secretKey) {
	const s = await sdk();
	return s.createAgenCClient({ cluster: pickCluster(cluster), rpcUrl: RPC_URL || undefined, signer: secretKey });
}

/** Human-readable label for an AgenC agent status enum/object. */
function agentStatusLabel(status) {
	const map = { 0: 'Inactive', 1: 'Active', 2: 'Busy', 3: 'Suspended' };
	if (typeof status === 'number') return map[status] ?? `Unknown(${status})`;
	if (status && typeof status === 'object') {
		const key = Object.keys(status)[0];
		return key ? key[0].toUpperCase() + key.slice(1) : 'Unknown';
	}
	return status == null ? null : String(status);
}

/** Shape an on-chain AgentState into a plain JSON snapshot (BigInts → strings). */
export function shapeOnchainAgent(agent) {
	if (!agent) return null;
	return {
		authority: agent.authority?.toBase58?.() ?? String(agent.authority),
		status: agentStatusLabel(agent.status),
		capabilities: String(agent.capabilities ?? '0'),
		endpoint: agent.endpoint,
		metadataUri: agent.metadataUri,
		stakeAmount: String(agent.stakeAmount ?? '0'),
		activeTasks: agent.activeTasks,
		reputation: agent.reputation,
		registeredAt: agent.registeredAt,
	};
}

/** Shape an on-chain TaskStatus into a plain JSON snapshot (BigInts → strings). */
export async function shapeOnchainTask(task) {
	if (!task) return null;
	const s = await sdk();
	let state;
	try {
		state = s.formatTaskState(task.state);
	} catch {
		state = task.state != null ? String(task.state) : null;
	}
	return {
		state,
		rewardAmount: task.rewardAmount != null ? String(task.rewardAmount) : null,
		rewardMint: task.rewardMint?.toBase58?.() ?? (task.rewardMint != null ? String(task.rewardMint) : null),
		deadline: task.deadline != null ? Number(task.deadline) : null,
		currentWorkers: task.currentWorkers ?? null,
		maxWorkers: task.maxWorkers ?? null,
		minReputation: task.minReputation ?? null,
		requiredCapabilities: task.requiredCapabilities != null ? String(task.requiredCapabilities) : null,
	};
}

/** Explorer URL for a tx signature, cluster-aware. */
export function explorerTx(sig, cluster) {
	return `https://explorer.solana.com/tx/${sig}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

// ── Write operations (each performs the REAL on-chain action) ────────────────

/**
 * Register the caller as an AgenC citizen of Agora. Idempotent: if the derived
 * agent PDA already holds a registration we reconcile from it (no re-register, no
 * duplicate stake) and return existed:true with txSignature:null.
 *
 * @returns {{ agentPda: string, agentIdHex: string, txSignature: string|null,
 *             existed: boolean, agent: object|null, source: string, label: string,
 *             metadataUri: string }}
 */
export async function registerCitizen({ cluster, secretKey, identityRef, baseUrl, capabilities, endpoint, stakeLamports }) {
	const s = await sdk();
	const ident = await deriveIdentity(identityRef, baseUrl);
	const client = await signerClient(cluster, secretKey);
	const pda = s.deriveAgenCAgentPda(client, ident.agentIdHex);

	const existing = await s.getAgenCAgent(client, pda);
	if (existing) {
		return {
			agentPda: pda.toBase58(),
			agentIdHex: ident.agentIdHex,
			txSignature: null,
			existed: true,
			agent: shapeOnchainAgent(existing),
			source: ident.source,
			label: ident.label,
			metadataUri: ident.metadataUri,
		};
	}

	const result = await s.registerAgenCAgent(client, {
		agentId: ident.agentIdHex,
		capabilities,
		endpoint,
		metadataUri: ident.metadataUri,
		stakeAmount: stakeLamports,
	});
	const agent = await s.getAgenCAgent(client, result.agentPda);
	return {
		agentPda: result.agentPda.toBase58(),
		agentIdHex: ident.agentIdHex,
		txSignature: result.txSignature,
		existed: false,
		agent: shapeOnchainAgent(agent),
		source: ident.source,
		label: ident.label,
		metadataUri: ident.metadataUri,
	};
}

/** Claim an open task on-chain as the caller's worker identity. */
export async function claimTask({ cluster, secretKey, taskPda, workerAgentId }) {
	const s = await sdk();
	const client = await signerClient(cluster, secretKey);
	const result = await s.claimAgenCTask(client, {
		taskPda: new PublicKey(taskPda),
		workerAgentId,
	});
	const task = await s.getAgenCTask(client, new PublicKey(taskPda));
	return { txSignature: result.txSignature, task: await shapeOnchainTask(task) };
}

/**
 * Complete a task on-chain with a real 32-byte proof hash + optional deliverable.
 * The escrow releases to the worker on accepted proof; reputation ticks up.
 */
export async function completeTask({ cluster, secretKey, taskPda, workerAgentId, proofHash, resultData }) {
	const s = await sdk();
	const client = await signerClient(cluster, secretKey);
	const result = await s.completeAgenCTask(client, {
		taskPda: new PublicKey(taskPda),
		workerAgentId,
		proofHash,
		resultData: resultData ?? null,
	});
	const task = await s.getAgenCTask(client, new PublicKey(taskPda));
	return { txSignature: result.txSignature, task: await shapeOnchainTask(task) };
}

/**
 * Post (escrow) a bounty on-chain. Devnet settles in native SOL (synthetic
 * plumbing); mainnet escrows in the $THREE mint. Returns the task PDA + tx.
 */
export async function postTask({
	cluster,
	secretKey,
	creatorAgentId,
	requiredCapabilities,
	description,
	rewardAmount,
	maxWorkers,
	deadline,
	taskType,
	minReputation,
	rewardMint,
	creatorTokenAccount,
}) {
	const s = await sdk();
	const client = await signerClient(cluster, secretKey);
	const args = {
		creatorAgentId,
		requiredCapabilities,
		description,
		rewardAmount,
		maxWorkers,
		deadline,
		taskType,
		minReputation,
	};
	if (rewardMint) {
		args.rewardMint = new PublicKey(rewardMint);
		if (creatorTokenAccount) args.creatorTokenAccount = new PublicKey(creatorTokenAccount);
	}
	const result = await s.createAgenCTask(client, args);
	const task = await s.getAgenCTask(client, result.taskPda);
	return {
		taskPda: result.taskPda.toBase58(),
		taskId: Buffer.from(result.taskId).toString('hex'),
		txSignature: result.txSignature,
		task: await shapeOnchainTask(task),
	};
}

/**
 * Canonical mainnet reward mint for a bounty. Devnet → null (native SOL).
 * Mainnet → the $THREE mint unless the caller supplies their own SPL mint
 * (generic plumbing; never a hardcoded non-$THREE recommendation).
 */
export function resolveRewardMint(cluster, mint) {
	if (cluster !== 'mainnet') return null;
	const m = String(mint || '').trim();
	return m || THREE_MINT;
}

const PUBLIC_RPC = {
	mainnet: 'https://api.mainnet-beta.solana.com',
	devnet: 'https://api.devnet.solana.com',
};

/**
 * Read the signer's live balances for a preview: native SOL, and the reward
 * mint's token balance when the escrow is an SPL token. Read-only.
 * @param {{ cluster: 'mainnet'|'devnet', pubkey: string, mint?: string|null }} input
 */
export async function signerBalances({ cluster, pubkey, mint = null }) {
	const { Connection } = await import('@solana/web3.js');
	const conn = new Connection(RPC_URL || PUBLIC_RPC[cluster], 'confirmed');
	const owner = new PublicKey(pubkey);
	const lamports = await conn.getBalance(owner, 'confirmed');
	let token = null;
	if (mint) {
		const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
		const atomic = res.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
		const decimals = res.value[0]?.account.data.parsed.info.tokenAmount.decimals ?? null;
		token = { mint, amountAtomic: String(atomic), decimals };
	}
	return { lamports, sol: lamports / 1e9, token };
}

/**
 * Resolve where a registration would land without signing: the derived agent
 * id and PDA, and whether that agent already exists on-chain (in which case a
 * register call spends nothing).
 */
export async function previewRegistration({ cluster, identityRef, baseUrl }) {
	const s = await sdk();
	const ident = await deriveIdentity(identityRef, baseUrl);
	const client = await readClient(cluster);
	const pda = s.deriveAgenCAgentPda(client, ident.agentIdHex);
	const existing = await s.getAgenCAgent(client, pda);
	return {
		agentIdHex: ident.agentIdHex,
		agentPda: pda.toBase58(),
		existed: Boolean(existing),
		metadataUri: ident.metadataUri,
		source: ident.source,
	};
}
