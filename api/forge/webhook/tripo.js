// @ts-check
// POST /api/forge/webhook/tripo: Tripo reporting a text-to-model /
// image-to-model task done or failed. Polling (pollJob in api/forge.js)
// stays the fallback when no webhook arrives in time or TRIPO_WEBHOOK_SECRET
// is unset; this endpoint only completes a job faster when it does.
//
// Same three properties as api/print/webhook/[provider].js, in the same
// order:
//
//   1. AUTHENTICITY. Tripo-Webhook-Signature is `t=<unix>,v1=<hex>`, an
//      HMAC-SHA256 of `{timestamp}.{raw body}` keyed on TRIPO_WEBHOOK_SECRET,
//      constant-time compared, with a 5 minute replay window. Unverified or
//      unconfigured (no secret set) never reaches JSON.parse.
//   2. IDEMPOTENCY. Tripo-Webhook-Delivery is claimed on forge_webhook_deliveries
//      before the payload's meaning is used, so a retried delivery is a 200
//      no-op.
//   3. ORDERING. materializeCreation is already idempotent on job status (a
//      second completion for a 'done' row returns its durable copy without
//      re-writing it), so an out-of-order or duplicate task.completed can
//      never regress a row that a prior poll already finished.
//
// Deliberately minimal completion, not pollJob's full richness (quality-gate
// scoring, result-cache population, failover redispatch): the webhook's job
// is to materialize or fail the row fast. A client still polling after the
// webhook lands sees the same 'done'/'failed' row and gets the full
// pollJob response on its next poll.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { error, json, method, readBody, wrap } from '../../_lib/http.js';
import {
	claimForgeWebhookDelivery,
	findByJobAnyClient,
	forgeStoreEnabled,
	markFailed,
	markForgeWebhookApplied,
	materializeCreation,
} from '../../_lib/forge-store.js';

const PROVIDER = 'tripo';
const MAX_BODY_BYTES = 256 * 1024;
const REPLAY_WINDOW_SECONDS = 300;

/**
 * @param {string} rawBody
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifySignature(rawBody, headers) {
	const secret = process.env.TRIPO_WEBHOOK_SECRET || '';
	if (!secret) return { ok: false, reason: 'webhook not configured (TRIPO_WEBHOOK_SECRET unset)' };

	const header = headers?.['tripo-webhook-signature'];
	const value = Array.isArray(header) ? header[0] : header;
	const m = /^t=(\d+),v1=([0-9a-f]+)$/i.exec(String(value || '').trim());
	if (!m) return { ok: false, reason: 'missing or malformed Tripo-Webhook-Signature' };

	const timestamp = Number(m[1]);
	const sig = m[2].toLowerCase();
	if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > REPLAY_WINDOW_SECONDS) {
		return { ok: false, reason: 'signature timestamp outside the replay window' };
	}

	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
	const a = Buffer.from(sig, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return { ok: false, reason: 'signature mismatch' };
	}
	return { ok: true };
}

/** Tripo's error.message (task.failed) or a generic note. */
function failureMessage(data) {
	const msg = data?.error?.message || data?.error?.code;
	return msg ? String(msg).slice(0, 500) : 'tripo task failed';
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;

	const raw = (await readBody(req, MAX_BODY_BYTES)).toString('utf8');
	const verdict = verifySignature(raw, req.headers || {});
	if (!verdict.ok) {
		return error(res, 401, 'unauthorized', verdict.reason || 'delivery could not be verified');
	}

	if (!forgeStoreEnabled()) {
		// 503 so Tripo retries: the delivery is genuine, we just cannot record it.
		return error(res, 503, 'not_configured', 'forge webhooks need a configured database');
	}

	const deliveryHeader = req.headers?.['tripo-webhook-delivery'];
	const deliveryId = String(Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader || '').trim();
	if (!deliveryId) {
		return error(res, 400, 'validation_error', 'missing Tripo-Webhook-Delivery header');
	}

	// Claim before parsing the body's meaning: the claim is what makes a retry
	// harmless, and it must happen even for a payload that turns out malformed,
	// an event type we end up ignoring (balance.low), or a task we cannot find a
	// row for. job_id is filled in below once it's known; a claim racing ahead
	// of that fill is still a correct, singular claim on (provider, delivery_id).
	const { fresh } = await claimForgeWebhookDelivery({ provider: PROVIDER, deliveryId, jobId: null });
	if (!fresh) {
		return json(res, 200, { ok: true, duplicate: true, applied: false });
	}

	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		return error(res, 400, 'validation_error', 'body must be JSON');
	}

	const eventType = String(payload?.type || '').trim();
	const data = payload?.data || {};
	const taskId = String(data?.task_id || '').trim();
	if (!taskId) {
		return error(res, 400, 'validation_error', 'body carries no data.task_id');
	}

	if (eventType !== 'task.completed' && eventType !== 'task.failed') {
		// balance.low and anything future: acknowledged, not applied to a job.
		return json(res, 200, { ok: true, applied: false, reason: `event '${eventType}' is informational` });
	}

	const existing = await findByJobAnyClient({ replicateJobId: taskId });
	if (!existing) {
		// Verified sender, unknown job (e.g. a task submitted before this row's
		// retention window, or outside forge entirely). Answer 200 so Tripo stops
		// retrying.
		return json(res, 200, { ok: true, applied: false, reason: 'no matching job' });
	}

	let applied = true;
	let status = existing.status;
	if (eventType === 'task.completed') {
		const modelUrl = data?.output?.model_url;
		if (!modelUrl) {
			applied = false;
			status = existing.status;
		} else {
			const result = await materializeCreation({
				replicateJobId: taskId,
				clientKey: existing.client_key,
				glbUrl: modelUrl,
			});
			status = result ? 'done' : existing.status;
			applied = Boolean(result);
		}
	} else {
		await markFailed({ replicateJobId: taskId, clientKey: existing.client_key, error: failureMessage(data) });
		status = 'failed';
	}

	await markForgeWebhookApplied({ provider: PROVIDER, deliveryId });

	return json(res, 200, { ok: true, applied, status });
});
