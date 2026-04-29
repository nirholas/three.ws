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
import { z } from 'zod';

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { recordEvent } from '../_lib/usage.js';
import {
	mintAttestation,
	loadAttesterKeypair,
	taskHash as _taskHash,
	buildPayload as _buildPayload,
} from '../_lib/attest-event.js';

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

// -- Pure helpers (re-exported for tests, backed by the shared core) -----

export const taskHash = _taskHash;
export const buildPayload = _buildPayload;

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

	const startedAt = Date.now();

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

	const [agent] = await sql`
		select id, user_id from agent_identities
		where meta->'onchain'->>'sol_asset' = ${body.agent_asset}
		   or meta->>'sol_mint_address'      = ${body.agent_asset}
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent_asset not registered');

	const result = await mintAttestation({
		event_id:    body.event_id,
		event_type:  body.event_type,
		source:      `pumpkit.${body.event_type === 'cto_detected' ? 'cto' : body.event_type === 'whale_trade' ? 'whale' : body.event_type}`,
		agent_asset: body.agent_asset,
		network:     body.network,
		token_mint:  body.token_mint,
		task_id:     body.task_id,
		detail:      body.detail,
		attester:    loadAttesterKeypair(),
	});

	const baseLog = {
		userId:    agent.user_id,
		agentId:   agent.id,
		kind:      'attest_event',
		tool:      `pumpkit.${body.event_type}`,
		latencyMs: Date.now() - startedAt,
		meta:      { network: body.network, event_id: body.event_id, signature: result.signature },
	};

	if (result.status === 'minted') {
		recordEvent({ ...baseLog, status: 'ok', meta: { ...baseLog.meta, kind: result.kind } });
		return json(res, 201, { data: { signature: result.signature, kind: result.kind, deduped: false } });
	}
	if (result.status === 'deduped') {
		recordEvent({ ...baseLog, status: 'deduped' });
		return json(res, 200, { data: { signature: result.signature, deduped: true } });
	}
	// in_progress
	recordEvent({ ...baseLog, status: 'in_progress' });
	return json(res, 202, { data: { deduped: true, status: 'in_progress' } });
});
