// Shared core for emitting on-chain threews.* memo attestations.
//
// Used by the production webhook (api/agents/solana-attest-event.js) and the
// in-house pumpfun monitor cron (api/cron/pumpfun-monitor.js). The two share
// the same exactly-once primitive: a claim row in solana_attest_event_claims
// is the lock; the SPL Memo tx is the on-chain artifact; a row in
// solana_attestations mirrors it for the reputation reads.
//
// All callers must provide a deterministic event_id so a retry never produces
// a second on-chain tx for the same logical event.

import crypto from 'node:crypto';
import {
	Connection,
	Keypair,
	PublicKey,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { sql } from './db.js';
import { RPC, KIND_MAP } from './solana-attestations.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TX_TIMEOUT_MS = 12_000;

export function taskHash(task_id, token_mint) {
	return crypto.createHash('sha256').update(`${task_id}:${token_mint}`).digest('hex');
}

/**
 * Build a threews.* attestation payload for a known event type.
 * Recognised sources: pumpkit.graduation|fee_claim|whale|cto, and the
 * in-house equivalents pumpfun.graduation|fee_claim|whale|cto.
 */
export function buildPayload({
	event_id, event_type, agent_asset, token_mint, task_id, detail,
	source = null,
}) {
	const ts = Math.floor(Date.now() / 1000);
	const base = { v: 1, agent: agent_asset, ts, event_id };
	const src = (s) => source ?? s;
	switch (event_type) {
		case 'graduation':
			return { ...base, kind: KIND_MAP.validation,
				task_hash: taskHash(task_id, token_mint), passed: true,
				source: src('pumpkit.graduation'), token: token_mint };
		case 'fee_claim':
			return { ...base, kind: KIND_MAP.feedback,
				score: 5, source: src('pumpkit.fee_claim'),
				token: token_mint, detail: detail ?? null };
		case 'whale_trade':
			return { ...base, kind: KIND_MAP.task,
				task_id, scope_hash: taskHash(task_id, token_mint),
				source: src('pumpkit.whale') };
		case 'cto_detected':
			return { ...base, kind: KIND_MAP.validation,
				task_hash: taskHash(task_id, token_mint), passed: false,
				source: src('pumpkit.cto'), token: token_mint };
		default:
			throw new Error(`unknown event_type: ${event_type}`);
	}
}

export function loadAttesterKeypair() {
	const k = process.env.ATTEST_AGENT_SECRET_KEY;
	if (!k) throw Object.assign(new Error('ATTEST_AGENT_SECRET_KEY not configured'), { status: 500 });
	return Keypair.fromSecretKey(bs58.decode(k));
}

function withTimeout(promise, ms, onTimeout) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			onTimeout?.();
			reject(Object.assign(new Error(`rpc timeout after ${ms}ms`), { code: 'RPC_TIMEOUT' }));
		}, ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Mint a single attestation, exactly-once.
 *
 * @param {object} input
 * @param {string} input.event_id      Deterministic id; collision = idempotent dedupe.
 * @param {string} input.event_type    'graduation'|'fee_claim'|'whale_trade'|'cto_detected'
 * @param {string} input.source        e.g. 'pumpfun.graduation' (in-house) or 'pumpkit.graduation'.
 * @param {string} input.agent_asset   Metaplex Core asset pubkey.
 * @param {'mainnet'|'devnet'} input.network
 * @param {string} input.token_mint
 * @param {string} input.task_id
 * @param {object} [input.detail]
 * @param {Keypair} [input.attester]   Defaults to loadAttesterKeypair().
 *
 * @returns {Promise<{ status: 'minted'|'deduped'|'in_progress', signature: string|null, kind: string|null }>}
 */
export async function mintAttestation(input) {
	const {
		event_id, event_type, source,
		agent_asset, network, token_mint, task_id, detail,
		attester = loadAttesterKeypair(),
	} = input;

	if (!event_id || !event_type || !agent_asset || !network || !token_mint || !task_id) {
		throw new Error('mintAttestation: missing required fields');
	}

	const attesterPubkey = attester.publicKey.toBase58();

	// Pre-tx claim — the lock that prevents duplicate on-chain txs.
	const claim = await sql`
		insert into solana_attest_event_claims (agent_asset, network, event_id, attester)
		values (${agent_asset}, ${network}, ${event_id}, ${attesterPubkey})
		on conflict (agent_asset, network, event_id) do nothing
		returning claimed_at
	`;
	if (claim.length === 0) {
		const [winner] = await sql`
			select signature from solana_attest_event_claims
			where agent_asset = ${agent_asset}
			  and network = ${network}
			  and event_id = ${event_id}
		`;
		return winner?.signature
			? { status: 'deduped', signature: winner.signature, kind: null }
			: { status: 'in_progress', signature: null, kind: null };
	}

	const payload = buildPayload({
		event_id, event_type, agent_asset, token_mint, task_id, detail, source,
	});
	const memo = JSON.stringify(payload);

	const conn = new Connection(RPC[network] || RPC.devnet, 'confirmed');
	const ix = new TransactionInstruction({
		programId: MEMO_PROGRAM_ID,
		keys: [
			{ pubkey: attester.publicKey,        isSigner: true,  isWritable: false },
			{ pubkey: new PublicKey(agent_asset), isSigner: false, isWritable: false },
		],
		data: Buffer.from(memo, 'utf8'),
	});
	const tx = new Transaction().add(ix);

	let signature;
	try {
		signature = await withTimeout(
			sendAndConfirmTransaction(conn, tx, [attester], { commitment: 'confirmed' }),
			TX_TIMEOUT_MS,
		);
	} catch (e) {
		// Release the claim so a future retry can try again.
		await sql`
			delete from solana_attest_event_claims
			where agent_asset = ${agent_asset}
			  and network = ${network}
			  and event_id = ${event_id}
			  and signature is null
		`;
		throw e;
	}

	await sql`
		update solana_attest_event_claims
		set signature = ${signature}, completed_at = now()
		where agent_asset = ${agent_asset}
		  and network = ${network}
		  and event_id = ${event_id}
	`;

	try {
		await sql`
			insert into solana_attestations (
				signature, network, slot, block_time, agent_asset, attester,
				kind, payload, task_id, target_signature, verified
			)
			values (
				${signature}, ${network}, null, now(),
				${agent_asset}, ${attesterPubkey},
				${payload.kind}, ${JSON.stringify(payload)}::jsonb,
				${payload.task_id ?? null}, null, true
			)
			on conflict (signature) do nothing
		`;
	} catch (e) {
		if (e?.code !== '23505') throw e;
		// Lost race against the unique partial index — claim row already won
		// the serialization, so signature above is canonical.
	}

	return { status: 'minted', signature, kind: payload.kind };
}

/** Deterministic event id for a logical pumpfun event. */
export function deriveEventId({ event_type, mint, slot_or_ts }) {
	return crypto.createHash('sha256')
		.update(`${event_type}:${mint}:${slot_or_ts}`)
		.digest('hex')
		.slice(0, 32);
}
