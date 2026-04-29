// Pumpkit -> attestation bridge.
// Receives a signed webhook from a pumpkit monitor and emits a
// threews.* SPL Memo on Solana, then mirrors it into solana_attestations
// so reputation reflects the event without waiting for the crawler.

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
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { RPC, KIND_MAP } from '../_lib/solana-attestations.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const bodySchema = z.object({
	event_type: z.enum(['graduation', 'fee_claim', 'whale_trade', 'cto_detected']),
	agent_asset: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']),
	token_mint: z.string().min(32).max(44),
	task_id: z.string().min(1).max(128),
	detail: z.record(z.unknown()).optional(),
});

// Map a pumpkit event onto a 3ws attestation envelope.
function buildPayload({ event_type, agent_asset, token_mint, task_id, detail }) {
	const base = { v: 1, agent: agent_asset, ts: Math.floor(Date.now() / 1000) };
	switch (event_type) {
		case 'graduation':
			return {
				...base,
				kind: KIND_MAP.validation,
				task_hash: task_hash(task_id, token_mint),
				passed: true,
				source: 'pumpkit.graduation',
				token: token_mint,
			};
		case 'fee_claim':
			return {
				...base,
				kind: KIND_MAP.feedback,
				score: 5,
				source: 'pumpkit.fee_claim',
				token: token_mint,
				detail: detail ?? null,
			};
		case 'whale_trade':
			return {
				...base,
				kind: KIND_MAP.task,
				task_id,
				scope_hash: task_hash(task_id, token_mint),
				source: 'pumpkit.whale',
			};
		case 'cto_detected':
			return {
				...base,
				kind: KIND_MAP.validation,
				task_hash: task_hash(task_id, token_mint),
				passed: false,
				source: 'pumpkit.cto',
				token: token_mint,
			};
	}
}

function task_hash(task_id, token_mint) {
	return crypto.createHash('sha256').update(`${task_id}:${token_mint}`).digest('hex');
}

function verifyPumpkitSignature(req, raw) {
	const secret = process.env.PUMPKIT_WEBHOOK_SECRET;
	if (!secret) throw Object.assign(new Error('webhook secret not configured'), { status: 500 });
	const got = req.headers['x-pumpkit-signature'];
	if (!got || typeof got !== 'string') return false;
	const expect = crypto.createHmac('sha256', secret).update(raw).digest('hex');
	const a = Buffer.from(got, 'hex');
	const b = Buffer.from(expect, 'hex');
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loadAttesterKeypair() {
	const k = process.env.ATTEST_AGENT_SECRET_KEY;
	if (!k) throw Object.assign(new Error('attester key not configured'), { status: 500 });
	return Keypair.fromSecretKey(bs58.decode(k));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	// Read raw body once for HMAC, then parse.
	const raw = await readBuffered(req);
	if (!verifyPumpkitSignature(req, raw)) {
		return error(res, 401, 'unauthorized', 'invalid webhook signature');
	}
	let parsed;
	try { parsed = JSON.parse(raw.toString('utf8')); }
	catch { return error(res, 400, 'validation_error', 'invalid JSON'); }
	const body = parse(bodySchema, parsed);

	const payload = buildPayload(body);
	const memo = JSON.stringify(payload);

	const conn = new Connection(RPC[body.network], 'confirmed');
	const attester = loadAttesterKeypair();
	const agentKey = new PublicKey(body.agent_asset);

	// Memo with the agent asset as a signer-less referenced key, so
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
	const signature = await sendAndConfirmTransaction(conn, tx, [attester], {
		commitment: 'confirmed',
	});

	// Mirror into the index immediately; crawler dedupes via unique signature.
	// Verified semantics match _lib/solana-attestations.js#computeVerified for
	// non-owner kinds (feedback/validation/task): structurally valid -> true.
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

	return json(res, 201, { data: { signature, kind: payload.kind } });
});

async function readBuffered(req) {
	const chunks = [];
	let total = 0;
	for await (const c of req) {
		chunks.push(c);
		total += c.length;
		if (total > 64_000) throw Object.assign(new Error('payload too large'), { status: 413 });
	}
	return Buffer.concat(chunks);
}
