// Pumpkit -> attestation bridge.
// Receives a signed webhook from a pumpkit monitor and emits a
// threews.* SPL Memo on Solana, then mirrors it into solana_attestations
// so reputation reflects the event without waiting for the crawler.
//
// Webhook contract:
//   POST /api/agents/solana-attest-event
//   headers:
//     x-pumpkit-timestamp: <unix seconds>
//     x-pumpkit-signature: hex(hmac_sha256(secret, "<ts>.<raw-body>"))
//   body: { event_id, event_type, agent_asset, network, token_mint, task_id, detail? }
//
// Idempotency: each (agent_asset, payload.event_id) pair is emitted at most once.
// Replay: rejects timestamps outside REPLAY_WINDOW_SECS.

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
import { z } from 'zod';

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { RPC, KIND_MAP } from '../_lib/solana-attestations.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const REPLAY_WINDOW_SECS = 5 * 60;
const MAX_BODY_BYTES = 64_000;

const bodySchema = z.object({
	event_id:    z.string().min(1).max(128),
	event_type:  z.enum(['graduation', 'fee_claim', 'whale_trade', 'cto_detected']),
	agent_asset: z.string().min(32).max(44),
	network:     z.enum(['mainnet', 'devnet']),
	token_mint:  z.string().min(32).max(44),
	task_id:     z.string().min(1).max(128),
	detail:      z.record(z.unknown()).optional(),
});

// -- Pure helpers (exported for tests) -----------------------------------

export function taskHash(task_id, token_mint) {
	return crypto.createHash('sha256').update(`${task_id}:${token_mint}`).digest('hex');
}

export function buildPayload({ event_id, event_type, agent_asset, token_mint, task_id, detail }) {
	const base = { v: 1, agent: agent_asset, ts: Math.floor(Date.now() / 1000), event_id };
	switch (event_type) {
		case 'graduation':
			return { ...base, kind: KIND_MAP.validation,
				task_hash: taskHash(task_id, token_mint), passed: true,
				source: 'pumpkit.graduation', token: token_mint };
		case 'fee_claim':
			return { ...base, kind: KIND_MAP.feedback,
				score: 5, source: 'pumpkit.fee_claim',
				token: token_mint, detail: detail ?? null };
		case 'whale_trade':
			return { ...base, kind: KIND_MAP.task,
				task_id, scope_hash: taskHash(task_id, token_mint),
				source: 'pumpkit.whale' };
		case 'cto_detected':
			return { ...base, kind: KIND_MAP.validation,
				task_hash: taskHash(task_id, token_mint), passed: false,
				source: 'pumpkit.cto', token: token_mint };
	}
}

// Signed message is `${timestamp}.${raw}` — binds body to its declared time
// so a captured signature can't be replayed against a fresh body.
export function verifyPumpkitSignature({ secret, timestamp, signature, raw, nowSecs = Math.floor(Date.now() / 1000) }) {
	if (!secret || !timestamp || !signature) return { ok: false, reason: 'missing' };
	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
	if (Math.abs(nowSecs - ts) > REPLAY_WINDOW_SECS) return { ok: false, reason: 'stale' };

	const expect = crypto.createHmac('sha256', secret)
		.update(`${ts}.`).update(raw).digest();
	let got;
	try { got = Buffer.from(signature, 'hex'); }
	catch { return { ok: false, reason: 'bad_signature' }; }
	if (got.length !== expect.length) return { ok: false, reason: 'bad_signature' };
	return { ok: crypto.timingSafeEqual(got, expect), reason: 'ok' };
}

// -- Handler -------------------------------------------------------------

function loadAttesterKeypair() {
	const k = process.env.ATTEST_AGENT_SECRET_KEY;
	if (!k) throw Object.assign(new Error('attester key not configured'), { status: 500 });
	return Keypair.fromSecretKey(bs58.decode(k));
}

async function readBuffered(req) {
	const chunks = [];
	let total = 0;
	for await (const c of req) {
		chunks.push(c);
		total += c.length;
		if (total > MAX_BODY_BYTES) throw Object.assign(new Error('payload too large'), { status: 413 });
	}
	return Buffer.concat(chunks);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const secret = process.env.PUMPKIT_WEBHOOK_SECRET;
	if (!secret) return error(res, 500, 'internal', 'webhook secret not configured');

	const raw = await readBuffered(req);
	const verdict = verifyPumpkitSignature({
		secret,
		timestamp: req.headers['x-pumpkit-timestamp'],
		signature: req.headers['x-pumpkit-signature'],
		raw,
	});
	if (!verdict.ok) return error(res, 401, 'unauthorized', `invalid webhook signature (${verdict.reason})`);

	let parsed;
	try { parsed = JSON.parse(raw.toString('utf8')); }
	catch { return error(res, 400, 'validation_error', 'invalid JSON'); }
	const body = parse(bodySchema, parsed);

	// Confirm the agent exists in our registry on the declared network.
	const [agent] = await sql`
		select id from agent_identities
		where meta->'onchain'->>'sol_asset' = ${body.agent_asset}
		   or meta->>'sol_mint_address'      = ${body.agent_asset}
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent_asset not registered');

	// Idempotency: short-circuit if we've already attested this event_id.
	const [existing] = await sql`
		select signature from solana_attestations
		where agent_asset = ${body.agent_asset}
		  and network = ${body.network}
		  and payload->>'event_id' = ${body.event_id}
		limit 1
	`;
	if (existing) return json(res, 200, { data: { signature: existing.signature, deduped: true } });

	const payload = buildPayload(body);
	const memo = JSON.stringify(payload);

	const conn = new Connection(RPC[body.network], 'confirmed');
	const attester = loadAttesterKeypair();
	const agentKey = new PublicKey(body.agent_asset);

	// Memo includes the agent asset as a non-signer key so
	// getSignaturesForAddress(agent) finds the tx during crawl.
	const ix = new TransactionInstruction({
		programId: MEMO_PROGRAM_ID,
		keys: [
			{ pubkey: attester.publicKey, isSigner: true,  isWritable: false },
			{ pubkey: agentKey,           isSigner: false, isWritable: false },
		],
		data: Buffer.from(memo, 'utf8'),
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(conn, tx, [attester], { commitment: 'confirmed' });

	// Mirror into the index immediately; crawler dedupes via unique signature.
	// Verified semantics match _lib/solana-attestations.js#computeVerified for
	// non-owner kinds (feedback/validation/task): structurally valid -> true.
	//
	// The partial unique index solana_attestations_event_id_uniq closes the
	// race window between the dedupe SELECT above and this INSERT. If a
	// concurrent webhook delivery already inserted, we catch 23505 and
	// return the winning signature.
	try {
		await sql`
			insert into solana_attestations (
				signature, network, slot, block_time, agent_asset, attester,
				kind, payload, task_id, target_signature, verified
			)
			values (
				${signature}, ${body.network}, null, now(),
				${body.agent_asset}, ${attester.publicKey.toBase58()},
				${payload.kind}, ${JSON.stringify(payload)}::jsonb,
				${payload.task_id ?? null}, null, true
			)
			on conflict (signature) do nothing
		`;
	} catch (e) {
		if (e?.code !== '23505') throw e;
		const [winner] = await sql`
			select signature from solana_attestations
			where agent_asset = ${body.agent_asset}
			  and network = ${body.network}
			  and payload->>'event_id' = ${body.event_id}
			limit 1
		`;
		return json(res, 200, { data: { signature: winner?.signature ?? null, deduped: true } });
	}

	return json(res, 201, { data: { signature, kind: payload.kind, deduped: false } });
});
