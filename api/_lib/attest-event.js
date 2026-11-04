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
import { solanaConnection } from './solana/connection.js';
import {
	Connection,
	Keypair,
	Transaction,
} from '@solana/web3.js';
import { sendAndConfirm } from './solana/confirm.js';
import { attestationMemoInstructions } from './solana/memo-attest.js';
import bs58 from 'bs58';

import { sql } from './db.js';
import { RPC, KIND_MAP } from './solana-attestations.js';

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

/**
 * Decode a Solana secret key from any encoding used across the three.ws env,
 * synchronously (bs58 is statically imported here). Mirrors the async
 * decodeSecretKey() in solana-signers.js so the attester key works whether it
 * was provisioned as a Solana CLI JSON byte array, base64, or base58.
 *   - JSON array of 64 (or 32) ints — `solana-keygen` keypair file contents
 *   - base64 of the raw secret-key bytes
 *   - base58 of the raw secret-key bytes
 * @param {string} secret
 * @returns {Uint8Array|null} 64/32-byte key, or null if it can't be decoded.
 */
export function decodeAttesterSecret(secret) {
	const raw = (secret || '').trim();
	if (!raw) return null;

	// JSON array form (Solana CLI keypair file contents).
	if (raw.startsWith('[')) {
		try {
			const arr = JSON.parse(raw);
			if (Array.isArray(arr) && (arr.length === 64 || arr.length === 32)) {
				return Uint8Array.from(arr);
			}
		} catch {
			/* fall through */
		}
	}

	// hex form (128 chars = 64 bytes, or 64 chars = 32 bytes). Checked before
	// base58 because hex's '0' is not a base58 character — an all-hex key would
	// otherwise throw "Non-base58 character" out of bs58.decode and fail to load.
	if (/^[0-9a-fA-F]+$/.test(raw) && (raw.length === 128 || raw.length === 64)) {
		const buf = Buffer.from(raw, 'hex');
		if (buf.length === 64 || buf.length === 32) return new Uint8Array(buf);
	}

	// base64 / base64url form. Buffer.from is lenient, so validate the byte length
	// and require a clean round-trip to reject base58 strings that happen to
	// base64-decode to 64 bytes. base64url (with - and _) is normalized to base64
	// first so url-safe-provisioned keys decode instead of falling through to the
	// base58 lane and throwing on the '-'/'_'.
	try {
		const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
		const buf = Buffer.from(normalized, 'base64');
		if (
			(buf.length === 64 || buf.length === 32) &&
			buf.toString('base64').replace(/=+$/, '') ===
				normalized.replace(/=+$/, '')
		) {
			return new Uint8Array(buf);
		}
	} catch {
		/* fall through */
	}

	// base58 form.
	try {
		const bytes = bs58.decode(raw);
		if (bytes.length === 64 || bytes.length === 32) return Uint8Array.from(bytes);
	} catch {
		/* fall through */
	}

	return null;
}

export function loadAttesterKeypair() {
	const k = process.env.ATTEST_AGENT_SECRET_KEY;
	if (!k) throw Object.assign(new Error('ATTEST_AGENT_SECRET_KEY not configured'), { status: 500 });
	const bytes = decodeAttesterSecret(k);
	if (!bytes) {
		throw Object.assign(
			new Error(
				'ATTEST_AGENT_SECRET_KEY is set but could not be decoded — expected a 64-byte ' +
					'ed25519 secret key as a JSON byte array, base64, or base58 string.',
			),
			{ status: 500, code: 'attester_key_undecodable' },
		);
	}
	return Keypair.fromSecretKey(bytes);
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

	const conn = solanaConnection({ url: RPC[network] || RPC.devnet, commitment: 'confirmed' });
	// Subject rides on a ComputeBudget carrier, not the memo: SPL Memo v2
	// rejects any non-signer account (see solana/memo-attest.js).
	const ixs = attestationMemoInstructions({ signer: attester.publicKey, subject: agent_asset, data: memo });
	const tx = new Transaction().add(...ixs);

	let signature;
	try {
		signature = await withTimeout(
			sendAndConfirm(conn, tx, [attester], { commitment: 'confirmed' }),
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
