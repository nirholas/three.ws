/**
 * On-chain agent-to-agent invocation receipts (the `agent_invocation` Anchor
 * program — see contracts/agent-invocation/).
 * ---------------------------------------------------------------------------
 * When one agent hires and pays another for a skill, we record a verifiable
 * receipt on Solana by invoking the program's `invoke_skill` instruction. The
 * program is intentionally non-trust-bearing: it moves no funds and grants no
 * capability — it validates the caller and emits a `SkillInvoked` event so the
 * invocation is permanently auditable on-chain with an explorer link on both
 * sides. The USDC payment itself already settled over the x402 rails; this is the
 * tamper-proof record THAT it happened.
 *
 * The instruction is built by hand (Anchor discriminator + Borsh-encoded string
 * args) so the API runtime doesn't have to load @coral-xyz/anchor — the same
 * dependency-light approach as skill-license-onchain.js. PDA derivation and
 * instruction encoding are pure and unit-tested; only `recordInvocationReceipt`
 * touches the chain.
 */

import { createHash } from 'node:crypto';

import {
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
} from '@solana/web3.js';
import { sendAndConfirm } from './solana/confirm.js';

import { solanaConnection } from './solana/connection.js';

/** Program id baked into the on-chain program's `declare_id!`. Override per
 *  deployment (e.g. a devnet build) with AGENT_INVOCATION_PROGRAM_ID. */
export const AGENT_INVOCATION_PROGRAM_ID =
	process.env.AGENT_INVOCATION_PROGRAM_ID || 'FGFr3ueSCLjBTcqbXsvcuU6fihDEgNbUnmStCb2FtWPv';

/** Cluster the invocation program is deployed to. Devnet until a mainnet deploy is
 *  recorded in contracts/SOLANA_DEPLOYMENTS.md; set AGENT_INVOCATION_NETWORK=mainnet
 *  once that row exists. */
export function defaultNetwork() {
	return process.env.AGENT_INVOCATION_NETWORK === 'mainnet' ? 'mainnet' : 'devnet';
}

const DEPLOYED_TTL_MS = 60_000;
const deployedCache = new Map();

/** True when `programId` is an executable account on `network`. Cached for a
 *  minute so a hot route does not hit RPC per call; RPC failures are not cached
 *  and surface as thrown errors rather than a false "not deployed". */
export async function isProgramDeployed(network = defaultNetwork(), programId = AGENT_INVOCATION_PROGRAM_ID, connection) {
	const key = `${network}:${programPk(programId).toBase58()}`;
	const hit = deployedCache.get(key);
	if (hit && Date.now() - hit.at < DEPLOYED_TTL_MS) return hit.value;
	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });
	const info = await conn.getAccountInfo(programPk(programId), 'confirmed');
	const value = Boolean(info?.executable);
	deployedCache.set(key, { value, at: Date.now() });
	return value;
}

/** Test hook: forget cached probe results. */
export function resetDeployedCache() {
	deployedCache.clear();
}

// On-chain limits enforced by the program; validated here too so a caller gets a
// clear error instead of a failed simulation. Must match contracts/agent-invocation.
export const MAX_SKILL_NAME_LEN = 64;
export const MAX_PARAMETERS_LEN = 512;

// Seed prefix — must byte-match `AGENT_SEED` in contracts/agent-invocation/src/lib.rs.
const AGENT_SEED = Buffer.from('agent');

// Anchor instruction discriminator: sha256("global:invoke_skill")[..8].
const INVOKE_SKILL_DISCRIMINATOR = createHash('sha256')
	.update('global:invoke_skill')
	.digest()
	.subarray(0, 8);

function programPk(programId) {
	return programId instanceof PublicKey ? programId : new PublicKey(programId);
}

/** Derive an agent's program identity PDA from its authority — matches the Rust
 *  `seeds = [AGENT_SEED, authority]`. */
export function deriveAgentPda(authority, programId = AGENT_INVOCATION_PROGRAM_ID) {
	return PublicKey.findProgramAddressSync(
		[AGENT_SEED, new PublicKey(authority).toBuffer()],
		programPk(programId),
	);
}

// Borsh string: 4-byte little-endian length prefix + UTF-8 bytes.
function encodeBorshString(value) {
	const bytes = Buffer.from(String(value), 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32LE(bytes.length, 0);
	return Buffer.concat([len, bytes]);
}

/**
 * Build the unsigned `invoke_skill` instruction. Pure — no chain access — so the
 * encoding and account ordering can be asserted directly in tests.
 *
 * @param {{ invokerAuthority: string|PublicKey, targetAuthority: string|PublicKey,
 *   skillName: string, parameters: string, programId?: string|PublicKey }} args
 */
export function buildInvokeSkillIx({ invokerAuthority, targetAuthority, skillName, parameters, programId = AGENT_INVOCATION_PROGRAM_ID }) {
	if (!skillName || String(skillName).length === 0) {
		throw new Error('skillName must not be empty');
	}
	if (Buffer.byteLength(String(skillName), 'utf8') > MAX_SKILL_NAME_LEN) {
		throw new Error(`skillName exceeds ${MAX_SKILL_NAME_LEN} bytes`);
	}
	if (Buffer.byteLength(String(parameters ?? ''), 'utf8') > MAX_PARAMETERS_LEN) {
		throw new Error(`parameters exceed ${MAX_PARAMETERS_LEN} bytes`);
	}

	const pid = programPk(programId);
	const invokerAuth = new PublicKey(invokerAuthority);
	const targetAuth = new PublicKey(targetAuthority);
	const [invokerAgent] = deriveAgentPda(invokerAuth, pid);
	const [targetAgent] = deriveAgentPda(targetAuth, pid);

	const data = Buffer.concat([
		INVOKE_SKILL_DISCRIMINATOR,
		encodeBorshString(skillName),
		encodeBorshString(parameters ?? ''),
	]);

	// Account order must match the Rust `InvokeSkill` accounts struct exactly.
	const keys = [
		{ pubkey: invokerAgent, isSigner: false, isWritable: false },
		{ pubkey: invokerAuth, isSigner: true, isWritable: true },
		{ pubkey: targetAuth, isSigner: false, isWritable: false },
		{ pubkey: targetAgent, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
	];

	return {
		instruction: new TransactionInstruction({ programId: pid, keys, data }),
		invokerAgent: invokerAgent.toBase58(),
		targetAgent: targetAgent.toBase58(),
	};
}

/**
 * Write a real on-chain invocation receipt. The invoking agent's keypair signs
 * and pays the (tiny) transaction fee; the target agent's authority is supplied
 * so its agent PDA can be re-derived and recorded. Truncates oversized parameters
 * to the program limit rather than failing the receipt.
 *
 * @param {{ invokerKeypair: import('@solana/web3.js').Keypair,
 *   targetAuthority: string|PublicKey, skillName: string, parameters?: string,
 *   network?: 'mainnet'|'devnet', programId?: string,
 *   connection?: import('@solana/web3.js').Connection }} args
 * @returns {Promise<{ signature: string, programId: string, network: string,
 *   invokerAgent: string, targetAgent: string, explorer: string }>}
 */
export async function recordInvocationReceipt({
	invokerKeypair,
	targetAuthority,
	skillName,
	parameters = '',
	network = defaultNetwork(),
	programId = AGENT_INVOCATION_PROGRAM_ID,
	connection,
}) {
	if (!invokerKeypair?.publicKey) throw new Error('invokerKeypair is required');
	if (!targetAuthority) throw new Error('targetAuthority is required');

	// Skill name capped to fit on-chain; long params trimmed to the byte limit.
	const name = String(skillName || 'skill').slice(0, MAX_SKILL_NAME_LEN);
	let params = String(parameters ?? '');
	while (Buffer.byteLength(params, 'utf8') > MAX_PARAMETERS_LEN) {
		params = params.slice(0, Math.floor(params.length * 0.9));
	}

	const { instruction, invokerAgent, targetAgent } = buildInvokeSkillIx({
		invokerAuthority: invokerKeypair.publicKey,
		targetAuthority,
		skillName: name,
		parameters: params,
		programId,
	});

	const conn = connection || solanaConnection({ network, commitment: 'confirmed' });
	if (!(await isProgramDeployed(network, programId, conn))) {
		const err = new Error(`agent_invocation program ${programPk(programId).toBase58()} is not deployed on ${network}`);
		err.code = 'program_not_deployed';
		err.status = 503;
		throw err;
	}
	const tx = new Transaction().add(instruction);
	const signature = await sendAndConfirm(conn, tx, [invokerKeypair], {
		commitment: 'confirmed',
	});

	const cluster = network === 'devnet' ? '?cluster=devnet' : '';
	return {
		signature,
		programId: programPk(programId).toBase58(),
		network,
		invokerAgent,
		targetAgent,
		explorer: `https://solscan.io/tx/${signature}${cluster}`,
	};
}
