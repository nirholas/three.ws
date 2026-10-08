/**
 * Solana ValidationRegistry attestor (server-side).
 *
 * The Solana-native analog of api/_lib/validation-attest.js (EVM). Solana has no
 * deployed registry contract — on-chain attestations are first-class SPL Memo
 * transactions indexed into `solana_attestations` (see solana-attestations.js).
 * This turns an agent's GLB into a signed, on-chain glTF/schema validation
 * attestation:
 *
 *   1. Fetch the GLB (SSRF-guarded) and run it through the platform's one glTF
 *      validator — the same inspector behind /api/x402/model-check. Parse-success
 *      ⇒ structurally valid; parse-failure ⇒ a hard error in the report.
 *   2. sha256 the canonical report JSON for the on-chain proof hash, and pin the
 *      full report to R2 so verifiers can fetch the detail behind the hash
 *      (best-effort: an unconfigured bucket yields an empty proof_uri, never a
 *      thrown attestation — the hash alone is still verifiable).
 *   3. Emit a `threews.validation.v1` memo (subkind glb-schema) signed by the
 *      platform attester (ATTEST_AGENT_SECRET_KEY), with the agent asset pubkey
 *      as a non-signer key, then mirror the row into solana_attestations.
 *
 * Idempotent by content: re-attesting an identical report for the same agent
 * returns the existing signature instead of broadcasting a duplicate tx.
 *
 * Best-effort by contract: callers wrap this in try/catch — a validation failure
 * (or missing key / RPC trouble) must never block the flow that triggered it.
 * Errors carry a machine-readable `.code`.
 */

import { createHash } from 'node:crypto';
import {
	PublicKey,
	Transaction,
	TransactionInstruction,
} from '@solana/web3.js';
import { sendAndConfirm } from './solana/confirm.js';

import { sql } from './db.js';
import { solanaConnection } from './solana/connection.js';
import { RPC, SUBKIND_GLB_SCHEMA } from './solana-attestations.js';
import { loadAttesterKeypair } from './attest-event.js';
import { validateGlb } from './validation-attest.js';
import { putObject, publicUrl } from './r2.js';
import { KIND_GLB_SCHEMA } from '../../src/erc8004/validation-report.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const VALIDATION_KIND = 'threews.validation.v1';
const TX_TIMEOUT_MS = 15_000;

class SolanaAttestError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SolanaAttestError';
		this.code = code;
	}
}

/** sha256 of the canonicalized report JSON — the on-chain proof hash (hex). */
export function hashReportSha256(report) {
	return createHash('sha256').update(JSON.stringify(report)).digest('hex');
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(Object.assign(new Error(`rpc timeout after ${ms}ms`), { code: 'RPC_TIMEOUT' })),
			ms,
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pin the report JSON to R2, returning its public URL. Best-effort: '' on failure. */
async function pinReport(report, network, agentAsset, proofHash) {
	try {
		const body = Buffer.from(JSON.stringify(report, null, 2));
		const key = `solana/validation/${network}/${agentAsset}/${proofHash}.json`;
		await putObject({ key, body, contentType: 'application/json' });
		return publicUrl(key);
	} catch {
		return '';
	}
}

/**
 * Full Solana attestation: validate the GLB, pin the report, sign + record a
 * memo attestation, mirror to the index.
 *
 * @param {object} p
 * @param {'mainnet'|'devnet'} p.network
 * @param {string} p.agentAsset   Metaplex Core asset pubkey (base58).
 * @param {string} p.glbUrl       Public URL to the agent's GLB.
 * @param {string} p.validatedAt  ISO timestamp (caller-supplied; deterministic hashing).
 * @returns {Promise<{
 *   status: 'minted'|'deduped', passed: boolean, proofHash: string, proofUri: string,
 *   signature: string, modelSha256: string, validatedAt: string, kind: string,
 *   network: string, agentAsset: string, validator: string, report: object,
 * }>}
 */
/**
 * The base58 address of the platform attester, or null when the key is not
 * configured or undecodable. A glb-schema validation is a "model verified"
 * badge only when THIS key signed it: the memo program accepts a memo from any
 * wallet, so a read that does not filter on the attester hands the badge to
 * anyone who posts `{ subkind: 'glb-schema', passed: true }` for an agent.
 * Fails closed: with no key there is no badge, never everyone's.
 */
export function platformValidatorAddress() {
	try {
		return loadAttesterKeypair().publicKey.toBase58();
	} catch {
		return null;
	}
}

export async function attestValidationSolana({ network, agentAsset, glbUrl, validatedAt }) {
	if (network !== 'mainnet' && network !== 'devnet') {
		throw new SolanaAttestError('unsupported_network', `unsupported network ${network}`);
	}
	try {
		new PublicKey(agentAsset);
	} catch {
		throw new SolanaAttestError('invalid_asset', 'agentAsset is not a valid pubkey');
	}

	let attester;
	try {
		attester = loadAttesterKeypair();
	} catch {
		throw new SolanaAttestError(
			'attester_key_not_configured',
			'ATTEST_AGENT_SECRET_KEY is not set — cannot sign Solana validation attestations.',
		);
	}
	const validator = attester.publicKey.toBase58();

	// 1. Validate the GLB (never throws on an invalid model — that's a failing report).
	const { report, passed, sha256: modelSha256 } = await validateGlb(glbUrl, validatedAt);
	const proofHash = hashReportSha256(report);

	// 2. Content idempotency: an identical report already on-chain for this agent
	//    short-circuits before we spend a second tx.
	const [existing] = await sql`
		select signature, payload->>'proof_uri' as proof_uri
		from solana_attestations
		where agent_asset = ${agentAsset} and network = ${network}
		  and kind = ${VALIDATION_KIND}
		  and payload->>'subkind' = ${SUBKIND_GLB_SCHEMA}
		  and payload->>'proof_hash' = ${proofHash}
		  and attester = ${validator}
		limit 1
	`;
	if (existing) {
		return {
			status: 'deduped', passed, proofHash, proofUri: existing.proof_uri || '',
			signature: existing.signature, modelSha256, validatedAt,
			kind: KIND_GLB_SCHEMA, network, agentAsset, validator, report,
		};
	}

	// 3. Pin the report, build the payload.
	const proofUri = await pinReport(report, network, agentAsset, proofHash);
	const payload = {
		v: 1,
		kind: VALIDATION_KIND,
		subkind: SUBKIND_GLB_SCHEMA,
		agent: agentAsset,
		ts: Math.floor(new Date(validatedAt).getTime() / 1000) || Math.floor(Date.now() / 1000),
		passed,
		proof_hash: proofHash,
		proof_uri: proofUri,
		model_sha256: modelSha256,
		source: 'threews.model-check',
	};

	// 4. Sign + send the memo.
	const conn = solanaConnection({ url: RPC[network] || RPC.devnet, commitment: 'confirmed' });
	const ix = new TransactionInstruction({
		programId: MEMO_PROGRAM_ID,
		keys: [
			{ pubkey: attester.publicKey, isSigner: true, isWritable: false },
			{ pubkey: new PublicKey(agentAsset), isSigner: false, isWritable: false },
		],
		data: Buffer.from(JSON.stringify(payload), 'utf8'),
	});
	const tx = new Transaction().add(ix);

	let signature;
	try {
		signature = await withTimeout(
			sendAndConfirm(conn, tx, [attester], { commitment: 'confirmed' }),
			TX_TIMEOUT_MS,
		);
	} catch (err) {
		throw new SolanaAttestError('record_failed', `validation memo failed: ${err.message}`);
	}

	// 5. Mirror into the index (best-effort; the crawler would pick it up anyway).
	try {
		await sql`
			insert into solana_attestations (
				signature, network, slot, block_time, agent_asset, attester,
				kind, payload, task_id, target_signature, verified
			)
			values (
				${signature}, ${network}, null, now(),
				${agentAsset}, ${validator},
				${VALIDATION_KIND}, ${JSON.stringify(payload)}::jsonb,
				null, null, true
			)
			on conflict (signature) do nothing
		`;
	} catch (err) {
		if (err?.code !== '23505') throw err;
	}

	return {
		status: 'minted', passed, proofHash, proofUri, signature, modelSha256,
		validatedAt, kind: KIND_GLB_SCHEMA, network, agentAsset, validator, report,
	};
}

export { SolanaAttestError };
